"""External validation of the TRANA duration model on the GeoLife dataset.

TRANA's committed model is trained on a physics-informed synthetic corpus.
This module answers the obvious reviewer question — *does it agree with real,
measured movement?* — by evaluating it against the **GeoLife GPS Trajectories
Dataset** (Microsoft Research; Zheng et al., KDD 2008 / Scientific Data 2015),
using the processed per-trajectory feature table published in the
``Beijing-Trajectories-Project`` mirror.

Run
---
    python -m evaluation.geolife_validation              # uses committed CSV
    python -m evaluation.geolife_validation --tarball /path/geolife.tgz
    python -m evaluation/geolife_validation --fetch       # download source tarball

Protocol (mirrors how Trana predicts in production)
---------------------------------------------------
* Labelled ``walk``/``bike``/``run`` trajectories → ``walk``/``ride``/``run``.
* For every trajectory the model sees **only that same user's earlier
  trajectories of the same mode as history** — the personal reference curve
  Trana would build from a real user's log. No future data, no other users.
* Empty history → the model's own cold-start fallback (population speed),
  exactly like a brand-new Trana account.
* Elevation is not present in the GeoLife feature table → 0 m (documented);
  weight is not recorded → 60 kg (training-corpus median-ish); experience is
  inferred from history length, same as production.
* Durations are door-to-door elapsed times from GPS timestamps — the same
  quantity Trana predicts for a planned session.

Baselines
---------
* ``pop_prior``  — fixed population pace (DEFAULT_SPEED_KMH) for the mode.
* ``anchor_base`` — the user's personal Riegel curve **without** the
  gradient-boosted correction (isolates what the learned model adds).
"""

from __future__ import annotations

import argparse
import io
import json
import math
import sys
import tarfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pandas as pd  # noqa: E402

from duration_model.model_store import DurationModel  # noqa: E402
from duration_model.preprocess import DEFAULT_SPEED_KMH  # noqa: E402

# --------------------------------------------------------------------- source
SOURCE_REPO = "jbremz/Beijing-Trajectories-Project"
SOURCE_TARBALL_URL = (
    f"https://codeload.github.com/{SOURCE_REPO}/tar.gz/refs/heads/master"
)
DATASET_PAPER = (
    "Zheng, X., Xie, X., Wang, L., Yu, Y., Jiang, S. (2008). Mining interesting "
    "locations and travel sequences from GPS trajectories. WWW '08. "
    "Dataset: GeoLife v1.3, Microsoft Research, "
    "https://www.microsoft.com/en-us/research/publication/geolife-gps-trajectories-dataset/"
)
CSV_PATH = ROOT / "data" / "external" / "geolife_activities.csv"
DEFAULT_REPORT = ROOT / "evaluation" / "reports" / "geolife_validation.json"

MODE_MAP = {"walk": "walk", "bike": "ride", "run": "run"}
SPEED_TRIM_KMH = (0.5, 50.0)  # implausible GPS glitches (stops/excursions)
WEIGHT_KG = 60.0  # not recorded in GeoLife; near the training-corpus median
MIN_ROWS = 3500  # sanity floor for a full run (4,384 expected before trims)

# ------------------------------------------------------------------- metrics


def mae(actual: list[float], pred: list[float]) -> float | None:
    if not actual:
        return None
    return sum(abs(a - p) for a, p in zip(actual, pred)) / len(actual)


def mape_pct(actual: list[float], pred: list[float]) -> float | None:
    if not actual:
        return None
    return sum(abs(a - p) / a for a, p in zip(actual, pred)) / len(actual) * 100.0


def mdape_pct(actual: list[float], pred: list[float]) -> float | None:
    if not actual:
        return None
    errs = sorted(abs(a - p) / a for a, p in zip(actual, pred))
    mid = len(errs) // 2
    median = errs[mid] if len(errs) % 2 else (errs[mid - 1] + errs[mid]) / 2
    return median * 100.0


