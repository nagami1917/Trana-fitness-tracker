"""Regression tests covering the five priority ML prediction fixes.

1. Flat-equivalent history normalization in `reference_curve`.
2. Ridge shrinkage, `b >= 1.0` bounds, speed-outlier filtering, and recency weighting.
3. No spurious `weight_kg` duration leakage; strict chronological `training_frame`.
4. Non-crossing calibrated quantiles and history/OOD-aware `confidence`.
5. VAM ascent-work energy physics and `energy_calibration_factor` propagation.
"""

from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from api.main import app
from duration_model.calibrate import fit_factor
from duration_model.model_store import DurationModel
from duration_model.preprocess import (
    FEATURE_ORDER,
    RIEGEL_EXPONENT,
    base_minutes,
    reference_curve,
    training_frame,
)
from fueling_model.predict import FuelingInput, estimate_met, recommend

client = TestClient(app)


# ------------------------------------------------------------------ Fix 1 & 2

def test_hilly_history_normalizes_baseline_without_double_penalizing():
    model = DurationModel()
    hilly_hist = [
        {"activity_type": "run", "distance_km": d, "duration_min": d * 7.5, "elevation_gain_m": d * 40.0}
        for d in (5.0, 8.0, 10.0, 12.0)
    ]
    flat_pred = model.predict(
        activity_type="run", distance_km=10.0, elevation_gain_m=0.0, weight_kg=60.0, history=hilly_hist, experience=3
    )
    hilly_pred = model.predict(
        activity_type="run", distance_km=10.0, elevation_gain_m=400.0, weight_kg=60.0, history=hilly_hist, experience=3
    )
    # Historical average on 40 m/km was 75 min / 10 km; flat effort must be materially faster,
    # and the matching 400 m hilly prediction should sit near 75 min rather than being double-penalized to ~95+ min.
    assert flat_pred["minutes"] < 62.0
    assert 68.0 <= hilly_pred["minutes"] <= 82.0


def test_reference_curve_clamps_b_and_shrinks_noisy_narrow_history():
    # Two near-identical distances with random timing noise (inverted slope without shrinkage)
    noisy_hist = [
        {"activity_type": "run", "distance_km": 5.0, "duration_min": 30.0},
        {"activity_type": "run", "distance_km": 5.2, "duration_min": 28.0},
    ]
    a, b = reference_curve(noisy_hist, "run")
    assert b >= 1.0
    assert abs(b - RIEGEL_EXPONENT["run"]) < 0.05
    # Extrapolating to a marathon should stay realistic (~270–330 min), never <200 min
    marathon_base = base_minutes(42.2, a, b)
    assert 250.0 <= marathon_base <= 330.0


def test_reference_curve_filters_speed_outliers_and_prefers_recent_sessions():
    history = [
        # Old slow runs (180 days ago)
        {"activity_type": "run", "distance_km": 10.0, "duration_min": 75.0, "started_at": "2026-01-01T08:00:00Z"},
        {"activity_type": "run", "distance_km": 8.0, "duration_min": 60.0, "started_at": "2026-01-05T08:00:00Z"},
        # Recent faster runs (today / yesterday)
        {"activity_type": "run", "distance_km": 10.0, "duration_min": 50.0, "started_at": "2026-07-01T08:00:00Z"},
        {"activity_type": "run", "distance_km": 8.0, "duration_min": 40.0, "started_at": "2026-07-02T08:00:00Z"},
        # Corrupted GPS glitch (200 km/h run) — must be ignored
        {"activity_type": "run", "distance_km": 50.0, "duration_min": 15.0, "started_at": "2026-07-03T08:00:00Z"},
    ]
    a, b = reference_curve(history, "run")
    pred_10k = base_minutes(10.0, a, b)
    # Must lean toward the 50 min recent pace (not 75 min old pace or 3 min car glitch)
    assert 48.0 <= pred_10k <= 60.0


# ------------------------------------------------------------------ Fix 3

def test_weight_does_not_distort_duration_prediction():
    assert "weight_kg" not in FEATURE_ORDER
    model = DurationModel()
    hist = [{"activity_type": "run", "distance_km": d, "duration_min": d * 6.0} for d in (5.0, 8.0, 10.0)]
    light = model.predict(activity_type="run", distance_km=10.0, elevation_gain_m=50.0, weight_kg=50.0, history=hist, experience=3)
    heavy = model.predict(activity_type="run", distance_km=10.0, elevation_gain_m=50.0, weight_kg=100.0, history=hist, experience=3)
    assert light["minutes"] == pytest.approx(heavy["minutes"])


