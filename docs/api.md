# TRANA API reference

Base URL: `https://<your-api>/api`
Auth: `Authorization: Bearer <sanctum-token>` except for `/health`, `/docs`, `/auth/register`, `/auth/login`, and `/auth/otp/verify`.
The API does not authenticate with session cookies or use CSRF cookies. Do not
add cookie-based API authentication without enabling appropriate CSRF protection.
Responses are JSON; collections are wrapped in `{ "data": [...] }`.

---

## Health

`GET /health` returns `{ "status": "ok" }` if Laravel can connect to its
configured database, or a generic `503` without connection details if it cannot.
This does not check FastAPI or verify that all migrations are applied.

## Auth

TRANA uses **passwordless email OTP**. It never asks for, receives, or stores a
Google/Gmail password; auth and account-erasure endpoints reject a `password`
field. Email codes are six digits, expire after 10 minutes, are
single-use, and are stored as keyed hashes. Five wrong attempts invalidate a
code. Re-sending an active code for the same purpose is delayed by 60 seconds;
requesting a different-purpose code replaces the active challenge. No more than five
codes can be sent to one email per hour, including codes that were used
successfully. Configure a real SMTP/transactional mail provider for the
Laravel API; production refuses the development-only `log` and `array` mailers.

### `POST /auth/register`
```json
{ "name": "Nagami", "email": "nagami@gmail.com" }
```
`202` → `{ "message": "A six-digit code was sent to your email. It expires in 10 minutes." }`.
The account and profile are created only after the code is verified. New sign-up
is limited to `@gmail.com` addresses (case-insensitive; stored lowercase); other
domains receive `422` on `email`. The request never accepts a password.
`429` means the per-email send limit is active; `503` means mail delivery failed
or is not configured.

### `POST /auth/login`
```json
{ "email": "nagami@gmail.com" }
```
`202` always has the same generic message whether or not the account exists.
For an eligible, active account, TRANA sends a six-digit code. Existing accounts
with other email domains can still sign in. Suspended accounts receive `403`.

### `POST /auth/otp/verify`
```json
{ "email": "nagami@gmail.com", "code": "042817" }
```
`200` → `{ "token": "1|abc…", "user": { "id": 1, "name": "Nagami",
"email": "nagami@gmail.com", "email_verified_at": "…" } }`. The code must be
exactly six digits, including any leading zeroes. Wrong, expired, used, or
exhausted codes receive `422`. Verification creates a new account when the
challenge came from sign-up; otherwise it signs in the existing account and
confirms its email address. Only a verified code creates a bearer token.

### `GET /auth/me` → `{ user: {...} }` · `POST /auth/logout` → `{ message }`

Authenticated routes require a verified email. Old tokens belonging to
unverified accounts are revoked and must be replaced by an OTP sign-in.

### Account erasure (authed)

`POST /account/delete-code` emails a separate one-time code before deletion.
`202` on send · `429` on cooldown/rate limit · `503` on mail failure.

