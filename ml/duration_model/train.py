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
    python -m duration_model.train                      # synth corpus -> artifacts
    python -m duration_model.train --source supabase    # real Supabase data
    python -m duration_model.train --source csv --csv path/to/activities.csv
"""

from __future__ import annotations

import argparse
import json
import os
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

from duration_model.preprocess import FEATURE_ORDER, training_frame  # noqa: E402

ARTIFACTS = Path(__file__).resolve().parent
DATA = ROOT / "data"

QUANTILES = {"q10": 0.10, "q50": 0.50, "q90": 0.90}
MIN_TRAIN_ROWS = 200
MIN_PLAUSIBLE_SPEED_KMH = 0.5
MAX_PLAUSIBLE_SPEED_KMH = 65.0


def normalize_activities(frame: pd.DataFrame) -> pd.DataFrame:
    """Fill the columns training needs and drop physically corrupt speeds.

    External tables (GeoLife / FitRec CSVs) carry only
    user/mode/distance/duration/time — the training frame additionally wants
    a row id, elevation, weight and experience.
    """
    from duration_model.preprocess import experience_level

    out = frame.copy()
    required = {"user_id", "activity_type", "distance_km", "duration_min"}
    missing = required - set(out.columns)
    if missing:
        raise SystemExit(f"training table is missing required columns: {sorted(missing)}")

    if "id" not in out.columns:
        out["id"] = range(1, len(out) + 1)
    out["distance_km"] = pd.to_numeric(out["distance_km"], errors="coerce")
    out["duration_min"] = pd.to_numeric(out["duration_min"], errors="coerce")
    out = out[out["distance_km"].gt(0) & out["duration_min"].gt(0)].copy()

    # Reject obvious paused timers (< 0.5 km/h) or motorized GPS glitches (> 65 km/h).
    speed = out["distance_km"] / (out["duration_min"] / 60.0)
    out = out[speed.between(MIN_PLAUSIBLE_SPEED_KMH, MAX_PLAUSIBLE_SPEED_KMH)].copy()

    if "elevation_gain_m" not in out.columns:
        out["elevation_gain_m"] = 0.0
    else:
        out["elevation_gain_m"] = pd.to_numeric(out["elevation_gain_m"], errors="coerce").fillna(0.0).clip(lower=0.0)

    if "weight_kg" not in out.columns:
        out["weight_kg"] = 60.0
    else:
        out["weight_kg"] = pd.to_numeric(out["weight_kg"], errors="coerce").fillna(60.0)

    if "experience_level" not in out.columns:
        counts: dict[tuple, int] = {}
        levels = []
        for row in out.itertuples(index=False):
            key = (row.user_id, row.activity_type)
            counts[key] = counts.get(key, 0) + 1
            levels.append(experience_level(counts[key]))
        out["experience_level"] = levels
    else:
        out["experience_level"] = pd.to_numeric(out["experience_level"], errors="coerce").fillna(3).astype(int)
    return out


def load_activities(source: str, csv_path: str | None) -> pd.DataFrame:
    if source == "csv":
        if not csv_path:
            raise SystemExit("--csv is required with --source csv")
        return normalize_activities(pd.read_csv(csv_path))

    if source == "supabase":
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            raise SystemExit("DATABASE_URL is required with --source supabase")
        try:
            import psycopg  # type: ignore
        except ImportError:  # pragma: no cover - optional dependency
            raise SystemExit("pip install 'psycopg[binary]' to train straight from Supabase")
        query = """
            SELECT a.id, a.user_id, a.activity_type, a.distance_km,
                   COALESCE(a.elevation_gain_m, 0) AS elevation_gain_m,
                   a.duration_min, a.calories, a.started_at,
                   COALESCE(p.weight_kg, 60) AS weight_kg,
                   COALESCE(p.experience_level, 3) AS experience_level
            FROM activities a
            JOIN fitness_profiles p ON p.user_id = a.user_id
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


