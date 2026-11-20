"""Shrink the FitRec/Endomondo metadata CSV into TRANA's scalar training schema.

`endomondoMeta.csv` (183 MB) exceeds the agent sandbox's 100 MiB file cap and
cannot be pulled into the workspace, so the slimming has to happen on the
owner's machine. This script does it with the standard library only (no pandas),
streams the input, and never loads the whole file into memory.

It has three modes, meant to be run in this order:

1. INSPECT — find out what the columns actually are::

       python ml/data/slim_endomondo.py --inspect

   Prints the header, a truncated sample row, and what it thinks each column
   is. Paste this output back into the chat so the mapping can be confirmed
   before committing to a full conversion.

2. HEAD — emit the first N rows verbatim (small enough to share)::

       python ml/data/slim_endomondo.py --head 500 --out endomondo_head.csv

3. SLIM — convert every row to scalar features::

       python ml/data/slim_endomondo.py --out endomondo_slim.csv

   Nested JSON arrays (altitude, heart rate, timestamps, distance, speed) are
   collapsed to per-workout summaries. Elevation gain is computed with a
   moving-average smoother plus a minimum-delta threshold, because raw GPS
   altitude is far too noisy to sum directly — the GeoLife audit measured a
   median of ~102 m/km of apparent gain against a true 5-15 m/km for Beijing,
   and FitRec's altitude column has the same failure mode.

Output columns (identical to geolife_activities.csv plus extras)::

    workout_id, user_id, sport, activity_type, gender, start_time,
    distance_km, duration_min, elevation_gain_m, avg_heart_rate,
    max_heart_rate, temperature_c, source_path

Nothing here writes to the repository or touches the shipped model.
"""

from __future__ import annotations

import argparse
import ast
import csv
import gzip
import json
import sys
from pathlib import Path
from typing import Any, Iterator

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_IN = ROOT / "data" / "external" / "endomondoMeta.csv"
DEFAULT_OUT = ROOT / "data" / "external" / "endomondo_activities.csv"

# Endomondo sport label -> TRANA modality. Anything unmapped is dropped.
SPORT_MAP = {
    "run": "run", "running": "run", "trail_running": "run",
    "ride": "ride", "bike": "ride", "cycling": "ride", "biking": "ride",
    "mountain_biking": "ride", "cycling_transport": "ride", "road_biking": "ride",
    "walk": "walk", "walking": "walk", "hiking": "hike", "hike": "hike",
}

# Header aliases, checked case-insensitively in order. First match wins.
ALIASES: dict[str, list[str]] = {
    "workout_id": ["id", "workout_id", "workoutid", "workout"],
    "user_id": ["userid", "user_id", "user"],
    "sport": ["sport", "sport_type", "activity_type", "activity"],
    "gender": ["gender", "sex"],
    "start_time": ["start_time", "starttime", "timestamp", "begin", "date"],
    "distance": ["distance", "dist"],
    "duration": ["duration", "time_elapsed", "elapsed", "moving_time"],
    "altitude": ["altitude", "alt", "elevation"],
    "heart_rate": ["heart_rate", "heartrate", "hr"],
    "speed": ["speed", "derived_speed"],
    "temperature": ["temperature", "temp", "weather_temperature"],
    "timestamps": ["timestamp", "timestamps", "time"],
}

OUT_FIELDS = [
    "workout_id", "user_id", "sport", "activity_type", "gender", "start_time",
    "distance_km", "duration_min", "elevation_gain_m", "avg_heart_rate",
    "max_heart_rate", "temperature_c", "source_path",
]

# Sanity trims, matching the GeoLife validation so the two sets are comparable.
SPEED_TRIM_KMH = (0.5, 50.0)
MAX_SANE_DURATION_MIN = 24 * 60


def open_text(path: Path):
    """Open a plain or gzipped text file, transparently."""
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8", errors="replace")
    return open(path, "r", encoding="utf-8", errors="replace", newline="")


def iter_rows(path: Path) -> Iterator[dict[str, str]]:
    """Stream the CSV as dicts without holding the file in memory."""
    with open_text(path) as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            yield row