`DELETE /account` requires both the code and explicit confirmation:
```json
{ "code": "042817", "confirmation": "DELETE" }
```
`200` deletes the account and associated data · `422` for an invalid/expired
code or missing confirmation. Export data first with
[`GET /activities/export`](#get-activities-export).

---

## Profile

The athlete's fitness profile (spec step 4). One row per account, created on
registration. Its values are attached to every prediction.

Spec fields: `id, user_id, age, sex, height_cm, weight_kg, fitness_level,
activity_experience, created_at, updated_at`. Responses also include the richer
settings that share the same row (`birth_year, sweat_profile, experience_level,
typical_temperature_c, city, units`, goal targets, `onboarded`,
`total_activities`).

`age` is derived from `birth_year`, and `fitness_level` is the stored 1–5
`experience_level` — both are returned in every profile response and accepted on
write (send `age` instead of `birth_year`, `fitness_level` instead of
`experience_level`).

### `GET /profile` — view

Creates a default row on first call so the client always has a profile.
```json
{
  "data": {
    "id": 1, "name": "Nagami", "email": "nagami@trana.app",
    "weight_kg": 55, "height_cm": 162, "birth_year": 1999, "age": 27,
    "sex": "female", "sweat_profile": "normal",
    "fitness_level": 4, "fitness_level_source": "user", "activity_experience": 6.5,
    "experience_level": 4,
    "typical_temperature_c": 27, "city": "Quezon City, PH", "units": "metric",
    "daily_calorie_goal": 2700, "daily_distance_goal_km": 10, "daily_active_min_goal": 90,
    "weekly_calorie_goal": 15000, "weekly_distance_goal_km": 45,
    "daily_carb_goal_g": 330, "onboarded": true, "total_activities": 32
  }
}
```

### `POST /profile` — create

```json
{ "weight_kg": 55, "height_cm": 162, "sex": "female", "age": 27,
  "fitness_level": 4, "activity_experience": 6.5 }
```
`weight_kg` is required; everything else is optional and falls back to the
column defaults. `201` → the full profile. `409` if this account already has one
(edit it with `PUT`/`PATCH` instead); the existing profile is returned in `data`.

### `PUT|PATCH /profile` — edit any subset

Accepts any subset of:
`name, age (or birth_year), sex(female|male|other), height_cm, weight_kg,
fitness_level (or experience_level, 1-5), activity_experience (0-70 years),
sweat_profile(low|normal|high), typical_temperature_c, city, units,
daily_calorie_goal, daily_distance_goal_km, daily_active_min_goal,
weekly_calorie_goal, weekly_distance_goal_km, daily_carb_goal_g, onboarded`.
Sending `age: null` clears the birth year.

### `PATCH /profile/weight` — update body mass only

```json
{ "weight_kg": 62.5 }
```
`200` → full profile · `422` outside 25–250 kg. This is the value the MET/fueling
math reads, so it can be updated without resending the rest of the profile.

### `PATCH /profile/fitness-level` — update the 1–5 level only

```json
{ "fitness_level": 4 }
```
`200` → full profile · `422` outside 1–5. A level set by the athlete sets
`fitness_level_source` to `user`, and logging activities no longer overwrites it
with the session-count heuristic. Send `{ "source": "auto" }` to hand the level
back to that heuristic; it is recomputed immediately.

---

## Activities

### `GET /activities?type=run&q=trail&from=2026-10-01&to=2026-11-08&limit=200&page=1`
```json
{
  "data": [{
    "id": 42, "activity_type": "run", "distance_km": 10.1, "elevation_gain_m": 60,
    "duration_min": 58.4, "calories": 612, "avg_heart_rate": 152,
    "started_at": "2026-11-05T06:40:00+08:00",
    "route": [[14.67, 121.04], [14.68, 121.05]], "notes": null, "source": "manual"
  }],
  "meta": { "current_page": 1, "last_page": 1, "per_page": 200, "total": 1 }
}
```

The default page size is 200 (maximum 500). Request subsequent pages until
`current_page == last_page`.

### `POST /activities`
```json
{
  "activity_type": "run",
  "distance_km": 8.2,
  "duration_min": 47,
  "elevation_gain_m": 55,
  "started_at": "2026-11-07T06:30:00+08:00",
  "route": [[14.676, 121.043]],
  "notes": "felt strong"
}
```
`201` → `{ data: { …activity } }`. `calories` is computed server-side (MET formula)
when omitted. Adding an activity re-buckets `experience_level` only while the athlete has not set a fitness level themselves (source `auto`).
Once the athlete has imported enough wearable samples, the stored calories are
scaled by their calibration factor — see
[Energy expenditure](#energy-expenditure).

### `GET /activities/{id}` · `DELETE /activities/{id}` → `{ deleted: true }`

### `GET /activities/export`
Downloads the full history as `text/csv` (`Content-Disposition: attachment`).
Columns: `id, activity_type, started_at, distance_km, duration_min, calories,
elevation_gain_m, avg_heart_rate, source, notes` — newest first. Route
geometry is excluded; every training metric is included.

### `GET /activities/summary`
```json
{
  "data": {
    "totals": { "sessions": 32, "distance_km": 214.6, "duration_min": 1293.4, "calories": 14208, "elevation_gain_m": 4200 },
    "today": { "sessions": 2, "distance_km": 6.6, "duration_min": 39, "calories": 402, "elevation_gain_m": 70 },
    "week": { "…": "…" },
    "streak_days": 7,
    "by_type": [{ "activity_type": "run", "sessions": 18, "distance_km": 132.1 }],
    "weekly_series": [{ "week_start": "2026-08-17", "distance_km": 24.9, "calories": 1580 }],
    "pace_trend": [{ "id": 12, "date": "2026-10-30", "pace_min_per_km": 5.71 }],
    "personal_bests": { "longest": {…}, "biggest_burn": {…}, "fastest_run": {…} }
  }
}
```

---

## Energy expenditure

Wearable energy-expenditure samples (e.g. the WEEE dataset) and the
calibration factor they produce. A watch measures what a session really cost;
TRANA estimates calories from MET. Importing device samples lets the server
measure the gap between the two and scale new estimates by it.

### `GET /energy-expenditure/calibration`
```json
{
  "data": {
    "calibration_factor": 1.0782,
    "sample_count": 3,
    "min_samples": 3
  }
}
```
`calibration_factor` is `1.0` until the athlete has at least `min_samples`
(3) imported samples. Once applied it is the mean of the per-session
`measured / estimated` ratios, clamped to `0.5`–`2.0`.

### `POST /energy-expenditure` — record one sample
```json
{
  "device_type": "garmin",
  "activity_type": "run",
  "distance_km": 5.2,
  "duration_min": 32.5,
  "avg_heart_rate": 158,
  "max_heart_rate": 174,
  "weight_kg": 68,
  "height_cm": 175,
  "age": 30,
  "sex": "male",
  "measured_calories": 420,
  "recorded_at": "2026-11-09T08:00:00+08:00"
}
```
Only `device_type, activity_type, distance_km, duration_min, weight_kg,
measured_calories, recorded_at` are required; the physiological fields are
optional context. The server stores TRANA's own MET estimate for the session
(`trana_estimated_calories`) next to the device value — that pair is what the
calibration ratio is computed from.

`201`
```json
{
  "data": {
    "id": 7,
    "measured_calories": 420,
    "trana_estimated_calories": 331,
    "calibration_factor": 1.0
  }
}
```

### `GET /energy-expenditure?limit=30&page=1`
```json
{
  "data": [
    { "id": 7, "device_type": "garmin", "activity_type": "run", "distance_km": 5.2,
      "duration_min": 32.5, "avg_heart_rate": 158, "max_heart_rate": 174,
      "weight_kg": 68, "height_cm": 175, "age": 30, "sex": "male",
      "measured_calories": 420, "trana_estimated_calories": 331,
      "calibration_factor": 1.0782, "recorded_at": "2026-11-09T00:00:00+00:00" }
  ],
  "meta": { "current_page": 1, "last_page": 1, "per_page": 30, "total": 1 }
}
```
Newest sample first; only the authenticated athlete's rows. Page size defaults
to 30 (maximum 100). `calibration_factor` is the athlete's current factor, not
a per-row value.

**Importing a dataset:** the API records one sample per request. The Svelte
service wraps this in `importBatch(entries)` (`services/energyService.js`),
which posts each entry in turn and returns per-entry results — the Settings
screen's paste-a-CSV importer uses it, as does:

```js
import { importBatch } from './services/energyService.js';

const results = await importBatch([
  { device_type: 'garmin', activity_type: 'run', distance_km: 5.2, /* … */ },
]);
// [{ success: true, data: { … } }, { success: false, entry, error: '…' }]
```

**What calibration changes:** `POST /activities` multiplies the calories it
stores by the factor (the MET estimate when `calories` is omitted, otherwise
the supplied value), so the stats screen's calorie totals reflect the
calibrated value automatically. The factor is `1.0` until 3 samples exist.

---

## Predictions

### `POST /predictions`
```json
{
  "activity_type": "run",
  "distance_km": 21.1,
  "elevation_gain_m": 220,
  "temperature_c": 26,
  "sweat_profile": "high",
  "planned_for": "2026-11-15T05:30:00+08:00",
  "route": [[14.65, 121.02], [14.70, 121.09]]
}
```
If `route` has ≥ 2 points the server measures it (haversine) and uses that distance; the measured route must be 0.1–500 km. The optional `sweat_profile` overrides the profile for this estimate only. The athlete's profile values (age, sex, height, body mass, fitness level, training experience) are sent to the ML service and echoed in the saved plan as `data.profile`.

`201`
```json
{
  "data": {
    "id": 7,
    "activity_type": "run",
    "distance_km": 21.1,
    "elevation_gain_m": 220,
    "route": [[14.65, 121.02], [14.70, 121.09]],
    "planned_for": "2026-11-15T05:30:00+08:00",
    "status": "planned",
    "duration": {
      "minutes": 128.4, "hours": 2.14,
      "low": 115.2, "high": 144.1,
      "paceMinPerKm": 6.09, "speedKmh": 9.86,
      "confidence": 0.81, "referenceSpeedKmh": 10.4,
      "basis": "gradient_boosted_pace_factor"
    },
    "fueling": {
      "intensity": "vigorous", "met": 10.06,
      "calories": { "total": 1240, "perHour": 553, "fromCarbsPct": 60 },
      "carbs": { "perHourG": 60, "totalG": 128, "dailyTargetG": 330, "preSessionG": 55 },
      "sodium": { "perHourMg": 591, "totalMg": 1265 },
      "fluid": { "perHourMl": 715, "totalMl": 1531 },
      "timeline": [
        { "window": "3 h before", "label": "Pre-activity meal", "detail": "66 g carbs, low fibre, moderate protein", "carbsG": 66, "icon": "meal" },
        { "window": "During", "label": "Every 45 min", "detail": "45 g carbs + 536 ml fluid", "carbsG": 45, "icon": "during" }
      ],
      "notes": ["Target 60 g of carbohydrate per hour — roughly 2 gels …"]
    },
    "history_used": 18,
    "model": { "name": "TRANA duration model", "version": "20261108.0405", "metrics": { "r2": 0.9524 } },
    "created_at": "2026-11-08T12:00:00+00:00"
  }
}
```

`503` when the ML service is unreachable:
```json
{ "message": "The prediction service is unavailable right now (HTTP 500).",
  "hint": "A local preview may be available, but saving requires the prediction service." }
```

### `POST /predictions/preview`
Same request body, returns the **raw FastAPI payload** (`snake_case`) without persisting.

### `GET /predictions?status=planned&limit=30&page=1` · `GET /predictions/{id}` · `DELETE /predictions/{id}`

The list includes `meta.current_page`, `last_page`, `per_page`, and `total`.
Default page size is 30; maximum is 100.

### `GET /model`
Model card proxied from the ML service: algorithm, version, metrics, feature importances.

---

## Goals

`GET /goals`
```json
{ "data": { "daily_calories": 2700, "daily_distance_km": 10, "daily_active_min": 90,
            "weekly_calories": 15000, "weekly_distance_km": 45, "carb_target_g": 330 } }
```
`PUT /goals` accepts any subset of the same keys.

`GET /goals/history`
Newest-first list of every goal reached (max 100 rows), written the moment a
daily or weekly target is crossed by a saved activity. Rows carry the
activity's calendar `date` so the UI can group them per day.
```json
{ "data": [ { "date": "2026-11-11", "goal_key": "daily_calories", "target": 2700,
              "achieved_value": 2810.5, "created_at": "2026-11-11T12:10:11+00:00" } ] }
```

---

## Body-weight timeline

### `GET /weight-logs?days=180`
Daily weigh-ins, newest first (window clamped 7–730 days, max 400 rows).
```json
{ "data": [ { "id": 3, "weight_kg": 68.4, "measured_at": "2026-11-11" } ] }
```

### `POST /weight-logs`
```json
{ "weight_kg": 68.4, "measured_at": "2026-11-11" }
```
`measured_at` is optional (defaults to today, never in the future). One row
per day — re-logging a date **replaces** it. When the date is the athlete's
newest, `fitness_profiles.weight_kg` (the value predictions read) is refreshed
too. `PATCH /profile/weight` writes the same timeline automatically.

### `DELETE /weight-logs/{id}`
Removes one weigh-in (`404` if it isn't yours). The profile keeps its last
known weight.

---

## Notifications

### `GET /notifications`
In-app reminder feed (max 50, newest first). On every fetch the server
**synthesizes** pending reminders from existing data — plans scheduled for
today (`plan_today`) and goals reached today (`goal_reached`) — inserting each
at most once per user via a dedupe key.
```json
{ "data": [ { "id": 7, "type": "goal_reached", "title": "Goal reached 🎯",
              "body": "Calories burned · 2,810 / 2,700 kcal",
              "read_at": null, "created_at": "2026-11-11T12:10:11+00:00" } ],
  "meta": { "unread": 1 } }
```

### `POST /notifications/{id}/read` · `POST /notifications/read-all`
Mark one / all notifications read → `{ message }`. Marking someone else's
notification answers `404`.

---

## Error monitoring

### `POST /client-errors`

Public intake for browser-side faults (and ML-service forwards). Unauthenticated
by design — errors happen before login — rate-limited to 60/min/IP.

```json
{
  "message": "TypeError: Cannot read properties of undefined (reading 'chart')",
  "stack": "    at drawChart (analytics.js:42:11)",
  "route": "/analytics",
  "kind": "client",
  "app_version": "1.0.0"
}
```

- `message` **required** (≤ 1000 chars); `stack` (≤ 8000), `route`, `kind`
  (`client` | `ml`), `app_version` optional.
- `202` → `{ "status": "accepted" }` · `422` validation failure.
- Reports are grouped server-side by fingerprint: repeat faults bump an
  occurrence counter instead of creating rows. Nothing from the payload is
  ever echoed back or shown to other users.

See [monitoring.md](monitoring.md) for the full pipeline (server exceptions,
browser errors, ML-service faults → one `error_logs` table).

---

## Admin console

Tier-1 operator API. **Every endpoint requires an account with `role = admin`**
(`admin` middleware — enforced server-side; the SPA only hides what it cannot
access). There is no HTTP way to grant roles: bootstrap the first admin with

```bash
cd backend && php artisan admin:promote you@gmail.com
```

| Endpoint | Purpose |
| --- | --- |
| `GET /admin/dashboard` | KPI counts: users (total / new 7d / suspended / admins), content (activities, predictions, goals), errors (open / 24 h / total) |
| `GET /admin/users?q=&status=all\|active\|suspended&limit=&page=` | Paginated roster with role, suspension state, activity counts |
| `PATCH /admin/users/{id}/suspend` | Suspend one account: sets `suspended_at`, revokes all its tokens (403 on self) |
| `PATCH /admin/users/{id}/reactivate` | Lift a suspension; the athlete signs in again normally |
| `GET /admin/model` | **Read-only** model-ops view (version, metrics, importances) from the ML service · `503` when it is down |
| `GET /admin/errors?status=open\|acknowledged\|resolved\|all&kind=api\|client\|ml` | Error-log viewer with traces (RLS-locked table) |
| `PATCH /admin/errors/{id}` | Triage: `status` → `open` / `acknowledged` / `resolved` |

By design, admin endpoints do **not** allow role editing, account deletion,
secrets/config viewing, raw database access, or mass messaging. Self-service
erasure is available separately under Account & data rights. Suspension also
blocks login and every authenticated request (`ensure.active` middleware), so
a suspended token dies even if login were bypassed.

---

## Account & data rights

### `DELETE /account`
Irreversibly deletes the account and every associated row (activities, goals,
achievements, plans, sessions, profile… — all `ON DELETE CASCADE`), plus auth
tokens and server sessions. First request `POST /account/delete-code`, then
submit the fresh six-digit code and explicit confirmation:
```json
{ "code": "042817", "confirmation": "DELETE" }
```
`200` → `{ "message": "Account and all associated data have been deleted." }` ·
`422` on an invalid/expired code or missing confirmation. Use together with
[`GET /activities/export`](#get-activities-export) so the athlete can keep a copy
of their data first.

---

## Errors

| Status | Meaning |
| --- | --- |
| 401 | Missing/invalid bearer token |
| 404 | Not found **or** owned by another athlete |
| 409 | The resource already exists (for example, `POST /profile` on an account that has one) |
| 422 | Validation — `{ message, errors: { field: [msg] } }` |
| 429 | Rate limit (auth 10/min/IP, predictions 60/min/user, client-errors 60/min/IP) |
| 503 | Database unavailable, ML service unavailable for predictions, or OTP email transport failed/misconfigured |
