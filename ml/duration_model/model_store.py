"""Loads the trained duration model once per process and serves predictions."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

import math

from duration_model.preprocess import (
    DEFAULT_SPEED_KMH,
    FEATURE_ORDER,
    base_minutes,
    build_feature_row,
    experience_level,
    haversine_km,
    reference_curve,
    reference_speed,
)

ARTIFACTS = Path(__file__).resolve().parent


class DurationModel:
    def __init__(self) -> None:
        self.bundle: dict | None = None
        self.card: dict | None = None
        self._load()

    # ------------------------------------------------------------------ load
    def _load(self) -> None:
        joblib_path = ARTIFACTS / "duration_model.joblib"
        card_path = ARTIFACTS / "model_card.json"
        if joblib_path.exists():
            import joblib

            self.bundle = joblib.load(joblib_path)
        if card_path.exists():
            self.card = json.loads(card_path.read_text())

    @property
    def ready(self) -> bool:
        return self.bundle is not None

    # ------------------------------------------------------------- inference
    def predict(
        self,
        *,
        activity_type: str,
        distance_km: float,
        elevation_gain_m: float,
        weight_kg: float,
        history: list[dict],
        experience: int | None = None,
    ) -> dict:
        ref_a, ref_b = reference_curve(history, activity_type)
        ref_speed = reference_speed(history, activity_type)
        if experience is None:
            experience = experience_level(len(history))

        row = build_feature_row(
            activity_type=activity_type,
            distance_km=distance_km,
            elevation_gain_m=elevation_gain_m,
            weight_kg=weight_kg,
            experience=experience,
        )
        base = base_minutes(distance_km, ref_a, ref_b)

        if self.bundle:
            x = np.array([[row[name] for name in FEATURE_ORDER]], dtype=float)
            factor = {q: math.exp(float(self.bundle["models"][q].predict(x)[0])) for q in ("q10", "q50", "q90")}
            # Guard against pathological multiplicative blow-ups on out-of-range input.
            factor = {q: min(3.0, max(0.7, v)) for q, v in factor.items()}
            q10, q50, q90 = base * factor["q10"], max(base * factor["q50"], base * factor["q10"]), base * factor["q90"]
            basis = "gradient_boosted_pace_factor"
        else:  # graceful degradation when artifacts are missing
            climb = 1.0 / (1.0 + 1.4 * row["elevation_per_km"] / 100.0)
            fatigue = 1.0 / (1.0 + 0.012 * max(0.0, distance_km - 8.0))
            q50 = base / (climb * fatigue)
            spread = max(3.0, q50 * 0.14)
            q10, q90 = q50 - spread, q50 + spread
            basis = "physics_fallback"

        # Never let the interval invert or go non-physical.
        q10 = max(1.0, min(q10, q50))
        q90 = max(q90, q50)
        q50 = max(1.0, q50)

        speed = distance_km / (q50 / 60.0)
        confidence = float(np.clip(1.0 - (q90 - q10) / (2.0 * q50), 0.35, 0.97))

        return {
            "minutes": round(q50, 1),
            "hours": round(q50 / 60.0, 2),
            "range": {
                "low": round(max(1.0, q10), 1),
                "high": round(q90, 1),
            },
            "pace_min_per_km": round(q50 / distance_km, 2) if activity_type in ("run", "walk", "hike") else None,
            "speed_kmh": round(speed, 2),
            "confidence": round(confidence, 2),
            "reference_speed_kmh": round(ref_speed, 2),
            "reference_curve": {"a": round(ref_a, 4), "b": round(ref_b, 3)},
            "basis": basis,
        }

    def info(self) -> dict:
        if self.card:
            return self.card
        return {
            "name": "TRANA duration model",
            "status": "untrained",
            "algorithm": "physics fallback",
            "features": FEATURE_ORDER,
            "default_speeds_kmh": DEFAULT_SPEED_KMH,
        }


def route_metrics(route: list[tuple[float, float]] | None) -> dict:
    if not route or len(route) < 2:
        return {}
    return {"distance_km": round(haversine_km(route), 3)}
