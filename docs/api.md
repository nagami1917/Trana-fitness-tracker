# TRANA API reference

Base URL: `https://<your-api>/api`
Auth: `Authorization: Bearer <sanctum-token>` on every route except `auth/*`.
Responses are JSON; collections are wrapped in `{ "data": [...] }`.

---

## Auth

### `POST /auth/register`
```json
{ "name": "Nagami", "email": "nagami@trana.app", "password": "secret123" }
```
`201`
```json
{ "token": "1|abc…", "user": { "id": 1, "name": "Nagami", "email": "nagami@trana.app" } }
```

### `POST /auth/login`
```json
{ "email": "nagami@trana.app", "password": "secret123", "device_name": "pwa" }
```
`200` → `{ token, user }` · `422` on bad credentials.

### `POST /auth/demo`
No body. Creates/uses the shared sandbox athlete (seeded history) and returns a token.
`403` in production unless `DEMO_MODE=true`.

### `GET /auth/me` → `{ user: {...} }` · `POST /auth/logout` → `{ message }`

---

## Profile

`GET /profile`
```json
{
  "data": {
    "id": 1, "name": "Nagami", "email": "nagami@trana.app",
    "weight_kg": 55, "height_cm": 162, "birth_year": 1999, "age": 27,
    "sex": "female", "sweat_profile": "normal", "experience_level": 4,
    "typical_temperature_c": 27, "city": "Quezon City, PH", "units": "metric",
    "daily_calorie_goal": 2700, "daily_distance_goal_km": 10, "daily_active_min_goal": 90,
    "weekly_calorie_goal": 15000, "weekly_distance_goal_km": 45,
    "daily_carb_goal_g": 330, "onboarded": true, "total_activities": 32
  }
}
```

`PUT /profile` accepts any subset of:
`name, weight_kg, height_cm, birth_year, sex(female|male|other), sweat_profile(low|normal|high), experience_level(1-5), typical_temperature_c, city, units, daily_calorie_goal, daily_distance_goal_km, daily_active_min_goal, weekly_calorie_goal, weekly_distance_goal_km, daily_carb_goal_g`.

---

## Activities

### `GET /activities?type=run&q=trail&from=2026-10-01&to=2026-11-08&limit=200`
```json
{
  "data": [{
    "id": 42, "activity_type": "run", "distance_km": 10.1, "elevation_gain_m": 60,
    "duration_min": 58.4, "calories": 612, "avg_heart_rate": 152,
    "started_at": "2026-11-05T06:40:00+08:00",
    "route": [[14.67, 121.04], [14.68, 121.05]], "notes": null, "source": "manual"
  }]
}
```

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
when omitted. Adding an activity also re-buckets `experience_level`.

### `GET /activities/{id}` · `DELETE /activities/{id}` → `{ deleted: true }`

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

## Predictions

### `POST /predictions`
```json
{
  "activity_type": "run",
  "distance_km": 21.1,
  "elevation_gain_m": 220,
  "temperature_c": 26,
  "planned_for": "2026-11-15T05:30:00+08:00",
  "route": [[14.65, 121.02], [14.70, 121.09]]
}
```
If `route` has ≥ 2 points the server measures it (haversine) and uses that distance.

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
  "hint": "The Svelte PWA can still predict locally while the ML service is offline." }
```

### `POST /predictions/preview`
Same request body, returns the **raw FastAPI payload** (`snake_case`) without persisting.

### `GET /predictions?status=planned&limit=30` · `GET /predictions/{id}` · `DELETE /predictions/{id}`

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

---

## Errors

| Status | Meaning |
| --- | --- |
| 401 | Missing/invalid bearer token |
| 403 | Demo endpoints disabled |
| 404 | Not found **or** owned by another athlete |
| 422 | Validation — `{ message, errors: { field: [msg] } }` |
| 429 | Rate limit (auth 10/min/IP, predictions 60/min/user) |
| 503 | ML service unavailable |
