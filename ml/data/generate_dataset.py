"""
TRANA — synthetic historical activity corpus generator.

TRANA predicts duration/fueling from a user's *own* past activities. Because the
production database starts empty, the duration model is bootstrapped on a
physics-informed synthetic corpus built from published field formulas
(Naismith's rule for elevation, ACSM/VAM metabolic cost) plus per-athlete
fitness factors, flat + hilly terrain coverage, and realistic noise.

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

# How strongly climbing slows each modality down (matches flat-equivalent normalization).
CLIMB_SENSITIVITY = {"run": 0.85, "ride": 0.45, "walk": 0.70, "hike": 0.75}

# Smooth Riegel-aligned endurance fatigue reference distance & exponent offset.
REF_DIST_KM = {"run": 5.0, "ride": 20.0, "walk": 4.0, "hike": 5.0}
FATIGUE_EXPONENT = {"run": 0.06, "ride": 0.03, "walk": 0.06, "hike": 0.12}

# Cover urban & endurance range: 1.5–45 km runs, 2–150 km rides, 0.5–22 km walks, 2–36 km hikes.
DISTANCE_RANGE_KM = {"run": (1.5, 45.0), "ride": (2.0, 150.0), "walk": (0.5, 22.0), "hike": (2.0, 36.0)}


def _rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


def build_corpus(n_users: int = 240, min_activities: int = 12, max_activities: int = 60, seed: int = 42) -> pd.DataFrame:
    rng = _rng(seed)
    rows: list[dict] = []
    activity_id = 1

    for user_id in range(1, n_users + 1):
        # --- athlete profile -------------------------------------------------
        weight_kg = float(np.clip(rng.normal(62, 12), 42, 115))
        experience = int(rng.integers(1, 6))  # 1 = new, 5 = seasoned
        fitness = 0.80 + 0.085 * (experience - 1) + rng.normal(0, 0.045)
        # Seasoned athletes sustain endurance distance with less pace decay.
        fatigue_skill = max(0.65, 1.0 - 0.08 * (experience - 3))
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
            # 30 % long efforts sampled across the modality's full useful range.
            if rng.random() < 0.70:
                distance_km = float(np.clip(rng.lognormal(math.log(lo * 1.5), 0.5), lo, hi))
            else:
                distance_km = float(rng.uniform(lo * 1.8, hi))

            # Include ~25% genuinely flat track/road/trainer sessions (0–1.5 m/km)
            # alongside rolling & mountain sessions up to 160 m/km so the model
            # learns the flat boundary accurately without negative-bias distortion.
            if rng.random() < 0.25 and activity_type != "hike":
                elevation_per_km = float(rng.uniform(0.0, 1.5)) if rng.random() < 0.5 else 0.0
            else:
                cap = 160.0 if activity_type == "hike" else 120.0
                elevation_per_km = float(np.clip(rng.lognormal(math.log(10 + 18 * (activity_type == "hike")), 0.90), 0.0, cap))
            elevation_gain_m = round(distance_km * elevation_per_km, 1)

            # --- physics-informed duration ------------------------------------
            base = BASE_SPEED_KMH[activity_type]
            climb_penalty = 1.0 / (1.0 + CLIMB_SENSITIVITY[activity_type] * elevation_per_km / 100.0)
            ref_d = REF_DIST_KM[activity_type]
            fatigue_exp = FATIGUE_EXPONENT[activity_type] * fatigue_skill
            fatigue = (max(distance_km, 0.5) / ref_d) ** (-fatigue_exp)
            speed = base * fitness * modality_bias[activity_type] * climb_penalty * fatigue
            speed *= float(np.clip(rng.normal(1.0, 0.055), 0.82, 1.2))  # day-to-day form, weather, traffic

            duration_min = distance_km / speed * 60.0

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
    """ACSM-style MET lookup + VAM vertical climbing work."""
    vam_m_per_h = max(0.0, elevation_per_km) * max(0.0, speed_kmh)
    climb_coef = 0.009 if activity_type == "ride" else 0.011
    climb_bonus = min(10.0, vam_m_per_h * climb_coef)
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
    # Chronological timestamps across sessions (k=0 oldest -> k=max newest)
    day_offset = int(index * 2) + int(rng.integers(0, 2))
    hour = int(rng.integers(6, 20))
    base = pd.Timestamp("2026-08-01T00:00:00+08:00") + pd.Timedelta(days=day_offset, hours=hour)
    return base.isoformat()


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the TRANA bootstrap corpus.")
    parser.add_argument("--users", type=int, default=240)
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