def resolve_columns(header: list[str]) -> dict[str, str]:
    """Map our canonical names onto the file's actual column names."""
    lowered = {h.strip().lower(): h for h in header if h}
    found: dict[str, str] = {}
    for canonical, candidates in ALIASES.items():
        for candidate in candidates:
            if candidate in lowered:
                found[canonical] = lowered[candidate]
                break
    return found


def parse_array(cell: Any) -> list[float]:
    """Parse a nested sequence cell into floats.

    Handles JSON (`[1.0, 2.0]`), Python repr (`[1.0, 2.0]` but sometimes with
    single quotes or None), and nested lists-of-lists (`[[lat, lng], ...]`).
    Returns [] rather than raising — one malformed cell should not kill a run.
    """
    if cell is None:
        return []
    if isinstance(cell, (list, tuple)):
        raw = list(cell)
    else:
        text = str(cell).strip()
        if not text or text in ("[]", "null", "None", "nan"):
            return []
        raw = None
        for loader in (json.loads, ast.literal_eval):
            try:
                raw = loader(text)
                break
            except (ValueError, SyntaxError):
                continue
        if raw is None:
            return []
    flat: list[float] = []
    for item in raw:
        if isinstance(item, (list, tuple)):
            # Nested pairs: use the first component only.
            item = item[0] if item else None
        try:
            if item is None:
                continue
            value = float(item)
        except (TypeError, ValueError):
            continue
        if value == value and value not in (float("inf"), float("-inf")):
            flat.append(value)
    return flat


def smooth(values: list[float], window: int) -> list[float]:
    """Centred moving average; suppresses GPS altitude jitter."""
    if window <= 1 or len(values) < window:
        return list(values)
    half = window // 2
    out: list[float] = []
    for i in range(len(values)):
        lo = max(0, i - half)
        hi = min(len(values), i + half + 1)
        chunk = values[lo:hi]
        out.append(sum(chunk) / len(chunk))
    return out


def elevation_gain(values: list[float], threshold: float = 2.0, window: int = 5) -> float:
    """Cumulative positive ascent after smoothing, using hysteresis.

    Two failure modes have to be avoided at once:

    * Raw GPS altitude is jittery, so summing every positive delta invents
      hundreds of metres on a flat road.
    * A per-step threshold fails the opposite way. A steady 5% climb sampled
      every 10 s rises only ~0.8 m per sample, so every step is rejected and a
      genuine 32 m climb reports 0 m.

    The fix is hysteresis: keep a pivot at the last committed altitude, let
    small movements accumulate, and only commit — adding the whole accumulated
    rise — once movement away from the pivot exceeds `threshold`. Descents move
    the pivot down without adding anything. This is what Strava and Garmin do.
    """
    if len(values) < 2:
        return 0.0
    smoothed = smooth(values, window)
    gain = 0.0
    pivot = smoothed[0]
    for cur in smoothed[1:]:
        delta = cur - pivot
        if delta > threshold:          # committed ascent
            gain += delta
            pivot = cur
        elif delta < -threshold:       # committed descent, no gain
            pivot = cur
    return round(gain, 1)


def span_minutes(values: list[float]) -> float | None:
    """Duration from a timestamp series, in minutes.

    Epoch seconds are ~1e9 and epoch milliseconds ~1e12, so the *magnitude* of
    the values identifies the unit. Testing the span instead is wrong: one hour
    is 3600 in seconds but only 3.6e6 in milliseconds, which no sane span
    threshold distinguishes from a long activity in seconds.
    """
    if len(values) < 2:
        return None
    span = max(values) - min(values)
    if span <= 0:
        return None
    if abs(max(values)) > 1e11:
        span = span / 1000.0
    return span / 60.0


