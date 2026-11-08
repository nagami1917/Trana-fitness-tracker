"""Feature engineering shared by training and inference.

Design note — why a *pace-factor* model
---------------------------------------
TRANA has very little data per user (a dozen activities is typical), so a model
that predicts raw minutes from scratch has to re-learn each athlete's speed
from a handful of rows and extrapolates badly at long distances.

Instead we anchor on the athlete's own reference speed (km/h) for the modality
and learn only the *multiplier* that fatigue, climbing and terrain apply:

    base_minutes = distance_km / ref_speed_kmh * 60
    duration_min = base_minutes * exp(f(distance, elevation, weight, experience, modality))

`f` is a small gradient-boosted model (three quantiles). The result is anchored
to reality — a 10 km/h runner stays a 10 km/h runner — while the model learns
the interesting part: how much slower they get on a 400 m climb or at 30 km.

The same module is used by the FastAPI service and (mirrored in JS) by the
offline PWA, so both produce identical vectors.
"""

from __future__ import annotations

import math
from typing import Iterable

import pandas as pd

ACTIVITY_TYPES = ("run", "ride", "walk", "hike")

# Population fallbacks when a user has no history for a modality yet.
DEFAULT_SPEED_KMH = {"run": 8.8, "ride": 20.0, "walk": 4.7, "hike": 3.6}

# Features fed to the gradient-boosted pace-factor model (order is part of the
# contract with the exported JSON trees and the browser evaluator).
FEATURE_ORDER = [
    "distance_km",
    "elevation_gain_m",
    "elevation_per_km",
    "weight_kg",
    "experience_level",
    "is_run",
    "is_ride",
    "is_walk",
    "is_hike",
]


# Riegel's endurance exponent: time scales as distance^b. Running is ~1.06;
# a bike is closer to linear (no weight-bearing fatigue), hiking steeper.
RIEGEL_EXPONENT = {"run": 1.06, "walk": 1.06, "hike": 1.15, "ride": 1.03}


def reference_curve(history: Iterable[dict], activity_type: str, exclude_id: int | None = None) -> tuple[float, float]:
    """Fit this athlete's distance→time curve: ``log t = a + b · log d``.

    Using a log-log fit instead of an average speed is what lets TRANA answer
    "how long will *my* 21 km take" from "my 5 km takes 28 min" — an average
    speed would silently assume a 5 km and a 21 km effort run at the same pace.

    Returns ``(a, b)``; at least one historical activity is required, otherwise
    the modality's default speed is used with an exponent of 1.
    """
    points: list[tuple[float, float]] = []
    for row in history:
        if row.get("activity_type") != activity_type:
            continue
        if exclude_id is not None and row.get("id") == exclude_id:
            continue
        distance = float(row.get("distance_km") or 0)
        duration = float(row.get("duration_min") or 0)
        if distance > 0 and duration > 0:
            points.append((math.log(distance), math.log(duration)))

    default_b = RIEGEL_EXPONENT.get(activity_type, 1.0)
    if not points:
        # No history at all: fall back to a population speed for this modality.
        speed = DEFAULT_SPEED_KMH.get(activity_type, 6.0)
        return math.log(60.0 / speed), 1.0
    if len(points) == 1:
        x, y = points[0]
        return y - default_b * x, default_b

    n = len(points)
    mean_x = sum(p[0] for p in points) / n
    mean_y = sum(p[1] for p in points) / n
    var_x = sum((p[0] - mean_x) ** 2 for p in points)
    if var_x < 1e-9:
        x, y = points[0]
        return y - default_b * x, default_b
    b = sum((p[0] - mean_x) * (p[1] - mean_y) for p in points) / var_x
    b = float(min(1.35, max(0.85, b)))
    a = mean_y - b * mean_x
    return float(a), b


