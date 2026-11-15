# TRANA ML service

FastAPI service for duration estimates and fueling guidance. It is stateless at
inference time and does not query a database. The duration model is a quantile
gradient-boosted pace-factor model anchored on the athlete's own earlier
activities; fueling remains rule-based.

## Run the service locally

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m evaluation.sanity_check
uvicorn api.main:app --reload --port 8000
```

Interactive API docs: <http://localhost:8000/docs>.

For deployment, set `ML_API_TOKEN` on both FastAPI and Laravel. Set separate
`ADMIN_TOKEN` and `ML_ADMIN_TOKEN` values to enable model reload. Empty tokens
are intended only for local development. Restrict network access and use HTTPS;
CORS is not authentication. `/health` is public for service probes.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | liveness and model readiness |
| GET | `/model/info` | model card and aggregate metrics |
| POST | `/predict` | duration and fueling in one call |
| POST | `/predict/duration` | duration only |
| POST | `/predict/fueling?duration_min=` | fueling only |
| POST | `/model/reload` | reload shipped artifacts; requires `X-Admin-Token` |

## Duration model

`GradientBoostingRegressor(loss="quantile", alpha∈{0.1,0.5,0.9})` predicts the
log pace-factor around an athlete-specific Riegel reference curve. Features are
distance, elevation gain/density, experience/history depth, and activity type.
Weight, calories, heart rate, direct identifiers, and route data are not model
features. The committed model card identifies the shipped artifact as trained on
synthetic data; those holdout metrics are not real-user accuracy guarantees.

## Consent-first local CSV workflow

Use a **local, consented, pseudonymized CSV** as the safe starting point. Do not
query production Supabase or train on production data without separate approval.
The source file should remain outside Git (preferably outside the repository)
and must not contain direct identifiers or raw GPS/route data.

Required columns:

- `user_id`: stable pseudonymous athlete ID, reused for all that athlete's rows
  and consistently across train/calibration/validation files.
- `activity_type`: `run`, `ride`, `walk`, or `hike`.
- `distance_km`, `duration_min`: positive distance and elapsed duration.
- `started_at`: valid ISO-8601 activity timestamp (prefer UTC/offset; naive times are treated as UTC; `start_time` is also accepted).

Optional model context: `elevation_gain_m` (total ascent only) and
`experience_level` (1–5 as known at the activity time). If experience is omitted,
it is derived from earlier same-sport activity history. The normalizer rejects
common PII/raw-location column names and email-/phone-like user IDs and drops
unused columns, but input owners must still verify pseudonymization and consent.

From this `ml/` directory:

```bash
# Audit first; output contains aggregate counts only.
python -m duration_model.audit --csv /secure/path/train.csv

# Full retraining: at least 200 valid activities and 5 distinct users.
python -m duration_model.train --source csv --csv /secure/path/train.csv

# Optional: holdout calibration, requiring at least 30 valid holdout rows.
python -m duration_model.train --source csv --csv /secure/path/train.csv --calibrate

# Or calibrate on a separate consented cohort (>=30 valid rows, disjoint users).
python -m duration_model.train --source csv --csv /secure/path/train.csv \
  --calibrate-csv /secure/path/calibration.csv

# Independent validation of real-data candidates (training users must not overlap).
python -m evaluation.validate_csv \
  --csv /secure/path/validation.csv \
  --training-csv /secure/path/train.csv \
  --artifacts-dir artifacts/duration_model-candidate \
  --out artifacts/duration-model-validation.json
```

If a candidate was calibrated on a separate CSV, pass
`--calibration-csv /secure/path/calibration.csv` to the validation command too;
validation athletes must be disjoint from both training and calibration athletes.
The evaluator performs chronological walk-forward predictions using only the
same athlete's earlier activities of the same sport.

The enforced minimums (30 calibration activities; 200 retraining activities
plus 5 users) are **minimum data-volume guards, not accuracy guarantees**. The
training and validation reports separate point-prediction error from q10–q90
interval coverage and break results down by activity type, history depth, and
ascent density when positive elevation data supports it. They compare against
the personal Riegel pace anchor; the CSV evaluator also reports a population
pace baseline. Ascent density is a proxy, not a measured terrain label.

Training runs default to the Git-ignored
`ml/artifacts/duration_model-candidate/`; shipped files under
`duration_model/` and `frontend/public/models/` are not updated automatically.
Review the model card and separate-user validation results before manually
promoting any candidate. See [`docs/ml-methodology.md`](../docs/ml-methodology.md)
for the data contract, privacy controls, detailed commands, thresholds, metrics,
and review-before-deploy checklist. No production Supabase query, real-data
training, or calibration was performed while implementing this workflow.

## Layout

```text
api/                 FastAPI app and request/response schemas
duration_model/      duration model, feature engineering, inference, trainer,
                     local CSV audit, calibration; shipped artifacts are here
fueling_model/       deterministic fueling rules
data/                synthetic bootstrap data generator
evaluation/          sanity checks, GeoLife report, CSV candidate validator
tests/               API, model, privacy, audit, and workflow tests
```
