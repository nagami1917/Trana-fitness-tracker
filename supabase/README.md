# Supabase (Laravel + PostgreSQL)

TRANA uses Supabase as a PostgreSQL database. Laravel and Sanctum own
authentication; the browser does not connect to the Supabase Data API or hold a
database password.

## Configure the Laravel connection

1. Open your Supabase project and choose **Connect → Session pooler**. Copy the
   **host**, **port**, **database**, and **username** shown there. Do not guess
   the pooler hostname from the region; it can vary by project. The shared
   session pooler uses port `5432`.
2. Edit `backend/.env`. If it does not exist yet, copy `backend/.env.example`
   first; never overwrite an existing `.env` containing your settings. Replace
   the clearly marked placeholders below with your own project details:

   ```dotenv
   DB_CONNECTION=pgsql
   DB_HOST=YOUR_SESSION_POOLER_HOST
   DB_PORT=5432
   DB_DATABASE=postgres
   DB_USERNAME=YOUR_SESSION_POOLER_USERNAME
   DB_PASSWORD=YOUR_DATABASE_PASSWORD
   DB_SSLMODE=require
   ```

   `DB_HOST` is the host **only**: no `https://`, brackets, port, path, or full
   connection string. Copy `DB_USERNAME` exactly from the session pooler
   (typically `postgres.<project-ref>`). `DB_DATABASE` is normally `postgres`;
   verify it in the dashboard. Enter your database password privately; it is
   **not** an API key or your Supabase account password.
3. Laravel's PostgreSQL and SQLite connection configurations deliberately ignore
   `DB_URL` and `DATABASE_URL` so that the individual `DB_*` values above are
   used. Remove or comment out any old URL variables in `backend/.env` to avoid
   confusion. The separate Python training service may use `DATABASE_URL`.
4. Run `php artisan config:clear`, then `php artisan migrate:status` to verify the
   connection. Run `php artisan migrate` for outstanding migrations; do not
   reapply the SQL baseline to an existing database. Generate `APP_KEY` with
   `php artisan key:generate` only when setting up a new `.env`.

The connected Trana project has already received the baseline migration.
The default seeder no longer creates a shared account or sample activities, and
the demo sign-in/reset routes have been removed. Existing database records are
not altered by these code changes; inspect any legacy sample accounts separately
before deciding whether to remove them.
The SQL test in `supabase/tests/verify_security.sql` checks RLS, view security,
Data API grants, sequences, and migration records.

## Initializing another database

Choose **one** of these methods, and only apply the SQL baseline to a new, empty
database. The SQL records the equivalent Laravel migrations so that subsequent
`php artisan migrate` runs do not recreate existing tables.

* Let Laravel create the schema: configure `DB_*` and run `php artisan migrate`.
* Apply `supabase/migrations/20261108105133_trana_laravel_baseline.sql` as a
  single transaction, or use the equivalent source files with:

  ```bash
  psql "$SUPABASE_DB_URL" -1 \
    -f supabase/sql/001_schema.sql -f supabase/sql/002_rls.sql
  ```

For an **existing** Laravel database, use Laravel migrations instead of the SQL
baseline. Never run `migrate:fresh` or reapply the baseline to a database with
real data; rolling back the baseline is destructive too. The SQL baseline requires
PostgreSQL 15+ for security-invoker views.

## Security

The database connection should use the Supabase `postgres` database role (or a
properly provisioned backend-only role with the necessary privileges and RLS
access). The baseline enables RLS on application and Laravel infrastructure
tables, revokes Data API access from `anon` and `authenticated`, and makes views
security-invoker. Laravel enforces per-user authorization with Sanctum. Supabase
Auth is not wired into this app; adding policies comparing its UUIDs with
Laravel's integer user IDs would not be sufficient.

The analytical views `v_athlete_pace`, `v_daily_totals`, and
`v_prediction_accuracy` are included in the SQL baseline and available to the
backend database role. They are not exposed to browser Data API roles.
