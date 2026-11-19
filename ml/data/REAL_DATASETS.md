# Real datasets for TRANA — candidates, ranked

**Purpose.** The shipped model is trained on a synthetic corpus (8,845 rows) and validated
on 4,362 real GeoLife activities. Section 4.3.3 of the documentation establishes that
*more synthetic rows do not help* (11.3x the corpus moved external MdAPE by 0.04 points).
This file records what real data exists, what each one can and cannot fix, and why.

Read this before starting any retraining work on real data.

---

## The constraint that decides everything: elevation

`elevation_per_km` carries **76.2%** of the model's feature importance (scaled model;
68.5% shipped). It is the dominant signal.

But the *only* external validation set in the project — GeoLife — has **no usable
elevation**. The raw `.plt` files carry a GPS altitude column, but it is GPS altitude,
not terrain: median apparent gain ~102 m/km against a true 5-15 m/km for Beijing, with
single fixes above 13,000 m. The validation sets `elevation_gain_m = 0.0` for every row
and says so in its own `limitations` block.

**Consequence:** the model's most important input has never been tested against real
ground truth. Any dataset that lacks a defensible elevation gain will reproduce the
current ceiling no matter how many rows it contains. This is the single strongest
argument for choosing FitRec over the larger alternatives below.

---

## Candidates

| # | Dataset | Rows | Users | Elevation? | Weather? | Licence | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **FitRec / Endomondo** (UCSD) | 253,020 workouts | 1,104 | **Yes** (GPS altitude) + HR | **Yes** (temp, humidity) | Academic use, no redistribution | **Best fit** |
| 2 | Public running dataset 2019-2020 (figshare) | 10,703,690 | 36,412 | No | No | CC BY 4.0 | Best *volume*, wrong features |
| 3 | Ultra-marathon running (Kaggle) | 7,461,226 | 1,641,168 | No | No | CC0 | Wrong task (races, not training) |
| 4 | GeoLife (already in repo) | 4,362 | 51 | No (see above) | No | Research use | Current external set |

### 1. FitRec / Endomondo — recommended

- **Source:** https://cseweb.ucsd.edu/~jmcauley/datasets/fitrec.html
- **Paper:** Ni, Muhlstein, McAuley. *Modeling heart rate and activity data for
  personalized fitness recommendation.* WWW 2019. https://doi.org/10.1145/3308558.3313643
- **Raw files:** `endomondoHR.json.gz` (~2.0 GB, GPS/HR series),
  `endomondoMeta.json.gz` (~1.1 GB, per-workout metadata)
- **Filtered:** `endomondoHR_proper.json` — 167,373 workouts / 956 users
- **Re-sampled:** 102,343 workouts / 887 users
- **Why it wins:** it is the only candidate that carries **altitude, heart rate, and
  weather**. Those are exactly the "new input signals" that Section 4.5 names as the
  condition under which the accuracy conclusions would change. It also has 253,020 real
  workouts from 1,104 genuinely distinct athletes — 2.5x the 100k target, and enough
  users for a proper user-disjoint split.
- **Caveats:** GPS altitude is noisy in the same way GeoLife's is; it must be smoothed
  or replaced with a DEM (TRANA already uses Copernicus GDEM via Open-Meteo) before it
  can be trusted as terrain. Academic-use terms forbid redistribution — the derived CSV
  stays out of Git (`ml/data/external/endomondo_*.csv` is already ignored).
- **Already partially converted:** `ml/data/endomondo_to_csv.py` streams the two `.gz`
  exports. `ml/evaluation/endomondo_validation.py` scores against them.

### 2. Public running dataset 2019-2020 — best volume, but will not move the needle

- **Source:** https://figshare.com/articles/dataset/.../16620238
- **DOI:** 10.6084/m9.figshare.16620238 — **CC BY 4.0** (redistributable)
- **Columns:** `datetime, athlete, distance (km), duration (min), gender, age_group,
  country, major`
- **Why it is tempting:** 10.7 million rows is 100x the target, the licence is clean,
  and `athlete` gives a real user id for chronological splits.
- **Why it will not fix accuracy:** it has **no elevation, no weather, and no heart
  rate**. Training on it would give the model real distance/duration pairs but leave its
  dominant feature permanently zero. Expect the outcome to look like Section 4.3.3: flat.
- **Where it IS valuable:** as a large *external validation* set for the distance/duration
  relationship, and to check whether the Riegel reference curve holds across 36,412
  athletes. That is a genuinely publishable sanity check the project currently lacks.

### 3. Ultra-marathon dataset — reject

- 7.4M records, CC0, but rows are **race results** (50 km, 100 km, 24 h events) from
  1798-2022, not training sessions. Wrong distribution, no per-athlete history for the
  reference curve, no elevation, no weather. Not applicable.

---

## What "more data" will and will not fix

Stated plainly, because the project has now measured this twice:

| Problem | Fixed by more rows? | Fixed by real elevation + weather + HR? |
|---|---|---|
| Interval coverage (17% vs 80% target) | **Yes** — retrain study: 15.9% -> 67.8% on 1,085 real rows | Yes, likely |
| Point accuracy (23.8% MdAPE) | **No** — 11.3x synthetic rows: -0.04 pts | **Untested; the honest hope** |
| Cold-start behaviour (46% MdAPE) | Partly | Yes, via population priors from 1,104 users |

The retraining study (Section 4.3.2) already showed real data fixes **calibration** but
not accuracy at 1-2k rows. FitRec is the first dataset that can test whether accuracy
moves when the *features* improve rather than just the row count.

---

## Blockers for doing this inside an agent sandbox

- `figshare.com`, `mcauleylab.ucsd.edu`, `kaggle.com` are **not reachable** from the
  project sandbox (TLS handshake fails, `http=000`). Only `github.com` resolves.
- Workspace file cap is **100 MiB** per file; `endomondoMeta.csv` is 183 MB and
  `endomondoHR.json.gz` is ~2 GB, so neither can be pulled in whole.

**Therefore:** the conversion and training must run either on the owner's machine, or on
files that have been reduced to under 100 MiB and re-shared to Drive.

### Recommended next step

1. Produce a **per-workout summary CSV** (one row per workout, scalar columns only —
   no GPS arrays): `workout_id, user_id, sport, distance_km, duration_min, start_time,
   elevation_gain_m, avg_heart_rate, temperature_c`. At 253,020 rows this should land
   well under 25 MB.
2. Drop it in Drive next to `endomondoMeta.csv`.
3. Then: audit with `python -m duration_model.audit`, train with
   `--source csv`, and validate on a **user-disjoint** holdout before touching anything
   that ships.
