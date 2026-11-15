"""Interval calibration for the duration model (ML phase 2).

The synthetic-trained q10/q90 bands undercover badly on real door-to-door
durations — 16.96 % coverage on GeoLife against an 80 % target (see
docs/ml-methodology.md). This module fits a single multiplicative **width
factor** on a calibration set of real activities so the deployed interval
``[med - k * lo_dev, med + k * hi_dev]`` covers ``target`` share of outcomes:

    lo_dev = med - low   (falls back to halfwidth if <= 0)
    hi_dev = high - med  (falls back to halfwidth if <= 0)
    score  = (actual - med) / hi_dev   if actual >= med
             (med - actual) / lo_dev   otherwise
    k      = finite-sample conformal quantile of scores, clipped to [1.0, 6.0]

When bands are symmetric (``med - low == high - med``), this reduces identically
to ``|actual - med| / halfwidth``; when bands are skewed, calibration and
inference evaluate the *exact* same asymmetric interval.

Both ``model_store.predict`` (server) and ``frontend/src/lib/ml/duration.js``
(offline PWA preview) apply it identically.

Run
---
    python -m duration_model.calibrate --csv /secure/path/calibration.csv \
        --training-csv /secure/path/train.csv --write
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
SHIPPED_ARTIFACTS = ROOT / "duration_model"
CANDIDATE_ARTIFACTS = ROOT / "artifacts" / "duration_model-candidate"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _validate_candidate_dir(path: Path) -> Path:
    destination = path.resolve()
    repository = ROOT.parent.resolve()
    safe_root = (ROOT / "artifacts").resolve()
    if destination == SHIPPED_ARTIFACTS.resolve() or (
        destination.is_relative_to(repository) and not destination.is_relative_to(safe_root)
    ):
        raise SystemExit(
            "calibration writes are candidate-only; use ml/artifacts/ or a secure directory outside the repository"
        )
    return path


def fit_factor(
    actual: list[float] | np.ndarray,
    low: list[float] | np.ndarray,
    median: list[float] | np.ndarray,
    high: list[float] | np.ndarray,
    target: float = TARGET_COVERAGE,
) -> dict:
    """Fit the band-width factor so ``[med - k*lo_dev, med + k*hi_dev]`` covers ``target``."""
    if not 0.0 < target <= 1.0:
        raise ValueError("target coverage must be greater than 0 and at most 1")

    actual_a = np.asarray(actual, dtype=float)
    low_a = np.asarray(low, dtype=float)
    med_a = np.asarray(median, dtype=float)
    high_a = np.asarray(high, dtype=float)

    halfwidth = (high_a - low_a) / 2.0
    valid = np.isfinite(actual_a) & np.isfinite(med_a) & (halfwidth > 1e-9) & (med_a > 0)
    n = int(valid.sum())
    if n == 0:
        raise ValueError("no valid rows to calibrate (empty or degenerate bands)")

    act_v = actual_a[valid]
    med_v = med_a[valid]
    hw_v = halfwidth[valid]
    lo_dev = np.where((med_v - low_a[valid]) > 1e-9, med_v - low_a[valid], hw_v)
    hi_dev = np.where((high_a[valid] - med_v) > 1e-9, high_a[valid] - med_v, hw_v)

    scores = np.where(act_v >= med_v, (act_v - med_v) / hi_dev, (med_v - act_v) / lo_dev)

    # Finite-sample conformal quantile, capped at 1.0 so k never extrapolates
    # beyond the worst observed score.
    q_level = min(1.0, math.ceil((n + 1) * target) / n)
    k = float(np.quantile(scores, q_level))
    k = float(np.clip(k, MIN_FACTOR, MAX_FACTOR))

    covered = (act_v >= med_v - k * lo_dev) & (act_v <= med_v + k * hi_dev)
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
    [0.7, 3.0], multiplied by the per-row anchor base, non-crossing enforced.
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

    dest = _validate_candidate_dir(
        Path(artifacts_dir) if artifacts_dir is not None else CANDIDATE_ARTIFACTS
    )
    dest.mkdir(parents=True, exist_ok=True)
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
    parser.add_argument("--bundle", default=None, help="joblib bundle to calibrate (default: shipped artifact, read-only)")
    parser.add_argument("--training-csv", default=None, help="training CSV, required to verify disjoint users for a real-trained bundle")
    parser.add_argument("--output-dir", default=None, help="candidate artifact directory for --write (never the shipped directory)")
    parser.add_argument("--write", action="store_true", help="write a candidate; the shipped artifact is never changed")
    args = parser.parse_args()

    import joblib
    import shutil

    from duration_model.preprocess import training_frame
    from duration_model.train import load_activities, normalize_activities

    activities = normalize_activities(load_activities(args.source, args.csv))
    if len(activities) < MIN_CALIBRATE_ROWS:
        raise SystemExit(
            f"need at least {MIN_CALIBRATE_ROWS} valid activities to calibrate, got {len(activities)}"
        )

    bundle_path = Path(args.bundle) if args.bundle else SHIPPED_ARTIFACTS / "duration_model.joblib"
    bundle = joblib.load(bundle_path)
    card_path = bundle_path.parent / "model_card.json"
    source_card = json.loads(card_path.read_text()) if card_path.is_file() else {}
    source_kind = source_card.get("training_source", "unknown")

    if args.training_csv:
        training_path = Path(args.training_csv)
        if not training_path.is_file():
            raise SystemExit(f"training CSV not found: {training_path}")
        training = normalize_activities(pd.read_csv(training_path, dtype={"user_id": "string"}))
        overlap = set(training["user_id"].astype(str)) & set(activities["user_id"].astype(str))
        if overlap:
            raise SystemExit(
                f"calibration CSV must use athletes disjoint from training; found {len(overlap)} overlapping pseudonymous users"
            )
    elif source_kind != "synthetic":
        raise SystemExit(
            "calibrating a non-synthetic candidate requires --training-csv to check athlete-level separation"
        )

    frame = training_frame(activities)
    calibration = calibrate_bundle(bundle, frame, target=args.target)
    calibration["protocol"] = "separate_user_disjoint_csv"
    calibration["calibration_users"] = int(activities["user_id"].nunique())
    bundle["calibration"] = calibration
    if args.write:
        output_dir = _validate_candidate_dir(
            Path(args.output_dir) if args.output_dir else CANDIDATE_ARTIFACTS
        )
        if output_dir.resolve() != bundle_path.parent.resolve():
            output_dir.mkdir(parents=True, exist_ok=True)
            for filename in ("duration_model.json", "model_card.json"):
                source = bundle_path.parent / filename
                destination = output_dir / filename
                if source.is_file():
                    shutil.copy2(source, destination)
                elif destination.exists():
                    raise SystemExit(
                        f"candidate output contains stale {filename}; use an empty output directory or a bundle with matching metadata"
                    )
        write_calibration(bundle, calibration, artifacts_dir=output_dir)
        print(f"candidate artifacts: {output_dir}")
    print(json.dumps(calibration, indent=2))


if __name__ == "__main__":
    main()
