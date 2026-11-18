# ML methodology

TRANA uses two deliberately different engines:

| Engine | Type | Where |
| --- | --- | --- |
| **Duration model** | learned quantile regressors | `ml/duration_model/` |
| **Fueling engine** | deterministic sports-science formulas | `ml/fueling_model/` |

The fueling engine remains rule-based: retraining the duration model does not
change fueling recommendations.

## Duration model

**Problem.** Estimate elapsed time for a planned activity, using the athlete's
own history where available.

**Personal pace anchor.** For each athlete and activity type, the model builds a
Riegel-style distance-to-time curve from earlier valid activities:

```text
base_minutes = exp(a + b * ln(distance_km))
```

**Learned correction.** Three `GradientBoostingRegressor` models use quantile
losses q10/q50/q90 to predict a pace factor relative to that anchor. Duration
features are distance, elevation gain and gain per km, experience/history depth,
and activity-type indicators. Body weight, calories, heart rate, route data and
profile identifiers are not duration-model features.

The median is the point estimate; q10–q90 form the uncertainty interval. A
separate multiplicative calibration factor may widen the interval without
moving the median. Interval coverage and point-prediction error are reported as
different measures.

The committed model card in `ml/duration_model/model_card.json` identifies its
training source as **synthetic**. Its holdout metrics describe that synthetic
corpus only and do not establish real-world accuracy. The independent GeoLife
results below show important real-world limitations.

## Consented local CSV contract

The safe starting point for real-data work is a **local, consented CSV**. Do
not export from production or use production Supabase data without separate
approval. Keep the source file outside the repository, restrict local file
permissions, and do not upload it to a public issue, notebook, or service.

Required columns:

| Column | Contract |
| --- | --- |
| `user_id` | Stable pseudonymous athlete ID: identical on all rows for one athlete and consistent across training, calibration, and validation files. It must not be an email or phone number. |
| `activity_type` | One of `run`, `ride`, `walk`, or `hike`. |
| `distance_km` | Positive distance in kilometres. |
| `duration_min` | Positive elapsed duration in minutes, using the same elapsed-time definition throughout the CSV. |
| `started_at` | Valid ISO-8601 activity start timestamp. Prefer UTC (`Z`) or an explicit offset; naive times are interpreted as UTC. It is required to build chronological history safely; `start_time` is accepted as an alias. |

Optional useful columns:

| Column | Contract |
| --- | --- |
| `elevation_gain_m` | Total ascent in metres only—no route, coordinate, or point-by-point track. Missing values default to zero; elevation slices are unavailable if all values are zero. |
| `experience_level` | Integer level 1–5 **as known at that activity's time**. If omitted, the pipeline derives it from that athlete's earlier same-sport history. Do not backfill a current value into past activities. |
| `id` | Do not include a source/database identifier. If present, its values are discarded and replaced with a local row-order tie-breaker. |

Create `user_id` as a stable pseudonym before making the CSV (for example, a
random token or a keyed HMAC of an internal ID). Keep any mapping/key separate
from the CSV, repository, and candidate artifacts. Reuse the same pseudonym for
the same athlete across all files so the leakage checks can detect overlap.

Exclude direct identifiers (names, email addresses, phone numbers, account or
profile IDs) and raw GPS/location fields (latitude/longitude, coordinates,
route polylines, GPX, tracks, locations, or map paths) before export. The
normalizer rejects common sensitive column names and email-/phone-like
`user_id` values, and drops other unused columns; it cannot infer whether an
arbitrary pseudonym or an unfamiliar column name is identifying, so the
exporter must still apply this contract. The model artifacts and reports do not
contain individual activity rows or a list of athlete IDs.

## Readiness audit and minimums

From `ml/`, audit a CSV before fitting anything:

```bash
python -m duration_model.audit --csv /secure/path/activities.csv
```

