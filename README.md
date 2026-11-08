# TRANA — Personalized Activity Fueling Recommendation System

> **Plan the effort. Know the fuel.**
> TRANA is a web-based predictive system that looks at your *past* activities and your
> *upcoming* route, then tells you how long it will take, how much energy you'll spend,
> and exactly what to eat and drink for it.

<p align="center">
  <img src="frontend/public/mascot-cat.png" width="140" alt="TRANA mascot" />
</p>

Most fitness apps tell you what you *already* burned. TRANA works **before** the
session: it predicts duration from your own pace history, converts that into energy,
carbohydrate, sodium and fluid targets, and lays them out on a timeline
(*3 h before → during → recovery*).

---

## 1. What it does

| Capability | How it works |
| --- | --- |
| **Duration prediction** | Your own distance→time curve (Riegel log-log fit, per sport) anchors a gradient-boosted **pace-factor** model that learns how climbing, body mass and experience slow you down. Three quantile models return a *range*, not a false-precision number. |
| **Energy (kcal)** | ACSM metabolic equations — `MET × body mass × hours`, with MET derived from your predicted speed and gradient. |
| **Carbohydrate** | Duration + intensity bands following sports-nutrition guidance (0 g/h under an hour → up to 85–90 g/h for multi-hour efforts), expressed as gels / bottles / real food. |
| **Sodium & fluid** | Baseline sweat profile (light / average / heavy sweater), adjusted for heat and session length. |
| **Fueling timeline** | Pre-session meal, top-up snack, during-session interval, recovery window — each with grams and millilitres. |
| **Learning loop** | Every completed session is logged, so predictions improve; the Analytics screen shows model error against your saved plans. |
| **Offline-first PWA** | The exported model trees run **in the browser**, so predictions still work with no network. |

---

## 2. Architecture

```text
                       TRANA
                         │
               ┌─────────┴─────────┐
               │                   │
            DESKTOP              MOBILE
               │                   │
               └─────────┬─────────┘
                         ↓
                Svelte 5 + Tailwind
                (Chart.js · Leaflet · OSM · PWA)
                         ↓
                      Vercel
                         ↓
                 Laravel REST API           ← Sanctum bearer tokens
                   /           \
                  /             \
                 ↓               ↓
     Supabase PostgreSQL     Python ML API (FastAPI)
          (data)                    │
                         ┌──────────┴──────────┐
                    Duration model        Fueling model
                 (gradient boosting)   (MET + nutrition)
```

Request flow for a prediction:

```text
User plans a session (sport, distance, elevation, route, temperature)
        ↓
Svelte → POST /api/predictions (Laravel)
        ↓
Laravel reads this athlete's activities from Supabase
        ↓
POST /predict → FastAPI (history + profile + plan)
        ↓
duration (q10 / q50 / q90)  +  calories / carbs / sodium / fluid / timeline
        ↓
Laravel normalises the payload, saves `predictions`, returns JSON
        ↓
Svelte renders the fueling plan
```

The browser never holds database credentials, and the private ML service is only
reachable from the Laravel API.

---

## 3. Repository layout

```text
frontend/        Svelte 5 + Vite + Tailwind PWA (Chart.js, Leaflet, OpenStreetMap)
  src/components/{common,dashboard,activities,route,fueling,analytics}/
  src/pages/{Login,Register,Dashboard,Activities,PlanActivity,Fueling,Analytics,Profile,Settings,Goals}/
  src/{stores,services,lib,routes}/    state · API/demo client · router+on-device ML · ROUTES table
  src/lib/ml/                          JS port of the Python model — identical trees, offline
backend/         Laravel 11 REST API (Sanctum, Eloquent, Supabase Postgres)
  app/Services/{ActivityService,RouteService,DurationPredictionService,FuelingPredictionService}.php
  app/Http/{Controllers,Requests,Resources}/
ml/              Python FastAPI service + scikit-learn training pipeline
  api/           FastAPI app (main.py, schemas.py)
  duration_model/  quantile GBM: train.py · predict.py · preprocess.py · model_store.py · artifacts
  fueling_model/   deterministic ACSM/ISSN fueling engine (predict.py)
  data/          synthetic corpus generator   ·   evaluation/sanity_check.py
docs/            api.md · architecture.md · database.md · ml-methodology.md · DEPLOYMENT.md
supabase/        PostgreSQL schema, RLS policies, analytical views
```

