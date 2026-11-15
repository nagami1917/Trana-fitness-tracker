"""Train TRANA's duration model.

Three gradient-boosted quantile regressors predict the 10th / 50th / 90th
percentile of the time an athlete needs for a planned session, which gives the
UI an honest "estimated range" instead of a single over-confident number.

Split discipline
----------------
Activities are split **by user_id** (`GroupShuffleSplit`) *before* constructing
chronological per-user anchors (`training_frame`), preventing both user-level
memorization and future-to-past target leakage.

Artifacts
---------
duration_model/duration_model.joblib   : scikit-learn object (used by FastAPI)
duration_model/duration_model.json     : the same trees as plain JSON so the PWA can
                                         evaluate them in the browser while offline
duration_model/model_card.json         : metrics + feature names, surfaced in the UI

Run
---
    python -m duration_model.audit --csv /secure/path/activities.csv
    python -m duration_model.train --source csv --csv /secure/path/train.csv

All CLI runs write to a local candidate artifact directory by default; they do
not replace the shipped model.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GroupShuffleSplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from duration_model.preprocess import FEATURE_ORDER, SPEED_BOUNDS_KMH, training_frame  # noqa: E402

ARTIFACTS = Path(__file__).resolve().parent
CANDIDATE_ARTIFACTS = ROOT / "artifacts" / "duration_model-candidate"
DATA = ROOT / "data"

QUANTILES = {"q10": 0.10, "q50": 0.50, "q90": 0.90}
MIN_TRAIN_ROWS = 200
MIN_TRAIN_USERS = 5
ALLOWED_ACTIVITY_COLUMNS = (
    "id", "user_id", "activity_type", "distance_km", "duration_min",
    "started_at", "start_time", "elevation_gain_m", "experience_level",
)
SENSITIVE_COLUMN_TOKENS = {
    "email", "name", "username", "phone", "mobile", "telephone",
    "address", "street", "postal", "zipcode", "postcode",
    "account", "profile", "athlete", "customer", "member", "device", "auth", "token",
    "external", "supabase", "uuid", "identifier", "birth", "dob", "ssn", "passport",
    "latitude", "longitude", "lat", "lon", "lng", "coordinate", "coordinates",
    "gps", "route", "polyline", "gpx", "track", "trace", "trajectory", "location",
    "geohash", "geocode", "geolocation", "geometry", "position", "map", "path",
}
SUPPORTED_ACTIVITY_TYPES = {"run", "ride", "walk", "hike"}
ELEVATION_DENSITY_BINS = {
    "low_lt_20_m_per_km": (None, 20.0),
    "moderate_20_to_60_m_per_km": (20.0, 60.0),
    "high_ge_60_m_per_km": (60.0, None),
}


def _sensitive_column_name(column: object) -> bool:
    # Also split camelCase and punctuation, then check the compact name so
    # fullname, phoneNumber, routePolyline, and similar aliases are caught.
    name = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", str(column))
    parts = [part for part in re.split(r"[^a-zA-Z0-9]+", name.casefold()) if part]
    compact = "".join(parts)
    return any(token in parts or token in compact for token in SENSITIVE_COLUMN_TOKENS)


def _validate_artifacts_dir(path: Path) -> Path:
    destination = path.resolve()
    repository = ROOT.parent.resolve()
    safe_root = (ROOT / "artifacts").resolve()
    if destination == ARTIFACTS.resolve() or (
        destination.is_relative_to(repository) and not destination.is_relative_to(safe_root)
    ):
        raise SystemExit(
            "training writes are candidate-only; use ml/artifacts/ or a secure directory outside the repository"
        )
    return path


def _phone_like_user_id(ids: pd.Series) -> pd.Series:
    digits = ids.str.replace(r"\D", "", regex=True)
    phone_shape = ids.str.fullmatch(r"[+0-9() .-]+", na=False)
    return phone_shape & digits.str.len().between(10, 15)


def normalize_activities(frame: pd.DataFrame) -> pd.DataFrame:
    """Validate and minimize a local activity table before model use.

    Required: stable pseudonymous ``user_id``, ``activity_type``, positive
    ``distance_km`` and elapsed ``duration_min``, and a valid ``started_at``
    timestamp (``start_time`` is accepted as an alias). Optional model context
    is ``elevation_gain_m`` and an at-the-time ``experience_level``. Raw IDs
    other than ``user_id`` are discarded; body weight is not a duration feature.
    Direct identifiers and raw route/location columns are rejected, while all
    other unused columns are dropped before feature construction.
    """
    from duration_model.preprocess import experience_level

    if not frame.columns.is_unique:
        raise SystemExit("training table must not contain duplicate column names")
    out = frame.copy().reset_index(drop=True)
    sensitive = sorted(str(column) for column in out.columns if _sensitive_column_name(column))
    if sensitive:
        raise SystemExit(
            "training data must not contain personal or raw location columns; "
            f"remove: {sensitive}"
        )

    if "started_at" not in out.columns and "start_time" in out.columns:
        out = out.rename(columns={"start_time": "started_at"})

    required = {"user_id", "activity_type", "distance_km", "duration_min", "started_at"}
    missing = required - set(out.columns)
    if missing:
        raise SystemExit(f"training table is missing required columns: {sorted(missing)}")

    out = out[[column for column in ALLOWED_ACTIVITY_COLUMNS if column in out.columns]].copy()
    ids = out["user_id"].astype("string").str.strip()
    if ids.isna().any() or ids.eq("").any():
        raise SystemExit("user_id must be present and pseudonymous for every activity")
    if ids.str.contains(r"@", regex=True, na=False).any():
        raise SystemExit("user_id must be pseudonymous, not an email address")
    if _phone_like_user_id(ids).any():
        raise SystemExit("user_id must be pseudonymous, not a phone-number-like value")
    out["user_id"] = ids

    out["activity_type"] = out["activity_type"].astype("string").str.strip().str.lower()
    invalid_types = sorted(set(out["activity_type"].dropna()) - SUPPORTED_ACTIVITY_TYPES)
    if out["activity_type"].isna().any() or invalid_types:
        raise SystemExit(
            "activity_type must be one of run, ride, walk, hike; "
            f"invalid values: {invalid_types}"
        )

    out["started_at"] = pd.to_datetime(out["started_at"], errors="coerce", utc=True)
    if out["started_at"].isna().any():
        raise SystemExit("started_at must contain a valid timestamp for every activity")

    # Never retain a source row id, which may be an internal database key.
    # A local deterministic tie-breaker is sufficient for equal timestamps.
    out["id"] = range(1, len(out) + 1)
    out["distance_km"] = pd.to_numeric(out["distance_km"], errors="coerce")
    out["duration_min"] = pd.to_numeric(out["duration_min"], errors="coerce")
    out = out[out["distance_km"].gt(0) & out["duration_min"].gt(0)].copy()

    # Remove paused timers / implausible speeds using sport-specific bounds.
    speed = out["distance_km"] / (out["duration_min"] / 60.0)
    plausible = pd.Series(False, index=out.index)
    for activity_type, (lower, upper) in SPEED_BOUNDS_KMH.items():
        plausible |= out["activity_type"].eq(activity_type) & speed.between(lower, upper)
    out = out[plausible].copy()

    if "elevation_gain_m" not in out.columns:
        out["elevation_gain_m"] = 0.0
    else:
        out["elevation_gain_m"] = (
            pd.to_numeric(out["elevation_gain_m"], errors="coerce")
            .replace([np.inf, -np.inf], np.nan).fillna(0.0).clip(lower=0.0)
        )

    if "experience_level" not in out.columns:
        ordered = out.copy()
        ordered = ordered.sort_values(
            ["user_id", "activity_type", "started_at", "id"], kind="mergesort"
        )
        counts: dict[tuple, int] = {}
        levels: dict[int, int] = {}
        for index, row in ordered.iterrows():
            key = (row["user_id"], row["activity_type"])
            levels[index] = experience_level(counts.get(key, 0))
            counts[key] = counts.get(key, 0) + 1
        out["experience_level"] = pd.Series(levels).reindex(out.index).astype(int)
    else:
        out["experience_level"] = (
            pd.to_numeric(out["experience_level"], errors="coerce")
            .replace([np.inf, -np.inf], np.nan).fillna(3).astype(int).clip(1, 5)
        )
    normalized_order = [
        "id", "user_id", "activity_type", "distance_km", "duration_min",
        "started_at", "elevation_gain_m", "experience_level",
    ]
    return out[[column for column in normalized_order if column in out.columns]]


def load_activities(source: str, csv_path: str | None) -> pd.DataFrame:
    if source == "csv":
        if not csv_path:
            raise SystemExit("--csv is required with --source csv")
        return normalize_activities(pd.read_csv(csv_path, dtype={"user_id": "string"}))

    if source == "supabase":
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            raise SystemExit("DATABASE_URL is required with --source supabase")
        try:
            import psycopg  # type: ignore
        except ImportError:  # pragma: no cover - optional dependency
            raise SystemExit("pip install 'psycopg[binary]' to train straight from Supabase")
        query = """
            SELECT a.user_id, a.activity_type, a.distance_km, a.duration_min,
                   a.started_at, COALESCE(a.elevation_gain_m, 0) AS elevation_gain_m
            FROM activities a
            WHERE a.duration_min IS NOT NULL AND a.distance_km > 0
            ORDER BY a.started_at, a.id
        """
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute(query)
            cols = [d.name for d in cur.description]
            return normalize_activities(pd.DataFrame(cur.fetchall(), columns=cols))

    # Default: (re)generate the bootstrap corpus on the fly.
    from data.generate_dataset import build_corpus

    frame = build_corpus()
    DATA.mkdir(parents=True, exist_ok=True)
    frame.to_csv(DATA / "activities.csv", index=False)
    return frame


def _split_activity_frames(clean: pd.DataFrame, seed: int) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Make an unseen-athlete split before constructing chronological histories."""
    n_users = clean["user_id"].nunique()
    if n_users < MIN_TRAIN_USERS:
        raise SystemExit(
            f"need at least {MIN_TRAIN_USERS} distinct pseudonymous users for a reliable user-level holdout; got {n_users}"
        )

    splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=seed)
    train_idx, test_idx = next(splitter.split(clean, groups=clean["user_id"]))
    train_rows = clean.iloc[train_idx]
    test_rows = clean.iloc[test_idx]
    train_users = set(train_rows["user_id"].astype(str))
    test_users = set(test_rows["user_id"].astype(str))
    if train_users & test_users:
        raise RuntimeError("user-level holdout split leaked pseudonymous users across partitions")
    metadata = {
        "split_strategy": "80/20 GroupShuffleSplit by user_id",
        "train_users": len(train_users),
        "test_users": len(test_users),
        "total_users": int(n_users),
        "user_overlap": 0,
    }
    return training_frame(train_rows), training_frame(test_rows), metadata


