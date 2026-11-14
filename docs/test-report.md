# TRANA Test Report

> How TRANA is verified — the test inventory, what each layer proves, current
> results, and what remains as manual verification. Companion to the
> [`user-manual.md`](user-manual.md); architecture context in
> [`architecture.md`](architecture.md).

**Verified predecessor baseline:** Google-only auth was merged at
`e320046d51b2614097b9ffaad59bc41d3bbf9f19`; its CI passed before this branch
replaced that flow with Gmail/password/OTP authentication.

**Current branch validation (2026-11-10):** `frontend/npm test` passed
(`svelte-check`: 0 errors and 0 warnings; all 22 smoke scripts passed), and
`frontend/npm run build` completed successfully with the existing large MapLibre
chunk-size advisory. The Supabase baseline check, Python syntax compilation, and
PHP-parser syntax check of all 156 backend PHP files passed. PHP/Composer are
unavailable locally, so Laravel PHP lint, migrations, PHPUnit and the real HTTP
smoke remain unrun and must be confirmed by CI. Live email delivery is unverified
because no provider credentials were supplied.

---

## 1. Test pyramid at a glance

| Layer | Tooling | Count | Runs |
| --- | --- | --- | --- |
| Backend (Laravel) | PHPUnit via `php artisan test` (SQLite `:memory:`) | **100 declared test methods / 16 feature files** | Current branch CI required |
| Backend (HTTP smoke) | `scripts/test_stateless_api_http.py` + live-server boot checks | 2 suites | CI `API (Laravel)` |
| Frontend | Node smoke scripts (`happy-dom` + Vite lib build) | **22 scripts** | Passed locally on this branch; CI pending |
| Frontend static | `svelte-check` (types, runes, accessibility) + `vite build` | 0 errors required | Passed locally; CI pending |
| ML (FastAPI) | `pytest -q tests` | **48 tests / 4 files** | CI `ML (FastAPI + scikit-learn)` |
| ML (regression gate) | `evaluation.sanity_check` + `evaluation.geolife_validation` | metric thresholds vs GeoLife | CI `ML` — failure fails the build |

The older green main baseline predates the current email/password authentication.
This branch has 22 frontend scripts and 100 declared backend test methods in
source. The frontend check, smoke suite and production build passed locally;
backend PHPUnit/HTTP tests remain pending because PHP and Composer are unavailable.
Current-branch CI is still required for PHP lint, backend tests, and the full
lint/database baseline/migration checks, as well as the scheduled production
[health workflow](../.github/workflows/health.yml).

---

## 2. Backend inventory (current source: 100 declared test methods; run status pending)

| File | Methods | What it pins down |
| --- | ---: | --- |
| `AccountDeletionTest` | 5 | Separate email-code deletion safeguard, exact `DELETE` confirmation, expiry, attempt limit, resend cooldown, production mail configuration |
| `ActivityUpdateTest` | 2 | Activity ownership and metric recalculation |
| `AdminAccessTest` | 12 | Admin role checks, KPI structure, suspension lifecycle (password login refused until reactivated), self-suspend prevention, triage, promotion, role in session payload |
| `CalibrationRegressionTest` | 6 | Wearable calibration: sample import → personal factor learned (0.5×–2.0× clamp), regression stability |
| `DailySessionTest` | 3 | Daily session and food lifecycle, partial updates, ownership |
| `DatabaseConfigurationTest` | 2 | DB config/baseline integrity |
| `EnergyExpenditureTest` | 13 | ACSM energy path, MET derivation, bounds/clamping |
| `ErrorMonitoringTest` | 8 | Exception capture, fingerprinting/dedup, client-error intake + throttle, `errors:report`, status triage |
| `EmailPasswordAuthTest` | 6 | Gmail/username/password rules, bcrypt storage, hashed OTP verification and attempt limits, generic login failures, HttpOnly cookies, password reset and token revocation |
| `LiveAccountTest` | 6 | Verified-account lifecycle, token use/logout, per-user isolation, pagination, health and seeding behavior |
| `NotificationCenterTest` | 3 | Notification synthesis, unread counts, mark-read |
| `PredictionCreationTest` | 11 | Plan creation, duration prediction payload, saved plans, sport-type handling |
| `ProfileApiTest` | 11 | Profile read/update, units, sweat profile, onboarding payload |
| `StatelessApiTest` | 2 | HttpOnly-cookie authentication, bearer precedence, trusted-Origin checks and double-submit CSRF rejection |
| `TrainingFeaturesTest` | 5 | Training feature calculations and account isolation |
| `WeightLogTest` | 5 | Weight timeline API: log, list order, delete, validation |

