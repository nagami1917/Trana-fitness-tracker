"""Held-out-user retraining study: does real training data actually help?

The shipped duration model is trained on a synthetic corpus that
``data/generate_dataset.py`` generates from formulas. The GeoLife report then
measures it on real GPS activities and finds the honest numbers: 23.8% median
error, and an 80% interval that contains the truth 17% of the time.

That raises the obvious question - is the gap caused by *synthetic vs real*, or
is it simply how hard this problem is? This module answers it by retraining on
real GeoLife data and scoring both models on the **same held-out people**.

Protocol
--------
1. Split the 51 GeoLife users into train / holdout by user. No person appears on
   both sides, so nothing about a held-out athlete leaked into training.
2. Train a fresh model on the training users only
   (``duration_model.train --source csv``).
3. Score two models on the holdout users' activities, using the *same*
   per-user chronological walk-forward protocol that
   ``evaluation.geolife_validation`` uses, so the numbers are comparable:
     - the shipped synthetic model
     - the GeoLife-retrained model
4. Report the paired delta, and a bootstrap interval on it.

Why paired, and why the interval
--------------------------------
Both models see exactly the same rows, so per-row differences are far less
noisy than two independent evaluations. A point estimate alone invites the
question "is 0.6 min a real improvement or luck?", so the difference gets the
same treatment the ablation did - see ``evaluation/ablation.py``.

What this cannot claim
----------------------
* GeoLife is walks and rides (2 runs). A model trained only here cannot serve
  runs or hikes, so this is an *experiment*, not a drop-in replacement.
* Elevation is absent, so the two models are compared without it. The shipped
  model's strongest feature (``elevation_per_km``, 68% importance) is therefore
  neutralised in both arms - the comparison is fair but narrower than
  production.
* Training users and holdout users are disjoint, but both sets come from one
  city and one decade of GPS logging.

Run
---
    python -m evaluation.retrain_study
    python -m evaluation.retrain_study --json evaluation/reports/retrain_study.json
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from evaluation.geolife_validation import CSV_PATH, evaluate_activities, load_csv
from duration_model.model_store import ARTIFACTS, DurationModel

ML_ROOT = Path(__file__).resolve().parents[1]
REPORT_PATH = ML_ROOT / "evaluation" / "reports" / "retrain_study.json"

# Fractions of users, not rows. Splitting by user is the whole point: a random
# row split would let the same athlete appear in training and validation, and
# the per-user curve is fitted from that athlete's other rows.
HOLDOUT_USER_FRACTION = 0.30
SEED = 7
BOOTSTRAP_DRAWS = 2000

# Columns that must never reach the trainer. `source_path` embeds the raw GPS
# file path (a location identifier) and `mode_original` is redundant.
DROP_BEFORE_TRAINING = ("source_path", "mode_original")


def _split_users(frame: pd.DataFrame) -> tuple[list[str], list[str]]:
    """Deterministic user split with a minimum row count on each side."""
    users = sorted(frame["user_id"].astype(str).unique())
    rng = np.random.default_rng(SEED)
    shuffled = list(rng.permutation(users))

    n_holdout = max(1, int(round(len(users) * HOLDOUT_USER_FRACTION)))
    holdout = sorted(shuffled[:n_holdout])
    train = sorted(shuffled[n_holdout:])
    return train, holdout


def _prepare_training_csv(frame: pd.DataFrame, train_users: list[str], out: Path) -> Path:
    """Write the training split in the layout `train.py --source csv` expects."""
    keep = [c for c in frame.columns if c not in DROP_BEFORE_TRAINING]
    subset = frame[frame["user_id"].astype(str).isin(train_users)][keep].copy()
    subset.to_csv(out, index=False)
    return out


def _train(train_csv: Path, artifacts_dir: Path) -> dict:
    """Shell out to the real trainer so the study uses the shipped pipeline."""
    cmd = [
        sys.executable,
        "-m",
        "duration_model.train",
        "--source",
        "csv",
        "--csv",
        str(train_csv),
        "--artifacts-dir",
        str(artifacts_dir),
    ]
    proc = subprocess.run(cmd, cwd=ML_ROOT, capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit(
            "training failed\n"
            f"command: {' '.join(cmd)}\n"
            f"stdout: {proc.stdout[-2000:]}\n"
            f"stderr: {proc.stderr[-2000:]}"
        )
    card_path = artifacts_dir / "model_card.json"
    return json.loads(card_path.read_text())


def _score(frame: pd.DataFrame, model: DurationModel) -> dict:
    """Score one model on the holdout rows with the production protocol."""
    result = evaluate_activities(frame, model)
    overall = result["overall"]
    return {
        "n": overall["n"],
        "mae_min": overall["mae_min"],
        "mdape_pct": overall["mdape_pct"],
        "mape_pct": overall["mape_pct"],
        "within_20_pct": overall["within_20_pct"],
        "r2": overall["r2"],
        "interval_coverage_pct": overall["interval_coverage_pct"],
        "anchor_base_mae_min": overall["baseline_anchor_base_mae_min"],
        "_by_mode": result["by_mode"],
        "_by_history": result["by_history"],
    }


def _paired_rows(frame: pd.DataFrame, models: dict[str, DurationModel]) -> pd.DataFrame:
    """Per-row absolute errors for every model, on identical rows.

    Mirrors `evaluate_activities` row-for-row (same sort, same walk-forward
    history) so the paired bootstrap compares predictions of the same activity,
    not two independently-aggregated evaluations.
    """
    rows = frame.sort_values(["user_id", "activity_type", "start_time"])
    records: list[dict] = []

    for (_user, activity_type), group in rows.groupby(["user_id", "activity_type"], sort=False):
        history: list[dict] = []
        for row in group.itertuples(index=False):
            distance = float(row.distance_km)
            actual = float(row.duration_min)

            record = {"actual": actual, "activity_type": activity_type}
            for name, model in models.items():
                pred = model.predict(
                    activity_type=activity_type,
                    distance_km=distance,
                    elevation_gain_m=0.0,
                    weight_kg=60.0,
                    history=history,
                    experience=None,
                )
                record[f"{name}_pred"] = float(pred["minutes"])

            records.append(record)
            history.append(
                {
                    "activity_type": activity_type,
                    "distance_km": distance,
                    "duration_min": actual,
                    "started_at": getattr(row, "start_time", None),
                }
            )

    return pd.DataFrame(records)


def _bootstrap_delta(rows: pd.DataFrame, a: str, b: str, draws: int = BOOTSTRAP_DRAWS) -> dict:
    """Paired bootstrap of MAE(a) - MAE(b). Negative means `a` is better."""
    err_a = np.abs(rows["actual"].to_numpy() - rows[f"{a}_pred"].to_numpy())
    err_b = np.abs(rows["actual"].to_numpy() - rows[f"{b}_pred"].to_numpy())
    n = len(err_a)
    if n < 30:
        return {"draws": 0, "note": "too few rows for a meaningful interval"}

    rng = np.random.default_rng(SEED)
    diffs = np.empty(draws, dtype=float)
    for i in range(draws):
        idx = rng.integers(0, n, n)
        diffs[i] = err_a[idx].mean() - err_b[idx].mean()

    point = float(err_a.mean() - err_b.mean())
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    better = float((diffs < 0).sum()) + 0.5 * float((diffs == 0).sum())
    return {
        "draws": draws,
        "mae_delta_min": round(point, 3),
        "ci95_low_min": round(float(lo), 3),
        "ci95_high_min": round(float(hi), 3),
        "share_draws_a_better_pct": round(better / draws * 100.0, 1),
        "excludes_zero": not (lo <= 0.0 <= hi),
        "a": a,
        "b": b,
        "note": f"MAE({a}) - MAE({b}); negative means {a} has the lower error",
    }


def _verdict(delta: dict, synthetic: dict, retrained: dict) -> dict:
    if not delta.get("draws"):
        return {"recommendation": "inconclusive", "reason": "not enough holdout rows"}

    if delta["excludes_zero"] and delta["mae_delta_min"] < 0:
        return {
            "recommendation": "real-data training helps — retraining is worth pursuing",
            "reason": (
                f"The retrained model is better by {-delta['mae_delta_min']:.2f} min MAE on held-out "
                f"people (95% CI [{delta['ci95_low_min']}, {delta['ci95_high_min']}]), which excludes "
                f"zero. Interval coverage moved from {synthetic['interval_coverage_pct']}% to "
                f"{retrained['interval_coverage_pct']}%."
            ),
        }
    if delta["excludes_zero"] and delta["mae_delta_min"] > 0:
        return {
            "recommendation": "the synthetic model generalises better — do not retrain on GeoLife",
            "reason": (
                f"The synthetic model is better by {delta['mae_delta_min']:.2f} min MAE on held-out "
                f"people (95% CI [{delta['ci95_low_min']}, {delta['ci95_high_min']}]). "
                "Real training data did not help on this corpus."
            ),
        }
    return {
        "recommendation": "no measurable difference — retraining did not change accuracy",
        "reason": (
            f"The 95% CI on the MAE difference straddles zero "
            f"([{delta['ci95_low_min']}, {delta['ci95_high_min']}] min). Retraining on real data "
            f"moved interval coverage from {synthetic['interval_coverage_pct']}% to "
            f"{retrained['interval_coverage_pct']}%, which may still be worth reporting."
        ),
    }


def _fmt(block: dict) -> str:
    if not block.get("n"):
        return "n=0"
    return (
        f"n={block['n']:5d}  MAE={block['mae_min']:5.2f}m  MdAPE={block['mdape_pct']:5.1f}%  "
        f"cov={block['interval_coverage_pct']:5.1f}%  R2={block['r2']}"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=CSV_PATH)
    parser.add_argument("--json", type=Path, default=None)
    parser.add_argument("--holdout-fraction", type=float, default=HOLDOUT_USER_FRACTION)
    parser.add_argument("--keep-artifacts", type=Path, default=None,
                        help="write the retrained artifacts here instead of a temp dir")
    args = parser.parse_args(argv)

    frame = load_csv(args.csv)
    frame["user_id"] = frame["user_id"].astype(str)

    train_users, holdout_users = _split_users(frame)
    holdout_frame = frame[frame["user_id"].isin(holdout_users)].copy()

    print("TRANA held-out retraining study")
    print(f"  corpus        {len(frame)} activities / {frame['user_id'].nunique()} users")
    print(f"  train users   {len(train_users)}  ({len(frame) - len(holdout_frame)} activities)")
    print(f"  holdout users {len(holdout_users)}  ({len(holdout_frame)} activities)")
    print(f"  mode mix      {holdout_frame['activity_type'].value_counts().to_dict()}")

    workdir = Path(tempfile.mkdtemp(prefix="trana-retrain-"))
    artifacts = Path(args.keep_artifacts) if args.keep_artifacts else workdir / "artifacts"
    train_csv = workdir / "train_users.csv"

    try:
        _prepare_training_csv(frame, train_users, train_csv)
        print("\n  training on the training users...")
        card = _train(train_csv, artifacts)
        print(f"  done — candidate version {card.get('version')}, source {card.get('training_source')}")

        synthetic_model = DurationModel(ARTIFACTS)
        retrained_model = DurationModel(artifacts)
        if not synthetic_model.ready:
            raise SystemExit("the shipped artifact is missing — cannot compare")
        if not retrained_model.ready:
            raise SystemExit("the retrained artifact did not load")

        synthetic = _score(holdout_frame, synthetic_model)
        retrained = _score(holdout_frame, retrained_model)

        rows = _paired_rows(holdout_frame, {"synthetic": synthetic_model, "retrained": retrained_model})
        delta = _bootstrap_delta(rows, "synthetic", "retrained")
        verdict = _verdict(delta, synthetic, retrained)

        print("\n  HELD-OUT USERS (never seen in training)")
        print(f"    shipped (synthetic-trained)  {_fmt(synthetic)}")
        print(f"    retrained (GeoLife, {len(train_users)} users) {_fmt(retrained)}")
        if delta.get("draws"):
            print(
                f"\n  paired bootstrap ({delta['draws']} draws): MAE delta "
                f"{delta['mae_delta_min']:+.3f} min "
                f"[{delta['ci95_low_min']:+.3f}, {delta['ci95_high_min']:+.3f}]  "
                f"retrained better in {delta['share_draws_a_better_pct']}% of draws"
            )
        print(f"\n  VERDICT: {verdict['recommendation']}")
        print(f"    {verdict['reason']}")

        report = {
            "name": "TRANA held-out retraining study",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "question": (
                "Does training on real GPS data beat training on the synthetic corpus, "
                "measured on people neither model has seen?"
            ),
            "protocol": {
                "split": "by user — no person appears in both training and holdout",
                "holdout_user_fraction": args.holdout_fraction,
                "seed": SEED,
                "bootstrap_draws": BOOTSTRAP_DRAWS,
                "evaluation": (
                    "per-user chronological walk-forward, identical to evaluation.geolife_validation, "
                    "so the shipped-model arm reproduces the published report"
                ),
                "elevation": "absent from GeoLife — zeroed for both models",
            },
            "dataset": {
                "rows": int(len(frame)),
                "users": int(frame["user_id"].nunique()),
                "train_users": len(train_users),
                "holdout_users": len(holdout_users),
                "holdout_rows": int(len(holdout_frame)),
                "holdout_mode_mix": {k: int(v) for k, v in holdout_frame["activity_type"].value_counts().items()},
            },
            "candidate_card": {
                "version": card.get("version"),
                "training_source": card.get("training_source"),
                "corpus_rows": card.get("corpus_rows"),
                "trainer_holdout_metrics": card.get("metrics"),
            },
            "holdout_scores": {"synthetic": synthetic, "retrained": retrained},
            "paired_bootstrap": delta,
            "verdict": verdict,
            "limitations": [
                "GeoLife is walks and rides (2 runs); a model trained only on it cannot serve runs or hikes.",
                "Elevation is absent, so both models are compared without the shipped model's strongest feature.",
                "Train and holdout users are disjoint, but all come from one city and one decade of GPS logging.",
                "The candidate is evaluated as an experiment and is not deployed by this script.",
            ],
        }

        out = Path(args.json) if args.json else REPORT_PATH
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2, default=float) + "\n")
        print(f"\n  report -> {out}")

        if args.keep_artifacts:
            print(f"  artifacts -> {args.keep_artifacts}")
        return 0
    finally:
        if not args.keep_artifacts:
            shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