---

## 4. Quick start

### Prerequisites
Node 20+, Python 3.11+, PHP 8.2+ with Composer, a Supabase project (or any Postgres).

### 4.1 Frontend (works immediately, demo data included)

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

With no `VITE_API_BASE_URL`, the app runs in **demo mode**: a seeded athlete, a
localStorage database, and the real model running on-device. Click
*“Explore with demo data”* on the sign-in screen.

```bash
npm run build          # production bundle + service worker
node scripts/smoke.mjs # headless check of the whole prediction pipeline
```

### 4.2 Machine learning service

```bash
cd ml
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m duration_model.train      # trains + exports artifacts (~40 s)
python -m evaluation.sanity_check   # physical plausibility asserts
uvicorn api.main:app --reload --port 8000
```

### 4.3 Laravel API

```bash
cd backend
composer install
cp .env.example .env
php artisan key:generate
# Set the Supabase DB_* values (including the private DB_PASSWORD) and ML_API_URL.
# For this project's connection details, see supabase/README.md.
php artisan migrate:status  # verifies the connection
php artisan migrate         # do not reapply the SQL baseline to an existing database
php artisan serve --host=0.0.0.0 --port=8001
```

Point the frontend at it:

```bash
# frontend/.env.local (local development)
VITE_API_BASE_URL=/
```

Vite proxies same-origin `/api` requests to the Laravel server (by default
`http://127.0.0.1:8001`, server-side only). For separate deployments, set
`VITE_API_BASE_URL` to the deployed Laravel API origin. An empty value selects
local demo mode; it does **not** use the proxy. Never put database credentials
in a `VITE_*` variable.

### Environment variables

| Where | Variable | Purpose |
| --- | --- | --- |
| frontend | `VITE_API_BASE_URL` | Laravel API origin; `/` ⇒ same-origin API; empty ⇒ demo mode. |
| backend | `DB_HOST/DB_PORT/DB_DATABASE/DB_USERNAME/DB_PASSWORD/DB_SSLMODE` | Supabase Postgres (session pooler for Vercel). |
| backend | `ML_API_URL`, `ML_API_TOKEN`, `ML_TIMEOUT` | Python prediction service. |
| backend | `CORS_ALLOWED_ORIGINS` | Comma-separated frontend origins. |
| backend | `DEMO_MODE`, `DEMO_EMAIL`, `DEMO_PASSWORD` | Public sandbox login. |
| ml | `ALLOWED_ORIGINS`, `ADMIN_TOKEN`, `DATABASE_URL` | CORS, model-reload auth, training source. |

---

## 5. Machine learning in detail

**Problem.** Predict the duration of a *planned* activity from the athlete’s own
sparse history plus route characteristics.

**Why not regress minutes directly?** With ~12–60 sessions per athlete, a raw
regressor has to relearn each person’s speed from almost nothing and extrapolates
badly at long distances. TRANA separates the two problems:

```text
base(distance)  = exp(a + b · ln distance)      ← Riegel curve fitted per athlete/sport
duration        = base · exp(f(features))       ← what the model learns
features        = distance, elevation, elevation/km, mass, experience, sport
```

`f` is a `GradientBoostingRegressor` trained with **quantile loss** at α = 0.10 /
0.50 / 0.90 — so the UI can say “96 min, likely 88–112” instead of pretending to
know a single exact value.

