# Deployment guide

TRANA consists of **Supabase Postgres**, a **Laravel API**, a **FastAPI ML
service**, and the **Svelte PWA**. Hosting options below are examples, not a
claim that this deployment has been tested.

**Not production-ready yet:** Laravel 11 is end-of-life and this repository
currently suppresses unresolved Laravel security advisories. Upgrade and audit
the framework and dependencies before accepting real users. Backups/restore
testing, monitoring, privacy/consent, and a real-world validation of the
prediction model also need work. Google sign-in is not live until a Google
OAuth Web client is configured for the deployed frontend and its matching client
ID is set in both frontend and backend environments. Account deletion still
depends on a real mail provider configured as described below.

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
| `GOOGLE_CLIENT_ID` | Google OAuth Web client ID; match the frontend `VITE_GOOGLE_CLIENT_ID` exactly |
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

### Google sign-in (required for account creation and sign-in)

1. In Google Cloud, configure the OAuth consent screen / Google Auth Platform
   and create an OAuth client with application type **Web application**.
2. Add each exact frontend origin under **Authorized JavaScript origins**:
   local development (for example `http://localhost:5173`), production, and any
   preview domain where sign-in should work. Google's popup button flow does not
   need an OAuth redirect URI.
3. Set `GOOGLE_CLIENT_ID` in the Laravel environment and the identical
   `VITE_GOOGLE_CLIENT_ID` in the frontend's Vercel build environment. The client
   ID is public configuration; do not add a Google client secret to the app.
   Rebuild the frontend after changing its `VITE_` variable and clear Laravel's
   config cache after changing the backend setting.
4. Keep the frontend origin in `CORS_ALLOWED_ORIGINS`, then apply all outstanding
   Laravel migrations, including `google_sub` on `users`.

The API issues a short-lived nonce and verifies the Google-signed ID token,
audience, issuer, expiry, verified email and nonce before creating/linking an
account. After deployment, test both account creation and returning sign-in with
an operator-controlled Google account. A health check alone does not prove that
Google sign-in is configured correctly.

### Mail delivery (account deletion only)

Normal registration and sign-in use Google; they do not depend on email delivery.
The API still sends a six-digit email code for the separate account-deletion
confirmation. Configure a real provider using `MAIL_MAILER`, `MAIL_SCHEME`,
`MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS`,
and `MAIL_FROM_NAME` from `backend/.env.example`. Replace all sample values
with the provider's settings and sender identity. Production rejects the
`log`/`array` mailers and placeholder SMTP host/sender values. Do not use a Gmail
account password; if SMTP authentication is required, create a provider-specific
credential and keep it only in the deployment secret manager.

Keep `APP_KEY` stable: it is used as the HMAC key for account-deletion codes.
Apply the `email_otp_challenges` table and its RLS/revoke migration before
relying on self-service deletion. Test delivery with an operator-controlled
account (also check Spam/Promotions); a successful sign-in does not test the mail
provider. If deletion-code delivery fails, verify provider credentials,
sender-domain verification, SMTP connectivity and provider logs. Deletion codes
expire in 10 minutes, allow five attempts, and are limited to five sends per
email per hour with a 60-second resend cooldown.

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
| `VITE_GOOGLE_CLIENT_ID` | Same public Google OAuth Web client ID as the Laravel `GOOGLE_CLIENT_ID` |
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

Open the frontend, create a dedicated test account with Google, complete
onboarding, log an activity, save a prediction, sign out and sign back in with
the same Google account. Verify the activity and plan persist and that a second
account cannot access them. Use disposable test
data and remove it through the app when appropriate. A successful health check
alone does not prove end-to-end integration.

---

## 6. Environment matrix

| Variable | frontend | backend | ml |
| --- | :---: | :---: | :---: |
| `VITE_API_BASE_URL`, `VITE_GOOGLE_CLIENT_ID` | ✅ | | |
| `VITE_ORS_API_KEY` (optional) | ✅ | | |
| `APP_KEY`, `APP_ENV`, `APP_DEBUG`, `APP_URL`, `GOOGLE_CLIENT_ID` | | ✅ | |
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
| Google sign-in button is unavailable | Verify matching `GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID` values, the Google-authorized frontend origin, and access to Google's Identity Services script. |
| `503` from Google auth | Check the backend client ID and outbound access to Google's signing-key endpoint. |
| `429` on auth | Auth is limited to 10 requests/min/IP — expected during automated testing. |