def _split_activities(clean: pd.DataFrame, seed: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Compatibility wrapper returning only the train and holdout frames."""
    train_frame, test_frame, _metadata = _split_activity_frames(clean, seed)
    return train_frame, test_frame


def _regression_metrics(
    actual: np.ndarray,
    median: np.ndarray,
    low: np.ndarray,
    high: np.ndarray,
    anchor: np.ndarray,
) -> dict:
    if len(actual) == 0:
        return {"n": 0}
    model_mae = float(mean_absolute_error(actual, median))
    anchor_mae = float(mean_absolute_error(actual, anchor))
    r2_value = None
    if len(actual) >= 2 and float(np.var(actual)) > 0:
        candidate_r2 = float(r2_score(actual, median))
        if np.isfinite(candidate_r2):
            r2_value = round(candidate_r2, 4)
    return {
        "n": int(len(actual)),
        "mae_min": round(model_mae, 2),
        "rmse_min": round(float(np.sqrt(mean_squared_error(actual, median))), 2),
        "r2": r2_value,
        "mape_pct": round(float(np.mean(np.abs((actual - median) / actual)) * 100), 2),
        "within_15_pct": round(float(np.mean(np.abs(actual - median) / actual <= 0.15) * 100), 2),
        "interval_coverage_pct": round(float(np.mean((actual >= low) & (actual <= high)) * 100), 2),
        "anchor_mae_min": round(anchor_mae, 2),
        "mae_improvement_vs_anchor_pct": round((1.0 - model_mae / anchor_mae) * 100, 2) if anchor_mae else None,
    }


def _validation_slices(test_frame: pd.DataFrame, actual: np.ndarray, median: np.ndarray, low: np.ndarray, high: np.ndarray) -> dict:
    anchor = test_frame["base_minutes"].to_numpy(dtype=float)
    slices: dict[str, dict] = {
        "overall": _regression_metrics(actual, median, low, high, anchor),
        "by_activity_type": {},
        "by_elevation_density": {},
        "by_history": {},
    }
    for activity_type in ("run", "ride", "walk", "hike"):
        mask = test_frame[f"is_{activity_type}"].to_numpy(dtype=bool)
        if mask.any():
            slices["by_activity_type"][activity_type] = _regression_metrics(
                actual[mask], median[mask], low[mask], high[mask], anchor[mask]
            )

    elevation_density = test_frame["elevation_per_km"].to_numpy(dtype=float)
    if np.any(elevation_density > 0):
        for label, (lower, upper) in ELEVATION_DENSITY_BINS.items():
            mask = elevation_density >= (lower if lower is not None else -np.inf)
            if upper is not None:
                mask &= elevation_density < upper
            if mask.any():
                slices["by_elevation_density"][label] = _regression_metrics(
                    actual[mask], median[mask], low[mask], high[mask], anchor[mask]
                )
    slices["elevation_density_available"] = bool(np.any(elevation_density > 0))
    slices["elevation_density_definition"] = "elevation_gain_m / distance_km (m per km); not a measured terrain label"

    history_count = test_frame["history_count"].to_numpy(dtype=int)
    for label, mask in {
        "cold_start": history_count == 0,
        "one_prior_activity": history_count == 1,
        "two_or_more_prior_activities": history_count >= 2,
    }.items():
        if mask.any():
            slices["by_history"][label] = _regression_metrics(
                actual[mask], median[mask], low[mask], high[mask], anchor[mask]
            )
    return slices


def train(
    activities: pd.DataFrame,
    seed: int = 7,
    training_source: str = "unknown",
    calibrate: pd.DataFrame | None = None,
    target_coverage: float = 0.80,
    calibrate_on_holdout: bool = False,
    artifacts_dir: Path | None = None,
) -> dict:
    dest = _validate_artifacts_dir(
        Path(artifacts_dir) if artifacts_dir is not None else CANDIDATE_ARTIFACTS
    )

    clean = normalize_activities(activities)
    if len(clean) < MIN_TRAIN_ROWS:
        raise SystemExit(f"need at least {MIN_TRAIN_ROWS} valid activities to train, got {len(clean)}")

    calibration_frame = None
    if calibrate is not None:
        calibration_frame = normalize_activities(calibrate)
        from duration_model.calibrate import MIN_CALIBRATE_ROWS

        if len(calibration_frame) < MIN_CALIBRATE_ROWS:
            raise SystemExit(
                f"need at least {MIN_CALIBRATE_ROWS} valid, separate activities to calibrate, got {len(calibration_frame)}"
            )
        overlap = set(clean["user_id"].astype(str)) & set(calibration_frame["user_id"].astype(str))
        if overlap:
            raise SystemExit(
                f"separate calibration CSV must use athletes disjoint from training; found {len(overlap)} overlapping pseudonymous users"
            )

    train_frame, test_frame, split_metadata = _split_activity_frames(clean, seed=seed)

    x_train = train_frame[FEATURE_ORDER].to_numpy(dtype=float)
    y_train = train_frame["log_pace_factor"].to_numpy(dtype=float)
    x_test = test_frame[FEATURE_ORDER].to_numpy(dtype=float)
    base_test = test_frame["base_minutes"].to_numpy(dtype=float)

    models: dict[str, GradientBoostingRegressor] = {}
    for name, alpha in QUANTILES.items():
        model = GradientBoostingRegressor(
            loss="quantile",
            alpha=alpha,
            n_estimators=320,
            learning_rate=0.06,
            max_depth=3,
            min_samples_leaf=12,
            subsample=0.9,
            random_state=seed,
        )
        model.fit(x_train, y_train)
        models[name] = model

    # Evaluate in minutes with the same clamping and non-crossing guards as inference.
    raw_lo = np.clip(np.exp(models["q10"].predict(x_test)), 0.7, 3.0)
    raw_med = np.clip(np.exp(models["q50"].predict(x_test)), 0.7, 3.0)
    raw_hi = np.clip(np.exp(models["q90"].predict(x_test)), 0.7, 3.0)
    lo = base_test * raw_lo
    pred_median = np.maximum(base_test * raw_med, lo)
    hi = np.maximum(base_test * raw_hi, pred_median)
    y_test = test_frame["duration_min"].to_numpy(dtype=float)

    validation = _validation_slices(test_frame, y_test, pred_median, lo, hi)
    metrics = {
        **validation["overall"],
        "train_rows": int(len(x_train)),
        "test_rows": int(len(x_test)),
    }

    importance = pd.Series(models["q50"].feature_importances_, index=FEATURE_ORDER)
    importance = importance.sort_values(ascending=False).round(4)
    bundle: dict = {"models": models, "feature_order": FEATURE_ORDER, "metrics": metrics}

    calibration: dict | None = None
    if calibration_frame is not None:
        from duration_model.calibrate import calibrate_bundle

        calibration = calibrate_bundle(bundle, training_frame(calibration_frame), target=target_coverage)
        calibration["protocol"] = "separate_user_disjoint_csv"
        calibration["calibration_users"] = int(calibration_frame["user_id"].nunique())
    elif calibrate_on_holdout:
        from duration_model.calibrate import MIN_CALIBRATE_ROWS, fit_factor

        if len(x_test) < MIN_CALIBRATE_ROWS:
            raise SystemExit(
                f"need at least {MIN_CALIBRATE_ROWS} holdout activities to calibrate, got {len(x_test)}"
            )
        calibration = fit_factor(
            actual=y_test,
            low=lo,
            median=pred_median,
            high=hi,
            target=target_coverage,
        )
        calibration["protocol"] = "held_out_user_groups"
        calibration["calibration_users"] = split_metadata["test_users"]
    bundle["calibration"] = calibration

    dest.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, dest / "duration_model.joblib")
    payload = export_trees(models)
    payload["calibration"] = calibration
    (dest / "duration_model.json").write_text(json.dumps(payload, separators=(",", ":")))

    card = {
        "name": "TRANA duration model",
        "version": datetime.now(timezone.utc).strftime("%Y%m%d.%H%M"),
        "algorithm": "GradientBoostingRegressor (quantile loss, q10/q50/q90)",
        "target": "log(duration / flat-equivalent time at the athlete's own chronological reference curve)",
        "output": "activity duration in minutes (base × exp(prediction))",
        "features": FEATURE_ORDER,
        "metrics": metrics,
        "validation": {
            **split_metadata,
            "by_activity_type": validation["by_activity_type"],
            "by_elevation_density": validation["by_elevation_density"],
            "elevation_density_available": validation["elevation_density_available"],
            "elevation_density_definition": validation["elevation_density_definition"],
            "by_history": validation["by_history"],
            "baseline": "personal Riegel reference curve without the learned correction",
        },
        "feature_importance": importance.to_dict(),
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "corpus_rows": int(len(clean)),
        "training_source": training_source,
        "data_requirements": {
            "minimum_valid_activities_for_full_retraining": MIN_TRAIN_ROWS,
            "minimum_distinct_pseudonymous_users_for_user_holdout": MIN_TRAIN_USERS,
            "minimums_are_accuracy_guarantees": False,
        },
        "calibration": calibration,
    }
    (dest / "model_card.json").write_text(json.dumps(card, indent=2))
    return card


def export_trees(models: dict[str, GradientBoostingRegressor]) -> dict:
    """Flatten scikit-learn trees into arrays the browser can walk in ~30 lines."""
    payload: dict = {
        "feature_order": FEATURE_ORDER,
        "target": "log_pace_factor",
        "base": "exp(a + b * ln(distance_km))",
        "models": {},
    }
    for name, model in models.items():
        init = model.init_.constant_.ravel()[0] if hasattr(model, "init_") else 0.0
        trees = []
        for estimator in model.estimators_.ravel():
            tree = estimator.tree_
            trees.append(
                {
                    "feature": tree.feature.tolist(),
                    "threshold": [round(float(t), 6) for t in tree.threshold],
                    "left": tree.children_left.tolist(),
                    "right": tree.children_right.tolist(),
                    "value": [round(float(v), 6) for v in tree.value.ravel()],
                }
            )
        payload["models"][name] = {
            "init": round(float(init), 6),
            "learning_rate": float(model.learning_rate),
            "trees": trees,
        }
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the TRANA duration model.")
    parser.add_argument("--source", choices=["synth", "csv", "supabase"], default="synth")
    parser.add_argument("--csv", default=None)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument(
        "--artifacts-dir",
        default=None,
        help="output directory; all runs default to ml/artifacts/duration_model-candidate and never replace shipped weights",
    )
    parser.add_argument(
        "--calibrate",
        action="store_true",
        help="fit interval calibration on the 20% user-level holdout split",
    )
    parser.add_argument(
        "--no-calibrate",
        action="store_true",
        help="skip automatic holdout calibration when training from --source supabase",
    )
    parser.add_argument(
        "--calibrate-csv",
        default=None,
        help="separate, consented CSV reserved for interval calibration (at least 30 valid activities)",
    )
    parser.add_argument("--target-coverage", type=float, default=0.80)
    args = parser.parse_args()

    activities = normalize_activities(load_activities(args.source, args.csv))
    if len(activities) < MIN_TRAIN_ROWS:
        hint = (
            " — use the calibrator for interval width once at least 30 real activities exist"
            if args.source == "supabase"
            else ""
        )
        raise SystemExit(
            f"need at least {MIN_TRAIN_ROWS} valid activities to train, got {len(activities)}{hint}"
        )
    n_users = activities["user_id"].nunique()
    if n_users < MIN_TRAIN_USERS:
        raise SystemExit(
            f"need at least {MIN_TRAIN_USERS} distinct pseudonymous users for a user-level holdout; got {n_users}"
        )

    calibrate_frame = None
    if args.calibrate_csv:
        calibrate_frame = normalize_activities(pd.read_csv(args.calibrate_csv, dtype={"user_id": "string"}))
        from duration_model.calibrate import MIN_CALIBRATE_ROWS

        if len(calibrate_frame) < MIN_CALIBRATE_ROWS:
            raise SystemExit(
                f"need at least {MIN_CALIBRATE_ROWS} valid activities in --calibrate-csv, got {len(calibrate_frame)}"
            )

    calibrate_holdout = bool(
        calibrate_frame is None and (args.calibrate or (args.source == "supabase" and not args.no_calibrate))
    )
    artifacts_dir = Path(args.artifacts_dir) if args.artifacts_dir else CANDIDATE_ARTIFACTS
    card = train(
        activities,
        seed=args.seed,
        training_source="synthetic" if args.source == "synth" else args.source,
        calibrate=calibrate_frame,
        target_coverage=args.target_coverage,
        calibrate_on_holdout=calibrate_holdout,
        artifacts_dir=artifacts_dir,
    )
    print(json.dumps(card["metrics"], indent=2))
    print("validation:", json.dumps(card["validation"], indent=2))
    if card.get("calibration"):
        print("calibration:", json.dumps(card["calibration"]))
    print("top features:", list(card["feature_importance"].items())[:4])
    print(f"candidate artifacts: {artifacts_dir}")


if __name__ == "__main__":
    main()