**Current artifact** (bootstrapped on a physics-informed synthetic corpus,
retrainable on real Supabase data):

| Metric | Value |
| --- | --- |
| R² | 0.952 |
| MAE | 9.6 min |
| MAPE | 7.2 % |
| 80 % interval coverage | 76.8 % |
| Training rows | 7,988 sessions |

Top learned effects: climbing per kilometre, total elevation, distance, sport.

**Retraining on real data**

```bash
cd ml
DATABASE_URL="postgresql://..." python -m duration_model.train --source supabase
curl -X POST "$ML_API_URL/model/reload" -H "X-Admin-Token: $ADMIN_TOKEN"
```

or let Laravel schedule it: `php artisan trana:retrain` (nightly at 03:00).

**Offline parity.** `ml/duration_model/train.py` exports the fitted trees to
`duration_model/duration_model.json`; the PWA ships that file and evaluates the same
forests in JavaScript (`frontend/src/lib/ml/duration.js`). Server and browser
therefore agree, and predictions keep working without a network connection.

---

## 6. Fueling model

```text
MET        = modality & speed dependent (running ≈ 1.03 × km/h) + climb bonus
kcal       = MET × kg × hours
carbs/h    = 0 (<60 min) → 30 (60–90) → 60 (90–150) → 85+ (>150), intensity-adjusted
sodium/h   = baseline × heat factor × duration factor   (light 350 / avg 550 / heavy 800 mg)
fluid/h    = baseline × heat factor                     (450 / 650 / 900 ml)
```

All constants live in `ml/fueling_model/predict.py` and are mirrored exactly in
`frontend/src/lib/ml/fueling.js` and (for one-off estimates) in the Laravel
activity controller. Outputs are guidance for healthy adults, not medical advice.

---

## 7. API at a glance

| Method | Endpoint | Description |
| --- | --- | --- |
| POST | `/api/auth/register` · `/login` · `/demo` | Bearer token issuance |
| GET | `/api/auth/me` | Current athlete |
| GET/PUT | `/api/profile` | Body mass, sweat profile, experience, goals |
| GET/POST | `/api/activities` | Activity log (the training corpus) |
| GET | `/api/activities/{id}` · `/summary` | Detail / analytics |
| POST | `/api/predictions` | Plan a session → duration + fueling |
| POST | `/api/predictions/preview` | Same, without saving |
| GET | `/api/predictions` · `/api/model` | Saved plans, model card |

Full reference with payloads: [`docs/api.md`](docs/api.md).

---

## 8. Design

The UI follows the supplied reference: soft pink gradients, rounded cards, the cat
mascot, paw-print accents — translated into a responsive layout with a desktop
sidebar, a mobile bottom bar and a floating “plan” action. Components are built
with Tailwind tokens (`brand.50…900`, `ink.400…900`, `shadow-soft`, `shadow-glow`),
Chart.js for data viz and Leaflet + OpenStreetMap for routes.

---

## 9. Deployment

| Piece | Host | Notes |
| --- | --- | --- |
| Frontend | Vercel | `npm run build`, output `dist`, SPA rewrite |
| API | Vercel (PHP runtime) | `backend/vercel.json` + `api/index.php` |
| Database | Supabase | Postgres + pooler connection; see `supabase/README.md` for schema setup |
| ML | Render / Railway / Fly.io / Cloud Run | `ml/Dockerfile`, port 8000 |

Step-by-step instructions, including the CORS and connection-string gotchas, are in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## 10. Roadmap

- Supabase Auth (or passkeys) as an alternative to Sanctum tokens
- Live GPS recording during a session, imported via GPX
- Elevation profiles from a routing API (currently entered by hand or estimated)
- Per-athlete model fine-tuning once ≥ 40 sessions exist
- Wearable import (Garmin / Strava) to remove manual logging

---

## License

MIT — a student/portfolio project. Predictions are estimates; always train and fuel
responsibly.
