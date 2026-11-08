"""Train TRANA's duration model.

Three gradient-boosted quantile regressors predict the 10th / 50th / 90th
percentile of the time an athlete needs for a planned session, which gives the
UI an honest "estimated range" instead of a single over-confident number.

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
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from duration_model.preprocess import FEATURE_ORDER, training_frame  # noqa: E402

ARTIFACTS = Path(__file__).resolve().parent
DATA = ROOT / "data"

QUANTILES = {"q10": 0.10, "q50": 0.50, "q90": 0.90}


def load_activities(source: str, csv_path: str | None) -> pd.DataFrame:
    if source == "csv":
        if not csv_path:
            raise SystemExit("--csv is required with --source csv")
        return pd.read_csv(csv_path)

    if source == "supabase":
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            raise SystemExit("DATABASE_URL is required with --source supabase")
        try:
            import psycopg  # type: ignore
        except ImportError:  # pragma: no cover - optional dependency
            raise SystemExit("pip install 'psycopg[binary]' to train straight from Supabase")
        query = """
            SELECT a.id, a.user_id, a.activity_type, a.distance_km, a.elevation_gain_m,
                   a.duration_min, a.calories, a.started_at,
                   p.weight_kg,
                   COALESCE(p.experience_level, 3) AS experience_level
            FROM activities a
            JOIN fitness_profiles p ON p.user_id = a.user_id
            WHERE a.duration_min IS NOT NULL AND a.distance_km > 0
        """
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute(query)
            cols = [d[0] for d in cur.description]
            return pd.DataFrame(cur.fetchall(), columns=cols)

    # Default: (re)generate the bootstrap corpus on the fly.
    from data.generate_dataset import build_corpus

    frame = build_corpus()
    DATA.mkdir(parents=True, exist_ok=True)
    frame.to_csv(DATA / "activities.csv", index=False)
    return frame


def train(activities: pd.DataFrame, seed: int = 7, training_source: str = "unknown") -> dict:
    frame = training_frame(activities)
    x = frame[FEATURE_ORDER].to_numpy(dtype=float)
    # The model learns a log pace factor; minutes are recovered via the athlete's
    # own reference speed so predictions stay anchored to their ability.
    y = frame["log_pace_factor"].to_numpy(dtype=float)

    x_train, x_test, y_train, y_test, base_train, base_test = train_test_split(
        x, y, frame["base_minutes"].to_numpy(), test_size=0.2, random_state=seed
    )

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

    # Everything below is evaluated in minutes, which is what the user sees.
    # (Predictions are log pace factors; multiply by the flat-equivalent time.)
    pred_median = np.exp(models["q50"].predict(x_test)) * base_test
    lo = np.exp(models["q10"].predict(x_test)) * base_test
    hi = np.exp(models["q90"].predict(x_test)) * base_test
    y_test = np.exp(y_test) * base_test

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

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {"models": models, "feature_order": FEATURE_ORDER, "metrics": metrics},
        ARTIFACTS / "duration_model.joblib",
    )
    (ARTIFACTS / "duration_model.json").write_text(json.dumps(export_trees(models), separators=(",", ":")))

    card = {
        "name": "TRANA duration model",
        "version": datetime.now(timezone.utc).strftime("%Y%m%d.%H%M"),
        "algorithm": "GradientBoostingRegressor (quantile loss, q10/q50/q90)",
        "target": "log(duration / flat-equivalent time at the athlete's own reference speed)",
        "output": "activity duration in minutes (base × exp(prediction))",
        "features": FEATURE_ORDER,
        "metrics": metrics,
        "feature_importance": importance.to_dict(),
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "corpus_rows": int(len(frame)),
        "training_source": training_source,
    }
    (ARTIFACTS / "model_card.json").write_text(json.dumps(card, indent=2))
    return card


def export_trees(models: dict[str, GradientBoostingRegressor]) -> dict:
    """Flatten scikit-learn trees into arrays the browser can walk in ~30 lines."""
    payload: dict = {
        "feature_order": FEATURE_ORDER,
        "target": "log_pace_factor",
        "base": "distance_km / ref_speed_kmh * 60",
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
    args = parser.parse_args()

    activities = load_activities(args.source, args.csv)
    if len(activities) < 200:
        raise SystemExit(f"need at least 200 activities to train, got {len(activities)}")

    card = train(activities, seed=args.seed, training_source="synthetic" if args.source == "synth" else args.source)
    print(json.dumps(card["metrics"], indent=2))
    print("top features:", list(card["feature_importance"].items())[:4])


if __name__ == "__main__":
    main()
