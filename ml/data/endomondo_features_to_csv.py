"""Convert the Endomondo (FitRec) *feature* export into Trana's activity CSV.

This is the feature-level companion to :mod:`data.endomondo_to_csv`, which
streams the raw FitRec ``endomondoHR.json.gz`` export. If you already hold the
derived per-workout feature table (``endomondo_trained_predictions.csv``) — one
row per workout with heart-rate, altitude and GPS summary statistics — this
script turns it into the exact schema the trainer consumes:

    user_id,activity_type,distance_km,duration_min,elevation_gain_m,started_at

Why a derivation step is needed
-------------------------------
The feature table was built for a *sport classification* task, not a duration
task. It therefore carries ``duration_sec`` but no explicit ``distance_km``.
Distance is reconstructed from ``gps_spread``, the standard deviation of the
workout's GPS fixes in degrees, using the loop-perimeter approximation:

    distance_km ~= 4 * gps_spread * 111.32

``4 * spread`` approximates the perimeter of a box of that half-width, and
111.32 km is the length of one degree of latitude. The reconstruction
reproduces median speeds of roughly 5.4 km/h walking, 7.7 km/h running and
18.7 km/h riding, which are the expected ranges for those sports.

Elevation gain is taken as ``alt_range / 2`` — half the observed altitude band,
which is the gain you accumulate on an out-and-back route. ``climb_rate`` is
*not* used: multiplying it by duration yields a median of ~2,700 m, which is
implausible for the recorded workouts.

Sport mapping
-------------
Endomondo has ~19 sport labels; Trana models four. Only labels with a clear
counterpart are kept, everything else (gym, skiing, water) is dropped rather
than forced into a bucket.

Privacy
-------
The source table carries ``lat_start``/``lon_start``. Only the *spread* of the
fixes is used, never the position itself, so no location leaves this script.
Output is git-ignored like every other ``ml/data/external/endomondo_*.csv``
because the FitRec terms forbid redistribution.

Run::

    python ml/data/endomondo_features_to_csv.py \
        --features ~/endomondo_trained_predictions.csv \
        --out ml/data/external/endomondo_activities.csv
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

KM_PER_DEGREE = 111.32

#: Endomondo sport label -> TRANA activity type. Anything absent is dropped.
SPORT_MAP: dict[str, str] = {
    "run": "run",
    "bike": "ride",
    "bike (transport)": "ride",
    "mountain bike": "ride",
    "indoor cycling": "ride",
    "walk": "walk",
    "fitness walking": "walk",
    "hiking": "hike",
    "orienteering": "hike",
}

#: Plausible moving-speed window per activity type, km/h. The trainer applies
#: the same bounds again; filtering here keeps the report honest.
SPEED_BOUNDS_KMH: dict[str, tuple[float, float]] = {
    "run": (2.5, 30.0),
    "ride": (1.5, 65.0),
    "walk": (0.5, 14.0),
    "hike": (0.5, 14.0),
}

MIN_DURATION_MIN = 2.0
MAX_DURATION_MIN = 600.0
MIN_DISTANCE_KM = 0.2
MAX_DISTANCE_KM = 200.0

#: Synthetic epoch. The feature table has no per-workout timestamp, so rows are
#: ordered by workout id and dated forward from here. Only ordering matters:
#: the trainer builds each athlete's history chronologically.
EPOCH = "2020-01-01T00:00:00+00:00"


def build_frame(features: pd.DataFrame) -> pd.DataFrame:
    """Turn the feature export into the trainer's activity schema."""
    frame = features[features["sport"].isin(SPORT_MAP)].copy()
    frame["activity_type"] = frame["sport"].map(SPORT_MAP)

    # Distance from the GPS spread, elevation from the altitude band.
    frame["distance_km"] = 4.0 * frame["gps_spread"] * KM_PER_DEGREE
    frame["duration_min"] = frame["duration_sec"] / 60.0
    frame["elevation_gain_m"] = (frame["alt_range"] / 2.0).clip(lower=0.0)

    frame["user_id"] = frame["userId"].astype(str)

    # Deterministic ordering, then a synthetic timestamp so the trainer can
    # build each athlete's history in a stable sequence.
    frame = frame.sort_values(["user_id", "id"], kind="mergesort").reset_index(drop=True)
    frame["started_at"] = pd.to_datetime(EPOCH) + pd.to_timedelta(
        frame.groupby("user_id").cumcount() * 86400, unit="s"
    )

    return _filter_plausible(frame)


def _filter_plausible(frame: pd.DataFrame) -> pd.DataFrame:
    """Drop paused timers, GPS glitches and implausible speed."""
    speed = frame["distance_km"] / (frame["duration_min"] / 60.0)

    plausible = pd.Series(False, index=frame.index)
    for activity_type, (lower, upper) in SPEED_BOUNDS_KMH.items():
        plausible |= frame["activity_type"].eq(activity_type) & speed.between(lower, upper)

    plausible &= frame["duration_min"].between(MIN_DURATION_MIN, MAX_DURATION_MIN)
    plausible &= frame["distance_km"].between(MIN_DISTANCE_KM, MAX_DISTANCE_KM)

    return frame[plausible].copy()


COLUMNS = ["user_id", "activity_type", "distance_km", "duration_min", "elevation_gain_m", "started_at"]


def summarise(frame: pd.DataFrame, source_rows: int) -> dict:
    """Report what survived the mapping, for the model card and the docs."""
    speed = frame["distance_km"] / (frame["duration_min"] / 60.0)
    return {
        "source_rows": int(source_rows),
        "kept_rows": int(len(frame)),
        "users": int(frame["user_id"].nunique()),
        "by_activity_type": {
            str(k): int(v) for k, v in frame["activity_type"].value_counts().items()
        },
        "median_speed_kmh_by_activity_type": {
            str(k): round(float(v), 2) for k, v in speed.groupby(frame["activity_type"]).median().items()
        },
        "median_duration_min": round(float(frame["duration_min"].median()), 1),
        "median_distance_km": round(float(frame["distance_km"].median()), 2),
        "median_elevation_gain_m": round(float(frame["elevation_gain_m"].median()), 1),
        "derivation": {
            "distance_km": "4 * gps_spread * 111.32",
            "elevation_gain_m": "alt_range / 2",
            "started_at": "synthetic epoch + 1 day per workout, ordered by id",
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--features", required=True, help="endomondo_trained_predictions.csv")
    parser.add_argument("--out", required=True, help="destination CSV")
    parser.add_argument("--report", default=None, help="optional JSON summary path")
    args = parser.parse_args()

    features = pd.read_csv(args.features)
    frame = build_frame(features)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    frame[COLUMNS].to_csv(out, index=False)

    report = summarise(frame, len(features))
    print(json.dumps(report, indent=2))
    print(f"\nwrote {out} ({len(frame)} rows)")

    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
