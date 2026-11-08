# Database

TRANA stores app data in **Supabase PostgreSQL** (Laravel is configured for
`pgsql` in `backend/.env`). The schema is managed exclusively by Laravel
migrations in `backend/database/migrations/`. A one-time SQL baseline can also
initialize a new empty project; see `supabase/README.md`.

## Tables

### `users` (+ `sessions`)
Laravel's default user table: name, email (unique), password (bcrypt), remember token.

### `fitness_profiles`
One row per athlete, auto-created on first use (`User::ensureProfile()`).

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | FK → users, unique | cascade on delete |
| `weight_kg` | decimal(5,2) | drives the MET/fueling math |
| `height_cm` | decimal(5,1), nullable | |
| `birth_year` | smallint, nullable | `age()` computes from it |
| `sex` | string(16) | `female`/`male`/`other` |
| `sweat_profile` | string(16) | `low`/`normal`/`high` — sodium & fluid rates |
| `experience_level` | tinyint | 1–5; auto-synced from activity count |
| `typical_temperature_c` | decimal(4,1) | default 26; heat adjustment |
| `city`, `units` | string | profile display + metric/imperial |
| `onboarded_at` | timestamptz, nullable | null → app routes to /onboarding |

### `activities`
The athlete's training log — the *only* source of truth for pace history.

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | FK → users | cascade on delete |
| `activity_type` | string(16) | `run` · `ride` · `walk` · `hike` |
| `distance_km` | decimal(8,3) | |
| `elevation_gain_m` | uint | |
| `duration_min` | decimal(8,2) | |
| `calories` | uint, nullable | estimated from MET when omitted (`ActivityService::estimateCalories`) |
| `avg_heart_rate` | smallint, nullable | |
| `started_at` | timestamptz | index `(user_id, started_at)` |
| `route` | jsonb, nullable | `[[lat, lng], …]` when drawn |
| `source` | string(24) | `manual` / `import` … |

Indexes: `(user_id, started_at)`, `(user_id, activity_type)`.

### `predictions`
Saved plans produced by the ML pipeline (see [ml-methodology.md](ml-methodology.md)).

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | FK → users | |
| `activity_type`, `distance_km`, `elevation_gain_m`, `route` | | snapshot of the request |
| `planned_for` | timestamptz, nullable | when the session is planned |
| `status` | string(16) | `planned`/`completed`/`cancelled` |
| `duration_min`, `duration_low_min`, `duration_high_min` | decimal | predicted interval (q10–q90) |
| `confidence` | decimal(4,3) | from interval width |
| `calories`, `carbs_per_hour_g`, `carbs_total_g` | | fueling targets |
| `sodium_per_hour_mg`, `fluid_per_hour_ml` | | |
| `intensity`, `met` | string/decimal | intensity band + MET used |
| `payload` | jsonb | full client-shaped recommendation |
| `model_version` | string(40) | which artifact produced this |

### `goals`
One row per athlete (`User::ensureGoals()`): `daily_calories`, `daily_distance_km`,
`daily_active_min`, `weekly_calories`, `weekly_distance_km`, `carb_target_g`.

### `personal_access_tokens`
Sanctum bearer tokens (API auth). Also the standard `cache` / `jobs` tables
from the skeleton; both are used only if `CACHE_STORE=database` / `QUEUE_CONNECTION=database`.

## Relationships

```
users 1──1 fitness_profiles
users 1──1 goals
users 1──N activities
users 1──N predictions
```

## Seeding

The default seeder creates no users or activities. Register accounts through
Laravel instead. Existing data is not deleted or migrated by seeding. Backend
tests use in-memory SQLite with `RefreshDatabase`; they never touch Postgres.

## Spec-compatible views

The original product spec names the persistence layer `users` / `user_profiles` /
`activities` / `planned_activities` / `nutritional_predictions` (+ optional
`activity_routes` / `user_goals` / `prediction_history`). TRANA ships the richer
real schema above; the migration `backend/database/migrations/2026_11_08_000001_create_spec_compatibility_views.php`
(and `supabase/sql/001_schema.sql`, identical definitions) exposes the spec names as
**read-only views** — no data is duplicated and all writes keep flowing through the API:

| Spec view | Definition (source columns) |
| --- | --- |
| `user_profiles` | `fitness_profiles` — full athlete profile (weight, sweat profile, experience…) |
| `planned_activities` | `predictions` — the plan side: distance/route, planned_for, status, predicted interval, `payload`, `model_version` |
| `nutritional_predictions` | `predictions` — the fueling side: `prediction_id`, calories, carbs/h + total, sodium, fluid, intensity, MET |
| `activity_routes` | `activities WHERE route IS NOT NULL` — `activity_id`, `user_id`, distance/elevation/time, `route` jsonb |
| `user_goals` | `goals` — calorie/distance/active-minute/carb targets (daily & weekly) |
| `prediction_history` | `predictions` — `id`, `status`, `planned_for`, `model_version`, timestamps (history of the plan lifecycle) |

Notes:

- Views are projections for trusted SQL/BI clients; Supabase `anon` and
  `authenticated` Data API roles have no access. On Postgres 15+ they also use
  `security_invoker` so underlying RLS applies to callers.
- `migrate:fresh` is destructive and must never be run on a production database;
  SQLite tests start with a fresh in-memory database.
- Nutrition is stored **once** (columns + `payload.fueling` of `predictions`) — the views are alternative projections, not copies.
