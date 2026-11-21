"""API-level tests for the TRANA prediction service.

    pip install -r requirements-dev.txt
    pytest -q
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from duration_model.preprocess import base_minutes, reference_curve
from fueling_model.predict import FuelingInput, recommend
from api.main import app

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


def test_step4_profile_context_is_accepted():
    """Step 4 sends age, sex, height, fitness level and training experience."""
    res = client.post(
        "/predict",
        json=payload(age=27, sex="female", height_cm=162, fitness_level=4, activity_experience=6.5),
    )
    assert res.status_code == 200, res.text
    assert res.json()["duration"]["minutes"] > 0


def test_fitness_level_aliases_experience_level():
    legacy = client.post("/predict", json=payload(experience_level=5)).json()
    spec = client.post("/predict", json=payload(experience_level=1, fitness_level=5)).json()
    assert spec["duration"]["minutes"] == pytest.approx(legacy["duration"]["minutes"])


def test_invalid_profile_context_is_rejected():
    assert client.post("/predict", json=payload(age=-1)).status_code == 422
    assert client.post("/predict", json=payload(fitness_level=9)).status_code == 422
    assert client.post("/predict", json=payload(height_cm=10)).status_code == 422
    assert client.post("/predict", json=payload(activity_experience=100)).status_code == 422


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


def test_prediction_service_token_protects_server_to_server_endpoints(monkeypatch):
    monkeypatch.setenv("ML_API_TOKEN", "test-shared-secret")
    assert client.get("/health").status_code == 200
    assert client.get("/model/info").status_code == 401
    assert client.post("/predict", json=payload()).status_code == 401
    assert client.post("/predict", json=payload(), headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.post("/predict", json=payload(), headers={"Authorization": "Bearer test-shared-secret"}).status_code == 200


def test_model_reload_is_disabled_without_an_admin_token(monkeypatch):
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    assert client.post("/model/reload").status_code == 503
    monkeypatch.setenv("ADMIN_TOKEN", "test-admin-secret")
    assert client.post("/model/reload", headers={"X-Admin-Token": "wrong"}).status_code == 403
    assert client.post("/model/reload", headers={"X-Admin-Token": "test-admin-secret"}).status_code == 200


def test_laravel_accepted_prediction_boundaries_are_also_accepted_by_ml():
    response = client.post("/predict", json=payload(distance_km=500, weight_kg=25))
    assert response.status_code == 200, response.text


def test_bundled_model_card_declares_its_training_source():
    """The card must state where the weights came from.

    It is ``csv`` for the shipped Endomondo-trained artifact and ``synthetic``
    for a bootstrap build. What matters is that the field is present and
    honest, never that it holds one particular value — the previous version of
    this test hard-coded ``synthetic`` and broke the moment real data was used.
    """
    body = client.get("/model/info").json()
    assert body["training_source"] in {"synthetic", "csv", "supabase"}
    assert body["training_source"] is not None


def test_fueling_kit_hr_intensity_and_carb_loading():
    res = client.post(
        "/predict",
        json=payload(
            distance_km=21.1,
            target_hr=182,
            max_hr=190,
            resting_hr=50,
            acwr=1.35,
            carb_loading=True,
            fuel_items=[
                {"name": "Hydro Flask", "category": "drink", "carbs_g": 30, "sodium_mg": 350, "fluid_ml": 500},
                {"name": "Espresso Gel", "category": "gel", "carbs_g": 25, "sodium_mg": 50, "fluid_ml": 0},
            ],
        ),
    )
    assert res.status_code == 200, res.text
    fueling = res.json()["fueling"]
    assert fueling["intensity"] == "very_vigorous"
    assert fueling["carbs"]["daily_target_g"] == 540
    assert fueling["kit"]["items"]
    assert fueling["kit"]["cadence"]["sip_every_min"] > 0



# --- burn vs intake must stay distinguishable ------------------------------
#
# The fueling payload carries two kinds of number: what the session COSTS
# (calories, and the carbohydrate it oxidises) and what to TAKE IN (carbs,
# sodium, fluid, recovery). They are easy to conflate - a 1,560 kcal burn sitting
# in a row of intake tiles reads as "eat 1,560 kcal". These tests pin the facts
# that keep them apart, so a future refactor cannot quietly merge them.


def test_calories_report_burned_carbs_separately_from_intake():
    body = client.post("/predict", json=payload(distance_km=52, elevation_gain_m=250)).json()
    calories = body["fueling"]["calories"]

    assert calories["total"] > 0
    assert calories["from_carbs_pct"] in (45, 60)
    # Grams oxidised, derived from the burn - must be positive and consistent.
    assert calories["carbs_burned_g"] > 0

    expected = round(calories["total"] * calories["from_carbs_pct"] / 100 / 4)
    assert abs(calories["carbs_burned_g"] - expected) <= 1


def test_carbs_burned_exceeds_carbs_to_eat():
    """You cannot and should not replace a session's carbohydrate burn.

    If this ever flips, the plan is telling athletes to eat everything they
    burn - which is the exact misconception the split UI exists to prevent.
    """
    body = client.post("/predict", json=payload(distance_km=52, elevation_gain_m=250)).json()
    fueling = body["fueling"]
    assert fueling["calories"]["carbs_burned_g"] > fueling["carbs"]["total_g"]


def test_recovery_is_reported_as_its_own_structured_block():
    body = client.post("/predict", json=payload(distance_km=52, elevation_gain_m=250)).json()
    recovery = body["fueling"]["recovery"]

    assert recovery["carbs_g"] > 0
    assert recovery["protein_g"] > 0
    assert recovery["window"] == "Within 30 min after"
    assert recovery["elevated_load"] in (True, False)
    assert recovery["note"]


def test_recovery_matches_its_timeline_step():
    """One rule, two presentations - they must not drift apart."""
    body = client.post("/predict", json=payload(distance_km=52, elevation_gain_m=250)).json()
    fueling = body["fueling"]
    step = next(s for s in fueling["timeline"] if s["icon"] == "recovery")

    assert fueling["recovery"]["carbs_g"] == step["carbs_g"]
    assert f"{fueling['recovery']['carbs_g']} g carbs" in step["detail"]
    assert f"{fueling['recovery']['protein_g']} g protein" in step["detail"]


def test_recovery_is_far_smaller_than_the_burn():
    """Recovery feeds the next session; it is not a refund of this one."""
    body = client.post("/predict", json=payload(distance_km=52, elevation_gain_m=250)).json()
    fueling = body["fueling"]
    recovery_kcal = fueling["recovery"]["carbs_g"] * 4 + fueling["recovery"]["protein_g"] * 4
    assert recovery_kcal < fueling["calories"]["total"] / 2


def test_elevated_load_raises_recovery_carbs():
    calm = client.post("/predict", json=payload(distance_km=20, acwr=1.0)).json()["fueling"]
    loaded = client.post("/predict", json=payload(distance_km=20, acwr=1.5)).json()["fueling"]

    assert calm["recovery"]["elevated_load"] is False
    assert loaded["recovery"]["elevated_load"] is True
    assert loaded["recovery"]["carbs_g"] > calm["recovery"]["carbs_g"]
