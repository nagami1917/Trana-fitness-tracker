# Device & phone testing checklist

> Manual pass for the items automation cannot reach: a real phone, a real GPS,
> real touch input. Companion to [`test-report.md`](test-report.md) §8.
> Run against the deployed app: **https://trana-web.vercel.app**

**Status legend:** ☐ not run · ☑ pass · ✗ fail (file an issue with the row number)

---

## A. Install & shell (PWA)

| # | Step | Expected | Status |
| --- | --- | --- | --- |
| A1 | Open the URL in Chrome/Safari on the phone | App loads, brand shell renders, no horizontal scroll | ☐ |
| A2 | Browser menu → *Install app* / *Add to Home Screen* | Installs; icon shows the TRANA mascot | ☐ |
| A3 | Launch from the home screen | Opens standalone (no browser chrome), splash/shell correct | ☐ |
| A4 | Kill and relaunch the installed app | Session persists; no repeated login | ☐ |

## B. Responsive navigation

| # | Step | Expected | Status |
| --- | --- | --- | --- |
| B1 | Open any signed-in page | Bottom navigation bar visible with 7 items | ☐ |
| B2 | Tap each bottom-nav item | Correct page loads, active state highlights | ☐ |
| B3 | Open the avatar menu | Dropdown shows username, Profile / Settings / Log out (+ Admin if admin) | ☐ |
| B4 | Rotate to landscape (if supported) | Layout reflows, nothing clipped | ☐ |
| B5 | Small phone (≤5″) spot check | Tables/cards scroll or wrap — no overlap | ☐ |

## C. Auth flows on device

| # | Step | Expected | Status |
| --- | --- | --- | --- |
| C1 | Create an account with a unique username and Gmail | Validation accepts the exact username/password constraints | ☐ |
| C2 | Submit signup with a configured mail provider | Six-digit email code arrives; no session is created before verification | ☐ |
| C3 | Paste the code and verify within five minutes | Email is marked verified; login tab is shown | ☐ |
| C4 | Log in with username and then Gmail | Both identifiers open the same account | ☐ |
| C5 | Enter an incorrect password / unverified account | Generic invalid-credentials error / resend-code option appears | ☐ |
| C6 | Use Forgot password with a verified account | Reset code arrives; new password works and old sessions are revoked | ☐ |
| C7 | Log out and log in again | Session is restored with HttpOnly cookie; username and Log out are visible | ☐ |
| C8 | Settings → Danger zone → request code and type `DELETE` | Separate account-deletion email arrives; confirmation erases account data | ☐ |

## D. Planning & drawing (the draw-test on a real map)

| # | Step | Expected | Status |
| --- | --- | --- | --- |
| D1 | Plan Activity → tap 2–3 points on the map | Waypoint markers appear where tapped | ☐ |
| D2 | Wait for routing (ORS key configured) | Path follows roads, not straight lines | ☐ |
| D3 | Routing unavailable / no key | Straight-line fallback — no error toast spam, no hang | ☐ |
| D4 | Save the plan | Appears under Saved plans; duration + fueling shown | ☐ |
| D5 | Reopen the saved plan | Waypoints hydrate (≤12 markers, not hundreds) | ☐ |

## E. GPS tracking

| # | Step | Expected | Status |
| --- | --- | --- | --- |
| E1 | Track Activity → allow location permission | Position marker follows movement | ☐ |
| E2 | Deny location permission | Clear message + manual-entry alternative offered | ☐ |
| E3 | Start → pause → stop → save | Activity appears in Activities with correct distance/time | ☐ |
| E4 | Stop mid-run and discard | No partial activity saved | ☐ |
| E5 | Background the app for 2 min, return | Tracking state intact (or gracefully stopped per design) | ☐ |

## F. Core screens sanity

| # | Step | Expected | Status |
| --- | --- | --- | --- |
| F1 | Dashboard | Today's summary + chart render with data | ☐ |
| F2 | Week Calendar | Shows **run/ride/walk only** (no hike) | ☐ |
| F3 | Activities → open one | Map, splits, fueling visible; back works | ☐ |
| F4 | Activities → Export CSV | File downloads (`trana-activities.csv`) | ☐ |
| F5 | Analytics | Charts render; weight log adds a point | ☐ |
| F6 | Fueling → add/edit/remove food | Totals update; edit form usable at thumb size | ☐ |
| F7 | Goals → edit a target | Progress bars reflect the new target | ☐ |
| F8 | Settings → switch units → save | New units apply across pages after reload | ☐ |
| F9 | Notification bell → open + mark all read | Badge clears | ☐ |
| F10 | Admin console (admin account) | KPIs load; suspend/reactivate taps work | ☐ |

## G. Resilience

| # | Step | Expected | Status |
| --- | --- | --- | --- |
| G1 | Airplane mode → open Dashboard | Offline/unavailable message, no white screen | ☐ |
| G2 | Airplane mode → Plan a session | Clear service-unavailable handling, app recovers when back online | ☐ |
| G3 | Force-quit during tracking, relaunch | No corrupt activity; state explained | ☐ |
| G4 | Rotate/switch apps during a fetch | No stuck spinner >10 s | ☐ |

---

**Run record:** date · tester · phone model/OS/browser · app build
\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_

File failures as GitHub issues citing the row ID (e.g. `E2`). Rows that fail
on a *supported* configuration block release; rows that fail only on exotic
browsers/devices get documented as limitations in
[`user-manual.md`](user-manual.md) §15.
