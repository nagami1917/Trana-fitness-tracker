# Database

TRANA stores app data in **Supabase PostgreSQL** (Laravel is configured for
`pgsql` in `backend/.env`). The schema is managed exclusively by Laravel
migrations in `backend/database/migrations/` — never edit tables by hand.

## Tables

### `users` (+ `password_reset_tokens`, `sessions`)
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

`php artisan db:seed` creates a demo athlete via `DemoSeeder` (32 activities over
the past months, matching the frontend demo fixtures in `frontend/src/services/seed.js`).
Backend tests use in-memory SQLite with `RefreshDatabase` — they never touch Postgres.
