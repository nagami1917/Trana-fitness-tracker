# TRANA — Architecture

## 1. Components

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Client | Svelte 5 (runes) + Vite, Tailwind, Chart.js, Leaflet/OSM, `vite-plugin-pwa` | UI, offline-first PWA, on-device model evaluation |
| API | Laravel 11, Sanctum, Eloquent | Auth, validation, history assembly, persistence, orchestration |
| Database | Supabase **PostgreSQL** | Activities, profiles, predictions, goals + analytical views |
| ML | Python 3.11, FastAPI, scikit-learn, pandas | Duration model (training + inference), fueling engine |
| Hosting | Vercel (frontend + API), Supabase (DB), Render/Railway (ML) | — |

No component talks to a database it does not own: the browser only speaks to the
Laravel API, and the ML service holds no credentials at all.

## 2. Data model

```text
users 1───1 fitness_profiles        weight, height, sex, sweat profile, experience
  │
  ├──1───1 goals                    daily/weekly energy, distance, active minutes, carbs
  │
  ├───n─── activities               run | ride | walk | hike
  │                                 distance_km, elevation_gain_m, duration_min,
  │                                 calories, started_at, route jsonb, source
  │
  └───n─── predictions              planned session + model output
                                    duration_min / low / high / confidence,
                                    calories, carbs/sodium/fluid per hour,
                                    payload jsonb (full recommendation), model_version
```

Both `activities` and `predictions` carry `route` as `jsonb` (`[[lat, lng], …]`), so a
planned route can be compared with what was actually done later.

Views:

* `v_athlete_pace` — per-athlete, per-modality speed/pace. The ML anchor, also handy for reports.
* `v_daily_totals` — dashboard rollups without client-side aggregation.
* `v_prediction_accuracy` — joins predictions to the completed activity to expose model drift.

## 3. Prediction flow

```text
POST /api/predictions
  { activity_type, distance_km | route[], elevation_gain_m, temperature_c, planned_for }
        │
        ├─ validate (StorePredictionRequest)
        ├─ load profile + last 300 activities
        ├─ if route drawn → recompute distance with haversine (server-side truth)
        ├─ POST {ML_API_URL}/predict
        │      payload: plan + profile + history
        │      response: duration{q10,q50,q90}, fueling{calories,carbs,sodium,fluid,timeline,notes}
        ├─ normalise snake_case → camelCase (PredictionService::normalise)
        ├─ persist predictions row (payload jsonb = audit trail)
        └─ 201 { data: Prediction::toApiArray() }
```

Failure handling: if the ML service is unreachable the endpoint returns **503** with a
hint, while every other endpoint keeps working. The PWA can still preview predictions
locally because it ships the same trees.

## 4. Why a pace-factor model

Raw regression on minutes:

* learns each athlete's speed from a handful of rows → high variance;
* extrapolates poorly to distances not present in the history;
* cannot distinguish "slow because unfit" from "slow because hilly".

Pace-factor decomposition:

```
base(d)  = exp(a + b·ln d)                 Riegel fit per athlete & modality (b clipped to 0.85–1.35)
factors  = exp(f(distance, elevation, elevation/km, mass, experience, sport))
duration = base · factors, evaluated at q10/q50/q90
```

Consequences:

* the prediction is anchored to something real (“my 5 km takes 28 min” ⇒ a 10 km
  prediction starts from *my* curve, not the population's);
* the model only has to learn the multiplier, which is a far smaller, better-posed
  target;
* quantiles give an honest range and a confidence score
  (`1 − (q90−q10)/(2·q50)`), which the UI surfaces as “82 % confidence”.

## 5. Training corpus

`data/generate_dataset.py` builds a physics-informed bootstrap corpus (220
athletes, ≈8 000 sessions) from published relationships — modality base speeds,
gradient penalties, Naismith-style ascent costs, fatigue deceleration and
day-to-day noise. This exists because a new deployment has no data; once real
rows are in Supabase:

```bash
DATABASE_URL=... python -m duration_model.train --source supabase
```

`evaluation/sanity_check.py` asserts that classic reference points (5 km, 10 km, half
marathon, 40 km ride, 400 m hike climb, 5 km walk) land within ±22 % of
textbook expectations, so a bad retrain cannot reach production unnoticed.

## 6. Fueling engine

Deterministic, inspectable formulas (see `ml/fueling_model/predict.py`), not a black box — a
health-facing product should let you trace every number:

```
MET(type, speed, gradient)  → kcal = MET · kg · h
carbs/h  = band(duration) · intensity factor        (0 … 90 g)
sodium/h = profile(base, heat, duration)
fluid/h  = profile(base, heat)
timeline = 3 h before / 30 min before / during (every 45–60 min) / recovery
```

## 7. Offline & PWA strategy

* `vite-plugin-pwa` precaches the app shell, fonts, tiles (runtime, 30-day cache)
  and `public/models/duration_model.json`.
* The browser evaluates the exported trees (`lib/ml/duration.js`) and the same
  fueling formulas (`lib/ml/fueling.js`), so the prediction screen is fully
  functional offline.
* Writes queue naturally in the UI: a session logged offline is kept by the service
  worker's app shell until connectivity returns (demo mode) or fails loudly with a
  toast (live mode, so the athlete knows the server has not seen it yet).

## 8. Security

* Sanctum personal access tokens, rate-limited auth (`10/min/IP`) and predictions
  (`60/min/user`).
* All queries are scoped through the authenticated user's relations
  (`$request->user()->activities()`), so ID tampering cannot cross accounts;
  `abort_unless($model->user_id === $user->id, 404)` on every route-model binding.
* RLS is enabled on every table even though Laravel connects as the service role —
  defence in depth in case an anon key ever leaks into a client bundle.
* CORS is an explicit origin allowlist; stack traces are suppressed in API responses.
* The ML service is stateless and holds no database credentials.

## 9. Trade-offs

| Decision | Why | Cost |
| --- | --- | --- |
| Laravel instead of a Node BFF | Required by the project brief; strong validation/Eloquent | Two runtimes to deploy |
| Separate Python service | scikit-learn/Pandas ecosystem; independent scaling | One more network hop |
| Trees exported to JSON | True offline parity, no server round-trip for previews | ~340 kB asset (gzip ≈ 60 kB) |
| Formula-based fueling | Auditable, explainable, no training data needed | Less “personalised” than a learned model (sweat rate is self-reported) |