The audit prints aggregate row/user counts, quality-filter counts, activity
mix, timestamp/elevation availability, and readiness warnings. It never prints
activity rows or writes the source CSV.

The enforced minimums are:

- **30 valid activities** for interval calibration.
- **200 valid activities and at least 5 distinct pseudonymous users** for full
  retraining and a user-group holdout.

These are **minimum data-volume gates, not accuracy guarantees**. Meeting them
does not mean that the sample is representative, that every activity type has
enough examples, or that point predictions/intervals will be reliable. Review
counts for every reported slice and retain an independent validation cohort.

## Local training and calibration workflow

Install the ML requirements and run commands from `ml/`:

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt

# 1. Audit the consented local training file.
python -m duration_model.audit --csv /secure/path/train.csv

# 2. Fit a candidate from at least 200 valid activities / 5 pseudonymous users.
python -m duration_model.train --source csv --csv /secure/path/train.csv
```

All training runs default to
`ml/artifacts/duration_model-candidate/` (ignored by Git). They do not replace
the shipped model. The trainer makes an 80/20 `GroupShuffleSplit` by
`user_id` **before** constructing chronological features, and explicitly checks
that the training and holdout athlete sets do not overlap. Each row's anchor
uses only earlier activities of the same athlete and sport.

Training reports point-error metrics (including MAE/RMSE), q10–q90 interval
coverage, and comparison with the simple **personal Riegel anchor without the
learned correction**. The model card breaks these down by activity type,
history depth (cold start, one prior activity, two or more), and—when positive
elevation data exists—by ascent density:

- low: `< 20 m ascent/km`
- moderate: `20–<60 m ascent/km`
- high: `≥60 m ascent/km`

Ascent density is only an elevation proxy, **not** a measured terrain label.
Missing/all-zero elevation makes these slices unavailable. Empty or tiny slices
are omitted or have small `n`; do not over-interpret them.

Calibration options:

```bash
# Fit interval width on the 20% user-group holdout (at least 30 valid holdout rows).
python -m duration_model.train --source csv --csv /secure/path/train.csv --calibrate

# Or use a separate, consented calibration cohort (at least 30 valid rows).
# Training and calibration user_id sets must be disjoint; the trainer enforces this.
python -m duration_model.train --source csv --csv /secure/path/train.csv \
  --calibrate-csv /secure/path/calibration.csv
```

Holdout calibration fits and measures `achieved_coverage` on the same calibration
partition, so that number is not an independent test result. A separate
validation cohort is still needed. Standalone calibration is also candidate-only;
for a real-trained model, provide the training file so athlete overlap can be
checked:

```bash
python -m duration_model.calibrate --source csv \
  --csv /secure/path/calibration.csv \
  --training-csv /secure/path/train.csv \
  --bundle artifacts/duration_model-candidate/duration_model.joblib \
  --output-dir artifacts/duration-model-calibrated --write
```

Standalone calibration requires 30 valid rows. It writes into the candidate
output directory and leaves the source bundle unchanged by default. For a
non-synthetic source bundle, `--training-csv` is required so the calibration
cohort can be checked for athlete-level separation. Calibration
changes interval width only; it does not improve or change the median estimate.

## Independent, leakage-checked validation

Reserve a consented CSV of athletes not used in training. If a separate
calibration CSV was used, keep validation athletes disjoint from that cohort too.
Run the candidate evaluator as follows:

```bash
python -m evaluation.validate_csv \
  --csv /secure/path/validation.csv \
  --training-csv /secure/path/train.csv \
  --artifacts-dir artifacts/duration_model-candidate \
  --out artifacts/duration-model-validation.json
