# TRANA User Manual

> **Plan the effort. Know the fuel.**
> This guide walks through TRANA as an end user — from creating your account to
> reading your training analytics. Developer documentation lives in
> [`docs/api.md`](api.md), [`docs/architecture.md`](architecture.md) and the
> other files in [`docs/`](../README.md).

---

## 1. Creating your account

1. Open the app and choose **Create your account**.
2. Fill in your **name**, your **Gmail address** and a **password**
   (8+ characters, letters and numbers).
3. TRANA accepts **`@gmail.com` addresses only** — sign-up with any other
   domain is rejected with a clear message. (Existing accounts created before
   this rule can still log in with their old address.)
4. Submit. A **verification link** is sent to that Gmail address.

**Verify your email.** Until you click the link, TRANA shows a
*verify your email* screen instead of the dashboard. The link is only needed
once; if it expires, use **Resend** on that screen or log in again to get a
fresh one.

**Forgot your password?** On the login screen choose *forgot password*, enter
your Gmail address, and follow the emailed link to set a new one.

---

## 2. First-run onboarding

After verifying, a three-step wizard collects what the prediction engine needs:

| Step | What you provide |
| --- | --- |
| **You** | Weight, height, birth year, sex (optional), experience level |
| **Training** | Typical training temperature and units (metric / imperial) |
| **Sweat** | Sweat profile — light / average / heavy sweater |

Everything can be changed later in **Settings**. Nothing here is shared with
other users.

---

## 3. Dashboard

Your home screen shows:

- **Today's Summary** — calories, distance and active time for today,
  measured against your goals.
- **Your Activity Chart** — recent training volume at a glance.
- **Recent Activities** — your latest sessions, tap one to open it.
- **Track Activity** — jump straight into recording a session.

The top bar also holds the **notification bell** (see §11) and your avatar
menu (Profile, Settings, Sign out — plus **Admin console** for operators).

---

## 4. Plan a session (Plan Activity)

**Plan → Plan Activity** answers *"how long, how much fuel?"* before you go:

1. Pick the **activity** — Run, Ride, Walk or Hike.
2. Describe the **route** — distance and elevation gain (draw or pick a route
   on the map).
3. Set your **effort** — TRANA predicts the duration from your own pace
   history, then derives:
   - **Energy** (kcal) from ACSM metabolic equations,
   - **Carbohydrate** targets (g/h) banded by duration,
   - **Sodium & fluid** from your sweat profile and the temperature,
   - a **fueling timeline** — *3 h before → during → recovery* with concrete
     grams and millilitres (gels, bottles, real food).
4. **Save** the plan to keep it; saved plans appear at the bottom of the page.

If the ML service is temporarily unavailable, the app tells you plainly and
falls back to anchor estimates where possible — nothing fails silently.

---

## 5. Track a session (Track Activity)

**Track → Track Activity** records what you are doing *now*:

- **GPS mode** — start tracking, and TRANA follows your position while you
  move. You can cancel/stop at any time; a partial track is kept only if you
  save it.
- **Manual entry** — no GPS? Add an activity by hand from **Activities**
  (*+* button): type, date, distance, duration and (optionally) measured
  calories.

Location is used to draw your route and estimate elevation. You are in control:
tracking only runs while you have the page open and started a session, and you
can delete any activity afterwards.

---

## 6. Week calendar

**Calendar → Week calendar** shows your planned and completed sessions for the
current week.

> The calendar deliberately lists **only run, ride and walk** — the three
> activity types TRANA's model is trained on. Hikes appear in Plans and
> Activities but not on the calendar.

Use it to check the week at a glance: what was planned, what got done, and
where the gaps are.

---

## 7. Activities & export

**Activities** is the full history:

- Search and filter your sessions; open one for detail (route map, splits,
  fueling, kcal).
- **Add** a session manually or **delete** one you no longer want (with
  confirmation).
- **Export CSV** — downloads your complete activity history as
  `trana-activities.csv`. Your data leaves the app only when *you* ask for it.

---

## 8. Analytics

**Analytics → Your training, decoded**:

- **Weekly energy** and **Activity mix** — where your training volume goes.
- **Run pace trend** — how your pace is moving over time.
- **Body-weight timeline** — log a weight and watch the trend; the timeline
  accepts and removes entries inline.
- **Model card** — the deployed prediction model's version, validation metrics
  (MAE, MdAPE, R²) and training source, right where you can see what the
  numbers you get are based on.

---

## 9. Fueling

**Fueling → What to eat & drink** combines two things:

