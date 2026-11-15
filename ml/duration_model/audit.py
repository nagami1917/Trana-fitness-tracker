"""Privacy-first readiness audit for a TRANA duration-training CSV.

Run from ml/ before fitting a real-data candidate:
    python -m duration_model.audit --csv /secure/path/activities.csv

The report contains aggregate counts only; it never prints activity rows or
writes the supplied CSV back to disk.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from duration_model.train import (
    ALLOWED_ACTIVITY_COLUMNS,
    MIN_TRAIN_ROWS,
    MIN_TRAIN_USERS,
    normalize_activities,
)
from duration_model.calibrate import MIN_CALIBRATE_ROWS


def audit_activities(raw: pd.DataFrame) -> dict:
    clean = normalize_activities(raw)
    raw_columns = {str(column) for column in raw.columns}
    ignored = sorted(raw_columns - set(ALLOWED_ACTIVITY_COLUMNS))
    rows_by_mode = {
        str(mode): int(count)
        for mode, count in clean["activity_type"].value_counts().sort_index().items()
    }
    users_by_mode = {
        str(mode): int(group["user_id"].nunique())
        for mode, group in clean.groupby("activity_type", sort=True)
    }
    unique_users = int(clean["user_id"].nunique())
    timestamp_pct = 0.0
    if "started_at" in clean.columns and len(clean):
        parsed = pd.to_datetime(clean["started_at"], errors="coerce", utc=True)
        timestamp_pct = round(float(parsed.notna().mean() * 100), 2)

    warnings: list[str] = []
    if len(clean) < MIN_TRAIN_ROWS:
        warnings.append(f"Need {MIN_TRAIN_ROWS} valid activities for full retraining; currently {len(clean)}.")
    if unique_users < MIN_TRAIN_USERS:
        warnings.append(f"Need {MIN_TRAIN_USERS} distinct pseudonymous users for a user-level holdout; currently {unique_users}.")
    if len(clean) < MIN_CALIBRATE_ROWS:
        warnings.append(f"Need {MIN_CALIBRATE_ROWS} valid activities before interval calibration; currently {len(clean)}.")
    if timestamp_pct < 100:
        warnings.append("Add a valid started_at timestamp for every row so personal histories are ordered chronologically.")
    if unique_users < 2 and len(clean) >= MIN_CALIBRATE_ROWS:
        warnings.append("Calibration has only one athlete; 30 rows is a minimum, not evidence of cross-athlete coverage.")
    if "elevation_gain_m" not in raw.columns:
        warnings.append("elevation_gain_m is missing; the training pipeline will default it to 0 m and elevation slices will be unavailable.")
    elif not clean["elevation_gain_m"].gt(0).any():
        warnings.append("elevation_gain_m has no positive values; elevation-density evaluation slices will be unavailable.")
    if ignored:
        warnings.append(f"Unused columns will be dropped before training: {ignored}.")
    for mode in ("run", "ride", "walk", "hike"):
        if rows_by_mode.get(mode, 0) < 30:
            warnings.append(f"{mode} has fewer than 30 valid activities; its per-sport metrics will be weak or absent.")

    return {
        "rows_input": int(len(raw)),
        "rows_valid": int(len(clean)),
        "rows_dropped_by_quality_filters": int(len(raw) - len(clean)),
        "pseudonymous_users": unique_users,
        "rows_by_activity_type": rows_by_mode,
        "users_by_activity_type": users_by_mode,
        "valid_timestamps_pct": timestamp_pct,
        "uses_elevation": bool("elevation_gain_m" in raw.columns and clean["elevation_gain_m"].gt(0).any()),
        "ready_for_full_retraining": len(clean) >= MIN_TRAIN_ROWS and unique_users >= MIN_TRAIN_USERS,
        "ready_for_interval_calibration": len(clean) >= MIN_CALIBRATE_ROWS,
        "minimums_are_accuracy_guarantees": False,
        "minimums": {
            "activities_for_interval_calibration": MIN_CALIBRATE_ROWS,
            "activities_for_full_retraining": MIN_TRAIN_ROWS,
            "distinct_users_for_user_level_training_holdout": MIN_TRAIN_USERS,
        },
        "warnings": warnings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit a private CSV for TRANA duration-model training readiness.")
    parser.add_argument("--csv", type=Path, required=True, help="consented, anonymized activity CSV")
    args = parser.parse_args()
    if not args.csv.is_file():
        raise SystemExit(f"CSV not found: {args.csv}")
    raw = pd.read_csv(args.csv, dtype={"user_id": "string"})
    print(json.dumps(audit_activities(raw), indent=2))


if __name__ == "__main__":
    main()
