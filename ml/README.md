# TRANA ML service (FastAPI + scikit-learn)

Duration prediction + fueling guidance for TRANA. Pure stateless worker — no
database access at inference time.

## Run

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# Existing artifacts are included; retraining is optional and requires consent for real data.
python -m evaluation.sanity_check         # physical plausibility asserts (exit 1 on failure)
uvicorn api.main:app --reload --port 8000
```

Interactive docs: <http://localhost:8000/docs>

## Service security

For a deployment, set the same long random `ML_API_TOKEN` on FastAPI and Laravel;
FastAPI checks the bearer token on prediction and model-info routes. An empty
value leaves these routes unauthenticated for local development. Set a separate
`ADMIN_TOKEN` on FastAPI and `ML_ADMIN_TOKEN` on Laravel for model reload; reload
is disabled if `ADMIN_TOKEN` is missing. Restrict network access and use HTTPS;
CORS is not authentication. `/health` is public for service probes.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | liveness + model readiness |
| GET | `/model/info` | model card (metrics, features, importances) |
| POST | `/predict` | duration + fueling in one call (used by Laravel) |
| POST | `/predict/duration` | duration only |
| POST | `/predict/fueling?duration_min=` | fueling only |
| POST | `/model/reload` | reload artifacts (requires `X-Admin-Token`) |

## Example

```bash
curl -s -X POST localhost:8000/predict -H 'Content-Type: application/json' -d '{
  "activity_type": "run",
  "distance_km": 21.1,
  "elevation_gain_m": 220,
  "weight_kg": 55,
  "experience_level": 3,
  "fitness_level": 3,
  "age": 27,
  "sex": "female",
  "height_cm": 162,
  "activity_experience": 6.5,
  "temperature_c": 26,
  "history": [
    {"activity_type":"run","distance_km":5,"duration_min":29},
    {"activity_type":"run","distance_km":10,"duration_min":61}
  ]
}' | jq
```

`age`, `sex`, `height_cm`, `fitness_level` and `activity_experience` are optional
profile context sent by Laravel (spec step 4). Only `weight_kg` and the 1–5
fitness level (`fitness_level`, falling back to `experience_level`) change the
model output today; the rest is validated and carried for auditing.

CLI predictor (no server):

```bash
python -m duration_model.predict --activity-type run --distance-km 21.1 --elevation-gain-m 220 --weight-kg 55
```

## Layout

```
api/                 FastAPI app
  main.py            routes + CORS + /model/reload admin guard
  schemas.py         pydantic request/response models
  __init__.py
duration_model/      duration quantile model
  preprocess.py      feature engineering + Riegel reference curve
  model_store.py     artifact loading, quantile inference, route metrics
  train.py           trains q10/q50/q90 GBMs, exports JSON trees + model card
  predict.py         `python -m duration_model.predict` CLI
  duration_model.joblib · duration_model.json · model_card.json   (committed artifacts)
fueling_model/       fueling recommendation engine
  predict.py         MET energy cost + carbohydrate/sodium/fluid guidance
                     (deterministic by design — no learned parameters)
data/
  generate_dataset.py  physics-informed synthetic bootstrap corpus
  __init__.py
evaluation/
  sanity_check.py    reference-point smoke test against the trained model
  __init__.py
tests/
  test_api.py        endpoint + engine tests (pytest)
```

## Model

`GradientBoostingRegressor(loss="quantile", alpha∈{0.1,0.5,0.9})` on the log of a
*pace factor*, anchored to the athlete's own Riegel distance→time curve:

```
base      = exp(a + b·ln d)          # fitted per athlete & modality
duration  = base · exp(f(features))  # features: distance, elevation, elev/km, mass, experience, sport
```

Metrics and the training source live in `duration_model/model_card.json` and
are surfaced in the UI. The bundled model was trained and evaluated on synthetic
activities; those metrics do not validate real-world accuracy.

## Retrain on real data

```bash
pip install 'psycopg[binary]'
DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-0-….pooler.supabase.com:5432/postgres" \
  python -m duration_model.train --source supabase
curl -X POST $ML_API_URL/model/reload -H "X-Admin-Token: $ADMIN_TOKEN"
```

Copy both `duration_model/duration_model.json` and `model_card.json` to
`frontend/public/models/` and redeploy so browser previews use the same version.
Train on user data only with appropriate consent and validate on representative
real-world data before relying on the estimates.
