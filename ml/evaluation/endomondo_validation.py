"""External validation of the TRANA duration model on the FitRec sample.

The FitRec sample package (Endomondo Sports Tracker exports, delivered as
``endomondoMeta.json.gz`` / ``endomondoHR.json.gz`` in the dataset owner's
Google Drive) is converted to Trana's activity CSV by
``ml/data/endomondo_to_csv.py``. This module runs the *same* per-user,
chronological protocol as the GeoLife validation — reusing
``evaluation.geolife_validation.evaluate_activities`` — so the two external
datasets are directly comparable.

The raw exports are never committed (dataset terms); only the derived CSV
(git-ignored, personal storage) and the aggregate report JSON (metrics only)
live around the repo.

Run
---
    python ml/data/endomondo_to_csv.py --meta …/endomondoMeta.json.gz --out …
    python -m evaluation.endomondo_validation                 # default CSV path
    python -m evaluation.endomondo_validation --csv /path.csv --out report.json

Protocol deltas vs GeoLife (documented in the report)
------------------------------------------------------
* Elevation is not extracted → elevation features are 0 (same as GeoLife).
* Weight is not recorded → 60 kg (training-corpus median-ish).
* When the export carries no user id, every workout is its own account, so
  history is empty and all rows are evaluated cold-start — noted honestly in
  the report instead of pretending to personalization.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from evaluation.geolife_validation import (  # noqa: E402
    evaluate_activities,
    load_csv,
)
from duration_model.model_store import DurationModel  # noqa: E402

CSV_PATH = ROOT / "data" / "external" / "endomondo_activities.csv"
DEFAULT_REPORT = ROOT / "evaluation" / "reports" / "endomondo_validation.json"

SOURCE = {
    "dataset": "FitRec sample package — Endomondo Sports Tracker exports "
    "(endomondoMeta.json.gz / endomondoHR.json.gz)",
    "citation": "Distributed to the project owner as the FitRec sample; source "
    "platform: Endomondo Sports Tracker (research release). "
    "See the Fitrec dataset page cited in the thesis. Raw exports are held in "
    "personal storage (Google Drive) and are not redistributed.",
    "modes_used": ["hike", "ride", "run", "walk"],
}


def build_report(frame, model: DurationModel) -> dict:
    users = int(frame["user_id"].nunique())
    rows = int(len(frame))
    cold_only = users >= rows  # no user ids → one account per workout

    report = {
        "name": "TRANA external validation — FitRec sample (Endomondo)",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model_version": (model.card or {}).get("version", "unknown"),
        "source": {**SOURCE, "rows_input": rows},
        "protocol": {
            "history": (
                "workout is its own account → no history (pure cold-start)"
                if cold_only
                else "same user's earlier sessions of the same mode (chronological, no future data)"
            ),
            "cold_start": "empty history → model's population-speed fallback (new-account behaviour)",
            "elevation_gain_m": 0.0,
            "weight_kg": 60.0,
            "experience": "inferred from history length (production behaviour)",
            "speed_trim_kmh": [0.5, 50.0],
            "derived_by": "ml/data/endomondo_to_csv.py (streaming sample of the raw exports)",
        },
        "limitations": [
            "Sample, not the full dataset — a strided/first-N subset chosen by --max/--stride.",
            "Elevation is present in the raw GPS series but not extracted → elevation features are 0.",
            "Heart rate is not a model feature; the HR export is only used to recover distance/duration.",
            "Weight is not recorded → 60 kg assumed; experience inferred, not measured.",
            "start_time is UTC-normalised from epoch timestamps; original local timezones are not preserved.",
            "Speeds outside 0.5–50 km/h (GPS glitches, stops) are trimmed, matching the GeoLife protocol.",
        ],
    }
    if cold_only:
        report["limitations"].append(
            "The export carries no user ids → personalization cannot be measured; "
            "all rows are cold-start population predictions."
        )
    report.update(evaluate_activities(frame, model))
    return report


def print_report(report: dict) -> None:
    ds = report["dataset"]

    def line(label: str, m: dict) -> None:
        if not m or not m.get("n"):
            print(f"  {label:<24} n=0")
            return
        print(
            f"  {label:<24} n={m['n']:<5} "
            f"MAE={m['mae_min']:>7.2f}m  MdAPE={m['mdape_pct']:>5.1f}%  "
            f"±15%={m['within_15_pct']:>5.1f}%  R²={str(m['r2']):>6}  "
            f"cov={m['interval_coverage_pct']}%"
        )

    print(f"\nFitRec/Endomondo external validation — model {report['model_version']}")
    print(f"  {ds['rows_evaluated']} sessions · {ds['users']} accounts · input {report['source']['rows_input']} rows")
    line("overall", report["overall"])
    for mode, metrics in report["by_mode"].items():
        line(f"mode: {mode}", metrics)
    for label, metrics in report["by_history"].items():
        line(label, metrics)
    line("in training domain", report["in_training_domain"])
    ov = report["overall"]
    if ov.get("n"):
        print(
            f"  baselines (overall MAE): pop_prior={ov['baseline_pop_prior_mae_min']}m · "
            f"anchor_base={ov['baseline_anchor_base_mae_min']}m · model={ov['mae_min']}m"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate the duration model on the FitRec sample")
    parser.add_argument("--csv", type=Path, default=CSV_PATH,
                        help="converted activity CSV (from ml/data/endomondo_to_csv.py)")
    parser.add_argument("--out", type=Path, default=DEFAULT_REPORT, help="report JSON path")
    parser.add_argument("--min-rows", type=int, default=500,
                        help="sanity floor for a full sample run")
    parser.add_argument("--no-write", action="store_true", help="print only; do not write the report")
    args = parser.parse_args()

    frame = load_csv(args.csv)
    model = DurationModel()
    report = build_report(frame, model)

    n = report["dataset"]["rows_evaluated"]
    if n < args.min_rows:
        raise SystemExit(
            f"only {n} rows evaluated (need ≥ {args.min_rows}) — dataset incomplete? "
            "re-run ml/data/endomondo_to_csv.py with a larger --max"
        )

    print_report(report)

    if not args.no_write:
        import json

        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"  report → {args.out}")


if __name__ == "__main__":
    main()
