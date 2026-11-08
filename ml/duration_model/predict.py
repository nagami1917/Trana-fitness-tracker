"""Command-line predictor for the TRANA duration model.

Examples
--------
With your own recent activities as a JSON array:

    python -m duration_model.predict --activity-type run --distance-km 21.1 \
        --elevation-gain-m 220 --weight-kg 55 \
        --history-json '[{"activity_type":"run","distance_km":5,"duration_min":28.6}]'

Or with just your easy reference pace (used to build a two-point reference curve):

    python -m duration_model.predict --activity-type run --distance-km 21.1 \
        --elevation-gain-m 220 --weight-kg 55 --ref-speed-kmh 10.5
"""

from __future__ import annotations

import argparse
import json

from duration_model.model_store import DurationModel


def build_history(activity_type: str, ref_speed_kmh: float) -> list[dict]:
    """Two synthetic reference points at the athlete's typical easy speed."""
    return [
        {"activity_type": activity_type, "distance_km": 5.0, "duration_min": 300.0 / ref_speed_kmh},
        {"activity_type": activity_type, "distance_km": 8.0, "duration_min": 480.0 / ref_speed_kmh * 1.02},
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Predict activity duration with the trained TRANA model.")
    parser.add_argument("--activity-type", required=True, choices=["run", "ride", "walk", "hike"])
    parser.add_argument("--distance-km", required=True, type=float)
    parser.add_argument("--elevation-gain-m", type=float, default=0.0)
    parser.add_argument("--weight-kg", type=float, required=True)
    parser.add_argument("--experience-level", type=int, default=None, help="1 (new) … 5 (elite); default inferred from history length")
    parser.add_argument("--history-json", default=None, help="JSON array of {activity_type, distance_km, duration_min}")
    parser.add_argument("--ref-speed-kmh", type=float, default=None, help="your easy pace; builds a 2-point reference curve")
    args = parser.parse_args()

    if args.history_json:
        history = json.loads(args.history_json)
    elif args.ref_speed_kmh:
        history = build_history(args.activity_type, args.ref_speed_kmh)
    else:
        raise SystemExit("pass either --history-json or --ref-speed-kmh so the model can anchor to your pace")

    model = DurationModel()
    if not model.ready:
        raise SystemExit("no trained artifact found — run `python -m duration_model.train` first")

    pred = model.predict(
        activity_type=args.activity_type,
        distance_km=args.distance_km,
        elevation_gain_m=args.elevation_gain_m,
        weight_kg=args.weight_kg,
        history=history,
        experience=args.experience_level,
    )
    print(json.dumps(pred, indent=2))


if __name__ == "__main__":
    main()
