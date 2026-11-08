"""Sanity-check the trained duration model against known-good reference points.

Run after training:

    python -m training.sanity_check

Any row whose relative error exceeds the tolerance is printed with a warning —
useful as a smoke test before deploying a new artifact.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.fueling import FuelingInput, recommend  # noqa: E402
from app.model_store import DurationModel  # noqa: E402

# (label, activity, distance, elevation, athlete reference pace, expected minutes)
CASES = [
    ("5 km easy run", "run", 5, 25, 10.5, 28.6),
    ("10 km run", "run", 10, 60, 10.5, 58.0),
    ("half marathon", "run", 21.1, 180, 10.5, 135.0),
    ("40 km ride", "ride", 40, 250, 21.0, 115.0),
    ("8 km hike, 400 m up", "hike", 8, 400, 3.9, 165.0),
    ("5 km walk", "walk", 5, 20, 4.9, 61.0),
]

TOLERANCE = 0.22


def main() -> None:
    model = DurationModel()
    if not model.ready:
        raise SystemExit("no trained artifact found — run `python -m training.train` first")

    print(f"{'case':<24}{'pred':>8}{'range':>18}{'expect':>8}{'err':>8}")
    failures = 0
    for label, kind, distance, elevation, ref_speed, expected in CASES:
        minutes = distance / ref_speed * 60.0
        history = [
            {"activity_type": kind, "distance_km": 5.0, "duration_min": 300.0 / ref_speed},
            {"activity_type": kind, "distance_km": 8.0, "duration_min": 480.0 / ref_speed * 1.02},
        ]
        pred = model.predict(
            activity_type=kind,
            distance_km=distance,
            elevation_gain_m=elevation,
            weight_kg=60,
            history=history,
            experience=3,
        )
        err = (pred["minutes"] - expected) / expected
        flag = "" if abs(err) <= TOLERANCE else "  <-- out of tolerance"
        if abs(err) > TOLERANCE:
            failures += 1
        interval = f"{pred['range']['low']:.0f}–{pred['range']['high']:.0f}"
        print(
            f"{label:<24}{pred['minutes']:>8.0f}{interval:>18}"
            f"{expected:>8.0f}{err:>+7.0%}{flag}"
        )

    demo = recommend(
        FuelingInput(activity_type="run", duration_min=135, weight_kg=60, elevation_per_km=8.5, avg_speed_kmh=9.4)
    )
    print("\nfueling for a 2 h 15 min run @ 60 kg")
    print(
        f"  calories {demo['calories']['total']} kcal | carbs {demo['carbs']['per_hour_g']} g/h "
        f"| sodium {demo['sodium']['per_hour_mg']} mg/h | fluid {demo['fluid']['per_hour_ml']} ml/h"
    )
    print(f"  intensity: {demo['intensity']} (MET {demo['met']})")

    print(f"\n{failures} case(s) outside ±{TOLERANCE:.0%}")
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
