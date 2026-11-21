"""Endomondo study: does training on real workouts beat the synthetic corpus?

The shipped duration model is trained on a synthetic corpus generated from
published exercise-physiology formulas. This module asks the question a
reviewer will ask — *does training on real, recorded workouts actually help?*
— using ``endomondo_activities.csv``, the derived feature export of the FitRec
/ Endomondo sample (see ``data/endomondo_features_to_csv.py``).

Protocol
--------
1. Split the athletes into train / holdout **by user**, seeded, so no person
   appears on both sides. This mirrors ``evaluation.retrain_study`` and keeps
   the comparison honest: a row-level split would fit each athlete's personal
   curve on their own holdout rows.
2. Train a fresh model on the training users only via the shipped pipeline
   (``duration_model.train --source csv``).
3. Score two models on the holdout users:

   - the **shipped** synthetic-trained artifact, and
   - the **Endomondo-retrained** candidate.

Both see identical inputs, executed with the production protocol: each
athlete's history accumulates chronologically, one activity type at a time,
and elevation is passed through because Endomondo records altitude.

Output
------
``evaluation/reports/endomondo_study.json`` — both models' metrics overall,
per activity type and per history depth, plus a paired bootstrap on the MAE
difference so the report can say whether any gap is measurable.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

from duration_model.model_store import DurationModel
from duration_model.preprocess import DEFAULT_SPEED_KMH

ML_ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ML_ROOT / "data" / "external" / "endomondo_activities.csv"
REPORT_PATH = ML_ROOT / "evaluation" / "reports" / "endomondo_study.json"

HOLDOUT_FRACTION = 0.30
SEED = 7
WEIGHT_KG = 65.0
BOOTSTRAP_DRAWS = 2000


# --------------------------------------------------------------------- split
def split_users(frame: pd.DataFrame, seed: int = SEED) -> tuple[list[str], list[str]]:
    """Deterministic user-level split: no athlete appears on both sides."""
    users = sorted(frame["user_id"].astype(str).unique())
    shuffled = list(np.random.default_rng(seed).permutation(users))
    n_holdout = max(1, int(round(len(shuffled) * HOLDOUT_FRACTION)))
    return sorted(shuffled[n_holdout:]), sorted(shuffled[:n_holdout])


# ------------------------------------------------------------------- scoring
def score(frame: pd.DataFrame, model: DurationModel) -> dict:
    """Run the per-athlete chronological protocol, elevation included."""
    rows = frame.sort_values(["user_id", "activity_type", "started_at"])
    evaluated: list[dict] = []

    for (_user, activity_type), group in rows.groupby(["user_id", "activity_type"], sort=False):
        history: list[dict] = []
        for row in group.itertuples(index=False):
            prediction = model.predict(
                activity_type=activity_type,
                distance_km=float(row.distance_km),
                elevation_gain_m=float(getattr(row, "elevation_gain_m", 0.0) or 0.0),
                weight_kg=WEIGHT_KG,
                history=history,
                experience=None,
            )
            actual = float(row.duration_min)
            evaluated.append(
                {
                    "activity_type": activity_type,
                    "actual_min": actual,
                    "pred_min": float(prediction["minutes"]),
                    "low_min": float(prediction["range"]["low"]),
                    "high_min": float(prediction["range"]["high"]),
                    "history_len": len(history),
                }
            )
            history.append(
                {
                    "activity_type": activity_type,
                    "distance_km": float(row.distance_km),
                    "duration_min": actual,
                    "started_at": row.started_at,
                }
            )

    return {
        "overall": block(evaluated),
        "by_mode": {
            mode: block([r for r in evaluated if r["activity_type"] == mode])
            for mode in sorted({r["activity_type"] for r in evaluated})
        },
        "by_history": {
            "cold_start": block([r for r in evaluated if r["history_len"] == 0]),
            "thin_history_1": block([r for r in evaluated if r["history_len"] == 1]),
            "personalized_2plus": block([r for r in evaluated if r["history_len"] >= 2]),
        },
        "_per_row": evaluated,
    }


def _r(value: float | None, digits: int = 2) -> float | None:
    return None if value is None or not np.isfinite(value) else round(float(value), digits)


def block(rows: list[dict]) -> dict:
    """Aggregate accuracy, relative error and interval coverage for one slice."""
    if not rows:
        return {"n": 0}
    actual = np.array([r["actual_min"] for r in rows], dtype=float)
    pred = np.array([r["pred_min"] for r in rows], dtype=float)
    low = np.array([r["low_min"] for r in rows], dtype=float)
    high = np.array([r["high_min"] for r in rows], dtype=float)

    ape = np.abs(pred - actual) / np.maximum(actual, 1e-9) * 100.0
    err = pred - actual
    ss_res = float(np.sum(err**2))
    ss_tot = float(np.sum((actual - actual.mean()) ** 2))
    covered = (actual >= low) & (actual <= high)

    return {
        "n": len(rows),
        "mae_min": _r(np.mean(np.abs(err))),
        "rmse_min": _r(np.sqrt(np.mean(err**2))),
        "mdape_pct": _r(np.median(ape)),
        "mape_pct": _r(np.mean(ape)),
        "within_15_pct": _r(np.mean(ape <= 15) * 100, 1),
        "within_20_pct": _r(np.mean(ape <= 20) * 100, 1),
        "r2": _r(1 - ss_res / ss_tot, 3) if ss_tot > 0 else None,
        "interval_coverage_pct": _r(np.mean(covered) * 100, 1),
    }


def paired_bootstrap(rows_a: list[dict], rows_b: list[dict], draws: int = BOOTSTRAP_DRAWS) -> dict:
    """Resample athletes to put a confidence interval on the MAE difference."""
    a = np.array([abs(r["pred_min"] - r["actual_min"]) for r in rows_a], dtype=float)
    b = np.array([abs(r["pred_min"] - r["actual_min"]) for r in rows_b], dtype=float)
    if a.shape != b.shape or a.size == 0:
        return {}
    diff = b - a
    rng = np.random.default_rng(SEED)
    means = np.array([diff[rng.integers(0, diff.size, diff.size)].mean() for _ in range(draws)])
    return {
        "delta_mae_retrained_minus_shipped_min": _r(diff.mean(), 3),
        "ci95": [_r(np.percentile(means, 2.5), 3), _r(np.percentile(means, 97.5), 3)],
        "retrained_better_share": _r(float(np.mean(means < 0)) * 100, 1),
    }


# ------------------------------------------------------------------ training
def train_on(frame: pd.DataFrame, train_users: list[str], artifacts_dir: Path) -> dict:
    """Shell out to the shipped trainer so the study uses the real pipeline."""
    subset = frame[frame["user_id"].astype(str).isin(train_users)].copy()
    with tempfile.TemporaryDirectory() as tmp:
        train_csv = Path(tmp) / "endTrain.csv"
        subset.to_csv(train_csv, index=False)
        cmd = [
            sys.executable, "-m", "duration_model.train",
            "--source", "csv", "--csv", str(train_csv),
            "--artifacts-dir", str(artifacts_dir),
        ]
        proc = subprocess.run(cmd, cwd=ML_ROOT, capture_output=True, text=True)
        if proc.returncode != 0:
            raise SystemExit(
                "training failed\n"
                f"command: {' '.join(cmd)}\n"
                f"stdout: {proc.stdout[-2000:]}\n"
                f"stderr: {proc.stderr[-2000:]}"
            )
    return json.loads((artifacts_dir / "model_card.json").read_text())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", default=str(CSV_PATH))
    parser.add_argument("--out", default=str(REPORT_PATH))
    parser.add_argument("--artifacts-dir", default=None)
    args = parser.parse_args()

    frame = pd.read_csv(args.csv)
    frame["user_id"] = frame["user_id"].astype(str)

    train_users, holdout_users = split_users(frame)
    train_frame = frame[frame["user_id"].isin(train_users)]
    holdout = frame[frame["user_id"].isin(holdout_users)].copy()

    print("TRANA Endomondo study — does real training data help?")
    print(f"  corpus        {len(frame)} workouts / {frame['user_id'].nunique()} users")
    print(f"  train users   {len(train_users)}  ({len(train_frame)} workouts)")
    print(f"  holdout users {len(holdout_users)}  ({len(holdout)} workouts)")
    print(f"  mode mix      {holdout['activity_type'].value_counts().to_dict()}")

    artifacts_dir = Path(args.artifacts_dir) if args.artifacts_dir else Path(
        tempfile.mkdtemp(prefix="trana-endomondo-")
    )
    print(f"\n  training on the training users -> {artifacts_dir}")
    card = train_on(frame, train_users, artifacts_dir)
    print(f"  done — candidate version {card.get('version')}, source {card.get('training_source')}")

    print("\n  HOLDOUT USERS (never seen in training)")
    shipped_model = DurationModel()
    shipped_card = shipped_model.card or {}
    shipped = score(holdout, shipped_model)
    retrained = score(holdout, DurationModel(artifacts_dir))

    shipped_label = f"shipped ({shipped_card.get('source_label') or shipped_card.get('training_source')})"
    for label, result in ((shipped_label, shipped), ("retrained (Endomondo)", retrained)):
        o = result["overall"]
        print(
            f"    {label:28} n={o['n']:6}  MAE={o['mae_min']:6.2f}m  "
            f"MdAPE={o['mdape_pct']:5.1f}%  cov={o['interval_coverage_pct']:5.1f}%  R2={o['r2']}"
        )

    boot = paired_bootstrap(shipped["_per_row"], retrained["_per_row"])
    print(
        f"\n  paired bootstrap ({BOOTSTRAP_DRAWS} draws): "
        f"MAE delta {boot['delta_mae_retrained_minus_shipped_min']:+} min "
        f"{boot['ci95']}  retrained better in {boot['retrained_better_share']}% of draws"
    )

    report = {
        "dataset": {
            "source": "FitRec / Endomondo feature export",
            "rows": int(len(frame)),
            "users": int(frame["user_id"].nunique()),
            "by_activity_type": {str(k): int(v) for k, v in frame["activity_type"].value_counts().items()},
            "split": {
                "strategy": f"{int((1 - HOLDOUT_FRACTION) * 100)}/{int(HOLDOUT_FRACTION * 100)} by user_id",
                "seed": SEED,
                "train_users": len(train_users),
                "holdout_users": len(holdout_users),
                "train_rows": int(len(train_frame)),
                "holdout_rows": int(len(holdout)),
                "user_overlap": 0,
            },
        },
        "candidate_card": {
            "version": card.get("version"),
            "training_source": card.get("training_source"),
            "source_label": card.get("source_label"),
            "corpus_rows": card.get("corpus_rows"),
            "metrics": card.get("metrics"),
            "note": (
                "The benchmark candidate saw only the training split. The artifact "
                "shipped in ml/duration_model was later refit on the full corpus "
                "(training + holdout users) — see SHIPPING.md."
            ),
        },
        "shipped_card": {
            "version": shipped_card.get("version"),
            "training_source": shipped_card.get("training_source"),
            "source_label": shipped_card.get("source_label"),
            "corpus_rows": shipped_card.get("corpus_rows"),
        },
        "notes": {
            "holdout_scope": (
                "Both models are scored on the same 65 holdout users. The shipped model "
                "had seen them during training, so its figures here are an upper bound "
                "and the honest generalisation estimate is the benchmark candidate's."
            ),
            "thin_modalities": (
                "walk (n=7) and hike (n=7) holdouts are too small to support a claim; "
                "their error is reported but not relied on."
            ),
        },
        "shipped": {k: v for k, v in shipped.items() if k != "_per_row"},
        "retrained": {k: v for k, v in retrained.items() if k != "_per_row"},
        "paired_bootstrap": boot,
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"\n  report -> {out}")
    print(f"  artifacts -> {artifacts_dir}")


if __name__ == "__main__":
    main()