def reference_speed(history: Iterable[dict], activity_type: str, exclude_id: int | None = None) -> float:
    """Average moving speed (km/h) the athlete sustains for this modality."""
    speeds = []
    for row in history:
        if row.get("activity_type") != activity_type:
            continue
        if exclude_id is not None and row.get("id") == exclude_id:
            continue
        distance = float(row.get("distance_km") or 0)
        duration = float(row.get("duration_min") or 0)
        if distance > 0 and duration > 0:
            speeds.append(distance / (duration / 60.0))
    if not speeds:
        return DEFAULT_SPEED_KMH.get(activity_type, 6.0)
    return sum(speeds) / len(speeds)


def experience_level(total_activities: int) -> int:
    """Bucket a user's history size into the 1–5 scale the model was trained on."""
    if total_activities >= 40:
        return 5
    if total_activities >= 24:
        return 4
    if total_activities >= 12:
        return 3
    if total_activities >= 5:
        return 2
    return 1


def build_feature_row(
    *,
    activity_type: str,
    distance_km: float,
    elevation_gain_m: float,
    weight_kg: float,
    experience: int,
) -> dict[str, float]:
    distance_km = max(0.1, float(distance_km))
    elevation_gain_m = max(0.0, float(elevation_gain_m))
    return {
        "distance_km": distance_km,
        "elevation_gain_m": elevation_gain_m,
        "elevation_per_km": elevation_gain_m / distance_km,
        "weight_kg": max(30.0, float(weight_kg)),
        "experience_level": float(experience),
        "is_run": 1.0 if activity_type == "run" else 0.0,
        "is_ride": 1.0 if activity_type == "ride" else 0.0,
        "is_walk": 1.0 if activity_type == "walk" else 0.0,
        "is_hike": 1.0 if activity_type == "hike" else 0.0,
    }


def base_minutes(distance_km: float, a: float, b: float) -> float:
    """Flat-equivalent time the athlete needs for this distance, from their own curve."""
    minutes = math.exp(a + b * math.log(max(distance_km, 0.1)))
    # Sanity clamp: 2:00/km … 45:00/km keeps wild extrapolations out of the UI.
    return float(min(45.0 * max(distance_km, 0.1), max(2.0 * max(distance_km, 0.1), minutes)))


def to_frame(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=FEATURE_ORDER).astype(float)


def training_frame(activities: pd.DataFrame) -> pd.DataFrame:
    """Turn a raw activity log into a supervised frame of log pace factors.

    The anchor (``a``, ``b``) is fitted **per user and modality**, leaving the
    current activity out — exactly what is available at prediction time.
    """
    records = activities.to_dict("records")
    groups: dict[tuple[int, str], list[dict]] = {}
    for row in records:
        groups.setdefault((int(row["user_id"]), row["activity_type"]), []).append(row)

    features: list[dict] = []
    for row in records:
        key = (int(row["user_id"]), row["activity_type"])
        a, b = reference_curve(groups[key], row["activity_type"], exclude_id=row["id"])
        features.append(
            build_feature_row(
                activity_type=row["activity_type"],
                distance_km=row["distance_km"],
                elevation_gain_m=row["elevation_gain_m"],
                weight_kg=row["weight_kg"],
                experience=row["experience_level"],
            )
        )
        base = base_minutes(float(row["distance_km"]), a, b)
        duration = float(row["duration_min"])
        features[-1]["base_minutes"] = base
        features[-1]["duration_min"] = duration
        features[-1]["log_pace_factor"] = float(math.log(duration / base))

    frame = to_frame(features)
    frame["base_minutes"] = [row["base_minutes"] for row in features]
    frame["duration_min"] = [row["duration_min"] for row in features]
    frame["log_pace_factor"] = [row["log_pace_factor"] for row in features]
    return frame


def haversine_km(points: list[tuple[float, float]] | list[list[float]]) -> float:
    """Great-circle length of a [[lat, lng], ...] polyline, in kilometres."""
    r = 6371.0088
    total = 0.0
    for (lat1, lon1), (lat2, lon2) in zip(points, points[1:]):
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dphi = p2 - p1
        dlambda = math.radians(lon2 - lon1)
        h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
        total += 2 * r * math.asin(min(1.0, math.sqrt(h)))
    return total
