"""Feature engineering shared by training and inference.

Design note — flat-normalized, Bayesian-regularized pace-factor model
--------------------------------------------------------------------
TRANA predicts an athlete's session duration from their own past logs:

    base_minutes = exp(a + b · ln d)
    duration_min = base_minutes · exp(f(features))

Key invariants enforced here (and mirrored 1:1 in frontend/src/lib/ml/duration.js):
1. Historical activities are normalized to *flat-equivalent* time before fitting
   the anchor curve `(a, b)`, so climbing cost is never absorbed into the anchor
   and double-counted by the GBDT.
2. Implausible GPS/timer glitches are filtered out, extreme pace outliers are
   down-weighted (Huber/MAD), recent sessions receive higher weight (90-day
   half-life when timestamps exist), and the Riegel exponent `b` uses Ridge
   shrinkage toward the sport prior with physical bounds [1.00, 1.30].
3. `training_frame` builds each row's anchor strictly chronologically from prior
   sessions only — matching real production inference with zero future leakage.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
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
    "experience_level",
    "history_count",
    "is_run",
    "is_ride",
    "is_walk",
    "is_hike",
]

# Riegel's endurance exponent: time scales as distance^b (b >= 1.00).
RIEGEL_EXPONENT = {"run": 1.06, "walk": 1.06, "hike": 1.15, "ride": 1.03}

# Flat-equivalent climbing cost per 100 m/km (10% grade) matching generate_dataset.py.
FLAT_CLIMB_SENSITIVITY = {"run": 0.85, "ride": 0.45, "walk": 0.70, "hike": 0.75}

# Plausible moving speeds (km/h) to reject paused timers & vehicle GPS glitches.
SPEED_BOUNDS_KMH = {
    "run": (2.5, 30.0),
    "ride": (1.5, 65.0),
    "walk": (0.5, 14.0),
    "hike": (0.5, 14.0),
}

# Ridge prior strength toward RIEGEL_EXPONENT[activity_type] (on ln-distance variance).
RIEGEL_PRIOR_STRENGTH = 0.25

# Domain upper bounds used for OOD confidence scaling.
DOMAIN_MAX_DISTANCE_KM = {"run": 45.0, "ride": 150.0, "walk": 25.0, "hike": 40.0}


def flat_equivalent_duration(
    duration_min: float,
    distance_km: float,
    elevation_gain_m: float,
    activity_type: str,
) -> float:
    """Convert raw elapsed duration to flat-equivalent minutes before anchor fitting."""
    elev_per_km = min(300.0, max(0.0, elevation_gain_m) / max(distance_km, 0.1))
    sens = FLAT_CLIMB_SENSITIVITY.get(activity_type, 1.0)
    factor = 1.0 + sens * (elev_per_km / 100.0)
    return duration_min / factor


def _parse_ts(raw: object) -> float | None:
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _median(vals: list[float]) -> float:
    s = sorted(vals)
    mid = len(s) // 2
    if len(s) % 2:
        return s[mid]
    return 0.5 * (s[mid - 1] + s[mid])


def _valid_history_points(
    history: Iterable[dict],
    activity_type: str,
    exclude_id: int | None = None,
) -> list[dict]:
    lo_spd, hi_spd = SPEED_BOUNDS_KMH.get(activity_type, (0.5, 60.0))
    pts: list[dict] = []
    for row in history:
        if row.get("activity_type") != activity_type:
            continue
        if exclude_id is not None and row.get("id") == exclude_id:
            continue
        distance = float(row.get("distance_km") or 0)
        duration = float(row.get("duration_min") or 0)
        if distance <= 0 or duration <= 0:
            continue
        speed = distance / (duration / 60.0)
        if speed < lo_spd or speed > hi_spd:
            continue
        ele = max(0.0, float(row.get("elevation_gain_m") or 0))
        flat_min = flat_equivalent_duration(duration, distance, ele, activity_type)
        pts.append(
            {
                "distance": distance,
                "duration": duration,
                "flat_min": flat_min,
                "x": math.log(distance),
                "y": math.log(flat_min),
                "log_pace": math.log(flat_min / distance),
                "ts": _parse_ts(row.get("started_at")),
            }
        )

    if not pts:
        return pts

    # Exponential recency weight (90-day half-life relative to most recent log).
    timestamps = [p["ts"] for p in pts if p["ts"] is not None]
    t_max = max(timestamps) if timestamps else None

    # Robust Huber down-weighting for extreme pace outliers when >= 4 sessions exist.
    med_pace = _median([p["log_pace"] for p in pts]) if len(pts) >= 4 else 0.0
    mad = _median([abs(p["log_pace"] - med_pace) for p in pts]) if len(pts) >= 4 else 0.0
    scale = max(0.15, 1.4826 * mad)

    for p in pts:
        w_time = 1.0
        if t_max is not None and p["ts"] is not None:
            age_days = max(0.0, (t_max - p["ts"]) / 86400.0)
            w_time = max(0.25, 0.5 ** (age_days / 90.0))
        w_rob = 1.0
        if len(pts) >= 4:
            resid = abs(p["log_pace"] - med_pace)
            if resid > 2.0 * scale:
                w_rob = (2.0 * scale) / resid
        p["w"] = w_time * w_rob
    return pts


def reference_stats(
    history: Iterable[dict],
    activity_type: str,
    exclude_id: int | None = None,
) -> dict[str, float | int]:
    """Return valid history count and maximum logged distance for this modality."""
    pts = _valid_history_points(history, activity_type, exclude_id=exclude_id)
    return {
        "count": len(pts),
        "max_distance_km": max((p["distance"] for p in pts), default=0.0),
    }


def reference_curve(
    history: Iterable[dict],
    activity_type: str,
    exclude_id: int | None = None,
    experience: int = 3,
) -> tuple[float, float]:
    """Fit this athlete's flat-equivalent curve: ``log t_flat = a + b · log d``.

    Uses weighted Ridge shrinkage toward ``RIEGEL_EXPONENT[activity_type]`` and
    physical bounds ``b in [1.00, 1.30]`` so thin or narrow-distance logs never
    extrapolate into non-physical negative-fatigue marathons.
    """
    pts = _valid_history_points(history, activity_type, exclude_id=exclude_id)
    default_b = RIEGEL_EXPONENT.get(activity_type, 1.06)

    if not pts:
        base_speed = DEFAULT_SPEED_KMH.get(activity_type, 6.0)
        exp_clamped = min(5, max(1, int(experience or 3)))
        exp_mult = 1.0 + 0.085 * (exp_clamped - 3)
        return math.log(60.0 / (base_speed * exp_mult)), float(default_b)

    if len(pts) == 1:
        p = pts[0]
        return float(p["y"] - default_b * p["x"]), float(default_b)

    w_sum = sum(p["w"] for p in pts)
    mean_x = sum(p["w"] * p["x"] for p in pts) / w_sum
    mean_y = sum(p["w"] * p["y"] for p in pts) / w_sum
    s_xx = sum(p["w"] * (p["x"] - mean_x) ** 2 for p in pts)
    s_xy = sum(p["w"] * (p["x"] - mean_x) * (p["y"] - mean_y) for p in pts)

    b = (s_xy + RIEGEL_PRIOR_STRENGTH * default_b) / (s_xx + RIEGEL_PRIOR_STRENGTH)
    b = float(min(1.30, max(1.00, b)))
    a = mean_y - b * mean_x
    return float(a), b


def reference_speed(history: Iterable[dict], activity_type: str, exclude_id: int | None = None) -> float:
    """Weighted flat-equivalent moving speed (km/h) sustained for this modality."""
    pts = _valid_history_points(history, activity_type, exclude_id=exclude_id)
    if not pts:
        return DEFAULT_SPEED_KMH.get(activity_type, 6.0)
    w_sum = sum(p["w"] for p in pts)
    return sum(p["w"] * (p["distance"] / (p["duration"] / 60.0)) for p in pts) / w_sum


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
    experience: int = 3,
    history_count: int = 0,
    weight_kg: float = 60.0,  # kept optional for signature compatibility; unused by duration trees
) -> dict[str, float]:
    del weight_kg
    distance_km = max(0.1, float(distance_km))
    elevation_gain_m = max(0.0, float(elevation_gain_m))
    return {
        "distance_km": distance_km,
        "elevation_gain_m": elevation_gain_m,
        "elevation_per_km": elevation_gain_m / distance_km,
        "experience_level": float(min(5, max(1, int(experience or 3)))),
        "history_count": float(min(50, max(0, int(history_count)))),
        "is_run": 1.0 if activity_type == "run" else 0.0,
        "is_ride": 1.0 if activity_type == "ride" else 0.0,
        "is_walk": 1.0 if activity_type == "walk" else 0.0,
        "is_hike": 1.0 if activity_type == "hike" else 0.0,
    }


def base_minutes(distance_km: float, a: float, b: float) -> float:
    """Flat-equivalent time the athlete needs for this distance, from their own curve."""
    d = max(distance_km, 0.1)
    minutes = math.exp(a + b * math.log(d))
    # Sanity clamp: 2:00/km … 45:00/km keeps wild extrapolations out of the UI.
    return float(min(45.0 * d, max(2.0 * d, minutes)))


def to_frame(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=FEATURE_ORDER).astype(float)


def training_frame(activities: pd.DataFrame) -> pd.DataFrame:
    """Turn a raw activity log into a chronological supervised frame of log pace factors.

    Activities are sorted per ``(user_id, activity_type)`` chronologically so
    every row's anchor ``(a, b)`` and ``history_count`` see **only strictly
    prior sessions** — identical to production inference with zero future leakage.
    """
    work = activities.copy()
    if "started_at" in work.columns:
        work["_ts_sort"] = pd.to_datetime(work["started_at"], errors="coerce", utc=True)
    else:
        work["_ts_sort"] = pd.NaT
    sort_cols = ["user_id", "activity_type", "_ts_sort", "id"] if "id" in work.columns else ["user_id", "activity_type", "_ts_sort"]
    work = work.sort_values(sort_cols, kind="mergesort").drop(columns=["_ts_sort"])

    records = work.to_dict("records")
    prior_by_key: dict[tuple[int | str, str], list[dict]] = {}
    features: list[dict] = []

    for row in records:
        key = (row["user_id"], row["activity_type"])
        prior = prior_by_key.get(key, [])
        exp = int(row.get("experience_level") or 3)
        a, b = reference_curve(prior, row["activity_type"], experience=exp)
        valid_count = len(_valid_history_points(prior, row["activity_type"]))

        feat = build_feature_row(
            activity_type=row["activity_type"],
            distance_km=float(row["distance_km"]),
            elevation_gain_m=float(row.get("elevation_gain_m") or 0.0),
            experience=exp,
            history_count=valid_count,
        )
        base = base_minutes(float(row["distance_km"]), a, b)
        duration = float(row["duration_min"])
        feat["base_minutes"] = base
        feat["duration_min"] = duration
        feat["log_pace_factor"] = float(math.log(duration / base))
        features.append(feat)

        prior_by_key.setdefault(key, []).append(row)

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
