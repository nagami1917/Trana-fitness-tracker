# Supabase (Laravel + PostgreSQL)

TRANA uses the **Trana** Supabase project (`tlqyvjhlesmackmcrzyg`) as a
PostgreSQL database. Laravel and Sanctum continue to own authentication; the
browser does not connect to the Supabase Data API or hold a database password.

## Finish configuring the Laravel connection

1. In the Supabase dashboard, open **Connect → Session pooler** and copy the
   exact host, port and username. The pooler host cannot be inferred from the
   region. For the direct connection, the known host is
   `db.tlqyvjhlesmackmcrzyg.supabase.co`, port `5432`, username `postgres`;
   the direct endpoint requires IPv6 unless the project has the IPv4 add-on.
2. In `backend/.env` (copy `.env.example` if it does not exist), set `DB_HOST`,
   `DB_PORT`, `DB_DATABASE`, `DB_USERNAME` and `DB_PASSWORD` from that connection
   string. Keep `DB_CONNECTION=pgsql` and `DB_SSLMODE=require`. For the shared
   session pooler, the username is normally `postgres.<project-ref>`, and the
   port is `5432`.
3. Keep the **database password** in the ignored `.env` file or your hosting
   provider's secret settings. Do not put it in frontend `VITE_*` variables or
   commit it. A Supabase publishable/anon key is **not** the database password.
4. Run `php artisan migrate:status` to verify the connection, followed by
   `php artisan migrate` for future migrations. Set `APP_KEY` with
   `php artisan key:generate` if the backend environment does not already have one.

The connected Trana project has already received the baseline migration; it
contains empty application tables and Laravel migration records, not demo data.
The backend demo endpoint can create a shared account with known default
credentials in non-production environments. Use it only with an isolated demo
database, and do not seed that account into a real production database.
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
