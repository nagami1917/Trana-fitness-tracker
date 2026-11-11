"""Tests for the GeoLife external-validation module.

    pytest -q tests
"""

from __future__ import annotations

import pandas as pd
import pytest

from duration_model.model_store import DurationModel
from evaluation.geolife_validation import (
    CSV_PATH,
    block_metrics,
    evaluate_activities,
    load_csv,
    mae,
    mape_pct,
    mdape_pct,
    r2,
    within_pct,
)

# ------------------------------------------------------------------ metrics


def test_metric_primitives():
    actual = [10.0, 20.0, 40.0]
    pred = [12.0, 18.0, 50.0]
    assert mae(actual, pred) == pytest.approx((2 + 2 + 10) / 3)
    assert mape_pct(actual, pred) == pytest.approx(((2 / 10) + (2 / 20) + (10 / 40)) / 3 * 100)
    assert mdape_pct([10.0, 20.0], [11.0, 18.0]) == pytest.approx(10.0)  # errors 10%, 10% → 10
    assert within_pct(actual, pred, 0.20) == pytest.approx(2 / 3 * 100)  # 0.25 misses the 20% band
    perfect = [float(i) for i in range(12)]
    assert r2(perfect, perfect) == pytest.approx(1.0)


def test_r2_suppressed_on_tiny_slices():
    # n < 10 → unstable, reported as null instead of a wild negative number.
    assert r2([1.0, 2.0], [1.5, 1.5]) is None
    assert r2([float(i) for i in range(12)], [float(i) + 0.1 for i in range(12)]) is not None


def test_block_metrics_zero_rows():
    assert block_metrics([]) == {"n": 0}


# ------------------------------------------------------------------ dataset


def test_committed_dataset_is_complete():
    frame = load_csv(CSV_PATH)
    assert len(frame) >= 3500
    assert set(frame.columns) == {
        "user_id", "activity_type", "mode_original",
        "distance_km", "duration_min", "start_time", "source_path",
    }
    assert set(frame["activity_type"]) <= {"walk", "ride", "run"}
    assert (frame["distance_km"] > 0).all()
    assert (frame["duration_min"] > 0).all()
    # Speeds inside the documented GPS-glitch trim window.
    speed = frame["distance_km"] / (frame["duration_min"] / 60.0)
    assert speed.between(0.5, 50.0).all()


# ------------------------------------------------------------------ protocol


def _two_row_frame() -> pd.DataFrame:
    """Two walks for one user — deliberately out of chronological order."""
    return pd.DataFrame(
        [
            {"user_id": "u1", "activity_type": "walk", "distance_km": 2.0,
             "duration_min": 25.0, "start_time": "2008-05-20 09:00:00"},
            {"user_id": "u1", "activity_type": "walk", "distance_km": 1.0,
             "duration_min": 10.0, "start_time": "2008-05-20 08:00:00"},
        ]
    )


@pytest.mark.skipif(not DurationModel().ready, reason="train the model first")
def test_chronological_history_protocol():
    """The earlier trajectory must get a cold-start (no future leakage)."""
    report = evaluate_activities(_two_row_frame(), DurationModel())
    assert report["dataset"]["rows_evaluated"] == 2
    assert report["by_history"]["cold_start"]["n"] == 1
    assert report["by_history"]["thin_history_1"]["n"] == 1
    assert report["by_history"]["personalized_2plus"]["n"] == 0
    assert report["overall"]["mae_min"] is not None
    for key in ("mape_pct", "within_15_pct", "interval_coverage_pct",
                "baseline_pop_prior_mae_min", "baseline_anchor_base_mae_min"):
        assert key in report["overall"]
