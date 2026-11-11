# TRANA Test Report

> How TRANA is verified — the test inventory, what each layer proves, current
> results, and what remains as manual verification. Companion to the
> [`user-manual.md`](user-manual.md); architecture context in
> [`architecture.md`](architecture.md).

**Report status:** current as of main `a44715b` (CI run
[`43007197431`](https://github.com/nagami1917/Trana-fitness-tracker/actions/runs/43007197431) — all jobs green).

---

## 1. Test pyramid at a glance

| Layer | Tooling | Count | Runs |
| --- | --- | --- | --- |
| Backend (Laravel) | PHPUnit via `php artisan test` (SQLite `:memory:`) | **82 tests / 13 feature files** | CI `API (Laravel)` on every push & PR |
| Backend (HTTP smoke) | `scripts/test_stateless_api_http.py` + live-server boot checks | 2 suites | CI `API (Laravel)` |
| Frontend | 10 Node smoke scripts (`happy-dom` + Vite lib build) | **10 scripts** | CI `Frontend (Svelte + Tailwind)` |
| Frontend static | `svelte-check` (types, runes, accessibility) + `vite build` | 0 errors required | CI `Frontend (Svelte + Tailwind)` |
| ML (FastAPI) | `pytest -q tests` | **31 tests / 3 files** | CI `ML (FastAPI + scikit-learn)` |
| ML (regression gate) | `evaluation.sanity_check` + `evaluation.geolife_validation` | metric thresholds vs GeoLife | CI `ML` — failure fails the build |

Total automated checks: **82 backend + 31 ML + 10 frontend smoke suites**
(plus lint, baseline and migration scripts, and the scheduled production
[health workflow](../.github/workflows/health.yml)).

---

## 2. Backend inventory (82 tests)

| File | Tests | What it pins down |
| --- | ---: | --- |
| `AdminAccessTest` | 12 | Admin console: guest 401, athlete 403 on every admin route, KPI structure, user search/suspension lifecycle (suspend → sessions die → login refused → reactivate), self-suspend blocked, read-only model viewer (200/503), error triage validation, `admin:promote` CLI, login exposes `role` |
| `ProfileApiTest` | 11 | Profile read/update, units, sweat profile, onboarding payload, account deletion (self-service, password-gated) |
| `EnergyExpenditureTest` | 11 | ACSM energy path, MET derivation, bounds/clamping |
| `PredictionCreationTest` | 9 | Plan creation, duration prediction payload, saved plans, sport-type handling |
| `ErrorMonitoringTest` | 8 | Exception capture into `error_logs`, fingerprinting/dedup, client-error intake + throttle, `errors:report` command, status triage API |
| `LiveAccountTest` | 6 | Full account lifecycle over HTTP: register (Gmail-only) → verify → login → token use → logout |
| `CalibrationRegressionTest` | 6 | Wearable calibration: sample import → personal factor learned (0.5×–2.0× clamp), regression stability |
| `WeightLogTest` | 5 | Weight timeline API: log, list order, delete, validation |
| `PasswordRecoveryTest` | 5 | Forgot → reset flow, token validity, expired/used tokens |
| `NotificationCenterTest` | 3 | Notification synthesis, unread counts, mark-read |
| `StatelessApiTest` | 2 | Bearer-token statelessness of the API surface |
| `GmailOnlyRegistrationTest` | 2 | Exact-suffix `@gmail.com` acceptance, other domains rejected, emails stored lowercase |
| `DatabaseConfigurationTest` | 2 | DB config/baseline integrity |

**Conventions:** every test boots a fresh schema (`RefreshDatabase`), auth
guards are cleared between role switches (`forgetGuards()`), and no test
requires network access.

---

## 3. Frontend smoke inventory (10 scripts)

| Script | What it verifies |
| --- | --- |
| `api-config-smoke` | API base URL/proxy configuration invariants |
| `live-api-smoke` | Live API contract: pagination, retry, session handling (mocked) |
| `proxy-smoke` | Vite same-origin `/api` proxy wiring |
| `smoke` | Core fueling math & sanity guards (duration/energy/carb/sodium/fluid tables, cold-start anchors) |
| `draw-smoke` | **The draw-test**: road-routing profiles & waypoint thinning, straight-line fallback contract (zero network calls without an ORS key), and road-snapping success/failure paths against a mocked Overpass API |
| `location-smoke` | Location detection, privacy rules, cancellation, error paths |
| `location-ui-smoke` | Location input & onboarding/profile/settings save flows (UI) |
| `login-ui-smoke` | Login password visibility, accessibility attributes, mocked sign-in |
| `render-smoke` | **Every route renders** (11 routes incl. `/admin`) with fixture data; fails on `NaN`/`undefined`/`[object Object]` leaks; screen inventory output |
| `error-monitor-smoke` | Client error mirror: dedupe, payload shape, wiring, buffer cap |

Static gates: `svelte-check` must report **0 errors** and **0 accessibility
warnings** (see §7); `vite build` must succeed.

---

## 4. ML inventory (31 tests + 2 gates)

| File | What it verifies |
| --- | --- |
| `tests/test_api.py` | FastAPI endpoints: prediction schemas, validation, error paths |
| `tests/test_error_monitor.py` | ML-side fault reporting: summary-first stacks, payload shape |
| `tests/test_geolife_validation.py` | Validation harness behaviour (metric computation, grouping) |

**Regression gates (every CI run):**

1. `python -m duration_model.train` — the model retrains from scratch.
2. `python -m evaluation.sanity_check` — training-time sanity thresholds.
3. `python -m evaluation.geolife_validation` — **the published GeoLife
   numbers must hold**: MAE 5.65 min · MdAPE 21.9 % · ±15 % = 36.4 % ·
   R² 0.461 (cold start 12.88 → personalized 5.41; baselines
   7.10 → 5.80 → 5.65). A regression fails the build.

---

## 5. CI pipeline

Three parallel jobs on every push/PR (`.github/workflows/ci.yml`):

| Job | Steps (abridged) |
| --- | --- |
| **Frontend (Svelte + Tailwind)** | `npm ci` → `svelte-check` → `vite build` → `npm run smoke` (all 9) |
| **ML (FastAPI + scikit-learn)** | deps → retrain → sanity check → **GeoLife validation gate** → `pytest` (failures surfaced as `::error::` annotations: assertion lines first, then FAILED summary, then resolved versions) |
| **API (Laravel)** | PHP lint → Supabase baseline/security-migration checks → config checks → `composer validate` + resolve → live-server boot (`/up`, `/api/docs`) → bearer-auth HTTP suite → `php artisan test` (failures → annotations **and** full log posted to the PR as `<!-- trana-test-log -->`) |

Failure diagnostics are designed for readability: annotation budget (~10/step)
is spent on the decisive block first, and the backend job additionally posts
the complete log to the PR.

**Production health workflow** (`.github/workflows/health.yml`) — runs on every
merge to main, on demand, and every 6 hours (the schedule doubles as the
ML warm-up ping from `DEPLOYMENT.md`): web SPA reachable, API
`/api/health` returns `status: ok` (app + database), `/api/docs` descriptor
intact, and — once the repository variable `ML_HEALTH_URL` is set — ML
`/health` returns `model_ready: true`.

---

## 6. Requirements → coverage map

| Professor item / feature | Covered by |
| --- | --- |
| Gmail-only registration | `GmailOnlyRegistrationTest` + `LiveAccountTest` + `render-smoke` (register screen) |
| Password recovery | `PasswordRecoveryTest` |
| Profile & onboarding | `ProfileApiTest`, `location-ui-smoke` |
| Duration prediction & plans | `PredictionCreationTest` + ML GeoLife gate |
| Energy expenditure | `EnergyExpenditureTest` |
| Wearable calibration | `CalibrationRegressionTest` + Settings import flow (UI smoke) |
| Weight timeline | `WeightLogTest` + `render-smoke` (Analytics) |
| Data export (CSV) | `ProfileApiTest`/export contract + `Activities` export button (rendered in `render-smoke`) |
| Week calendar (run/ride/walk only) | `render-smoke` route render + type filter pinned in `Calendar.svelte` |
| Notification center | `NotificationCenterTest` |
| Error monitoring (all 3 services) | `ErrorMonitoringTest` + `error-monitor-smoke` + `test_error_monitor` |
| Admin module (server-side roles) | `AdminAccessTest` (12) + `/admin` render + role-gated nav |
| Account deletion (self-service only) | `ProfileApiTest` |
| Database/baseline integrity | `DatabaseConfigurationTest` + CI baseline scripts |

---

## 7. Accessibility pass

**Audit scope:** all Svelte components, checked with `svelte-check`'s
accessibility rules plus a manual review of shared components against
**WCAG 2.1 AA** targets.

**Findings & fixes (this pass):**

| Finding | Where | Fix |
| --- | --- | --- |
| Clickable food rows (`<li onclick>`) not keyboard-operable | `FoodLogger.svelte` | Converted to a native `<button>` — focusable, Enter/Space activates; decorative `×` marked `aria-hidden` |
| 8 form labels not programmatically associated with their inputs | `FoodLogger.svelte` add-food form | Proper `for`/`id` pairs on every field (name, meal, calories, qty, carbs, protein, fat, notes) |
| Unlabeled inputs in the edit form | `FoodLogger.svelte` edit-food form | `aria-label`s added (no visible label exists in that compact form) |

**Result:** `svelte-check` reports **0 accessibility warnings** (down from 10)
and 0 errors.

**Manual audit checklist (shared chrome & flows):**

- [x] Icon-only buttons carry `aria-label` (notification close, food add, map controls)
- [x] Avatar menu and notification panel close via explicit close controls
- [x] Focus-visible styling present on interactive elements (buttons, links, inputs)
- [x] Keyboard path: sidebar nav → page content → forms → table actions
- [x] Login screen password visibility toggle is a real button with label
- [x] Status conveyed by text as well as colour (suspended/active badges, error kinds)
- [ ] Screen-reader pass with a live AT tool (manual, see §8)

---

## 8. Manual verification checklist (pending)

These require hardware, a deployed environment or user-held data — they are
**not** automatable here and remain open until executed:

| Item | State | Notes |
| --- | --- | --- |
| Production **health curl** (web + API + ML) | ✅ automated | `.github/workflows/health.yml` — runs on merge/manual/6 h schedule; ML step activates when repo var `ML_HEALTH_URL` is set |
| **Draw-test** (route drawing pipeline) | ✅ automated | `draw-smoke` (10th suite): profiles, waypoint thinning, fallback contracts, mocked Overpass snapping — wired into `npm run smoke` + CI. Live ORS key behaviour = device rows D2/D5 |
| **Phone tests** (PWA, nav, GPS, resilience) | ⏳ pending | Execute [`device-testing.md`](device-testing.md) checklist on a physical device (~40 rows, A–G) |
| **FitRec/Endomondo validation report** | ⏳ pending user CSV | Tooling merged (#41); awaiting the derived `endomondo_activities.csv` upload, then `python -m evaluation.endomondo_validation` commits the report JSON |
| Screen-reader (AT) pass | ⏳ optional | Automated + keyboard audit done (§7) |

---

## 9. Known limitations

- **No browser E2E suite** — smokes run in `happy-dom`, not a real browser;
  cross-browser visual testing is manual.
- **No load/soak testing** — throughput limits are enforced only by throttles
  (e.g., client-error intake 60/min/IP).
- **Backend tests need no local PHP to read this report**, but running them
  locally requires PHP/composer; CI is the authoritative run.
- **FitRec metrics are fixture-validated only** until §8's CSV arrives — the
  quoted FitRec smoke numbers (MAE 9.93 etc.) came from synthetic fixture data
  proving the tooling, not from the real dataset.

---

## 10. Reproducing locally

```bash
# Frontend (Node 20+)
cd frontend
npm ci
npx svelte-check --output human   # 0 errors, 0 a11y warnings
npm run build
npm run smoke                     # all 10 scripts

# Backend (PHP 8.3+ / composer)
cd backend
composer update
php artisan test                  # 82 tests, SQLite :memory:

# ML (Python 3.11)
pip install -r requirements-dev.txt
python -m duration_model.train
python -m evaluation.sanity_check
python -m evaluation.geolife_validation   # published metrics gate
python -m pytest -q tests                 # 31 tests
```

---

*Related docs: [`user-manual.md`](user-manual.md) · [`api.md`](api.md) ·
[`monitoring.md`](monitoring.md) · [`ml-methodology.md`](ml-methodology.md) ·
[`DEPLOYMENT.md`](DEPLOYMENT.md)*
