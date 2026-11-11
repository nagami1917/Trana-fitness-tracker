# Error monitoring

Production faults from all three services land in **one place**: the
`error_logs` table in the Trana database, grouped by fingerprint, readable
via `php artisan errors:report` today and via the admin module next.

```
 browser (Svelte)              Laravel API                FastAPI (ML)
┌──────────────────┐   POST    ┌──────────────────┐       ┌──────────────────┐
│ window "error"   │──────────▶│ POST /api/       │       │ uncaught         │
│ unhandledrejection│ /client- │   client-errors   │       │ exception        │
│ HTTP 5xx mirror   │  errors  │ (throttle 60/min) │       │                  │
└──────────────────┘          └────────┬─────────┘       └────────┬─────────┘
                                       │                          │ stderr JSON line
┌──────────────────┐                  │                          │ + optional POST
│ RecordServerErrors│──uncaught 5xx───┤                          │ to /client-errors
│ middleware (global)│                ▼                          │ (kind = ml)
└──────────────────┘          ┌──────────────────────────────────┴─────────┐
                              │ error_logs: kind, fingerprint, message,     │
                              │ trace, context, occurrences, first/last_seen│
                              └─────────────────────────────────────────────┘
```

## What each source contributes

| kind | source | level | how it arrives |
| --- | --- | --- | --- |
| `api` | Uncaught Laravel exceptions (5xx-class) | `error` | `RecordServerErrors` middleware — prepended globally, records then **rethrows**, so JSON rendering and default logging are untouched |
| `client` | Uncaught browser JS errors, unhandled promise rejections, HTTP 5xx seen by the API client | `warning` | `frontend/src/lib/errorMonitor.js` → `POST /api/client-errors` (fire-and-forget, deduped, capped at 40/page session) |
| `ml` | Unhandled FastAPI exceptions | `error` | `ml/api/error_monitor.py` → one `ERROR_MONITOR {json}` stderr line (log-based alerting) **plus**, when `ERROR_REPORT_ENDPOINT` is set, a forwarded POST to the same intake |

Deliberate protocol outcomes — 401/403/404/422/429 — are **not** faults and
are filtered out on every side. Monitoring never breaks the monitored path:
every record path is wrapped so a monitoring failure (DB down, bad payload)
is swallowed and the original request behaves as if nothing happened.

## Grouping (fingerprints)

`sha1(kind | class | message | origin-frame)` — one row per unique fault;
repeat hits increment `occurrences` and refresh `last_seen_at`. Two
concurrent first-hits race safely (unique key → counter fallback). The
origin frame is the first stack frame outside `vendor/` (server) / outside
the monitor module (ML) / the first stack line (browser), so the same root
cause groups even when it fires on different routes.

## What is — and is not — stored

Stored: exception class, message (≤ 1000 chars), stack/trace (≤ 4000
chars, first 20 frames), route path, HTTP method, user-agent (≤ 200),
app version, linked `user_id` when a session existed (nullable FK:
the incident outlives the account; deletion nulls the link).

**Never stored**: request bodies, query strings, IPs, tokens, or any
activity/health payload. On Supabase the table has RLS enabled and the
Data API roles (`anon`, `authenticated`) have no privileges — traces are
readable only by the backend (same treatment as body-weight rows).

## Reading the data

```bash
cd backend
php artisan errors:report               # open groups, last 24h, newest first
php artisan errors:report --since=7d    # wider window
php artisan errors:report --all --limit 100
```

Output: hits, last seen, kind, status, message, fingerprint prefix.
`status` (`open` → `acknowledged` → `resolved`) exists for the admin
viewer that ships with the admin module; the CLI only lists `open` unless
`--all`.

Log-based alerting (ML service or any host shipping stderr): grep for
`ERROR_MONITOR` — each hit is one JSON object with fingerprint, route and
`duration_ms`.

## Deployment configuration

| Variable | Where | Effect |
| --- | --- | --- |
| `ERROR_REPORT_ENDPOINT` | FastAPI host | Full URL of `POST /api/client-errors` — enables ML → Laravel forwarding (1 s budget, best-effort) |
| `ML_VERSION` | FastAPI host | Version label stored with ML reports (defaults to `dev`) |
| `VITE_APP_VERSION` | Frontend build | Version label stored with browser reports (defaults to `dev`) |

Without `ERROR_REPORT_ENDPOINT` the ML service still self-reports to its
own stderr logs — forwarding is an enhancement, not a requirement.

## Tests

- `backend/tests/Feature/ErrorMonitoringTest.php` — grouping/counting,
  422 validation, uncaught-exception capture + JSON render still works,
  4xx not recorded, CLI listing, anonymous intake.
- `ml/tests/test_error_monitor.py` — capture + 500 passthrough, 4xx
  filtered, fingerprint stability across routes, forward contract,
  middleware registration order.
- `frontend/scripts/error-monitor-smoke.mjs` — dedupe, payload shape,
  window-listener wiring, session cap (runs in CI's `npm run smoke`).