def to_km(values: list[float], unit: str) -> float | None:
    """Final cumulative distance as km, applying an explicit or inferred unit.

    The FitRec raw export records cumulative distance in **metres**. Do not try
    to infer the unit from the magnitude of the final sample: a 136 m walk is
    indistinguishable from a 136 km ride by value alone, and guessing wrong
    yields a speed three orders of magnitude off that the sanity filter then
    silently discards as "implausible" — losing real rows rather than flagging
    the mistake. `auto` therefore means "metres unless the value is absurd for
    metres", and both `--distance-unit m` and `--distance-unit km` exist so the
    caller can state it plainly once the header has been inspected.
    """
    if not values:
        return None
    last = max(abs(v) for v in values)
    if unit == "km":
        return last
    if unit == "m":
        return last / 1000.0
    # auto: metres is the documented FitRec unit. Only fall back to km when the
    # figure cannot plausibly be metres (> 1000 km is not a workout).
    return last / 1000.0 if last <= 1_000_000 else last


def inspect(path: Path, columns: dict[str, str]) -> None:
    """Print the header, one truncated row, and the resolved mapping."""
    with open_text(path) as handle:
        reader = csv.reader(handle)
        header = next(reader, [])
        first = next(reader, [])
    print(f"file       : {path}")
    print(f"size       : {path.stat().st_size:,} bytes")
    print(f"columns    : {len(header)}")
    print()
    print("HEADER:")
    for i, name in enumerate(header):
        print(f"  [{i:>2}] {name}")
    print()
    print("FIRST ROW (each cell truncated to 120 chars):")
    for name, cell in zip(header, first):
        shown = str(cell)[:120].replace("\n", " ")
        print(f"  {name:<24} = {shown}")
    print()
    print("RESOLVED MAPPING:")
    for canonical in ALIASES:
        actual = columns.get(canonical)
        print(f"  {canonical:<12} -> {actual if actual else '(not found)'}")


def convert(path: Path, columns: dict[str, str], out: Path, *, unit: str,
            threshold: float, window: int, limit: int | None) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    kept = 0
    seen = 0
    dropped_sport = 0
    dropped_invalid = 0
    speed_drops = 0

    with open(out, "w", encoding="utf-8", newline="") as sink:
        writer = csv.DictWriter(sink, fieldnames=OUT_FIELDS)
        writer.writeheader()

        for row in iter_rows(path):
            seen += 1
            if limit is not None and seen > limit:
                break

            sport_raw = str(row.get(columns.get("sport", ""), "")).strip().lower()
            activity_type = SPORT_MAP.get(sport_raw)
            if not activity_type:
                dropped_sport += 1
                continue

            timestamps = parse_array(row.get(columns.get("timestamps", "")))
            duration_min = span_minutes(timestamps)
            if duration_min is None and "duration" in columns:
                try:
                    duration_min = float(row[columns["duration"]])
                except (TypeError, ValueError):
                    duration_min = None

            distance_km = to_km(parse_array(row.get(columns.get("distance", ""))), unit)
            if distance_km is None and "distance" in columns:
                try:
                    distance_km = float(row[columns["distance"]])
                    if unit == "m" or (unit == "auto" and distance_km > 1000):
                        distance_km = distance_km / 1000.0
                except (TypeError, ValueError):
                    distance_km = None

            if not distance_km or not duration_min or duration_min <= 0:
                dropped_invalid += 1
                if seen <= 5:
                    print(f"  drop row {seen}: missing distance/duration "
                          f"(km={distance_km!r}, min={duration_min!r})", file=sys.stderr)
                continue
            if duration_min > MAX_SANE_DURATION_MIN:
                dropped_invalid += 1
                if seen <= 5:
                    print(f"  drop row {seen}: duration {duration_min:.1f} min > 24 h", file=sys.stderr)
                continue
            speed = distance_km / (duration_min / 60.0)
            if not (SPEED_TRIM_KMH[0] <= speed <= SPEED_TRIM_KMH[1]):
                dropped_invalid += 1
                if speed_drops <= 10:
                    print(f"  drop row {seen}: implausible speed {speed:.1f} km/h "
                          f"({distance_km:.3f} km in {duration_min:.1f} min) "
                          f"— check --distance-unit", file=sys.stderr)
                    speed_drops += 1
                continue

            hr = parse_array(row.get(columns.get("heart_rate", "")))
            alt = parse_array(row.get(columns.get("altitude", "")))
            temp_raw = row.get(columns.get("temperature", ""), "")
            try:
                temperature = float(temp_raw) if str(temp_raw).strip() else None
            except (TypeError, ValueError):
                temperature = None

            # start_time must be ONE instant for chronological (walk-forward)
            # splits to work. The FitRec column holds a full timestamp array,
            # so take the first sample rather than writing the array through.
            start_raw = str(row.get(columns.get("start_time", ""), "")).strip()
            start_time = ""
            if timestamps:
                start_time = int(min(timestamps))
            elif start_raw and not start_raw.startswith("["):
                start_time = start_raw

            writer.writerow({
                "workout_id": row.get(columns.get("workout_id", ""), ""),
                "user_id": row.get(columns.get("user_id", ""), ""),
                "sport": sport_raw,
                "activity_type": activity_type,
                "gender": row.get(columns.get("gender", ""), ""),
                "start_time": start_time,
                "distance_km": round(distance_km, 4),
                "duration_min": round(duration_min, 3),
                "elevation_gain_m": elevation_gain(alt, threshold, window),
                "avg_heart_rate": round(sum(hr) / len(hr), 1) if hr else "",
                "max_heart_rate": round(max(hr), 1) if hr else "",
                "temperature_c": temperature if temperature is not None else "",
                "source_path": f"{path.name}#{row.get(columns.get('workout_id', ''), '')}",
            })
            kept += 1

    size = out.stat().st_size
    print(f"read     : {seen:,} rows")
    print(f"kept     : {kept:,}")
    print(f"dropped  : {dropped_sport:,} non-target sport, {dropped_invalid:,} invalid/implausible")
    if speed_drops:
        print(f"           {speed_drops} due to implausible speed -- if this is most rows, "
              f"the distance unit is probably wrong (try --distance-unit m|km)")
    print(f"wrote    : {out}  ({size:,} bytes)")
    mb = size / (1024 * 1024)
    print(f"size     : {mb:.1f} MB" + ("  OK, under the 100 MiB cap" if mb < 95 else "  WARNING: still large"))


