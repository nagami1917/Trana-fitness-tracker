"""Convert the FitRec sample (Endomondo exports) into Trana's activity CSV.

The FitRec sample package ships as two gzip-compressed JSON exports —
``endomondoMeta.json.gz`` (per-workout metadata) and ``endomondoHR.json.gz``
(per-workout GPS/heart-rate time series) — each a few gigabytes. This script
streams them with a bounded-memory object scanner (never loads a whole file),
keeps a strided sample of run/ride/walk/hike workouts, and writes the exact
CSV schema used by the GeoLife validation:

    user_id,activity_type,mode_original,distance_km,duration_min,start_time,source_path

The raw exports are **not redistributed** (dataset terms) — only this derived
CSV is produced, and it is git-ignored; keep it in personal storage (e.g. the
owner's Google Drive).

Run (stdlib only — no pip installs needed)::

    python ml/data/endomondo_to_csv.py \
        --meta "/path/endomondoMeta.json.gz" \
        --hr   "/path/endomondoHR (1).json.gz" \
        --max 8000

Then validate::

    python -m evaluation.endomondo_validation
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "external" / "endomondo_activities.csv"

FIELDS = [
    "user_id",
    "activity_type",
    "mode_original",
    "distance_km",
    "duration_min",
    "start_time",
    "source_path",
]

# Endomondo sport labels → Trana activity types (anything else is skipped).
SPORT_MAP = {
    "running": "run",
    "run": "run",
    "cycling": "ride",
    "bike": "ride",
    "biking": "ride",
    "cycling_transport": "ride",
    "mountain_biking": "ride",
    "mountain biking": "ride",
    "walking": "walk",
    "walk": "walk",
    "hiking": "hike",
    "hike": "hike",
}

SPEED_TRIM_KMH = (0.5, 50.0)  # same plausibility window as the GeoLife run

USER_KEYS = ("userId", "user_id", "user", "author", "username", "account")
ID_KEYS = ("id", "workoutId", "workout_id", "activityId", "activity_id")
SPORT_KEYS = ("sport", "type", "activityType", "activity_type", "mode")
DISTANCE_KEYS = ("distance", "distance_m", "distanceMeters", "length", "length_m")
# Scalars, or per-sample arrays whose span is the elapsed time.
DURATION_KEYS = ("elapsedTime", "elapsed_time", "duration", "totalTime", "total_time", "time")
TIME_KEYS = ("timestamp", "timestamps", "time", "startTime", "start_time", "startDate", "date")


def _open(path: Path):
    return gzip.open(path, "rt", encoding="utf-8", errors="replace") if path.suffix == ".gz" else open(
        path, "rt", encoding="utf-8", errors="replace"
    )


def iter_json_objects(path: Path, chunk_size: int = 1 << 20):
    """Yield top-level ``{...}`` objects from a JSON array (or one wrapper
    object) without ever holding the whole document in memory."""
    with _open(path) as fh:
        buf = ""
        depth = 0
        in_str = esc = False
        start = -1
        while True:
            chunk = fh.read(chunk_size)
            if not chunk:
                break
            buf += chunk
            i, n = 0, len(buf)
            while i < n:
                c = buf[i]
                if depth == 0:
                    if c == "{":
                        depth, start, in_str, esc = 1, i, False, False
                elif in_str:
                    if esc:
                        esc = False
                    elif c == "\\":
                        esc = True
                    elif c == '"':
                        in_str = False
                else:
                    if c == '"':
                        in_str = True
                    elif c == "{":
                        depth += 1
                    elif c == "}":
                        depth -= 1
                        if depth == 0:
                            yield buf[start : i + 1]
                            buf = buf[i + 1 :]
                            n = len(buf)
                            i = -1  # resume scanning the trimmed buffer
                            start = -1
                i += 1


def _as_workouts(parsed) -> list[dict]:
    """A file may be ``[{w}, {w}, …]`` or a wrapper ``{"data": [{w}…], …}``."""
    if isinstance(parsed, list):
        return [w for w in parsed if isinstance(w, dict)]
    if isinstance(parsed, dict):
        if any(k in parsed for k in SPORT_KEYS):
            return [parsed]
        for value in parsed.values():
            if isinstance(value, list) and value and isinstance(value[0], dict):
                return [w for w in value if isinstance(w, dict)]
    return []


def _pick(workout: dict, keys: tuple[str, ...]):
    for key in keys:
        if key in workout and workout[key] is not None:
            return workout[key]
    return None


def _seconds(value) -> float | None:
    """Scalar seconds, or the span of a per-sample array of seconds."""
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, list) and value:
        first, last = value[0], value[-1]
        if isinstance(first, (int, float)) and isinstance(last, (int, float)) and last > first:
            return float(last - first)
    return None


def _start_time(workout: dict) -> str:
    for key in TIME_KEYS:
        value = workout.get(key)
        if isinstance(value, list) and value and isinstance(value[0], (int, float)):
            return datetime.fromtimestamp(float(value[0]), tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        if isinstance(value, (int, float)) and value > 10**8:  # epoch seconds/millis
            seconds = float(value) / (1000.0 if value > 10**11 else 1.0)
            return datetime.fromtimestamp(seconds, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        if isinstance(value, str) and len(value) >= 10:
            return value[:19].replace("T", " ")
    return ""


def extract_row(workout: dict, source_name: str) -> tuple[dict | None, str]:
    """Return (row, skip_reason). row is None when the workout is unusable."""
    sport_raw = _pick(workout, SPORT_KEYS)
    if not isinstance(sport_raw, str):
        return None, "no_sport"
    sport = sport_raw.strip().lower().replace("-", "_")
    activity_type = SPORT_MAP.get(sport)
    if activity_type is None:
        return None, "sport_excluded"

    duration_s = _seconds(_pick(workout, DURATION_KEYS))
    if duration_s is None:
        # Many exports only carry per-sample timestamps — the span is elapsed time.
        duration_s = _seconds(_pick(workout, TIME_KEYS))
    if duration_s is None:
        return None, "no_duration"

    distance_value = _pick(workout, DISTANCE_KEYS)
    distance_m = None
    if isinstance(distance_value, (int, float)):
        distance_m = float(distance_value)
    elif isinstance(distance_value, list) and distance_value and isinstance(distance_value[-1], (int, float)):
        distance_m = float(distance_value[-1])
    if distance_m is None or distance_m <= 0:
        return None, "no_distance"

    duration_min = duration_s / 60.0
    distance_km = distance_m / 1000.0
    speed_kmh = distance_km / (duration_min / 60.0) if duration_min > 0 else 0.0
    if not SPEED_TRIM_KMH[0] <= speed_kmh <= SPEED_TRIM_KMH[1]:
        return None, "speed_trim"

    workout_id = _pick(workout, ID_KEYS) or "unknown"
    user = _pick(workout, USER_KEYS)
    # Without a user id every workout is its own account → cold-start
    # protocol (documented in the validation report).
    user_id = str(user) if user is not None else f"w{workout_id}"

    return (
        {
            "user_id": user_id,
            "activity_type": activity_type,
            "mode_original": sport,
            "distance_km": round(distance_km, 4),
            "duration_min": round(duration_min, 3),
            "start_time": _start_time(workout),
            "source_path": f"{source_name}#{workout_id}",
        },
        "",
    )


def convert(paths: list[Path], out: Path, max_rows: int, stride: int) -> dict:
    rows: dict[str, dict] = {}  # keyed by workout id → meta/HR merge, no dupes
    dropped: dict[str, int] = {}
    first_keys: list[str] = []
    skipped_no_user = 0

    for path in paths:
        if not path.exists():
            raise SystemExit(f"{path} not found")
        seen = 0
        for raw in iter_json_objects(path):
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                dropped["unparseable"] = dropped.get("unparseable", 0) + 1
                continue
            for workout in _as_workouts(parsed):
                seen += 1
                if stride > 1 and (seen - 1) % stride:
                    continue
                if not first_keys:
                    first_keys = sorted(workout.keys())
                row, reason = extract_row(workout, path.name)
                if row is None:
                    dropped[reason] = dropped.get(reason, 0) + 1
                    continue
                workout_id = row["source_path"].split("#", 1)[-1]
                if workout_id not in rows and _pick(workout, USER_KEYS) is None:
                    skipped_no_user += 1
                rows.setdefault(workout_id, row)
                if len(rows) >= max_rows:
                    break
            if len(rows) >= max_rows:
                break
        print(f"  read {path.name}: {seen} workouts scanned, {len(rows)} rows kept so far")

    if not rows:
        raise SystemExit(
            "no usable rows extracted — first workout keys were: "
            f"{first_keys or 'none (empty file?)'}"
        )

    ordered = sorted(
        rows.values(),
        key=lambda r: (r["user_id"], r["activity_type"], r["start_time"]),
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(ordered)

    by_type: dict[str, int] = {}
    for row in ordered:
        by_type[row["activity_type"]] = by_type.get(row["activity_type"], 0) + 1

    return {
        "rows": len(ordered),
        "by_type": by_type,
        "dropped": dropped,
        "first_keys": first_keys,
        "no_user_id": skipped_no_user,
        "out": out,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="FitRec sample (Endomondo) → Trana activity CSV")
    parser.add_argument("--meta", type=Path, default=None, help="endomondoMeta.json.gz")
    parser.add_argument("--hr", type=Path, default=None, help="endomondoHR.json.gz (only needed when meta lacks distance/duration)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output CSV path")
    parser.add_argument("--max", type=int, default=8000, help="max rows to keep")
    parser.add_argument("--stride", type=int, default=1, help="keep every Nth workout (spreads the sample across the file)")
    args = parser.parse_args()

    sources = [p for p in (args.meta, args.hr) if p is not None]
    if not sources:
        parser.error("provide --meta and/or --hr")

    print(f"converting {len(sources)} source file(s) → {args.out}")
    stats = convert(sources, args.out, args.max, args.stride)

    print(f"\nwrote {stats['rows']} rows → {stats['out']}")
    print(f"  by type: {stats['by_type']}")
    if stats["dropped"]:
        print(f"  dropped: {stats['dropped']}")
    if stats["no_user_id"]:
        print(
            f"  note: {stats['no_user_id']} workouts had no user id → each is its own "
            "account (cold-start protocol; see the validation report)."
        )
    print(f"  first workout keys: {', '.join(stats['first_keys'])}")
    print("\nnext: python -m evaluation.endomondo_validation")


if __name__ == "__main__":
    sys.exit(main())
