# TRANA ML service (FastAPI + scikit-learn)

## Run

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m training.train            # writes artifacts/ (joblib + JSON + model card)
python -m training.sanity_check     # physical plausibility asserts (exit 1 on failure)
uvicorn app.main:app --reload --port 8000
```

Interactive docs: <http://localhost:8000/docs>

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
  "temperature_c": 26,
  "history": [
    {"activity_type":"run","distance_km":5,"duration_min":29},
    {"activity_type":"run","distance_km":10,"duration_min":61}
  ]
}' | jq
```

## Layout

```
app/
  features.py      feature engineering + Riegel reference curve (shared with training)
  model_store.py   artifact loading, quantile inference, route metrics
  fueling.py       MET energy cost + carbohydrate/sodium/fluid guidance
  main.py          FastAPI app
  schemas.py       pydantic request/response models
training/
  generate_dataset.py  physics-informed bootstrap corpus
  train.py             trains q10/q50/q90 GBMs, exports JSON trees + model card
  sanity_check.py      reference-point smoke test
artifacts/         duration_model.joblib · duration_model.json · model_card.json
```

## Model

`GradientBoostingRegressor(loss="quantile", alpha∈{0.1,0.5,0.9})` on the log of a
*pace factor*, anchored to the athlete's own Riegel distance→time curve:

```
base      = exp(a + b·ln d)          # fitted per athlete & modality
duration  = base · exp(f(features))  # features: distance, elevation, elev/km, mass, experience, sport
```

Metrics live in `artifacts/model_card.json` and are surfaced in the UI.

## Retrain on real data

```bash
pip install 'psycopg[binary]'
DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-0-….pooler.supabase.com:5432/postgres" \
  python -m training.train --source supabase
curl -X POST $ML_API_URL/model/reload -H "X-Admin-Token: $ADMIN_TOKEN"
```

Copy `artifacts/duration_model.json` → `frontend/public/models/` so the PWA stays in
sync with the server.