def _split_activities(clean: pd.DataFrame, seed: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split by unseen user_id when >= 5 users exist; otherwise chronological tail."""
    n_users = clean["user_id"].nunique()
    if n_users >= 5:
        splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=seed)
        train_idx, test_idx = next(splitter.split(clean, groups=clean["user_id"]))
        return training_frame(clean.iloc[train_idx]), training_frame(clean.iloc[test_idx])

    full = training_frame(clean)
    cut = max(1, int(len(full) * 0.8))
    return full.iloc[:cut].copy(), full.iloc[cut:].copy()


def train(
    activities: pd.DataFrame,
    seed: int = 7,
    training_source: str = "unknown",
    calibrate: pd.DataFrame | None = None,
    target_coverage: float = 0.80,
    calibrate_on_holdout: bool = False,
) -> dict:
    clean = normalize_activities(activities)
    train_frame, test_frame = _split_activities(clean, seed=seed)

    x_train = train_frame[FEATURE_ORDER].to_numpy(dtype=float)
    y_train = train_frame["log_pace_factor"].to_numpy(dtype=float)

    x_test = test_frame[FEATURE_ORDER].to_numpy(dtype=float)
    y_test_log = test_frame["log_pace_factor"].to_numpy(dtype=float)
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

    # Evaluate in minutes with identical clamping and non-crossing guards as inference.
    raw_lo = np.clip(np.exp(models["q10"].predict(x_test)), 0.7, 3.0)
    raw_med = np.clip(np.exp(models["q50"].predict(x_test)), 0.7, 3.0)
    raw_hi = np.clip(np.exp(models["q90"].predict(x_test)), 0.7, 3.0)
    lo = base_test * raw_lo
    pred_median = np.maximum(base_test * raw_med, lo)
    hi = np.maximum(base_test * raw_hi, pred_median)
    y_test = test_frame["duration_min"].to_numpy(dtype=float)

    metrics = {
        "mae_min": round(float(mean_absolute_error(y_test, pred_median)), 2),
        "rmse_min": round(float(np.sqrt(mean_squared_error(y_test, pred_median))), 2),
        "r2": round(float(r2_score(y_test, pred_median)), 4),
        "mape_pct": round(float(np.mean(np.abs((y_test - pred_median) / y_test)) * 100), 2),
        "interval_coverage_pct": round(float(np.mean((y_test >= lo) & (y_test <= hi)) * 100), 1),
        "train_rows": int(len(x_train)),
        "test_rows": int(len(x_test)),
    }

    importance = pd.Series(models["q50"].feature_importances_, index=FEATURE_ORDER)
    importance = importance.sort_values(ascending=False).round(4)

    bundle: dict = {"models": models, "feature_order": FEATURE_ORDER, "metrics": metrics}

    # ML phase 2 — interval calibration on strictly held-out users or external table.
    calibration: dict | None = None
    if calibrate is not None and len(calibrate) > 0:
        from duration_model.calibrate import calibrate_bundle

        calibration = calibrate_bundle(bundle, training_frame(normalize_activities(calibrate)), target=target_coverage)
    elif calibrate_on_holdout and len(x_test) > 0:
        from duration_model.calibrate import fit_factor

        calibration = fit_factor(
            actual=y_test,
            low=lo,
            median=pred_median,
            high=hi,
            target=target_coverage,
        )
        bundle["calibration"] = calibration

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, ARTIFACTS / "duration_model.joblib")
    payload = export_trees(models)
    payload["calibration"] = calibration
    (ARTIFACTS / "duration_model.json").write_text(json.dumps(payload, separators=(",", ":")))

    card = {
        "name": "TRANA duration model",
        "version": datetime.now(timezone.utc).strftime("%Y%m%d.%H%M"),
        "algorithm": "GradientBoostingRegressor (quantile loss, q10/q50/q90)",
        "target": "log(duration / flat-equivalent time at the athlete's own chronological reference curve)",
        "output": "activity duration in minutes (base × exp(prediction))",
        "features": FEATURE_ORDER,
        "metrics": metrics,
        "feature_importance": importance.to_dict(),
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "corpus_rows": int(len(train_frame) + len(test_frame)),
        "training_source": training_source,
        "calibration": calibration,
    }
    (ARTIFACTS / "model_card.json").write_text(json.dumps(card, indent=2))
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
        "--calibrate",
        action="store_true",
        help="fit interval calibration on the 20 %% holdout split (enabled by default for --source supabase)",
    )
    parser.add_argument(
        "--no-calibrate",
        action="store_true",
        help="skip automatic holdout calibration when training from --source supabase",
    )
    parser.add_argument(
        "--calibrate-csv",
        default=None,
        help="separate real activity table for interval calibration (ML phase 2)",
    )
    parser.add_argument("--target-coverage", type=float, default=0.80)
    args = parser.parse_args()

    activities = load_activities(args.source, args.csv)
    if len(activities) < MIN_TRAIN_ROWS:
        hint = (
            " — run `python -m duration_model.calibrate --source supabase --write` once >= 30 rows exist"
            if args.source == "supabase"
            else ""
        )
        raise SystemExit(
            f"need at least {MIN_TRAIN_ROWS} activities to train, got {len(activities)}{hint}"
        )

    calibrate_frame = normalize_activities(pd.read_csv(args.calibrate_csv)) if args.calibrate_csv else None
    calibrate_holdout = bool(
        calibrate_frame is None and (args.calibrate or (args.source == "supabase" and not args.no_calibrate))
    )
    card = train(
        activities,
        seed=args.seed,
        training_source="synthetic" if args.source == "synth" else args.source,
        calibrate=calibrate_frame,
        target_coverage=args.target_coverage,
        calibrate_on_holdout=calibrate_holdout,
    )
    print(json.dumps(card["metrics"], indent=2))
    if card.get("calibration"):
        print("calibration:", json.dumps(card["calibration"]))
    print("top features:", list(card["feature_importance"].items())[:4])


if __name__ == "__main__":
    main()
