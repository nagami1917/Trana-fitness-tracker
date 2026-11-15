"""Leakage-checked walk-forward evaluation on a separate, consented CSV.

Every prediction uses only earlier sessions from the same pseudonymous user
and sport. The validation users must also be disjoint from every user in the
training CSV, preventing an apparently separate file from reusing athletes the
candidate has seen.

Run from ml/:
    python -m evaluation.validate_csv \\
      --csv /secure/path/holdout.csv \\
      --training-csv /secure/path/train.csv \\
      --artifacts-dir artifacts/duration_model-candidate \\
      --out artifacts/candidate-validation.json

Only aggregate metrics are printed or written; individual activity rows and
pseudonymous user IDs are never included in the report.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import pandas as pd

from duration_model.model_store import DurationModel
from duration_model.preprocess import DEFAULT_SPEED_KMH
from duration_model.train import ELEVATION_DENSITY_BINS, normalize_activities
from evaluation.geolife_validation import block_metrics


def _elevation_slices(rows: list[dict]) -> tuple[bool, dict[str, dict]]:
    """Metrics by ascent density, a proxy rather than an explicit terrain label."""
    available = any(float(row["elevation_gain_m"]) > 0 for row in rows)
    if not available:
        return False, {}

    slices: dict[str, dict] = {}
    for label, (lower, upper) in ELEVATION_DENSITY_BINS.items():
        bucket = [
            row for row in rows
            if (lower is None or row["elevation_gain_m"] / max(row["distance_km"], 0.1) >= lower)
            and (upper is None or row["elevation_gain_m"] / max(row["distance_km"], 0.1) < upper)
        ]
        if bucket:
            slices[label] = block_metrics(bucket)
    return True, slices


def evaluate_csv(
    frame: pd.DataFrame,
    model: DurationModel,
    training_user_ids: set[str] | None = None,
    calibration_user_ids: set[str] | None = None,
) -> dict:
    if not model.ready:
        raise SystemExit("candidate model is missing duration_model.joblib")

    card = model.card or {}
    training_source = card.get("training_source", "unknown")
    calibration_metadata = card.get("calibration")
    calibration_protocol = (calibration_metadata or {}).get("protocol")
    if training_user_ids is None and training_source != "synthetic":
        raise SystemExit("supply the training CSV so athlete overlap can be checked")
    if (
        calibration_metadata is not None
        and calibration_protocol != "held_out_user_groups"
        and calibration_user_ids is None
    ):
        raise SystemExit("supply --calibration-csv with the calibration CSV to verify athlete separation for this calibrated model")

    clean = normalize_activities(frame)
    clean["_sort_ts"] = pd.to_datetime(clean["started_at"], errors="coerce", utc=True)
    if clean["_sort_ts"].isna().any():
        raise SystemExit("validation CSV contains missing or invalid started_at timestamps")

    train_ids = {str(value).strip() for value in (training_user_ids or set())}
    calibration_ids = {str(value).strip() for value in (calibration_user_ids or set())}
    validation_ids = set(clean["user_id"].astype(str))
    if train_ids & calibration_ids:
        raise SystemExit("calibration users must be disjoint from training users")
    overlap_count = len(train_ids & validation_ids)
    calibration_overlap = len(calibration_ids & validation_ids)
    if overlap_count:
        raise SystemExit(
            "validation users must be disjoint from training users; "
            f"found {overlap_count} overlapping pseudonymous users"
        )
    if calibration_overlap:
        raise SystemExit(
            "validation users must be disjoint from calibration users; "
            f"found {calibration_overlap} overlapping pseudonymous users"
        )

    clean = clean.sort_values(["user_id", "activity_type", "_sort_ts", "id"], kind="mergesort")

    evaluated: list[dict] = []
    for (_user_id, activity_type), group in clean.groupby(["user_id", "activity_type"], sort=False):
        history: list[dict] = []
        for row in group.itertuples(index=False):
            distance = float(row.distance_km)
            elevation = float(row.elevation_gain_m)
            pred = model.predict(
                activity_type=str(activity_type),
                distance_km=distance,
                elevation_gain_m=elevation,
                experience=int(row.experience_level),
                history=history,
            )
            curve = pred["reference_curve"]
            raw_anchor = math.exp(curve["a"] + curve["b"] * math.log(max(distance, 0.1)))
            anchor = min(45.0 * max(distance, 0.1), max(2.0 * max(distance, 0.1), raw_anchor))
            evaluated.append({
                "activity_type": str(activity_type),
                "distance_km": distance,
                "elevation_gain_m": elevation,
                "actual_min": float(row.duration_min),
                "model_q50_min": float(pred["minutes"]),
                "model_q10_min": float(pred["range"]["low"]),
                "model_q90_min": float(pred["range"]["high"]),
                "pop_prior_min": 60.0 / DEFAULT_SPEED_KMH.get(str(activity_type), 6.0) * distance,
                "anchor_base_min": anchor,
                "history_len": len(history),
            })
            history.append({
                "activity_type": str(activity_type),
                "distance_km": distance,
                "duration_min": float(row.duration_min),
                "elevation_gain_m": elevation,
                "started_at": str(row.started_at),
            })

    modes = sorted({row["activity_type"] for row in evaluated})
    by_elevation_density = _elevation_slices(evaluated)
    elevation_available, elevation_metrics = by_elevation_density
    by_history = {
        "cold_start": block_metrics([row for row in evaluated if row["history_len"] == 0]),
        "one_prior_activity": block_metrics([row for row in evaluated if row["history_len"] == 1]),
        "two_or_more_prior_activities": block_metrics([row for row in evaluated if row["history_len"] >= 2]),
    }
    return {
        "name": "TRANA candidate duration-model validation",
        "model_version": (model.card or {}).get("version", "unknown"),
        "training_source": training_source,
        "validation_protocol": "disjoint training/calibration/validation athletes; chronological walk-forward using only the same user's earlier activities of the same sport",
        "dataset": {
            "rows_evaluated": len(evaluated),
            "users": int(clean["user_id"].nunique()),
            "training_user_overlap": overlap_count,
            "calibration_user_overlap": calibration_overlap,
            "by_activity_type": {mode: sum(row["activity_type"] == mode for row in evaluated) for mode in modes},
        },
        "overall": block_metrics(evaluated),
        "by_activity_type": {
            mode: block_metrics([row for row in evaluated if row["activity_type"] == mode])
            for mode in modes
        },
        "elevation_density_available": elevation_available,
        "elevation_density_definition": "elevation_gain_m / distance_km (m per km); ascent-density proxy, not a measured terrain label",
        "by_elevation_density": elevation_metrics,
        "by_history": by_history,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate a candidate duration model on a disjoint, consented CSV.")
    parser.add_argument("--csv", type=Path, required=True, help="separate validation CSV; never used for training")
    parser.add_argument("--training-csv", type=Path, default=None, help="training source CSV; required for real-data candidates and used only to check user overlap")
    parser.add_argument("--calibration-csv", type=Path, default=None, help="separate calibration CSV, required when candidate metadata records one")
    parser.add_argument("--artifacts-dir", type=Path, required=True, help="candidate model artifact directory")
    parser.add_argument("--out", type=Path, default=None, help="optional aggregate JSON report path")
    args = parser.parse_args()
    if not args.csv.is_file():
        raise SystemExit(f"validation CSV not found: {args.csv}")
    frame = pd.read_csv(args.csv, dtype={"user_id": "string"})
    training_user_ids = None
    if args.training_csv is not None:
        if not args.training_csv.is_file():
            raise SystemExit(f"training CSV not found: {args.training_csv}")
        training = normalize_activities(pd.read_csv(args.training_csv, dtype={"user_id": "string"}))
        training_user_ids = set(training["user_id"].astype(str))

    calibration_user_ids = None
    if args.calibration_csv is not None:
        if not args.calibration_csv.is_file():
            raise SystemExit(f"calibration CSV not found: {args.calibration_csv}")
        calibration = normalize_activities(pd.read_csv(args.calibration_csv, dtype={"user_id": "string"}))
        calibration_user_ids = set(calibration["user_id"].astype(str))

    model = DurationModel(args.artifacts_dir)
    report = evaluate_csv(frame, model, training_user_ids, calibration_user_ids)
    rendered = json.dumps(report, indent=2, allow_nan=False)
    print(rendered)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(rendered + "\n")


if __name__ == "__main__":
    main()
