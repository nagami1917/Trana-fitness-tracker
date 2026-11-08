# TRANA API (Laravel 11 + Sanctum)

```bash
composer install
# Only for a new environment; never overwrite an existing .env / APP_KEY.
if [ ! -f .env ]; then
  cp .env.example .env
  php artisan key:generate
fi
# Set DB_* (including the private database password) and ML_API_URL in .env.
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
contains the front controller required by `php artisan serve`.

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
* **Auth**: Sanctum personal access tokens (`Authorization: Bearer …`). Token
  abilities are ready for scoped apps (`activity:write`, `prediction:read`).
* **Prediction**: Laravel owns no model. It gathers history, calls FastAPI, shapes
  the response for the Svelte client and stores the full payload for auditing.
* **Data**: Registration creates a real user and default profile/goals. There are
  no demo sign-in/reset routes, and the default seeder creates no sample records.
* **Rate limits**: auth 10/min/IP, predictions 60/min/user.
* **Deploy**: `vercel.json` + `api/index.php` give a serverless PHP entry point;
  any Laravel host works too.

## Testing

```bash
composer install
php artisan test
```

The suite runs against in-memory SQLite (`phpunit.xml`) and fakes the FastAPI
service at the HTTP boundary (`Http::fake()`), so it needs no Python process or
network. See `tests/Feature/PredictionCreationTest.php` — it locks in the
contract that saved predictions persist the *effective* distance (a drawn route
wins over a typed one), and that prediction outages return 503 without storing
half-finished rows. `LiveAccountTest` covers real registration, tokens, per-user
isolation, pagination, health checks, and seeding behavior. Production still
targets PostgreSQL; these tests use SQLite and do not prove a Supabase deployment.

## Useful commands

```bash
php artisan migrate                 # apply outstanding schema changes
php artisan route:list --path=api   # inspect endpoints
php artisan test
```
