"""Interval calibration for the duration model (ML phase 2).

The synthetic-trained q10/q90 bands undercover badly on real door-to-door
durations — 24 % coverage on GeoLife against an 80 % target (see
docs/ml-methodology.md). This module fits a single multiplicative **width
factor** on a calibration set of real activities so the band covers the
target share of them:

    k = conformal quantile of |actual − q50| / halfwidth,
    halfwidth = (q90 − q10) / 2

Rows whose band is degenerate (halfwidth ≤ 0) are skipped. The factor is
clipped to [1.0, MAX_FACTOR] — calibration only ever *widens* the trained
band, and never beyond a physically sane multiple.

The fitted factor travels with the artifact (joblib bundle, model card and
the browser JSON export), and both `model_store.predict` (server) and
`frontend/src/lib/ml/duration.js` (offline PWA preview) apply it identically.

Run
---
    python -m duration_model.calibrate --csv path/to/real_activities.csv
    python -m duration_model.calibrate --source supabase --write
    (training-time fitting: `train --calibrate` or `train --calibrate-csv …`)
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

TARGET_COVERAGE = 0.80
MAX_FACTOR = 6.0
MIN_FACTOR = 1.0
MIN_CALIBRATE_ROWS = 30

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def fit_factor(
    actual: list[float] | np.ndarray,
    low: list[float] | np.ndarray,
    median: list[float] | np.ndarray,
    high: list[float] | np.ndarray,
    target: float = TARGET_COVERAGE,
) -> dict:
    """Fit the band-width factor so `median ± k·halfwidth` covers `target`.

    Conformal-style: scores = |actual − median| / halfwidth, k is the
    ⌈(n+1)·target⌉/n empirical quantile (finite-sample corrected), clipped
    to [1, MAX_FACTOR].
    """
    actual_a = np.asarray(actual, dtype=float)
    low_a = np.asarray(low, dtype=float)
    med_a = np.asarray(median, dtype=float)
    high_a = np.asarray(high, dtype=float)

    halfwidth = (high_a - low_a) / 2.0
    valid = np.isfinite(actual_a) & np.isfinite(med_a) & (halfwidth > 1e-9) & (med_a > 0)
    n = int(valid.sum())
    if n == 0:
        raise ValueError("no valid rows to calibrate (empty or degenerate bands)")

    scores = np.abs(actual_a[valid] - med_a[valid]) / halfwidth[valid]

    # Finite-sample conformal quantile, capped at 1.0 so k never extrapolates
    # beyond the worst observed score.
    q_level = min(1.0, math.ceil((n + 1) * target) / n)
    k = float(np.quantile(scores, q_level))
    k = float(np.clip(k, MIN_FACTOR, MAX_FACTOR))

    covered = np.abs(actual_a[valid] - med_a[valid]) <= k * halfwidth[valid]
    achieved = float(covered.mean())

    return {
        "factor": round(k, 3),
        "target_coverage": target,
        "achieved_coverage": round(achieved, 3),
        "n": n,
        "skipped": int(len(actual_a) - n),
        "calibrated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def band_for_frame(bundle: dict, frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """q10/q50/q90 minutes for a training frame, using the trained models.

    Mirrors `model_store.predict` exactly: exp(log pace factor), clipped to
    [0.7, 3.0], multiplied by the per-row anchor base.
    """
    from duration_model.preprocess import FEATURE_ORDER

    x = frame[FEATURE_ORDER].to_numpy(dtype=float)
    base = frame["base_minutes"].to_numpy(dtype=float)

    def raw(q: str) -> np.ndarray:
        values = np.exp(bundle["models"][q].predict(x))
        return np.clip(values, 0.7, 3.0)

    low = base * raw("q10")
    med = np.maximum(base * raw("q50"), low)
    high = np.maximum(base * raw("q90"), med)
    return low, med, high


def calibrate_bundle(bundle: dict, frame: pd.DataFrame, target: float = TARGET_COVERAGE) -> dict:
    """Fit and attach the calibration factor to a trained bundle (in place)."""
    low, med, high = band_for_frame(bundle, frame)
    calibration = fit_factor(
        actual=frame["duration_min"].to_numpy(dtype=float),
        low=low,
        median=med,
        high=high,
        target=target,
    )
    bundle["calibration"] = calibration
    return calibration


def write_calibration(
    bundle: dict,
    calibration: dict,
    artifacts_dir: Path | None = None,
) -> None:
    """Persist `calibration` onto the joblib, JSON export and model card."""
    import joblib

    dest = artifacts_dir or (ROOT / "duration_model")
    joblib.dump(bundle, dest / "duration_model.joblib")

    json_path = dest / "duration_model.json"
    if json_path.exists():
        payload = json.loads(json_path.read_text())
        payload["calibration"] = calibration
        json_path.write_text(json.dumps(payload, separators=(",", ":")))

    card_path = dest / "model_card.json"
    if card_path.exists():
        card = json.loads(card_path.read_text())
        card["calibration"] = calibration
        card_path.write_text(json.dumps(card, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Fit interval calibration on real activities.")
    parser.add_argument("--source", choices=["csv", "supabase"], default="csv")
    parser.add_argument("--csv", default=None, help="real activity table (required with --source csv)")
    parser.add_argument("--target", type=float, default=TARGET_COVERAGE)
    parser.add_argument("--bundle", default=None, help="joblib bundle to calibrate (default: shipped artifact)")
    parser.add_argument("--write", action="store_true", help="persist factor into joblib, json export and model card")
    args = parser.parse_args()

    import joblib

    from duration_model.preprocess import training_frame
    from duration_model.train import load_activities, normalize_activities

    activities = load_activities(args.source, args.csv)
    if len(activities) < MIN_CALIBRATE_ROWS:
        raise SystemExit(
            f"need at least {MIN_CALIBRATE_ROWS} activities to calibrate, got {len(activities)}"
        )

    bundle_path = Path(args.bundle) if args.bundle else ROOT / "duration_model" / "duration_model.joblib"
    bundle = joblib.load(bundle_path)
    frame = training_frame(normalize_activities(activities))
    calibration = calibrate_bundle(bundle, frame, target=args.target)
    if args.write:
        write_calibration(bundle, calibration, artifacts_dir=bundle_path.parent)
    print(json.dumps(calibration, indent=2))


if __name__ == "__main__":
    main()
