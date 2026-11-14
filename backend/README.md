# TRANA API (Laravel 11 + Sanctum)

```bash
composer install
# Only for a new environment; never overwrite an existing .env / APP_KEY.
if [ ! -f .env ]; then
  cp .env.example .env
  php artisan key:generate
fi
# Set DB_* (including the private database password), ML_API_URL, CORS_ALLOWED_ORIGINS,
# TRANA_COOKIE_SAME_SITE and MAIL_* in .env. Keep mail-provider credentials in
# the deployment environment only; see ../docs/DEPLOYMENT.md.
# See ../supabase/README.md for the session-pooler settings.
php artisan config:clear
php artisan migrate:status
php artisan migrate
php artisan serve --host=0.0.0.0 --port=8001
```

Base URL: `http://localhost:8001/api` · full reference in [`../docs/api.md`](../docs/api.md).
After starting the server, visit `http://localhost:8001/up` to check that the
Laravel HTTP entry point is responding. `GET /api/health` also checks the
database connection without exposing its credentials. The `public/` directory
contains the front controller required by `php artisan serve`. On Windows, if
`artisan serve` reports `Failed to listen ... (reason: ?)` on otherwise free
ports, try adding `--no-reload`; restart the server after editing `.env`.

## Layout

```
app/
  Http/Controllers/Api/   Auth · Profile · Activity · Prediction · Goal
  Http/Requests/          validation for auth, profile, activities, predictions
  Models/                 User · FitnessProfile · Activity · Prediction · Goal
  Services/
    MlClient              HTTP client for the FastAPI service
    PredictionService     history assembly, haversine, snake_case → camelCase
    AnalyticsService      rollups, streaks, personal bests, weekly series
  Console/Commands/       trana:retrain (explicit, not scheduled)
routes/api.php            all endpoints, throttled
database/migrations/      Postgres schema + Supabase Data API lockdown
database/seeders/         no sample accounts or activities are seeded
```

## Notes

* **PostgreSQL only.** `DB_CONNECTION=pgsql`; use the Supabase pooler host behind
  serverless hosts.
* **Database URLs**: the PostgreSQL and SQLite connections ignore `DB_URL` and
  `DATABASE_URL`; configure the individual `DB_*` values instead. The separate
  ML training service can still use its own `DATABASE_URL`.
* **Auth**: users register with a unique username, Gmail address, and bcrypt
  password, then verify a six-digit email OTP. Sanctum personal-access tokens
  are returned only in HttpOnly cookies for browser sessions (Secure in
  production). The API's double-submit CSRF middleware validates allowlisted
  `Origin` headers and CSRF tokens for cookie-authenticated writes. Trusted
  non-browser clients can continue to use bearer tokens. Signup, login, and OTP
  endpoints are rate-limited; OTPs are purpose-bound, short-lived, and stored as
  keyed hashes. Configure `MAIL_*` in the deployment environment for delivery.
  Token abilities are ready for scoped apps (`activity:write`, `prediction:read`).
* **Prediction**: Laravel owns no model. It gathers history, calls FastAPI, shapes
  the response for the Svelte client and stores the full payload for auditing.
* **Data**: Email verification activates the account and creates default
  profile/goals. Signup/password-reset codes use a five-minute expiry; the
  separate account-deletion code retains its ten-minute expiry. The default
  seeder creates no sample records.
* **Rate limits**: auth 10/min/IP, predictions 60/min/user.
* **Deploy**: `vercel.json` + `api/index.php` give a serverless PHP entry point;
  any Laravel host works too.

## Testing

```bash
composer install
php artisan test
python3 scripts/test_stateless_api_http.py
```

The PHPUnit suite runs against in-memory SQLite (`phpunit.xml`) and fakes the
FastAPI and mail boundaries, so it needs no ML service, provider credentials,
or network. The HTTP smoke test uses Python's standard library and an isolated
temporary SQLite database to exercise real browser-origin requests, HttpOnly
cookie auth, and CSRF/origin checks. It does not read the checkout's `.env` or
modify its database. `EmailPasswordAuthTest` covers Gmail/username constraints,
bcrypt storage, verification OTP expiry/attempts/resends, generic login errors,
HttpOnly cookies, password reset, and token revocation. `AccountDeletionTest`
covers the separate email-code safeguard. `PredictionCreationTest.php` locks in
the contract that saved predictions persist the *effective* distance (a drawn
route wins over a typed one), and that prediction outages return 503 without
storing half-finished rows. `LiveAccountTest` covers verified-account access,
tokens, per-user isolation, pagination, health checks, and seeding behavior.
Production still targets PostgreSQL; these tests use SQLite and do not prove a
Supabase deployment or live SMTP delivery.

## Useful commands

```bash
php artisan migrate                 # apply outstanding schema changes
php artisan route:list --path=api   # inspect endpoints
php artisan test
```
