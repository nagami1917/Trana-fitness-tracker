# ML methodology

Two engines, deliberately different in kind:

| Engine | Type | Where |
| --- | --- | --- |
| **Duration model** | learned (quantile gradients) | `ml/duration_model/` |
| **Fueling engine** | deterministic (sports-science formulas) | `ml/fueling_model/` |

The split is intentional: fueling has no reliable public training corpus, and a
rule-based engine is transparent, auditable and safe for a health-facing product.

## Duration model

**Problem.** Predict how long an athlete needs for a *planned* session, using their
*own* history — not a population average.

**Anchor.** Each athlete × modality gets a Riegel-style distance→time curve fitted
to their logged activities (`duration_model/preprocess.py: reference_curve`):

```
base_minutes = exp(a + b·ln distance_km)
```

**Model.** `GradientBoostingRegressor` with quantile loss at α = 0.10 / 0.50 / 0.90,
learning a *pace factor* against that base — it corrects the personal curve for
elevation, mass, experience and sport:

```
duration = base · exp(f(features))
features = distance_km, elevation_gain_m, elevation_per_km,
           weight_kg, experience_level, is_run, is_ride, is_walk, is_hike
```

q10/q90 give an honest "estimated range" in the UI instead of one over-confident
number; `duration.confidence` derives from the interval width.

**Training.** `python -m duration_model.train` (from `ml/`):

- default: (re)generates the physics-informed synthetic bootstrap corpus
  (`data/generate_dataset.py`, ~8k activities from synthetic athletes) and trains on it;
- `--source supabase` trains on the real activity log (`DATABASE_URL`, optional dep `psycopg[binary]`) and calibrates interval width on the 20 % holdout split by default (`--no-calibrate` to skip);
- `--source csv --csv file.csv` trains on a Postgres or external activity CSV (`--calibrate` fits interval width on the 20 % holdout split; `--calibrate-csv real.csv` fits on a separate file);
- standalone recalibration (`python -m duration_model.calibrate --source csv|supabase --write`) fits only the interval width factor `k` onto an existing artifact once ≥ 30 real activities are available.

Current committed artifact (`ml/duration_model/duration_model.joblib`):

| Metric | Value |
| --- | --- |
| MAE | 9.56 min |
| RMSE | 27.16 min |
| R² | 0.952 |
| MAPE | 7.18 % |
| Interval coverage (q10–q90) | 76.8 % |
| Corpus | 7 988 rows (synthetic bootstrap) — **retrain on real data before relying on absolute numbers** |

Feature importance (q50): `elevation_per_km` 0.62, `distance_km` 0.19, `is_ride` 0.05.
Elevation/km dominates — expected, since climbing is the strongest duration driver.

`duration_model.json` is the same trees as plain JSON for the PWA's **on-device**
evaluator (`frontend/src/lib/ml/duration.js`); keep `frontend/public/models/duration_model.json`
in sync with `ml/duration_model/duration_model.json` when retraining.

**Guardrails.** Factor clamped to [0.7, 3.0]; q10/q50/q90 can never invert or go
below 1 minute; graceful physics fallback when artifacts are missing; `python -m evaluation.sanity_check`
asserts ±22 % against known-good reference points (exit 1 on failure).

## Fueling engine

Calories from METs × body mass × hours (modality- and speed-dependent, with a climb
penalty); carbohydrate rate from duration band and intensity (0 g/h below 60 min →
85+ g/h beyond 2.5 h, capped at 90 g/h); sodium and fluid from the athlete's sweat
profile and heat (×1.025 per °C above 22 °C); a 3-phase timeline (pre / during /
recovery); and intensity-graded notes. Every constant is documented inline in
`ml/fueling_model/predict.py` and mirrored 1:1 in `frontend/src/lib/ml/fueling.js`
(the PWA computes fueling offline, so the two must stay identical).

## Prediction flow

```
SPA ──POST /api/predictions──▶ Laravel ──POST /predict──▶ FastAPI (ml/api)
      feature        validation, normalisation   engine
```

1. `StorePredictionRequest` validates (distance optional when a route is drawn).
2. Laravel resolves the effective distance (drawn route wins, haversine-measured),
   assembles history + profile + goal, and calls FastAPI.
