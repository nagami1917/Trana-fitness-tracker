"""API-level tests for the TRANA prediction service.

    pip install -r requirements-dev.txt
    pytest -q
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.features import base_minutes, reference_curve
from app.fueling import FuelingInput, recommend
from app.main import app

client = TestClient(app)

HISTORY = [
    {"activity_type": "run", "distance_km": 5.0, "duration_min": 29.0},
    {"activity_type": "run", "distance_km": 8.0, "duration_min": 47.0},
    {"activity_type": "run", "distance_km": 10.0, "duration_min": 59.0},
]


def payload(**overrides):
    body = {
        "activity_type": "run",
        "distance_km": 10.0,
        "elevation_gain_m": 60,
        "weight_kg": 60,
        "experience_level": 3,
        "history": HISTORY,
        "temperature_c": 24,
    }
    body.update(overrides)
    return body


def test_health_reports_model_ready():
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["model_ready"] is True


def test_predict_returns_duration_and_fueling():
    res = client.post("/predict", json=payload())
    assert res.status_code == 200, res.text
    body = res.json()

    duration = body["duration"]
    assert duration["minutes"] > 0
    assert duration["range"]["low"] <= duration["minutes"] <= duration["range"]["high"]
    assert 0.3 <= duration["confidence"] <= 1.0

    fueling = body["fueling"]
    assert fueling["calories"]["total"] > 0
    assert 0 <= fueling["carbs"]["per_hour_g"] <= 90
    assert fueling["sodium"]["per_hour_mg"] > 0
    assert fueling["fluid"]["per_hour_ml"] > 0
    assert len(fueling["timeline"]) >= 2
    assert fueling["notes"]


def test_long_session_gets_a_during_session_step():
    body = client.post("/predict", json=payload(distance_km=25, elevation_gain_m=300)).json()
    windows = [step["window"] for step in body["fueling"]["timeline"]]
    assert "During" in windows
    assert body["fueling"]["carbs"]["per_hour_g"] > 0


def test_longer_distance_takes_longer():
    short = client.post("/predict", json=payload(distance_km=5)).json()
    long = client.post("/predict", json=payload(distance_km=20)).json()
    assert long["duration"]["minutes"] > short["duration"]["minutes"]


def test_climbing_slows_the_athlete():
    flat = client.post("/predict", json=payload(distance_km=10, elevation_gain_m=0)).json()
    hilly = client.post("/predict", json=payload(distance_km=10, elevation_gain_m=800)).json()
    assert hilly["duration"]["minutes"] > flat["duration"]["minutes"]


def test_route_overrides_distance():
    route = [[14.676, 121.0437], [14.686, 121.0537]]  # ≈ 1.4 km
    body = client.post("/predict", json=payload(distance_km=50, route=route)).json()
    # A 1.4 km route must not take as long as a 50 km run.
    assert body["duration"]["minutes"] < 30


def test_fueling_bands():
    short = recommend(FuelingInput(activity_type="run", duration_min=40, weight_kg=60))
    medium = recommend(FuelingInput(activity_type="run", duration_min=100, weight_kg=60, avg_speed_kmh=10))
    long = recommend(FuelingInput(activity_type="run", duration_min=200, weight_kg=60, avg_speed_kmh=10))
    assert short["carbs"]["per_hour_g"] == 0
    assert 0 < medium["carbs"]["per_hour_g"] <= 90
    assert long["carbs"]["per_hour_g"] > medium["carbs"]["per_hour_g"]


def test_heavy_sweater_gets_more_sodium_and_heat_raises_fluid():
    base = recommend(FuelingInput(activity_type="run", duration_min=120, weight_kg=60))
    heavy = recommend(FuelingInput(activity_type="run", duration_min=120, weight_kg=60, sweat_profile="high"))
    hot = recommend(FuelingInput(activity_type="run", duration_min=120, weight_kg=60, temperature_c=34))

    assert heavy["sodium"]["per_hour_mg"] > base["sodium"]["per_hour_mg"]
    assert hot["fluid"]["per_hour_ml"] > base["fluid"]["per_hour_ml"]


def test_reference_curve_is_monotonic():
    a, b = reference_curve(HISTORY, "run")
    assert base_minutes(5, a, b) < base_minutes(10, a, b) < base_minutes(21, a, b)


def test_no_history_falls_back_gracefully():
    res = client.post("/predict", json=payload(history=[]))
    assert res.status_code == 200
    assert res.json()["duration"]["minutes"] > 0


@pytest.mark.parametrize("activity_type", ["run", "ride", "walk", "hike"])
def test_all_modalities(activity_type):
    res = client.post("/predict", json=payload(activity_type=activity_type, distance_km=8))
    assert res.status_code == 200
    assert res.json()["fueling"]["intensity"] in {"light", "moderate", "vigorous", "very_vigorous"}
