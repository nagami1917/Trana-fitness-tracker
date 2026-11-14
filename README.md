# TRANA — Personalized Activity Fueling Recommendation System

> **Plan the effort. Know the fuel.**
> TRANA is a web-based predictive system that looks at your *past* activities and your
> *upcoming* route, then tells you how long it will take, how much energy you'll spend,
> and estimates what to eat and drink for it.

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
| **Wearable calibration** | Import what your Garmin/Strava-style device *measured* and the server learns the gap to its own estimate; from 3 samples on, new calorie estimates are scaled by your personal factor (clamped 0.5×–2.0×). |
| **Carbohydrate** | Duration + intensity bands following sports-nutrition guidance (0 g/h under an hour → up to 85–90 g/h for multi-hour efforts), expressed as gels / bottles / real food. |
| **Sodium & fluid** | Baseline sweat profile (light / average / heavy sweater), adjusted for heat and session length. |
| **Fueling timeline** | Pre-session meal, top-up snack, during-session interval, recovery window — each with grams and millilitres. |
| **Personal history** | Logged activities inform your reference pace; they do not automatically retrain the shared model. |
| **On-device previews** | The exported model can calculate a preview locally once loaded; account data and saved changes require the API. |

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
           Laravel REST API           ← HttpOnly cookie + CSRF (bearer clients supported)
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

The browser never holds database credentials. Protect the ML service with a shared
server-side token and/or private network access in a deployment.

---

## 3. Repository layout

```text
frontend/        Svelte 5 + Vite + Tailwind PWA (Chart.js, Leaflet, OpenStreetMap)
  src/components/{common,dashboard,activities,route,fueling,analytics}/
  src/pages/{Login,Register,Dashboard,Activities,PlanActivity,Fueling,Analytics,Profile,Settings,Goals}/
  src/{stores,services,lib,routes}/    state · Laravel API client · router+on-device ML · ROUTES table
  src/lib/ml/                          JS port of the Python model — identical trees, offline
backend/         Laravel 11 REST API (Sanctum, Eloquent, Supabase Postgres)
  app/Services/{ActivityService,RouteService,DurationPredictionService,FuelingPredictionService}.php
  app/Http/{Controllers,Requests,Resources}/
ml/              Python FastAPI service + scikit-learn training pipeline
  api/           FastAPI app (main.py, schemas.py)
  duration_model/  quantile GBM: train.py · predict.py · preprocess.py · model_store.py · artifacts
  fueling_model/   deterministic ACSM/ISSN fueling engine (predict.py)
  data/          synthetic corpus generator   ·   evaluation/sanity_check.py
docs/            api.md · architecture.md · database.md · ml-methodology.md · DEPLOYMENT.md · user-manual.md · test-report.md
supabase/        PostgreSQL schema, RLS policies, analytical views
```

New to the project? Start with the **[user manual](docs/user-manual.md)**;
verification evidence lives in the **[test report](docs/test-report.md)**.

---

## 4. Quick start

### Prerequisites
Node 20+, Python 3.11+, PHP 8.2+ with Composer, a Supabase project (or any Postgres).

### 4.1 Frontend

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```

The frontend always uses the Laravel API. An empty `VITE_API_BASE_URL` or `/`
uses same-origin `/api`; Vite proxies it to the backend during development.
Start Laravel and connect it to your database before signing in or registering.
Create an account with a unique username, Gmail address, and password, then
verify the emailed six-digit code. Configure a real `MAIL_*` transport in the
backend environment for delivery; keep provider credentials out of Git and the
frontend. No sample account or activity history is created automatically. Data
from the previous browser-only mode remains in that browser and is not
automatically imported; existing Supabase records are not changed by this update.

```bash
npm run build          # production bundle + service worker
node scripts/smoke.mjs # headless check of the whole prediction pipeline
```

### 4.4 Start everything together (3 terminals)

TRANA needs **three services running at the same time**. Open three terminal
windows/tabs and run each block:

#### Terminal 1 — Backend (Laravel API)

```powershell
cd D:\Trana-fitness-tracker\backend
php artisan config:clear
php artisan migrate
php -S 127.0.0.1:8001 -t public
```
Leave this open. API runs at **http://127.0.0.1:8001**.

> If `php artisan migrate` complains about the database, edit `backend\.env` with
> your Supabase session pooler values (host, username, password) from
> Supabase Dashboard → Connect → Session pooler, then run `migrate` again.

#### Terminal 2 — Frontend (Svelte PWA)

```powershell
cd D:\Trana-fitness-tracker\frontend
npm install
npm run dev          # http://localhost:5173
```
Leave this open.

> If the backend is on a port other than 8001, create `frontend\.env.local` with:
> `VITE_PROXY_TARGET=http://127.0.0.1:<your-port>`

#### Terminal 3 — Python ML Service

```powershell
cd D:\Trana-fitness-tracker\ml
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn api.main:app --reload --port 8000
```
Leave this open. ML runs at **http://127.0.0.1:8000**.

#### Open the app