- **Targets** — today's carb / sodium / fluid guidance derived from your
  planned or completed sessions.
- **Food log** — record what you actually ate, per meal (breakfast, lunch,
  dinner, snack) with calories and macros. Daily totals update immediately;
  tap any entry to edit or remove it.

---

## 10. Goals

**Goals → What you're aiming for** sets the numbers your Dashboard measures
against:

- **Today** — calories burned, distance, active time.
- **This week** — weekly energy, weekly distance.
- **Consistency** — how steadily you are hitting the above.

Set targets, watch progress fill in, adjust as your season changes.

---

## 11. Notifications

The **bell** in the top bar opens your notification center:

- Reminders and status messages (workouts due, goal milestones, system notes).
- An **unread badge** shows how many need your attention.
- Open one to mark it read, or **mark all read** in one click.

Notifications are synthesized for you when you open the panel — there is no
email marketing and no way for other users to message you.

---

## 12. Profile & Settings

**Profile** — your athlete card: stats, personal bests and weight at a glance.

**Settings** is organised in sections:

| Section | What's there |
| --- | --- |
| **Athlete** | Name, birth year, sex, height/weight |
| **Training & sweat** | Experience level, typical temperature, sweat profile |
| **Prediction engine** | Units (metric/imperial) and calibration preferences |
| **Energy calibration** | *Import samples* — upload what your watch measured so TRANA can learn your personal energy gap (from 3 samples on, estimates are scaled to you, clamped 0.5×–2.0×) |
| **Account** | Password change, email address display |
| **Danger zone** | **Delete account** — requires your password and an explicit confirmation; removes your data permanently (self-service only) |
| **Install TRANA** | Install the app as a PWA on phone or desktop |

---

## 13. The Admin console (operators only)

If your account has the **admin** role, an **Admin** entry appears in the
sidebar and avatar menu at `/admin`:

- **Overview** — counts only: accounts, content totals, open error groups.
- **Users** — search accounts, **suspend** (blocks sign-in and ends live
  sessions) or **reactivate** them. Operators cannot suspend their own account,
  and there is no HTTP path to change anyone's role.
- **Errors** — triage grouped runtime errors: *open → acknowledged →
  resolved* (with stack traces).
- **Model** — read-only view of the deployed artifact. Retraining happens from
  the command line, never from the console.

Everything on this screen is re-checked server-side: non-admins get a 403 even
if they navigate to `/admin` directly.

---

## 14. Troubleshooting

| Symptom | What to do |
| --- | --- |
| *"Sign-up is limited to Gmail addresses"* | Register with an `@gmail.com` address (case-insensitive). |
| Stuck on the verify screen | Check your Gmail for the link; use **Resend** if it's missing (check Promotions/Spam). |
| *"This account has been suspended."* | An operator suspended the account — contact the operator to reactivate. |
| Password forgotten | **Forgot password** on the login screen → Gmail link → new password. |
| Prediction says the service is unavailable | The ML service is down or unreachable — your data is safe; retry shortly. Anchors and history remain visible. |
| No GPS signal in Track | Use **manual entry** from Activities instead. |
| Notification badge stuck | Open the bell → **mark all read**. |

---

## 15. Privacy & data

- **Your data is yours.** Export everything as CSV from **Activities**;
  delete your account yourself from **Settings → Danger zone**.
- **Location** is used to draw routes and estimate elevation for the session
  you are recording — it is not published anywhere and other users never see
  your activities.
- **No social layer.** There are no public profiles, no feeds, no sharing of
  your sessions with other athletes.
- **Emails** are stored lowercase; only `@gmail.com` addresses are accepted
  for new sign-ups.
- **What TRANA does not do:** wearable sync (Garmin/Strava-style live sync) is
  not supported — use calibration imports (Settings → Energy calibration) or
  manual entry instead.

---

## 16. Where things live (quick map)

| You want to… | Go to |
| --- | --- |
| See today at a glance | Dashboard |
| Know how long/fuel a session | Plan Activity |
| Record now | Track Activity |
| Check the week | Week Calendar |
| Browse/export history | Activities |
| Charts, weight, model card | Analytics |
| Targets + food log | Fueling |
| Set targets | Goals |
| Change my data / delete account | Settings |
| Operator tools | Admin (admin role only) |

---

*Related docs: [`api.md`](api.md) · [`architecture.md`](architecture.md) ·
[`ml-methodology.md`](ml-methodology.md) · [`monitoring.md`](monitoring.md) ·
[`DEPLOYMENT.md`](DEPLOYMENT.md) · [`test-report.md`](test-report.md)*