The method counts above are source inventory, not a test-run result. PHP and
Composer are unavailable locally; CI is required to run PHP lint, migrations and
PHPUnit. Auth feature tests fake mail notifications and do not require live
provider credentials or outbound network.

**Conventions:** tests use `RefreshDatabase`, auth guards are cleared between
role switches (`forgetGuards()`), and external services are mocked.

---

## 3. Frontend smoke inventory (22 scripts)

| Script | What it verifies |
| --- | --- |
| `api-config-smoke` | API base URL/proxy configuration invariants |
| `live-api-smoke` | Live API contract: pagination, retry, session handling (mocked) |
| `proxy-smoke` | Vite same-origin `/api` proxy wiring |
| `smoke` | Core fueling math & sanity guards (duration/energy/carb/sodium/fluid tables, cold-start anchors) |
| `draw-smoke` | **The draw-test**: road-routing profiles & waypoint thinning, straight-line fallback contract (zero network calls without an ORS key), and road-snapping success/failure paths against a mocked Overpass API |
| `location-smoke` | Location detection, privacy rules, cancellation, error paths |
| `location-ui-smoke` | Location input & onboarding/profile/settings save flows (UI) |
| `login-ui-smoke` | Signup, six-digit verification, password login, and cookie/CSRF client behavior |
| `register-ui-smoke` | Shared auth page registration tab and signup fields/constraints |
| `render-smoke` | **Every route renders** (11 routes incl. `/admin`) with fixture data; fails on `NaN`/`undefined`/`[object Object]` leaks; screen inventory output |
| `error-monitor-smoke` | Client error mirror: dedupe, payload shape, wiring, buffer cap |

Static gates: `svelte-check` must report **0 errors** and **0 accessibility
warnings** (see §7); `vite build` must succeed.

---

## 4. ML inventory (48 tests + 2 gates)

| File | What it verifies |
| --- | --- |
| `tests/test_api.py` | FastAPI endpoints: prediction schemas, validation, error paths (21 cases) |
| `tests/test_error_monitor.py` | ML-side fault reporting: summary-first stacks, payload shape (8 cases) |
| `tests/test_geolife_validation.py` | Validation harness behaviour: metric computation, chronological grouping (5 cases) |
| `tests/test_phase2.py` | Conformal interval calibration, server-side factor application, mocked-psycopg `--source supabase` loader & min-row guards (14 cases) |

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
| **Frontend (Svelte + Tailwind)** | `npm ci` → `svelte-check` → `vite build` → `npm run smoke` (all 22) |
| **ML (FastAPI + scikit-learn)** | deps → retrain → sanity check → **GeoLife validation gate** → `pytest` (failures surfaced as `::error::` annotations: assertion lines first, then FAILED summary, then resolved versions) |
| **API (Laravel)** | PHP lint → Supabase baseline/security-migration checks → config checks → `composer validate` + resolve → live-server boot (`/up`, `/api/docs`) → cookie/CSRF HTTP suite → `php artisan test` (failures → annotations **and** full log posted to the PR as `<!-- trana-test-log -->`) |

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
| Gmail/password account creation and login | `EmailPasswordAuthTest` + `login-ui-smoke` + `register-ui-smoke` |
| Verification OTP expiry, attempts, resend and password recovery | `EmailPasswordAuthTest` + mail delivery configuration documentation |
| HttpOnly browser auth and CSRF | `EmailPasswordAuthTest` + `StatelessApiTest` + `test_stateless_api_http.py` + `live-api-smoke` |
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
| Account deletion (self-service only) | `AccountDeletionTest` (email code + exact `DELETE` confirmation) |
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
- [ ] Signup/login tabs, password visibility, six-digit OTP inputs and auth feedback have been checked with a screen reader
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
| **ML phase 2 (live Supabase retrain/calibrate)** | ⏳ tooling shipped, awaiting ≥ 30 / ≥ 200 live rows | Calibration & `--source supabase` hardening shipped and dry-run verified on GeoLife (see [`ml-methodology.md`](ml-methodology.md)); live Supabase currently has 1 trainable activity |
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
npm run smoke                     # all frontend smoke scripts, including Gmail/password auth UI coverage

# Backend (PHP 8.3+ / composer)
cd backend
composer install
php artisan test                  # current feature suite; report results for this branch before updating counts

# ML (Python 3.11)
pip install -r requirements-dev.txt
python -m duration_model.train
python -m evaluation.sanity_check
python -m evaluation.geolife_validation   # published metrics gate
python -m pytest -q tests                 # 48 tests
```

---

*Related docs: [`user-manual.md`](user-manual.md) · [`api.md`](api.md) ·
[`monitoring.md`](monitoring.md) · [`ml-methodology.md`](ml-methodology.md) ·
[`DEPLOYMENT.md`](DEPLOYMENT.md)*