def within_pct(actual: list[float], pred: list[float], band: float) -> float | None:
    if not actual:
        return None
    hits = sum(1 for a, p in zip(actual, pred) if abs(a - p) / a <= band)
    return hits / len(actual) * 100.0


def r2(actual: list[float], pred: list[float]) -> float | None:
    # R² is meaningless on tiny slices (n < 10 → unstable, often hugely negative).
    if len(actual) < 10:
        return None
    mean = sum(actual) / len(actual)
    ss_tot = sum((a - mean) ** 2 for a in actual)
    if ss_tot <= 0:
        return None
    ss_res = sum((a - p) ** 2 for a, p in zip(actual, pred))
    return 1.0 - ss_res / ss_tot


def interval_coverage_pct(actual: list[float], low: list[float], high: list[float]) -> float | None:
    if not actual:
        return None
    hits = sum(1 for a, lo, hi in zip(actual, low, high) if lo <= a <= hi)
    return hits / len(actual) * 100.0


def _r(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(float(value), digits)


def block_metrics(rows: list[dict]) -> dict:
    """Aggregate one slice of evaluated rows into a report block."""
    if not rows:
        return {"n": 0}
    actual = [r["actual_min"] for r in rows]
    q50 = [r["model_q50_min"] for r in rows]
    pop = [r["pop_prior_min"] for r in rows]
    anchor = [r["anchor_base_min"] for r in rows]
    model_mae = mae(actual, q50)
    pop_mae = mae(actual, pop)
    anchor_mae = mae(actual, anchor)
    out = {
        "n": len(rows),
        "mae_min": _r(model_mae),
        "mape_pct": _r(mape_pct(actual, q50)),
        "mdape_pct": _r(mdape_pct(actual, q50)),
        "within_15_pct": _r(within_pct(actual, q50, 0.15)),
        "within_20_pct": _r(within_pct(actual, q50, 0.20)),
        "r2": _r(r2(actual, q50), 3),
        "interval_coverage_pct": _r(
            interval_coverage_pct(actual, [r["model_q10_min"] for r in rows],
                                  [r["model_q90_min"] for r in rows])
        ),
        "baseline_pop_prior_mae_min": _r(pop_mae),
        "baseline_anchor_base_mae_min": _r(anchor_mae),
    }
    if model_mae is not None and pop_mae:
        out["mae_improvement_vs_pop_prior_pct"] = _r((1.0 - model_mae / pop_mae) * 100.0, 1)
    if model_mae is not None and anchor_mae:
        out["mae_improvement_vs_anchor_base_pct"] = _r((1.0 - model_mae / anchor_mae) * 100.0, 1)
    return out


# ---------------------------------------------------------------- derivation


def derive_from_tarball(tarball: Path) -> pd.DataFrame:
    """Build the evaluation table from the mirror repo's trajFeatures.csv."""
    with tarfile.open(tarball, "r:gz") as tar:
        member = next(
            (m for m in tar.getmembers() if m.name.endswith("Metadata/trajFeatures.csv")),
            None,
        )
        if member is None:
            raise SystemExit("Metadata/trajFeatures.csv not found in tarball")
        raw = tar.extractfile(member)
        if raw is None:
            raise SystemExit("could not read trajFeatures.csv from tarball")
        frame = pd.read_csv(io.BytesIO(raw.read()))

    frame = frame[frame["Label-state"] == "Labelled"].copy()
    frame = frame[frame["Mode of Transport"].isin(MODE_MAP)].copy()
    frame = frame[(frame["Duration"] > 0) & (frame["Length"] > 0)].copy()

    frame["distance_km"] = frame["Length"] / 1000.0
    frame["duration_min"] = frame["Duration"]
    frame["speed_kmh"] = frame["distance_km"] / (frame["duration_min"] / 60.0)
    trimmed = ~frame["speed_kmh"].between(*SPEED_TRIM_KMH)
    frame = frame[~trimmed].copy()

    frame["user_id"] = frame["Path"].str.split("/").str[0]
    frame["activity_type"] = frame["Mode of Transport"].map(MODE_MAP)
    frame["start_time"] = frame["Path"].str.split("/").str[-1].str.replace(".csv", "", regex=False)
    frame["start_time"] = pd.to_datetime(frame["start_time"], format="%Y%m%d%H%M%S", errors="coerce")
    frame = frame[frame["start_time"].notna()].copy()

    out = frame[
        ["user_id", "activity_type", "Mode of Transport", "distance_km",
         "duration_min", "start_time", "Path"]
    ].rename(columns={"Mode of Transport": "mode_original", "Path": "source_path"})
    out = out.sort_values(["user_id", "activity_type", "start_time"]).reset_index(drop=True)
    out["distance_km"] = out["distance_km"].round(4)
    out["duration_min"] = out["duration_min"].round(3)
    out["start_time"] = out["start_time"].dt.strftime("%Y-%m-%d %H:%M:%S")
    return out


def save_csv(frame: pd.DataFrame, path: Path = CSV_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, index=False)
    return path


def load_csv(path: Path = CSV_PATH) -> pd.DataFrame:
    if not path.exists():
        raise SystemExit(
            f"{path} not found — run with --fetch (downloads from GitHub) "
            "or --tarball /path/to/geolife.tgz"
        )
    return pd.read_csv(path, dtype={"user_id": str})


# ---------------------------------------------------------------- evaluation


def evaluate_activities(frame: pd.DataFrame, model: DurationModel) -> dict:
    """Run the per-user, chronological validation protocol."""
    if not model.ready:
        raise SystemExit("no trained artifact — run `python -m duration_model.train` first")

    rows = frame.sort_values(["user_id", "activity_type", "start_time"])
    evaluated: list[dict] = []

    for (_user, activity_type), group in rows.groupby(["user_id", "activity_type"], sort=False):
        history: list[dict] = []
        for row in group.itertuples(index=False):
            pred = model.predict(
                activity_type=activity_type,
                distance_km=float(row.distance_km),
                elevation_gain_m=0.0,  # not recorded in GeoLife
                weight_kg=WEIGHT_KG,
                history=history,
                experience=None,  # inferred from history length, as in production
            )
            actual = float(row.duration_min)
            distance = float(row.distance_km)
            evaluated.append(
                {
                    "user_id": row.user_id,
                    "activity_type": activity_type,
                    "distance_km": distance,
                    "actual_min": actual,
                    "model_q50_min": float(pred["minutes"]),
                    "model_q10_min": float(pred["range"]["low"]),
                    "model_q90_min": float(pred["range"]["high"]),
                    "pop_prior_min": 60.0 / DEFAULT_SPEED_KMH.get(activity_type, 6.0) * distance,
                    "anchor_base_min": _anchor_base(distance, pred),
                    "history_len": len(history),
                }
            )
            history.append(
                {
                    "activity_type": activity_type,
                    "distance_km": distance,
                    "duration_min": actual,
                    "started_at": getattr(row, "start_time", None),
                }
            )

    by_mode: dict[str, dict] = {}
    for mode in sorted({r["activity_type"] for r in evaluated}):
        by_mode[mode] = block_metrics([r for r in evaluated if r["activity_type"] == mode])

    by_history = {
        "cold_start": block_metrics([r for r in evaluated if r["history_len"] == 0]),
        "thin_history_1": block_metrics([r for r in evaluated if r["history_len"] == 1]),
        "personalized_2plus": block_metrics([r for r in evaluated if r["history_len"] >= 2]),
    }

    in_domain = block_metrics(
        [r for r in evaluated
         if (r["activity_type"] == "walk" and r["distance_km"] >= 1.5)
         or (r["activity_type"] == "ride" and r["distance_km"] >= 10.0)
         or r["activity_type"] == "run"]
    )

    return {
        "dataset": {
            "rows_evaluated": len(evaluated),
            "users": int(frame["user_id"].nunique()),
            "by_mode": {m: int((frame["activity_type"] == m).sum()) for m in sorted(frame["activity_type"].unique())},
        },
        "overall": block_metrics(evaluated),
        "by_mode": by_mode,
        "by_history": by_history,
        "in_training_domain": in_domain,
    }


def _anchor_base(distance_km: float, pred: dict) -> float:
    """The personal Riegel anchor without the learned factor.

    ``pred`` carries the fitted reference curve; base = exp(a + b·ln d),
    then the same sanity clamp the model applies in ``preprocess.base_minutes``.
    """
    a = pred["reference_curve"]["a"]
    b = pred["reference_curve"]["b"]
    minutes = math.exp(a + b * math.log(max(distance_km, 0.1)))
    return float(min(45.0 * max(distance_km, 0.1), max(2.0 * max(distance_km, 0.1), minutes)))


# ---------------------------------------------------------------------- main


def build_report(frame: pd.DataFrame, model: DurationModel) -> dict:
    report = {
        "name": "TRANA external validation — GeoLife GPS Trajectories",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model_version": (model.card or {}).get("version", "unknown"),
        "source": {
            "dataset": "GeoLife GPS Trajectories Dataset (Microsoft Research)",
            "paper": DATASET_PAPER,
            "processed_feature_table": f"github.com/{SOURCE_REPO} (Metadata/trajFeatures.csv)",
            "modes_used": sorted(MODE_MAP.values()),
            "rows_input": int(len(frame)),
        },
        "protocol": {
            "history": "same user's earlier trajectories of the same mode (chronological, no future data)",
            "cold_start": "empty history → model's population-speed fallback (new-account behaviour)",
            "elevation_gain_m": 0.0,
            "weight_kg": WEIGHT_KG,
            "experience": "inferred from history length (production behaviour)",
            "speed_trim_kmh": list(SPEED_TRIM_KMH),
        },
        "limitations": [
            "GeoLife has no elevation in the feature table → elevation features are 0 (Beijing is flat).",
            "Durations are door-to-door elapsed GPS times (includes stops), matching Trana's elapsed-time target.",
            "Mode labels are transportation modes: bike→ride, walk→walk; motorised modes excluded; run has n=2.",
            "Weight and experience are synthetic assumptions, not measured per participant.",
        ],
    }
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

    print(f"\nGeoLife external validation — model {report['model_version']}")
    print(f"  {ds['rows_evaluated']} trajectories · {ds['users']} users · input {report['source']['rows_input']} rows")
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
            f"anchor_base={ov['baseline_anchor_base_mae_min']}m · "
            f"model={ov['mae_min']}m"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate the duration model on GeoLife")
    parser.add_argument("--fetch", action="store_true",
                        help=f"download the source tarball from {SOURCE_REPO} and rebuild the CSV")
    parser.add_argument("--tarball", type=Path, default=None,
                        help="rebuild the CSV from a local GeoLife-mirror tarball")
    parser.add_argument("--csv", type=Path, default=CSV_PATH, help="evaluation CSV path")
    parser.add_argument("--out", type=Path, default=DEFAULT_REPORT, help="report JSON path")
    parser.add_argument("--no-write", action="store_true", help="print only; do not write the report")
    args = parser.parse_args()

    if args.fetch:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as fh:
            tmp = Path(fh.name)
        print(f"downloading {SOURCE_TARBALL_URL} …")
        urllib.request.urlretrieve(SOURCE_TARBALL_URL, tmp)
        save_csv(derive_from_tarball(tmp), args.csv)
        tmp.unlink(missing_ok=True)
    elif args.tarball:
        save_csv(derive_from_tarball(args.tarball), args.csv)

    frame = load_csv(args.csv)
    model = DurationModel()
    report = build_report(frame, model)

    n = report["dataset"]["rows_evaluated"]
    if n < MIN_ROWS:
        raise SystemExit(f"only {n} rows evaluated (expected ≥ {MIN_ROWS}) — dataset incomplete?")

    print_report(report)

    if not args.no_write:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")
        print(f"report → {args.out}")


if __name__ == "__main__":
    main()
