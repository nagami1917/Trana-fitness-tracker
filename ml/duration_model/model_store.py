"""Loads the trained duration model once per process and serves predictions."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from duration_model.preprocess import (
    DEFAULT_SPEED_KMH,
    DOMAIN_MAX_DISTANCE_KM,
    FEATURE_ORDER,
    FLAT_CLIMB_SENSITIVITY,
    base_minutes,
    build_feature_row,
    experience_level,
    haversine_km,
    reference_curve,
    reference_speed,
    reference_stats,
)

ARTIFACTS = Path(__file__).resolve().parent


def compute_confidence(
    *,
    q10: float,
    q50: float,
    q90: float,
    activity_type: str,
    distance_km: float,
    elevation_gain_m: float,
    history_count: int,
    max_history_km: float,
) -> float:
    """Compute a calibrated [0.30, 0.96] confidence reflecting interval width, history depth, and OOD distance."""
    interval_conf = 1.0 - (q90 - q10) / (2.0 * max(q50, 1.0))
    if history_count <= 0:
        history_factor = 0.58
    elif history_count == 1:
        history_factor = 0.78
    elif history_count == 2:
        history_factor = 0.88
    elif history_count < 5:
        history_factor = 0.94
    else:
        history_factor = 1.0

    domain_max_km = DOMAIN_MAX_DISTANCE_KM.get(activity_type, 45.0)
    ood_ratio = max(1.0, distance_km / domain_max_km)
    if max_history_km > 0 and distance_km > max_history_km * 2.0:
        ood_ratio = max(ood_ratio, distance_km / (max_history_km * 2.0))
    elev_per_km = max(0.0, elevation_gain_m) / max(distance_km, 0.1)
    if elev_per_km > 150.0:
        ood_ratio = max(ood_ratio, elev_per_km / 150.0)
    ood_factor = 1.0 / (1.0 + 0.35 * (ood_ratio - 1.0))

    return float(np.clip(interval_conf * history_factor * ood_factor, 0.30, 0.96))


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
        weight_kg: float = 60.0,
        history: list[dict],
        experience: int | None = None,
    ) -> dict:
        del weight_kg
        if experience is None:
            experience = experience_level(len(history))
        stats = reference_stats(history, activity_type)
        history_count = int(stats["count"])
        max_history_km = float(stats["max_distance_km"])

        ref_a, ref_b = reference_curve(history, activity_type, experience=experience)
        ref_speed = reference_speed(history, activity_type)

        row = build_feature_row(
            activity_type=activity_type,
            distance_km=distance_km,
            elevation_gain_m=elevation_gain_m,
            experience=experience,
            history_count=history_count,
        )
        base = base_minutes(distance_km, ref_a, ref_b)

        if self.bundle:
            x = np.array([[row[name] for name in FEATURE_ORDER]], dtype=float)
            factor = {q: math.exp(float(self.bundle["models"][q].predict(x)[0])) for q in ("q10", "q50", "q90")}
            # Guard against pathological multiplicative blow-ups on out-of-range input.
            factor = {q: min(3.0, max(0.7, v)) for q, v in factor.items()}
            q10 = base * factor["q10"]
            q50 = max(base * factor["q50"], q10)
            q90 = max(base * factor["q90"], q50)

            # ML phase 2: widen the band symmetrically/asymmetrically matching calibrate.fit_factor
            k = float((self.bundle.get("calibration") or {}).get("factor", 1.0) or 1.0)
            if k > 1.0:
                halfwidth = (q90 - q10) / 2.0
                lo_dev = (q50 - q10) if (q50 - q10) > 1e-9 else halfwidth
                hi_dev = (q90 - q50) if (q90 - q50) > 1e-9 else halfwidth
                q10 = q50 - k * lo_dev
                q90 = q50 + k * hi_dev
            basis = "gradient_boosted_pace_factor"
        else:  # graceful degradation when artifacts are missing
            sens = FLAT_CLIMB_SENSITIVITY.get(activity_type, 1.25)
            climb = 1.0 / (1.0 + sens * row["elevation_per_km"] / 100.0)
            fatigue = 1.0 / (1.0 + 0.012 * max(0.0, distance_km - 8.0))
            q50 = base / (climb * fatigue)
            spread_frac = 0.25 if history_count == 0 else 0.14
            spread = max(3.0, q50 * spread_frac)
            q10, q90 = q50 - spread, q50 + spread
            basis = "physics_fallback"

        # Never let the interval invert or go non-physical.
        q50 = max(1.0, q50)
        q10 = max(1.0, min(q10, q50))
        q90 = max(q90, q50)

        speed = distance_km / (q50 / 60.0)
        confidence = compute_confidence(
            q10=q10,
            q50=q50,
            q90=q90,
            activity_type=activity_type,
            distance_km=distance_km,
            elevation_gain_m=elevation_gain_m,
            history_count=history_count,
            max_history_km=max_history_km,
        )

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
