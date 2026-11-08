# Deployment guide

TRANA ships as four pieces: **Supabase Postgres**, a **Laravel API** on Vercel, a
**FastAPI ML service** on any Python host, and the **Svelte PWA** on Vercel.

```text
Vercel (frontend) ──► Vercel (Laravel API) ──► Supabase Postgres
                              │
                              └──────────────► Render/Railway (FastAPI ML)
```

---

## 1. Supabase (database)

The connected project is **Trana** (`tlqyvjhlesmackmcrzyg`); its empty Laravel
baseline has already been applied. For a different database, see
[`../supabase/README.md`](../supabase/README.md) and choose either Laravel
migrations or the one-time SQL baseline. Do not apply both to an existing DB.

In the Supabase dashboard select **Connect → Session pooler**. Copy the exact
connection details rather than guessing the pooler hostname:

```
host      <host copied from Connect>
port      5432
database  postgres
username  postgres.<project-ref>
password  <database password>
sslmode   require
```

Put the password only in backend environment secrets. The direct host for Trana
is `db.tlqyvjhlesmackmcrzyg.supabase.co`, but direct connections require IPv6
unless the IPv4 add-on is enabled. For serverless or IPv4-only hosts, use the
session pooler supplied by the dashboard. Laravel/Sanctum performs auth; the
Supabase Data API's `anon` and `authenticated` roles cannot read app tables or
views. Do not seed the known demo account into a real production database.

---

## 2. Laravel API on Vercel

The repository already contains `backend/vercel.json` and `backend/api/index.php`.

```bash
cd backend
composer install --no-dev --optimize-autoloader
vercel link            # or: vercel --prod
```

Set these environment variables in the Vercel dashboard (Production + Preview):

| Variable | Value |
| --- | --- |
| `APP_ENV` | `production` |
| `APP_KEY` | output of `php artisan key:generate --show` |
| `APP_DEBUG` | `false` |
| `APP_URL` | `https://<api>.vercel.app` |
| `DB_CONNECTION` / `DB_HOST` / `DB_PORT` / `DB_DATABASE` / `DB_USERNAME` / `DB_PASSWORD` / `DB_SSLMODE` | from Supabase (§1) |
| `CACHE_STORE` / `SESSION_DRIVER` | `database` (run the cache/sessions migrations once) |
| `CORS_ALLOWED_ORIGINS` | `https://<your-frontend>.vercel.app` |
| `ML_API_URL` | `https://<ml>.onrender.com` |
| `ML_TIMEOUT` | `12` |
| `DEMO_MODE` | `false` (or `true` to keep the sandbox login) |

Notes:

* The PHP runtime is **read-only except `/tmp`** — that is why sessions, cache and
  logs use the database driver, not files. If you prefer logs, send them to stderr
  (`LOG_CHANNEL=stderr`).
* Run migrations from your machine (or a one-off job) against Supabase; Vercel
  invocations should not run `php artisan migrate` on every cold start.
* `trustProxies('*')` is already configured so `https://` URLs and rate limits see
  the real client IP.

Any Laravel-capable host (Forge, Railway, Fly.io, a VPS) works identically — just
point `DB_*` at Supabase and drop `vercel.json`.

---

## 3. ML service (Render / Railway / Fly.io / Cloud Run)

The folder contains a `Dockerfile`.

**Render**

* New → Web Service → Docker → repo `ml` directory.
* Port `8000`. Health check path `/health`.
* Env: `ALLOWED_ORIGINS=https://<api>.vercel.app`, `ADMIN_TOKEN=<random long string>`.
* Optional persistent disk mounted at `/app/duration_model` if you retrain in place.

**Railway**

```bash
railway init
railway up            # builds ml/Dockerfile
railway variables set ALLOWED_ORIGINS=https://<api>.vercel.app
```

**Fly.io**

```bash
cd ml
fly launch --dockerfile Dockerfile --name trana-ml
fly secrets set ALLOWED_ORIGINS=https://<api>.vercel.app
fly deploy
```

**Cloud Run**

```bash
cd ml
gcloud run deploy trana-ml --source . --port 8000 --allow-unauthenticated --region asia-southeast1
```

Verify: `curl https://<ml>/health` → `{ "status": "ok", "model_ready": true }`.

Retraining in production:

```bash
DATABASE_URL="postgresql://…" python -m duration_model.train --source supabase
curl -X POST https://<ml>/model/reload -H "X-Admin-Token: $ADMIN_TOKEN"
```

---

## 4. Frontend on Vercel

```bash
cd frontend
vercel --prod
```

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| `VITE_API_BASE_URL` | `https://<api>.vercel.app` |

Add a SPA rewrite so deep links (`/analytics`, `/plan`) resolve:

`frontend/vercel.json`
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

The service worker caches the shell, the fonts, OSM tiles and the exported model,
so the installed PWA keeps working offline.

---

## 5. Smoke test after deploy

```bash
# 1. API is alive
curl -s https://<api>.vercel.app/ | jq

# 2. Demo token
TOKEN=$(curl -s -X POST https://<api>.vercel.app/api/auth/demo | jq -r .token)

# 3. Prediction end-to-end (Laravel → FastAPI)
curl -s -X POST https://<api>.vercel.app/api/predictions \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"activity_type":"run","distance_km":21.1,"elevation_gain_m":220}' | jq '.data.duration, .data.fueling.carbs'

# 4. Frontend
open https://<frontend>.vercel.app
```

---

## 6. Environment matrix

| Variable | frontend | backend | ml |
| --- | :---: | :---: | :---: |
| `VITE_API_BASE_URL` | ✅ | | |
| `APP_KEY`, `APP_ENV`, `APP_DEBUG`, `APP_URL` | | ✅ | |
| `DB_*`, `DB_SSLMODE` | | ✅ | |
| `CORS_ALLOWED_ORIGINS` | | ✅ | |
| `ML_API_URL`, `ML_API_TOKEN`, `ML_TIMEOUT` | | ✅ | |
| `ML_ADMIN_TOKEN` | | ✅ (reload) | |
| `DEMO_MODE`, `DEMO_EMAIL`, `DEMO_PASSWORD` | | ✅ | |
| `ALLOWED_ORIGINS`, `ADMIN_TOKEN` | | | ✅ |
| `DATABASE_URL` (training only) | | | ✅ |

---

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `SQLSTATE[08006]` on Vercel | Wrong pooler host or `DB_SSLMODE` missing → set `require`. |
| CORS error in the browser | Add the exact frontend origin (scheme included) to `CORS_ALLOWED_ORIGINS`, redeploy. |
| `503` from `/api/predictions` | ML service asleep/unreachable → check `/health`, raise `ML_TIMEOUT`, warm it with a cron ping. |
| Predictions look slow (> 2 s) | Cold start of the Python host; keep one instance warm or precompute at deploy time. |
| PWA serves an old bundle | `registerType: 'autoUpdate'` handles it, but a hard reload clears the stale service worker. |
| `429` on login | Auth is limited to 10 requests/min/IP — expected during automated testing. |