def head(path: Path, out: Path, n: int) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with open_text(path) as src, open(out, "w", encoding="utf-8", newline="") as dst:
        for i, line in enumerate(src):
            if i > n:
                break
            dst.write(line)
    print(f"wrote first {n:,} data rows -> {out} ({out.stat().st_size:,} bytes)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Shrink endomondoMeta.csv for TRANA.")
    parser.add_argument("--in", dest="src", type=Path, default=DEFAULT_IN)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--inspect", action="store_true",
                        help="print header, sample row, and detected mapping; write nothing")
    parser.add_argument("--head", type=int, default=None,
                        help="write only the first N data rows, verbatim")
    parser.add_argument("--limit", type=int, default=None,
                        help="convert only the first N rows (for a trial run)")
    parser.add_argument("--distance-unit", choices=["auto", "m", "km"], default="auto")
    parser.add_argument("--elevation-threshold", type=float, default=2.0,
                        help="metres a smoothed rise must clear to count (default 2.0)")
    parser.add_argument("--elevation-window", type=int, default=5,
                        help="moving-average window in samples (default 5)")
    args = parser.parse_args()

    if not args.src.exists():
        raise SystemExit(
            f"input not found: {args.src}\n"
            "point --in at endomondoMeta.csv (a .csv.gz also works)"
        )

    with open_text(args.src) as handle:
        header = next(csv.reader(handle), [])
    columns = resolve_columns(header)

    if args.inspect:
        inspect(args.src, columns)
        return

    if args.head is not None:
        head(args.src, args.out, args.head)
        return

    missing = [c for c in ("user_id", "sport") if c not in columns]
    if missing:
        raise SystemExit(
            f"could not resolve required column(s): {missing}\n"
            "run --inspect first and tell me the real header"
        )

    convert(
        args.src, columns, args.out,
        unit=args.distance_unit,
        threshold=args.elevation_threshold,
        window=args.elevation_window,
        limit=args.limit,
    )


if __name__ == "__main__":
    sys.exit(main())
