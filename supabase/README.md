# Supabase (PostgreSQL)

TRANA uses **Supabase Postgres** exclusively — there is no MySQL anywhere in the
stack.

```
supabase/sql/001_schema.sql   tables, constraints, indexes, analytical views
supabase/sql/002_rls.sql      row-level security (defence in depth)
```

## Apply the schema

**SQL editor (fastest):** open the Supabase dashboard → SQL Editor, paste
`001_schema.sql`, run it, then paste `002_rls.sql`.

**CLI:**

```bash
supabase link --project-ref <your-project-ref>
psql "$SUPABASE_DB_URL" -f supabase/sql/001_schema.sql
psql "$SUPABASE_DB_URL" -f supabase/sql/002_rls.sql
```

**From Laravel** (after setting the `DB_*` variables in `backend/.env`):

```bash
cd backend && php artisan migrate --seed
```

Both paths produce the same tables. Pick one — Laravel migrations for day-to-day
development, the SQL files when you want the database to exist before the API.

## Connection settings for the Laravel API

Supabase → *Project Settings → Database → Connection string → URI*:

```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Because the API runs on Vercel (serverless, many short-lived processes), use the
**session pooler** host (`...pooler.supabase.com:5432`) and keep
`DB_SSLMODE=require`. For long-running workers the direct host on port `5432` is
fine.

## Views worth knowing

| View | What it is for |
| --- | --- |
| `v_athlete_pace` | per-athlete, per-modality reference speed — the ML model's anchor |
| `v_daily_totals` | dashboard rollups (distance, minutes, calories per day) |
| `v_prediction_accuracy` | predicted vs. actual duration, used to monitor drift |