def test_training_frame_uses_strict_chronological_history():
    df = pd.DataFrame(
        [
            {"id": 1, "user_id": 10, "activity_type": "run", "distance_km": 5.0, "elevation_gain_m": 0.0, "duration_min": 30.0, "started_at": "2026-01-01T07:00:00Z", "weight_kg": 60.0, "experience_level": 1},
            {"id": 2, "user_id": 10, "activity_type": "run", "distance_km": 10.0, "elevation_gain_m": 0.0, "duration_min": 60.0, "started_at": "2026-01-02T07:00:00Z", "weight_kg": 60.0, "experience_level": 2},
            {"id": 3, "user_id": 10, "activity_type": "run", "distance_km": 8.0, "elevation_gain_m": 0.0, "duration_min": 48.0, "started_at": "2026-01-03T07:00:00Z", "weight_kg": 60.0, "experience_level": 3},
        ]
    )
    frame = training_frame(df).sort_values("history_count").reset_index(drop=True)
    assert list(frame["history_count"]) == [0.0, 1.0, 2.0]


# ------------------------------------------------------------------ Fix 4

def test_quantiles_never_cross_and_confidence_penalizes_cold_start_and_ood():
    model = DurationModel()
    hist = [{"activity_type": "run", "distance_km": d, "duration_min": d * 6.0} for d in range(5, 13)]

    rich_in_domain = model.predict(activity_type="run", distance_km=10.0, elevation_gain_m=50.0, weight_kg=60.0, history=hist, experience=3)
    cold_start = model.predict(activity_type="run", distance_km=10.0, elevation_gain_m=50.0, weight_kg=60.0, history=[], experience=3)
    extreme_ood = model.predict(activity_type="run", distance_km=150.0, elevation_gain_m=5000.0, weight_kg=60.0, history=hist[:2], experience=3)
    steep = model.predict(activity_type="hike", distance_km=10.0, elevation_gain_m=1500.0, weight_kg=60.0, history=[], experience=3)

    for p in (rich_in_domain, cold_start, extreme_ood, steep):
        assert p["range"]["low"] <= p["minutes"] <= p["range"]["high"]
        assert 0.30 <= p["confidence"] <= 0.96

    assert cold_start["confidence"] < rich_in_domain["confidence"]
    assert extreme_ood["confidence"] < rich_in_domain["confidence"]


def test_fit_factor_matches_asymmetric_band_expansion():
    actual = [10.0, 12.0, 14.0, 16.0, 18.0, 20.0, 22.0, 24.0]
    med = [14.0] * len(actual)
    low = [13.0] * len(actual)
    high = [17.0] * len(actual)  # asymmetric: lo_dev=1, hi_dev=3
    out = fit_factor(actual, low, med, high, target=0.75)
    k = out["factor"]
    hits = sum(1 for a, lo, m, hi in zip(actual, low, med, high) if (m - k * (m - lo)) <= a <= (m + k * (hi - m)))
    assert hits / len(actual) == pytest.approx(out["achieved_coverage"], abs=1e-3)


# ------------------------------------------------------------------ Fix 5

def test_vam_climb_met_scales_beyond_old_cap_and_preserves_flat():
    # Flat baseline preserved: 10 km/h run = 10.30 MET
    assert estimate_met("run", 10.0, 0.0) == pytest.approx(10.30, abs=1e-4)
    # Steep ascent scales significantly beyond old +2.6 MET cap
    gentle = estimate_met("run", 8.0, 30.0)   # VAM = 240 m/h -> +2.64
    steep = estimate_met("run", 6.0, 150.0)   # VAM = 900 m/h -> +9.90
    assert steep - (6.0 * 1.03) > 5.0
    assert steep > gentle


def test_energy_calibration_factor_scales_api_calories():
    base_res = client.post(
        "/predict",
        json={
            "activity_type": "run",
            "distance_km": 10.0,
            "elevation_gain_m": 0.0,
            "weight_kg": 70.0,
            "energy_calibration_factor": 1.0,
        },
    )
    cal_res = client.post(
        "/predict",
        json={
            "activity_type": "run",
            "distance_km": 10.0,
            "elevation_gain_m": 0.0,
            "weight_kg": 70.0,
            "energy_calibration_factor": 1.5,
        },
    )
    assert base_res.status_code == 200
    assert cal_res.status_code == 200
    ratio = cal_res.json()["fueling"]["calories"]["total"] / base_res.json()["fueling"]["calories"]["total"]
    assert ratio == pytest.approx(1.5, rel=0.02)

    bad = client.post(
        "/predict",
        json={
            "activity_type": "run",
            "distance_km": 10.0,
            "weight_kg": 70.0,
            "energy_calibration_factor": 5.0,
        },
    )
    assert bad.status_code == 422
