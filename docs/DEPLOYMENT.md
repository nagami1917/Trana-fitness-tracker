# Deployment guide

TRANA consists of **Supabase Postgres**, a **Laravel API**, a **FastAPI ML
service**, and the **Svelte PWA**. Hosting options below are examples, not a
claim that this deployment has been tested.

**Not production-ready yet:** Laravel 11 is end-of-life and this repository
currently suppresses unresolved Laravel security advisories. Upgrade and audit
the framework and dependencies before accepting real users. Backups/restore
testing, monitoring, privacy/consent, and a real-world validation of the
prediction model also need work. The new Gmail/password/OTP flow is implemented,
but live email delivery is not tested until a real provider is configured with
private `MAIL_*` credentials in the deployment environment. Cookie/CORS settings
must also match the deployed frontend and API origins.

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
| `CORS_ALLOWED_ORIGINS` | Exact comma-separated frontend origins (scheme and port included) |
| `TRANA_COOKIE_SAME_SITE` | `none` for cross-site frontend/API deployments, otherwise `lax` |
| `TRANA_AUTH_COOKIE_MINUTES` | Optional; default is 720 minutes |
| `TRANA_COOKIE_DOMAIN` | Optional; leave blank for host-only API cookies unless a shared parent domain is required |
| `MAIL_MAILER`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME` | Provider SMTP settings; store credentials only in deployment secrets |
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

### Browser cookies, CORS, and CSRF

The API stores the Sanctum access token in the `trana_session` HttpOnly cookie;
JavaScript never reads it and the login response never includes it. Production
cookies are Secure and default to `SameSite=Lax`. If the frontend and API are on
different sites, configure `TRANA_COOKIE_SAME_SITE=none` (HTTPS is required) and
keep `TRANA_COOKIE_DOMAIN` blank unless both hosts share a domain where a shared
cookie is intentionally needed. The current Vercel aliases are
`https://trana-web.vercel.app` (frontend) and `https://trana-api.vercel.app`
(API), so set `TRANA_COOKIE_SAME_SITE=none` in the API's production environment;
`backend/.env.example` lists the matching frontend CORS origin. For cross-site
deployments, browser third-party cookie policies can still interfere; a same-site
custom domain is more reliable.

Set `CORS_ALLOWED_ORIGINS` to the exact deployed frontend origin(s), including
the scheme and any port. Do not use a wildcard with credentialed browser
requests. The frontend sends `credentials: include`, fetches `/api/auth/csrf`,
and echoes the returned value in `X-CSRF-TOKEN` on writes. API writes carrying
TRANA cookies reject missing/mismatched CSRF tokens and untrusted `Origin`
headers, including login/signup requests. Preview domains need explicit origins
or should be disabled for authenticated testing.

### Mail delivery (signup, password reset, and account deletion)

Configure a real provider with `MAIL_MAILER`, `MAIL_SCHEME`, `MAIL_HOST`,
`MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS`, and
`MAIL_FROM_NAME` from `backend/.env.example`. Replace sample values with your
provider's settings and verified sender identity. Production rejects the
`log`/`array` mailers and placeholder SMTP host/sender values. Gmail SMTP needs
a Google App Password; do not use a regular Gmail account password. Keep all
provider credentials only in the deployment secret manager—never in Git or a
`VITE_*` variable.

Keep `APP_KEY` stable: it is the HMAC key for stored OTP hashes. Apply the
`email_otp_challenges` table and its RLS/revoke migration. Signup verification
and password-reset codes expire in five minutes; deletion codes expire in ten.
All codes are single-use, allow five failed attempts, and share a 60-second
per-address resend cooldown plus a five-send hourly limit. Configure provider
credentials before testing delivery; this repository has no production mail
credentials, so live sending is not yet verified. After configuration, test
signup, resend, and password recovery with an operator-controlled Gmail account
and check Spam/Promotions. If delivery fails, verify credentials, sender-domain
verification, SMTP connectivity, and provider logs.

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

When `VITE_API_BASE_URL` points to a different site, configure the API's exact
CORS origin and `TRANA_COOKIE_SAME_SITE=none`; HTTPS and credentialed fetches are
required for the HttpOnly auth cookie. Prefer a same-site custom domain because
some browsers block third-party cookies.

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

Open the frontend, create a dedicated Gmail/password account, verify the
six-digit code, complete onboarding, log an activity, save a prediction, log out,
and sign in again. Verify that the activity and plan persist, password recovery
sends and accepts a one-time code, and a second account cannot access the data.
Use disposable test data and remove it through the app when appropriate. A
successful health check alone does not prove end-to-end integration.

---

## 6. Environment matrix

| Variable | frontend | backend | ml |
| --- | :---: | :---: | :---: |
| `VITE_API_BASE_URL` | ✅ | | |
| `VITE_ORS_API_KEY` (optional) | ✅ | | |
| `APP_KEY`, `APP_ENV`, `APP_DEBUG`, `APP_URL` | | ✅ | |
| `DB_*`, `DB_SSLMODE` | | ✅ | |
| `CORS_ALLOWED_ORIGINS`, `TRANA_COOKIE_*` | | ✅ | |
| `MAIL_*` | | ✅ | |
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
| Browser login returns `419` | Refresh the page to bootstrap CSRF again; check that cookies are included and the `X-CSRF-TOKEN` matches the CSRF cookie. |
| Cookie is missing on cross-site API calls | Use HTTPS, set `TRANA_COOKIE_SAME_SITE=none`, allow credentials for the exact CORS origin, and consider a same-site custom domain. |
| Signup/reset email is not delivered | Verify `MAIL_*` provider credentials, sender/domain verification, SMTP connectivity, and provider logs; live delivery requires deployment credentials. |
| Browser request returns `403` | Check that `Origin` exactly matches an entry in `CORS_ALLOWED_ORIGINS`; unverified accounts must confirm the email OTP first. |
| `429` on auth | Auth is limited to 10 requests/min/IP; OTP resends also have per-address cooldown/hourly caps. |
