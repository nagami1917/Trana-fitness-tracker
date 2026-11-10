# Deployment guide

TRANA consists of **Supabase Postgres**, a **Laravel API**, a **FastAPI ML
service**, and the **Svelte PWA**. Hosting options below are examples, not a
claim that this deployment has been tested.

**Not production-ready yet:** Laravel 11 is end-of-life and this repository
currently suppresses unresolved Laravel security advisories. Upgrade and audit
the framework and dependencies before accepting real users. Password recovery,
email verification, backups/restore testing, monitoring, privacy/consent, and a
real-world validation of the prediction model also need work.

```text
Vercel (frontend) ──► Vercel (Laravel API) ──► Supabase Postgres
                              │
                              └──────────────► Render/Railway (FastAPI ML)
```

---

## 1. Supabase (database)

The connected Trana project's empty Laravel baseline has already been applied.
For a different database, see
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

Put the password only in backend environment secrets. Direct connections require
IPv6 unless the IPv4 add-on is enabled. For serverless or IPv4-only hosts, use
the session pooler supplied by the dashboard. The Laravel PostgreSQL connection
uses individual `DB_*` values and ignores `DB_URL` and `DATABASE_URL`; clear
Laravel's config cache after changing them. Laravel/Sanctum performs auth; the
Supabase Data API's `anon` and `authenticated` roles cannot read app tables or
views. The default seeder does not create sample accounts or activities.

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
| `ML_API_TOKEN` | Same long, random secret configured on the ML service |
| `ML_ADMIN_TOKEN` | Separate secret matching the ML service `ADMIN_TOKEN` if model reload is needed |
| `ML_TIMEOUT` | `12` |

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
* Privately set `ML_API_TOKEN` to the same random value as Laravel, and set a different random `ADMIN_TOKEN` if model reload is needed. Restrict network access and use HTTPS.
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
# Configure the shared ML_API_TOKEN and restrict network access before deployment.
gcloud run deploy trana-ml --source . --port 8000 --region asia-southeast1
```

Configure `ML_API_TOKEN` on **both** Laravel and FastAPI; if it is blank,
prediction endpoints are not authenticated. `ADMIN_TOKEN` separately protects
model reload, which is disabled when the token is blank. CORS is not a substitute
for authentication. Verify `curl https://<ml>/health` reports `model_ready: true`.

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
| `VITE_ORS_API_KEY` | OpenRouteService key — snaps drawn routes onto roads (optional; without it routes draw as straight lines) |

Add a SPA rewrite so deep links (`/analytics`, `/plan`) resolve:

`frontend/vercel.json`
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

The service worker caches the shell, fonts, OSM tiles and exported model. Account
loading and saving still require the API; offline writes are not queued.

---

## 5. Smoke test after deploy

```bash
# Read-only connection checks; do not put passwords in shell history.
curl --fail https://<api>.vercel.app/api/health
curl --fail https://<ml>/health
```

Open the frontend, register a dedicated test account, complete onboarding, log an
activity, save a prediction, sign out and sign back in. Verify the activity and
plan persist and that a second account cannot access them. Use disposable test
data and remove it through the app when appropriate. A successful health check
alone does not prove end-to-end integration.

---

## 6. Environment matrix

| Variable | frontend | backend | ml |
| --- | :---: | :---: | :---: |
| `VITE_API_BASE_URL` | ✅ | | |
| `VITE_ORS_API_KEY` (optional) | ✅ | | |
| `APP_KEY`, `APP_ENV`, `APP_DEBUG`, `APP_URL` | | ✅ | |
| `DB_*`, `DB_SSLMODE` | | ✅ | |
| `CORS_ALLOWED_ORIGINS` | | ✅ | |
| `ML_API_URL`, `ML_TIMEOUT` | | ✅ | |
| `ML_API_TOKEN` (same secret) | | ✅ | ✅ |
| `ML_ADMIN_TOKEN` | | ✅ (reload) | |
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