3. The ML response is normalised to camelCase (`DurationPredictionService` /
   `FuelingPredictionService`) and persisted as `predictions` (see
   [database.md](database.md)) with the full payload and `model_version`.
4. `docs/api.md` documents the exact request/response contract.

## External validation (GeoLife)

The trained artifact is also validated against **real measured movement**, not
just the synthetic holdout: the **GeoLife GPS Trajectories Dataset**
(Microsoft Research; Zheng et al., WWW '08) via the processed per-trajectory
feature table in the public `jbremz/Beijing-Trajectories-Project` mirror.

- **Dataset:** `ml/data/external/geolife_activities.csv` — **4,362 labelled
  walk/bike/run trajectories from 51 users** (provenance and reproducible
  derivation: `ml/data/external/README.md`).
- **Protocol:** for every trajectory the model receives **only that same
  user's earlier trajectories of the same mode** as history — exactly the
  information Trana has when predicting for a real account; empty history
  exercises the production cold-start fallback. No future data, no other
  users. Elevation 0 m (absent in GeoLife), weight 60 kg (assumed),
  experience inferred from history length (production behaviour). Target
  values are door-to-door elapsed times — what Trana predicts for a planned
  session.
- **Reproduce:** `python -m evaluation.geolife_validation` — run by CI after
  every training run; report artifact: `ml/evaluation/reports/geolife_validation.json`.

**Results — artifact `20261108.0445`, n = 4,362:**

| Slice | n | MAE (min) | MdAPE | ±15 % hit | R² | q10–q90 coverage |
| --- | --- | --- | --- | --- | --- | --- |
| overall | 4,362 | **5.65** | 21.9 % | 36.4 % | 0.461 | 24.1 % |
| walk | 2,988 | 5.99 | 25.0 % | 32.7 % | 0.441 | 25.7 % |
| ride | 1,372 | 4.93 | 17.2 % | 44.5 % | 0.498 | 20.7 % |
| cold start (no history) | 80 | 12.88 | 49.6 % | 15.0 % | 0.107 | 11.3 % |
| personalized (≥ 2 prior) | 4,215 | 5.41 | 21.4 % | 37.0 % | 0.475 | 24.5 % |

Baselines (overall MAE): population prior **7.10 min** → personal Riegel
anchor alone **5.80 min** → full model **5.65 min**.

**Reading:**

1. The model beats the population prior by **20.4 % MAE** — the
   distance→duration mapping transfers to real GPS movement.
2. **Personalization is the main lever:** cold-start error is ~2.4× the
   personalized error, empirically justifying Trana's own-log anchoring.
3. The learned correction contributes ~2.5 % beyond the personal anchor on
   this data — most of the win is the anchor itself; the synthetic-trained
   factor helps but is not the star.
4. **Interval coverage falls to 24 %** on real data (vs 76.8 % synthetic):
   door-to-door GPS durations vary more than the synthetic noise model —
   the q10/q90 range is optimistic for real sessions, and long in-domain
   activities are the weakest slice (n = 543, MAE 17.0 min).

**Dataset-specific limitations:** no elevation in GeoLife (features = 0;
Beijing is flat); `bike`→`ride` mapping; `run` has n = 2; weight and
experience assumed, not measured; elapsed times include stops.

→ Findings motivate **ML phase 2**: retrain and recalibrate on accumulated
real user activities (`python -m duration_model.train --source supabase`),
implemented in *ML phase 2 (interval calibration & real-data retraining)* below.

## External validation (FitRec sample — Endomondo)

A second external dataset guards against over-fitting the GeoLife quirks:
the **FitRec sample** — Endomondo Sports Tracker exports
(`endomondoMeta.json.gz` + `endomondoHR.json.gz`, ~3.1 GB) delivered to the
project owner. Dataset terms forbid redistribution, so the raw exports stay
in personal storage (Google Drive) and are **never committed**; the repo
holds the converter, the evaluator, and the aggregate report.

- **Protocol:** identical to the GeoLife run — the same
  `evaluation.geolife_validation.evaluate_activities` engine (chronological
  per-account history, cold-start fallback, weight 60 kg, elevation 0,
  0.5–50 km/h speed trim) — so the two datasets are directly comparable.
- **Derivation:** `ml/data/endomondo_to_csv.py` streams the multi-GB
  gzip exports with bounded memory, maps sports → Trana modes
  (`running→run`, `cycling→ride`, `walking→walk`, `hiking→hike`), and
  writes `ml/data/external/endomondo_activities.csv` (same columns as the
  GeoLife table; git-ignored).
- **User ids:** if the export carries no user ids, every workout becomes
  its own account and all rows are evaluated **cold-start** — the report
  states this explicitly rather than implying personalization.
- **Reproduce:**
  ```bash
  python ml/data/endomondo_to_csv.py --meta /path/endomondoMeta.json.gz
  cd ml && python -m evaluation.endomondo_validation
  ```
  Report artifact: `ml/evaluation/reports/endomondo_validation.json`
  (metrics only — no raw data). CI keeps running the GeoLife validation;
  the FitRec run is manual because the data is not in the repository.
- **Provenance & terms:** `ml/data/external/README.md`.

## ML phase 2 (interval calibration & real-data retraining)

To close the 24.1 % real-world interval coverage gap and prepare the
production training pipeline for real Trana logs, phase 2 adds conformal
interval calibration and hardens the `--source supabase` training path.

### Calibration method (`ml/duration_model/calibrate.py`)

Given predicted quantile bands `(q10, q50, q90)` clamped identically to inference
(`[0.7, 3.0]` pace-factor bounds around the athlete's Riegel anchor), each
non-degenerate calibration activity yields a normalized residual score:

```
halfwidth = (q90 − q10) / 2
score     = |actual − q50| / halfwidth
k         = clip(quantile(scores, ⌈(n + 1)·target⌉ / n), 1.0, 6.0)
```

- `target` defaults to `0.80` (80 % coverage). `k` is floored at `1.0` (never
  narrows trained bands) and capped at `6.0` (prevents extreme outliers from
  producing absurd ranges).
- Both the server (`ml/duration_model/model_store.py`) and the browser offline
  evaluator (`frontend/src/lib/ml/duration.js`) apply `k` identically around the
  median before clamping to `≥ 1.0 min` and computing `confidence`:
  `q10' = max(1, q50 − k·(q50 − q10))`, `q90' = q50 + k·(q90 − q50)`.
  Point predictions (`minutes`) do not change; wider bands lower `confidence`
  proportionally.
- The fitted block `calibration` (`factor`, `target_coverage`,
  `achieved_coverage`, `n`, `skipped`, `calibrated_at`) is stored in
  `duration_model.joblib`, `duration_model.json`, and `model_card.json`.

### Two-stage production workflow (`--source supabase`)

1. **Stage 1 — Recalibrate existing synthetic trees (≥ 30 real activities):**
   fits only the single scalar `k` without overfitting 320 gradient-boosted
   trees to a small corpus (`MIN_CALIBRATE_ROWS = 30`).
2. **Stage 2 — Full retrain + holdout calibration (≥ 200 real activities):**
   retrains `q10/q50/q90` on 80 % of real activities (`MIN_TRAIN_ROWS = 200`) and
   automatically calibrates `k` on the held-out 20 % test split (`--no-calibrate`
   to disable). Below either threshold, the CLI exits cleanly without overwriting
   the existing artifacts.
3. **Database compatibility:** `train.py` joins `activities` with
   `fitness_profiles` (`duration_min IS NOT NULL AND distance_km > 0`, ordered
   by `started_at, id`), defaults null `elevation_gain_m` / `weight_kg` /
   `experience_level`, and coerces PostgreSQL `numeric` (`Decimal`) values to
   float before feature extraction.

### Dry-run benchmark on GeoLife

Because production currently holds **1 trainable activity** (see status below),
the phase-2 pipeline was verified against `geolife_activities.csv` (n = 4,362,
51 users) in two modes: (a) recalibrating the shipped synthetic model `20261108.0445`
only, and (b) full retraining + 20 % holdout calibration. Both full-dataset runs
and strict unseen-user splits (fit on the first 25 users, n = 2,128; evaluate
chronologically on the held-out 26 users, n = 2,234 via
`evaluation.geolife_validation`) were measured:

| Run | Mode / split | Factor `k` | MAE (min) | R² | Chronological coverage |
| --- | --- | --- | --- | --- | --- |
| Baseline (`20261108.0445`) | Full GeoLife (n = 4,362) | — | 5.65 | 0.461 | 24.1 % |
| Baseline (`20261108.0445`) | Held-out 26 users (n = 2,234) | — | 5.72 | 0.420 | 23.8 % |
| **Dry run A — Recalibrate only** | Fit on all 51 users → full GeoLife | 5.266 | 5.65 | 0.461 | **78.8 %** (pers. 79.6 %, cold 42.5 %) |
| **Dry run A — Recalibrate only** | Fit on 25 users → **unseen 26 users** | 5.332 | 5.72 | 0.420 | **78.2 %** (pers. 78.9 %, cold 44.2 %) |
| **Dry run B — Retrain + holdout cal.** | 80/20 split on 51 users → full GeoLife* | 1.075 | **5.48** | **0.479** | **72.7 %** (pers. 73.2 %, cold 53.8 %) |
| **Dry run B — Retrain + holdout cal.** | Train+cal on 25 users → **unseen 26 users** | 1.113 | 5.95 | 0.394 | **67.9 %** (pers. 68.0 %, cold 53.5 %) |

\*In the full-GeoLife retrain dry run, calibration/validation share the 51 GeoLife
users; the 25→26-user row keeps evaluation strictly out-of-sample. Notice also
why chronological coverage (67.9–72.7 %) trails the random leave-one-out holdout
target (80.2–80.3 %): `training_frame` computes each row's anchor curve with
leave-one-out across all sessions, whereas real inference only sees prior
activities (cold start and 1-activity histories have wider errors).

**Shipped artifact status:** the committed artifact stays the synthetic
bootstrap (`20261108.0445`, `calibration: null`). Replacing it with GeoLife-fitted
weights would leak the external validation benchmark and drop elevation/hike/weight
signal; production Supabase currently contains **1 trainable activity** (5 users,
5 fitness profiles), so real-data retraining is blocked until sufficient user
logs accumulate.

### Production runbook & privacy

Once production accumulates ≥ 30 (calibration) or ≥ 200 (retrain) consented
activities:

```bash
cd ml
pip install -r requirements.txt 'psycopg[binary]'

# Pull the read-only/pooler connection string from Vercel trana-api or Supabase
export DATABASE_URL="postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres?sslmode=require"

# Option A (30–199 real activities): recalibrate intervals on shipped synthetic trees
python -m duration_model.calibrate --source supabase --write

# Option B (≥ 200 real activities): full retrain + 20 % holdout calibration
python -m duration_model.train --source supabase

# Verify guards and copy browser JSON + card to the SPA
python -m evaluation.sanity_check
python -m evaluation.geolife_validation --no-write
pytest -q
cp duration_model/duration_model.json duration_model/model_card.json ../frontend/public/models/

# Hot-reload the deployed FastAPI service (when ADMIN_TOKEN is configured)
curl -X POST "$ML_API_URL/model/reload" -H "X-Admin-Token: $ADMIN_TOKEN"
```

**Privacy:** never commit exported database CSVs, `DATABASE_URL` strings, or
per-user rows to Git. Only the trained weights, aggregate `model_card.json`
metrics, and `calibration` summary are committed/deployed.

## Known limitations

- The committed artifact (`20261108.0445`) is trained on **synthetic** data —
  correct shape, wrong absolute accuracy for individual athletes until per-user
  personalization accrues.
- Age is not yet a feature (birth_year is stored, unused by the model).
- Wearable HR stream is stored (`avg_heart_rate`) but unused by the model.
- Synthetic holdout coverage is 76.8 % vs 80 % target, dropping to **24.1 %**
  on real GeoLife door-to-door durations (long in-domain activities are
  weakest). **ML phase 2** adds conformal interval calibration and the
  `--source supabase` retrain/recalibrate pipeline (verified in dry runs up to
  78.2 % unseen-user coverage), awaiting ≥ 30 / ≥ 200 live Supabase activities
  (1 trainable activity present today).
