"""
TRANA — synthetic historical activity corpus generator.

TRANA predicts duration/fueling from a user's *own* past activities. Because the
production database starts empty, the duration model is bootstrapped on a
physics-informed synthetic corpus built from published field formulas
(Naismith's rule for elevation, ACSM metabolic equations for locomotion speed)
plus per-athlete fitness factors and realistic measurement noise.

Once real activities exist in Supabase, re-train with:

    python -m duration_model.train --source supabase        # uses DATABASE_URL
    python -m duration_model.train --source csv --csv data/my_export.csv

Output: training/data/activities.csv
Schema is identical to the `activities` table in Supabase.
"""

from __future__ import annotations

import argparse
import math
import os
from pathlib import Path

import numpy as np
import pandas as pd

ACTIVITY_TYPES = ("run", "ride", "walk", "hike")

# Typical moving speed (km/h) for a recreationally fit adult, flat ground, no wind.
BASE_SPEED_KMH = {"run": 9.6, "ride": 22.0, "walk": 5.0, "hike": 3.9}

# How strongly climbing slows each modality down.
CLIMB_SENSITIVITY = {"run": 1.25, "ride": 0.45, "walk": 1.0, "hike": 1.45}

# Distance at which fatigue starts to bite, and how hard it bites.
FATIGUE_ONSET_KM = {"run": 8.0, "ride": 45.0, "walk": 6.0, "hike": 8.0}
FATIGUE_RATE = {"run": 0.012, "ride": 0.006, "walk": 0.014, "hike": 0.016}

DISTANCE_RANGE_KM = {"run": (3.0, 32.0), "ride": (10.0, 120.0), "walk": (1.5, 15.0), "hike": (3.0, 26.0)}


def _rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


def build_corpus(n_users: int = 220, min_activities: int = 12, max_activities: int = 60, seed: int = 42) -> pd.DataFrame:
    rng = _rng(seed)
    rows: list[dict] = []
    activity_id = 1

    for user_id in range(1, n_users + 1):
        # --- athlete profile -------------------------------------------------
        weight_kg = float(np.clip(rng.normal(62, 12), 42, 115))
        experience = int(rng.integers(1, 6))  # 1 = new, 5 = seasoned
        fitness = 0.80 + 0.085 * (experience - 1) + rng.normal(0, 0.045)
        # Each athlete has a personal bias per modality (strength on the bike, etc.)
        modality_bias = {t: float(np.clip(rng.normal(1.0, 0.06), 0.82, 1.22)) for t in ACTIVITY_TYPES}
        favourite = rng.choice(ACTIVITY_TYPES, p=[0.42, 0.26, 0.20, 0.12])

        n_activities = int(rng.integers(min_activities, max_activities + 1))
        for k in range(n_activities):
            # People mostly repeat their favourite sport, with some cross-training.
            if rng.random() < 0.62:
                activity_type = favourite
            else:
                activity_type = str(rng.choice(ACTIVITY_TYPES))

            lo, hi = DISTANCE_RANGE_KM[activity_type]
            # 70 % everyday sessions (log-normal around a short base distance),
            # 30 % long efforts sampled across the modality's full useful range —
            # without the second mode the model never learns the endurance tail.
            if rng.random() < 0.70:
                distance_km = float(np.clip(rng.lognormal(math.log(lo * 1.5), 0.5), lo, hi))
            else:
                distance_km = float(rng.uniform(lo * 1.8, hi))
            elevation_per_km = float(np.clip(rng.lognormal(math.log(9 + 4 * (activity_type == "hike")), 0.85), 0, 95))
            elevation_gain_m = round(distance_km * elevation_per_km, 1)

            # --- physics-informed duration ------------------------------------
            base = BASE_SPEED_KMH[activity_type]
            climb_penalty = 1.0 / (1.0 + CLIMB_SENSITIVITY[activity_type] * elevation_per_km / 100.0)
            fatigue = 1.0 / (1.0 + FATIGUE_RATE[activity_type] * max(0.0, distance_km - FATIGUE_ONSET_KM[activity_type]))
            speed = base * fitness * modality_bias[activity_type] * climb_penalty * fatigue
            speed *= float(np.clip(rng.normal(1.0, 0.055), 0.82, 1.2))  # day-to-day form, weather, traffic

            # Hiking/walking pace depends on ascent even more than on gradient alone (Naismith).
            duration_min = distance_km / speed * 60.0
            if activity_type in ("hike", "walk"):
                duration_min += elevation_gain_m / 10.0 * (0.55 if activity_type == "hike" else 0.25)

            # --- observed calories (MET-based ground truth + noise) ------------
            met = estimate_met(activity_type, speed, elevation_per_km)
            calories = met * weight_kg * (duration_min / 60.0) * float(np.clip(rng.normal(1.0, 0.04), 0.9, 1.12))

            avg_hr = int(np.clip(
                rng.normal(118 + 26 * (0.9 - climb_penalty) + 6 * (experience - 3) / 2, 9),
                85, 178,
            ))

            rows.append(
                {
                    "id": activity_id,
                    "user_id": user_id,
                    "activity_type": activity_type,
                    "distance_km": round(distance_km, 2),
                    "elevation_gain_m": elevation_gain_m,
                    "duration_min": round(float(duration_min), 1),
                    "calories": int(round(float(calories))),
                    "avg_heart_rate": avg_hr,
                    "weight_kg": round(weight_kg, 1),
                    "experience_level": experience,
                    "started_at": _fake_timestamp(rng, k),
                }
            )
            activity_id += 1

    return pd.DataFrame(rows)


def estimate_met(activity_type: str, speed_kmh: float, elevation_per_km: float) -> float:
    """ACSM-style MET lookup: ~1 kcal/kg/hour per MET, adjusted for climbing."""
    climb_bonus = min(2.6, elevation_per_km * 0.045)
    if activity_type == "run":
        met = speed_kmh * 1.03  # running: MET ≈ 1.03 × km/h
    elif activity_type == "ride":
        met = 3.2 + speed_kmh * 0.29
    elif activity_type == "walk":
        met = 2.0 + speed_kmh * 0.45
    else:  # hike
        met = 3.6 + speed_kmh * 0.60
    return float(max(1.6, met + climb_bonus))


def _fake_timestamp(rng: np.random.Generator, index: int) -> str:
    day = 40 - int(index * 0.55) - int(rng.integers(0, 3))
    hour = int(rng.integers(6, 20))
    return f"2026-{ '11' if day > 0 else '10' }-{abs(day) + 1:02d}T{hour:02d}:00:00+08:00"


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the TRANA bootstrap corpus.")
    parser.add_argument("--users", type=int, default=220)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "data" / "activities.csv")
    args = parser.parse_args()

    df = build_corpus(n_users=args.users, seed=args.seed)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"wrote {len(df):,} activities from {df.user_id.nunique()} athletes -> {args.out}")
    print(df.groupby("activity_type")[["distance_km", "duration_min"]].mean().round(1))


if __name__ == "__main__":
    os.environ.setdefault("PYTHONHASHSEED", "0")
    main()