```

If the candidate card records calibration from a separate CSV, also pass
`--calibration-csv /secure/path/calibration.csv`. The evaluator exits on any
athlete overlap with training or calibration. For a candidate trained on the
synthetic corpus, `--training-csv` may be omitted; if separate real-data
calibration was applied, its CSV is still required. Validation predictions are
chronological walk-forward: each prediction uses only that same user's earlier
activities of the same sport, never future activities. The report contains
aggregate metrics only, with error and q10–q90 coverage separately by activity
type, ascent-density slice (where supported), and history depth. It compares
against both the population pace prior and the athlete's personal Riegel anchor.

The CSV validator checks disjoint athlete sets and temporal order; it does not
make a small or nonrepresentative validation cohort reliable. Review each
slice's `n`, MAE, interval coverage, and improvement (or regression) against the
personal anchor. Reported coverage is empirical for that cohort, not a promise
about future users.

## Candidate artifact handling and review-before-deploy

`ml/artifacts/` is Git-ignored. Treat candidate `.joblib` files, JSON exports,
model cards, and validation reports as local artifacts; keep private source CSVs
outside the repository and never commit them. The candidate directory is not
loaded by the production API or browser automatically. The shipped model remains
under `ml/duration_model/`; calibration code refuses to write directly into that
shipped directory.

Before promoting any candidate:

1. Confirm consent, schema, pseudonymization, and absence of direct identifiers
   or raw GPS data; save the aggregate audit output.
2. Review the user-group split counts and zero overlap, valid row counts, and
   error/coverage by sport, elevation proxy, and history depth.
3. Compare MAE with the personal Riegel baseline. A lower error is useful
   evidence for that cohort, not a guarantee; a worse result is a reason to
   stop and investigate.
4. Run the separate disjoint-user CSV evaluation, then smoke-test the same
   candidate and run the tests from `ml/`:

   ```bash
   python -m evaluation.sanity_check --artifacts-dir artifacts/duration_model-candidate
   python -m pytest -q
   ```
5. Have a human review the model card, slice sample sizes, interval coverage,
   source/consent, and deployment impact. Only after explicit review should the
   candidate be copied into shipped backend/browser locations and released.
   There is no automatic promotion or production reload in this workflow.

No production Supabase query, real-data training, or calibration was performed
as part of implementing this CSV workflow. The repository retains a Supabase
loader for compatibility, but do not use `--source supabase` or configure a
production `DATABASE_URL` without separate approval.

## External validation: GeoLife

The saved report `ml/evaluation/reports/geolife_validation.json` evaluates the
existing synthetic-trained artifact on the GeoLife GPS Trajectories Dataset.
GeoLife is **external evaluation only, not training data**. The report covers
4,362 labelled trajectories from 51 people (walk, bike→ride, and only 2 runs)
with chronological same-user/same-mode history. There is no elevation in the
feature table; the evaluator assumes zero elevation and infers experience from
history. These results do not establish expected accuracy for TRANA users.

| Slice | n | MAE (min) | MAPE | Within 15% | q10–q90 coverage | Personal-anchor MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Overall | 4,362 | 5.84 | 35.87% | 33.43% | 16.96% | 5.83 |
| Ride | 1,372 | 5.14 | 25.70% | 38.05% | 20.12% | 5.07 |
| Walk | 2,988 | 6.16 | 40.54% | 31.29% | 15.53% | 6.18 |
| Run | 2 | 2.78 | 28.21% | 50.00% | 0.00% | 3.07 |
| Cold start | 80 | 11.80 | 51.26% | 16.25% | 13.75% | 11.43 |
| ≥2 prior activities | 4,215 | 5.62 | 35.31% | 33.86% | 16.99% | 5.62 |

Overall MAE is better than the fixed population-pace baseline (7.10 min) — 17.9%
better, rising to 46.6% on rides — but the learned model is essentially tied
with the personal Riegel anchor (5.83 min). Real-world interval coverage is
poor, so intervals must be evaluated and recalibrated using a separate,
representative consented cohort before any deployment decision. GeoLife has no
elevation, its run sample is too small for conclusions, and elapsed GPS
durations include stops.

### Ablation: does the learned correction earn its place?

The duration model does not predict minutes directly. It predicts
`base_minutes × exp(GBM(features))`, where `base_minutes` already comes from the
athlete's own Riegel curve (see `duration_model/model_store.py`). So the honest
question is not "is the model better than nothing" but "does the learned
correction beat the curve it multiplies". `evaluation/ablation.py` scores
population prior, curve, and shipped model on the **same chronological rows**,
so the comparison is paired by construction, and puts a bootstrap interval on
the difference. Run it with:

```bash
cd ml && python -m evaluation.ablation --json evaluation/reports/ablation_report.json
```

**Result: it does not.**

| Slice | n | Curve MAE | Model MAE | Pop. prior MAE | Model vs. curve |
| --- | ---: | ---: | ---: | ---: | ---: |
| Overall | 4,362 | 5.83 | 5.84 | 7.10 | −0.2% |
| Ride | 1,372 | 5.07 | 5.14 | 9.49 | −1.4% |
| Walk | 2,988 | 6.18 | 6.16 | 6.01 | +0.3% |
| Cold start | 80 | 11.43 | 11.80 | 12.36 | −3.2% |
| ≥2 prior activities | 4,215 | 5.62 | 5.62 | 6.92 | 0.0% |

Paired bootstrap over 2,000 resamples of the 4,362 rows: the model's MAE
improvement over the curve is **−0.009 min, 95% CI [−0.019, +0.002]** (negative
means the model is worse). The interval straddles zero and the model wins only
**5.3%** of draws — worse than a coin flip. The correction is statistically
indistinguishable from doing nothing.

The mechanism is visible in the multiplier itself. Across those 4,362 real
activities, `exp(GBM q50)` has median **0.9904**, ranges **0.8823–1.0239**, and
has a standard deviation of 0.0167; 35.9% of predictions land within ±1% of
unity. At most it moves a prediction **+2.4%** or **−11.8%**. A correction
confined to that band cannot repair a 23.8% median error, which is exactly what
the ablation measures. Two consequences follow:

- The `[0.7, 3.0]` clamp in `model_store.predict()` is inert — the factor never
  approaches either bound. It is a guard against a retrained artifact going
  wild, not something that shapes today's output.
- On walks the correction is actively unhelpful: the curve beats the population
  prior by 2.8% on walks, and the model gives some of that back.

This is a negative result and is reported as one. Per the scope agreed for this
work, the ablation measures and documents the finding but **does not change the
shipped prediction path**; removing the correction from production is a separate
product decision. Until that decision is made, the deployed model still
multiplies the curve by `exp(GBM)` and the accuracy difference is immaterial
either way (−0.2%).

## Fueling engine and prediction flow

Fueling remains deterministic: calories use METs × body mass × hours; carbohydrate
rate depends on duration and intensity; sodium/fluid depend on sweat profile and
heat. Rules are documented in `ml/fueling_model/predict.py` and mirrored in
`frontend/src/lib/ml/fueling.js`. Duration-model retraining does not change them.

```text
SPA ──POST /api/predictions──▶ Laravel ──POST /predict──▶ FastAPI (ml/api)
```

Laravel validates the request, resolves distance (including a drawn route),
assembles history/profile context, calls FastAPI, normalizes the response, and
persists the prediction and model version. See `docs/api.md` for the API contract.

## Known limitations

- The shipped duration model is trained on synthetic activities; its synthetic
  holdout metrics are not real-user accuracy guarantees.
- GeoLife's real-world q10–q90 coverage is low, and its model MAE is essentially
  tied with the simple personal-pace baseline. The paired ablation quantifies
  that tie: 95% CI on the difference straddles zero, so the learned correction
  adds no measurable accuracy (`docs/ml-methodology.md`).
- Age and wearable heart-rate streams are not duration-model features.
- A 30-activity calibration set or a 200-activity retraining set is only a
  minimum-volume guard, not evidence of representative data or reliable
  estimates.