Go to **http://localhost:5173** in your browser:

1. Create a TRANA account with your name, username, Gmail address, and password
2. Verify the six-digit code delivered to Gmail, then log in
3. Complete onboarding and go to **Track Activity** to test live GPS and road snapping

Keep all three terminals open while using the app.

### 4.2 Machine learning service

```bash
cd ml
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# The committed model artifacts can be used without retraining.
python -m evaluation.sanity_check   # optional physical plausibility checks
uvicorn api.main:app --reload --port 8000
```

### 4.3 Laravel API

```bash
cd backend
composer install
cp .env.example .env   # only if .env does not already exist
php artisan key:generate  # only for a new .env
# Set Supabase DB_* values and ML_API_URL. Configure MAIL_* with a real SMTP
# provider/App Password for signup verification and password recovery.
# Keep MAIL_PASSWORD in backend/.env or deployment secrets; never commit it.
# For this project's connection details, see supabase/README.md.
php artisan config:clear
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
`VITE_API_BASE_URL` to the deployed Laravel API origin. An empty value also
uses the proxy. If Laravel runs on port 8002 instead, set
`VITE_PROXY_TARGET=http://127.0.0.1:8002` in `frontend/.env.local` and restart
Vite. Never put database credentials in a `VITE_*` variable.

### Environment variables

| Where | Variable | Purpose |
| --- | --- | --- |
| frontend | `VITE_API_BASE_URL`, `VITE_PROXY_TARGET` | Blank or `/` uses same-origin `/api`; Vite forwards it to the server-side proxy target. |
| frontend | `VITE_ORS_API_KEY` | OpenRouteService key — drawn routes snap onto real roads. Optional; without it the map falls back to straight lines. |
| backend | `DB_HOST/DB_PORT/DB_DATABASE/DB_USERNAME/DB_PASSWORD/DB_SSLMODE` | Supabase Postgres (session pooler for Vercel). Laravel ignores `DB_URL`/`DATABASE_URL` for pgsql. |
| backend | `MAIL_MAILER`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS` | SMTP/transactional mail for verification and password-reset OTPs; keep credentials in deployment secrets. |
| backend | `TRANA_AUTH_COOKIE_MINUTES`, `TRANA_COOKIE_SAME_SITE`, `TRANA_COOKIE_DOMAIN` | HttpOnly auth-cookie lifetime and deployment scope; production cookies are Secure. |
| backend | `ML_API_URL`, `ML_API_TOKEN`, `ML_ADMIN_TOKEN`, `ML_TIMEOUT` | Python prediction service and optional server-to-server secrets. |
| backend | `CORS_ALLOWED_ORIGINS` | Comma-separated frontend origins, required for browser CORS and CSRF checks. |
| ml | `ML_API_TOKEN`, `ADMIN_TOKEN`, `ALLOWED_ORIGINS`, `DATABASE_URL` | API/reload secrets, CORS, and optional training source. |

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

**Current artifact** (bootstrapped and tested on a synthetic corpus). These test
metrics are not evidence of real-world accuracy:

| Metric | Value |
| --- | --- |
| R² | 0.952 |
| MAE | 9.6 min |
| MAPE | 7.2 % |
| 80 % interval coverage | 76.8 % |
| Training rows | 7,988 synthetic activities |

Top learned effects: climbing per kilometre, total elevation, distance, sport.

**Retraining on real data**

```bash
cd ml
DATABASE_URL="postgresql://..." python -m duration_model.train --source supabase
curl -X POST "$ML_API_URL/model/reload" -H "X-Admin-Token: $ADMIN_TOKEN"
```

Retrain only with appropriate consent and enough representative data; deployment
and validation of the new artifacts are separate steps.

**Previews.** `ml/duration_model/train.py` exports the trees to JSON for the PWA.
The browser and server may differ if their model versions or inputs differ. The
server calculation is authoritative when a plan is saved; accessing accounts and
saving data requires a working API and database.

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
| GET | `/api/auth/csrf` | Bootstrap the double-submit CSRF token |
| POST | `/api/auth/register` · `/api/auth/email/verify` | Create and verify a Gmail/password account with email OTP |
| POST | `/api/auth/login` · `/api/auth/logout` | Sign in/out using an HttpOnly cookie |
| POST | `/api/auth/password/forgot` · `/api/auth/password/reset` | Reset password using a five-minute email OTP |
| GET | `/api/health` | API database connectivity (no credentials exposed) |
| GET | `/api/auth/me` | Current athlete |
| GET/POST/PUT/PATCH | `/api/profile` | Fitness profile: create, view, edit (body mass, fitness level, age, experience, sweat profile, goals) |
| PATCH | `/api/profile/weight` · `/api/profile/fitness-level` | Focused updates used by the profile screen |
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
- Full wearable activity import (GPX/FIT routes and sessions) — calorie-sample
  import and calibration already ship via `/api/energy-expenditure`

---

## License

MIT — predictions are estimates, not medical advice. Before public deployment,
address the known security and operational limitations in the deployment guide.
