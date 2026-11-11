# GeoLife external-validation dataset

`geolife_activities.csv` — the evaluation table used by
`python -m evaluation.geolife_validation` (external validation of the
TRANA duration model against real GPS movement).

## Source

- **Dataset:** GeoLife GPS Trajectories Dataset, Microsoft Research —
  182 users, 17,630+ days of GPS logs recorded with smartphones
  (2007–2011), with transportation-mode labels for a subset.
- **Paper:** Zheng, X., Xie, X., Wang, L., Yu, Y., Jiang, S. *Mining
  interesting locations and travel sequences from GPS trajectories.*
  WWW '08. https://doi.org/10.1145/1367497.1367550
- **Official page:** https://www.microsoft.com/en-us/research/publication/geolife-gps-trajectories-dataset/
- **Processed feature table (this file's origin):**
  `Metadata/trajFeatures.csv` from the public analysis mirror
  https://github.com/jbremz/Beijing-Trajectories-Project
  (per-trajectory duration, path length, speed, transport mode).
- **License/attribution:** GeoLife is published by Microsoft Research for
  research use; cite the paper above when using this data. The mirror is a
  community-maintained processing of the public release.

## Derivation (reproducible)

```bash
# from ml/: rebuild the CSV from the mirror repo (downloads from GitHub)
python -m evaluation.geolife_validation --fetch
# or from a locally downloaded tarball
python -m evaluation.geolife_validation --tarball /path/geolife.tgz
```

Steps: keep labelled trajectories whose mode is `walk` / `bike` / `run` →
map to Trana's `walk` / `ride` / `run` → drop zero/invalid lengths and
speeds outside 0.5–50 km/h (GPS glitches) → parse user id from the path
prefix and start time from the filename.

**SHA-256:** `4578ad87945a60c2f9e5b8c9b7b00b2aecce458969f3cc81be78655883c161df`

## Columns (4,362 rows, 51 users)

| column | meaning |
|---|---|
| `user_id` | GeoLife user prefix (`000`–`181`) |
| `activity_type` | Trana modality (`walk`/`ride`/`run`) |
| `mode_original` | original GeoLife label (`walk`/`bike`/`run`) |
| `distance_km` | GPS path length (m → km) |
| `duration_min` | elapsed door-to-door time (min) |
| `start_time` | first fix timestamp (chronology key) |
| `source_path` | trajectory file path inside GeoLife |

Not used: motorised modes (bus/car/subway/taxi/train/boat/airplane);
elevation is absent from the feature table (validation assumes 0 m).

---

# FitRec sample (Endomondo exports) — not committed

`endomondo_activities.csv` — the evaluation table used by
`python -m evaluation.endomondo_validation`. **Not in the repository**: the
sample is delivered under dataset terms that forbid redistribution; only this
derived table exists, produced on the owner's machine and kept in personal
storage (Google Drive). It is covered by `.gitignore`
(`ml/data/external/endomondo_*.csv`).

## Source

- **Package:** the FitRec sample — Endomondo Sports Tracker exports
  `endomondoMeta.json.gz` (~1.1 GB, per-workout metadata) and
  `endomondoHR (1).json.gz` (~2.0 GB, GPS/heart-rate series), held in the
  project owner's Google Drive.
- **Platform:** Endomondo Sports Tracker research release (workouts with
  sport labels, GPS traces, heart rate). See the FitRec dataset page cited
  in the thesis for the authoritative citation and terms.

## Derivation (reproducible, stdlib only)

```bash
# from repo root — streams the multi-GB exports with bounded memory
python ml/data/endomondo_to_csv.py \
  --meta "/path/endomondoMeta.json.gz" \
  --hr   "/path/endomondoHR (1).json.gz" \
  --max 8000            # optional: --stride N to spread the sample
```

Steps: keep sports `running/cycling/walking/hiking` (+ mountain biking) →
map to Trana `run/ride/walk/hike` → recover duration from elapsed-time
fields or the timestamp span → distance from the last distance sample →
drop rows without both, and speeds outside 0.5–50 km/h (same trim as
GeoLife) → `user_id` from the export when present, else the workout id
(every session its own account → **cold-start protocol**, flagged in the
report). Columns are identical to `geolife_activities.csv`.

## Columns

| column | meaning |
|---|---|
| `user_id` | export user id, else `w<workout_id>` (cold-start) |
| `activity_type` | Trana modality (`run`/`ride`/`walk`/`hike`) |
| `mode_original` | original Endomondo sport label |
| `distance_km` | last distance sample (m → km) |
| `duration_min` | elapsed time (s → min) |
| `start_time` | first timestamp, UTC-normalised |
| `source_path` | `<export filename>#<workout id>` |
