# TRANA — Defence Guide

A speaking companion for the panel. Every number here is traceable to a
committed artifact, named beside it.

Use it in three passes:

1. **§1** — memorise the one-paragraph answer. It is the answer to "explain your project."
2. **§3** — rehearse the questions. Panels ask the same twenty.
3. **§5** — read the traps. Most marks are lost here, not on the model.

> **Last reconciled:** 2026-11-21, against shipped model `20261121.0023`.
> If a number here disagrees with `ml/duration_model/model_card.json`, the
> model card wins and this file is wrong.

---

## 1. The answer to "explain your project"

> TRANA is a fitness tracking web application for endurance athletes. An athlete
> tells it what they plan to do — sport, distance, climbing — and TRANA predicts
> how long it will take, then builds a fuelling plan from that prediction:
> carbohydrates, fluid, and sodium per hour, plus what to actually pack.
>
> The interesting part is the prediction. It works in **two stacked stages**.
> Stage one is a *personalised Riegel curve* — a power law fitted from the
> athlete's own past sessions, where time scales with distance raised to an
> exponent near 1.06. That is classical sports science, no machine learning at
> all. Stage two is a *gradient-boosted quantile regressor* trained on **43,847
> recorded workouts from 218 athletes**, which learns a multiplicative correction
> on top of that curve. It only has to learn the part the physics gets wrong.
> Three forests predict the 10th, 50th and 90th percentile of that correction,
> which turns a single number into an honest range instead of false precision.
>
> Trained on real Endomondo data, it cut held-out error from 32.69 to **27.60
> minutes** MAE — a paired bootstrap over 2,000 athlete resamples put the
> improvement at **−5.09 minutes, 95% CI [−5.66, −4.50]**, better in 100% of
> draws. The honest limits are in §3, Q12 and Q19.

That paragraph is defensible end to end. Everything below supports it.

---

## 2. What the system is, in one page

### 2.1 Three deployed services

| Layer | Technology | Host | What it does |
|---|---|---|---|
| Frontend | Svelte 5 + Vite + Tailwind | Vercel | 18 pages, PWA, runs the model in-browser |
| API | PHP 8.2 / Laravel 12 / Sanctum | Vercel (container) | 87 routes, auth, persistence |
| ML service | Python / FastAPI / scikit-learn | Render | `/predict`, `/predict/duration`, `/predict/fueling` |

Database is PostgreSQL on Supabase. Auth is HttpOnly-cookie based with CSRF —
**tokens are never stored in `localStorage`**, which is a deliberate XSS
mitigation and is enforced by a test.

### 2.2 Why the model runs in two places

The same artifact is evaluated twice, on purpose:

- **In the browser** (`frontend/src/lib/ml/duration.js`) — so typing a distance
  gives an instant answer, works offline, and costs no round trip. It is a
  faithful JavaScript port of `preprocess.py` + `model_store.py`.
- **On the server** (`POST /api/predictions`) — authoritative when a plan is
  saved, so the stored row is never produced by an untrusted client.

Both read the identical 376 KB artifact, so the preview and the saved row agree.

### 2.3 The athlete only types three things

| Field | Note |
|---|---|
| Sport | run / ride / walk / hike, one-hot encoded |
| Distance | km — dominant input |
| Elevation gain | m — becomes `elevation_per_km`, the strongest feature |

Everything else — experience level, history depth, temperature, sweat profile —
is derived or defaulted. That is deliberate: every extra required field is a
reason to abandon the form.

---

## 3. The twenty questions panels actually ask

### Q1. What does your system predict?

Activity duration in minutes, with a range, for a *planned* session. Then it
converts that duration into a fuelling plan. It also predicts fuelling directly
(`/predict/fueling`) from duration, intensity, body weight, sweat profile, and
temperature.

### Q2. Why machine learning instead of just a formula?

Because the formula is already there and it is not enough. A Riegel curve scaled
by a Naismith climb correction gets you a respectable baseline — it beats a
population prior by **17.9%** on real GPS data. But it cannot know that *this*
athlete is slower on climbs than their flat pace implies, or that their first
three sessions are noisier than their twentieth. The learned correction captures
that. The honest framing: **the personalisation supplies most of the accuracy;
the model supplies the correction and the uncertainty interval.**

### Q3. What algorithm, and why that one?

Three `GradientBoostingRegressor`s with **quantile loss** (α = 0.1, 0.5, 0.9),
320 estimators each, learning rate 0.06, depth 3, min-samples-leaf 12, seed 7.
Ridge regression fits the reference curve underneath.

Why boosted trees: the corpus is a few tens of thousands of rows with ~9
features. That is far too little for a neural network and far too much for a
closed-form fit. Shallow boosted trees handle mixed continuous/categorical
features, need no scaling, and — critically — quantile loss gives an interval
natively, without assuming normally-distributed residuals, which running times
emphatically do not obey.

### Q4. What is your dataset?

The **shipped** model is trained on `endomondo_activities.csv`: **43,847 real
recorded workouts from 218 athletes**, derived from the FitRec / Endomondo
sample (Ni, Muhlstein & McAuley, WWW 2019).

| Sport | Workouts |
|---|---|
| ride | 21,993 |
| run | 20,937 |
| walk | 866 |
| hike | 51 |

Converted from 50,018 source rows; 43,847 survived filtering. The derivation is
recorded in `ml/evaluation/reports/endomondo_dataset_summary.json`.

Three corpora exist in this project and they play different roles:

| Corpus | Rows | Users | Role |
|---|---|---|---|
| Synthetic (generated in-repo) | 8,845 | 240 | Bootstrap. Produced the *previous* model |
| GeoLife GPS Trajectories | 4,362 | 51 | **External validation only** — never trained on |
| FitRec / Endomondo | 43,847 | 218 | **Training corpus for the shipped model** |

### Q5. How did you split your data?

Two different splits, for two different questions.

**For the shipping benchmark** (`endomondo_study.json`): 70/30 by `user_id` —
153 training athletes, 65 holdout, `user_overlap: 0`. 35,172 / 8,675 rows.

**For the shipped card's own figures**: 80/20 `GroupShuffleSplit` by `user_id` —
174 training users, 44 test, `user_overlap: 0`, 32,281 / 11,566 rows.

Always grouped by athlete, never by row. Splitting by row would put the same
person's Tuesday run in training and their Thursday run in test, and the model
would look far better than it is. `user_overlap: 0` is the field that proves
this was done.

**One honest wrinkle you should volunteer before you are asked:** the shipped
artifact was refit on the **full** corpus (all 218 athletes) for final deployment,
so its own card metrics on the 65 holdout users are an *upper bound*. The
generalisation estimate you should quote is the benchmark candidate's, which
only ever saw the training split. `SHIPPING.md` and `endomondo_study.json` both
say so explicitly in a `note` field.

### Q6. Why quantile regression and not ordinary regression?

An ordinary least-squares model predicts a mean, which for skewed running times
is a number few athletes ever produce, and it gives you no interval. The athlete
does not want "117 minutes" — they want "likely 90 to 148 minutes," because that
is what determines how much water to carry. Quantile loss gives three
predictions for slightly more than the price of one, and the width of the band
carries real information: narrow when the athlete has history in this sport,
wide when they do not.

### Q7. Why predict a factor instead of minutes?

Because the factor is scale-free and the minutes are not. The model predicts
`log(duration / flat-equivalent time at the athlete's own reference curve)`,
then multiplies by that base. Two benefits: a correction learned from a 5 km
session transfers to a marathon, and the loss function is not dominated by long
workouts — a 4-hour ride should not outweigh a 40-minute run by 6×.

### Q8. What is the Riegel curve?

A power law from running physiology: `T₂ = T₁ × (D₂/D₁)^b`, with `b` ≈ 1.06 for
running. It says: if you can run 5 km in 30 minutes, 10 km takes about 62, not
60. TRANA actually **fits** `b` per athlete by weighted least squares over their
own sessions, with a Ridge prior of 1.06 and the exponent clipped to
`[1.00, 1.30]`. The clip is a guard: an athlete with two badly-measured runs
should not produce an exponent of 2, which would predict absurd marathon times.

### Q9. What are your features and which matters most?

Nine features, and the importances are in `model_card.json`:

| Feature | Importance |
|---|---|
| `elevation_per_km` | **0.4411** |
| `distance_km` | **0.3621** |
| `elevation_gain_m` | 0.1012 |
| `is_ride` | 0.0484 |
| `is_run` | 0.0207 |
| `is_walk` | 0.0143 |
| `history_count` | 0.0116 |
| `experience_level` | 0.0005 |
| `is_hike` | 0.0 |

Two features carry **80%** of the variance: climb density and distance. That is
the headline finding and it matches sports science — gradient is what makes a
route hard, not raw distance.

`experience_level` at 0.0005 is worth addressing unasked: it is *nearly
redundant* with `history_count`, because experience is inferred from history
length. The model correctly declines to lean on it. That is a finding, not a
defect.

### Q10. How do you avoid data leakage?

Four specific measures:

1. **Split by athlete**, verified with `user_overlap: 0`.
2. **Chronological history only.** When scoring a workout, the curve uses only
   that athlete's *earlier* sessions of the same sport. No future data.
3. **The target is defined against the curve, and the curve excludes the row
   being predicted** (`excludeId`).
4. **GeoLife is validation only.** It never touches training, which is why it
   can be quoted as external evidence.

The leakage guard is `validHistoryPoints()` in `preprocess.py`, mirrored in
`duration.js`.

### Q11. What metrics did you use?

MAE in minutes, RMSE, R², MAPE, MdAPE (median absolute percentage error), and
interval coverage. MdAPE is the headline for percentage because MAPE is badly
skewed by short activities — a 12-minute walk predicted at 20 minutes is an 67%
error that says little about the model.

Interval coverage is the one that matters most for the product: if the 80% band
contains the truth only 30% of the time, the band is decoration.

### Q12. What is your accuracy?

Quote the right number for the right question. There are three, and they are
not interchangeable:

| Setting | n | MAE | MdAPE | R² | What it means |
|---|---|---|---|---|---|
| **Held-out Endomondo** (shipped) | 8,675 | **27.60 min** | **25.6%** | **0.630** | Same population, unseen athletes |
| Benchmark candidate, training split only | 8,894 | 28.10 min | — | 0.523 | Closest to a clean generalisation estimate |
| **GeoLife external** (different corpus) | 4,362 | 7.08 min | **36.86%** | **0.225** | Real GPS, but no elevation data |

The number to lead with is **MdAPE 25.6% on 8,675 held-out workouts from 65
unseen athletes**. That is the shipping benchmark and it is the fairest single
figure.

By sport (held-out, `n` matters here):

| Sport | n | MAE before → after | R² before → after |
|---|---|---|---|
| run | 3,766 | 22.6 → **17.4** | 0.226 → **0.642** |
| ride | 4,895 | 40.3 → **35.3** | 0.421 → **0.579** |
| walk | 7 | 50.1 → 47.2 | −0.605 → −0.539 |
| hike | 7 | 92.6 → 115.9 | −0.804 → −2.595 |

**Walk and hike have n = 7.** Say that out loud before anyone else does. Those
numbers are reported for completeness and are not evidence either way.

### Q13. Why does the model card say R² 0.44 but the held-out study says 0.63?

Because they are different splits with different athletes and different row
counts, and the card's 0.4419 is the 80/20 GroupShuffleSplit figure on
`test_rows: 11566` while the study's 0.630 is the 70/30 split on `8675`. Neither
is wrong; they are not the same measurement.

**What you must not do is quote 0.9924.** That is the *old synthetic* model
scoring itself on data it generated from the same formulas it was trained to
reproduce. It measures formula recovery, not prediction. If anyone produces that
number, say immediately: *"that is the superseded synthetic model's self-score —
the current artifact has not been evaluated that way, and we would not quote it."*

The Analytics page now labels these metrics from the card's own
`training_source`, so it cannot silently show synthetic-era numbers against a
real-data model.

### Q14. What is interval coverage, and is yours calibrated?

Coverage is the share of actual durations that fall inside the predicted band.
Nominal is 80% (q10–q90).

| Model | Coverage |
|---|---|
| Old synthetic model | 15.4% |
| **Shipped Endomondo model** | **65.5%** |

That is a four-fold improvement and still below nominal. **The frontend
therefore displays the measured error band, not the raw quantile interval** —
`VALIDATED_ERROR_PCT` in `duration.js` uses the per-sport measured error, widened
by a thin-history multiplier. So the band the athlete sees is honest even
though the model's own quantiles are optimistic.

`calibration` is `null` in the artifact: no post-hoc isotonic or conformal
calibration was fitted. The corpus would support it. That is the single
clearest next step and worth saying before you are asked.

### Q15. Your ablation shows the gradient boosting adds nothing. Why keep it?

> Because accuracy was never the only requirement. The product needs an
> uncertainty interval, and quantile regression supplies one natively. The
> ablation shows the correction is accuracy-neutral on GeoLife — 5.83 minutes
> for the curve alone versus 5.84 with the GBM, well inside noise — and it is
> what produces the q10/q90 bounds, the 0.7–3.0 guard rails, and usable output
> for a brand-new account with no history. I would not claim it improves
> accuracy, and the documentation does not.

Be precise about the scope of that result: the ablation was run on **GeoLife**,
where elevation is unavailable, so `elevation_per_km` — 44% of the model's
importance — was pinned at zero. That is the honest caveat, and it is why the
ablation is not the final word on whether the GBM helps.

### Q16. Did you train on real data?

Yes — the shipped model. 43,847 real recorded workouts from 218 athletes.

And be candid that this is the *second* attempt: the first model was trained on
8,845 **generated** workouts produced by a physics-formula generator. It was
reproducible and internally consistent, but every row was manufactured. Replacing
it with recorded data was a deliberate correction of that weakness, and
`SHIPPING.md` documents the before/after.

### Q17. What happened when you retrained on real data?

| | Before (synthetic) | After (Endomondo) |
|---|---|---|
| MAE | 32.69 min | **27.60 min** |
| MdAPE | 30.98% | **25.6%** |
| R² | 0.450 | **0.630** |
| Coverage | 15.4% | **65.5%** |
| Within 20% | 34.8% | **40.9%** |

Paired bootstrap, 2,000 athlete resamples: **ΔMAE −5.09 min, 95% CI [−5.66,
−4.50]**, better in **100.0%** of draws. The interval excludes zero.

Two things to volunteer:

- **The retraining study is not the shipping benchmark.** `retrain_study.json`
  scored 1,085 holdout workouts and found *no* measurable accuracy difference
  (ΔMAE 0.061 min, 95% CI [−0.071, 0.184], CI includes zero). Its own verdict
  string is "no measurable difference — retraining did not change accuracy",
  while noting coverage moved 15.94% → 67.83%. That study measured a *small*
  retrain on a much smaller holdout; the corpus swap was decided on the paired
  8,675-workout benchmark instead. If a panellist finds it, name both: two
  experiments, different sample sizes, different questions.
- **State the exact figure, not a rounded one.** The before/after table in
  `SHIPPING.md` rounds MdAPE 30.98% up to 31.0%. Both are defensible; the
  report is the source.
- **GeoLife got worse, not better.** On GeoLife the previous model scored MAE
  5.84 min / MdAPE 23.8% / R² 0.414 (`ablation_report.json`, 2026-11-18); the
  shipped model scores MAE 7.08 min / MdAPE 36.86% / R² 0.225
  (`geolife_validation.json`). That is a genuine trade-off: the model now fits
  Endomondo's population — dominated by running and cycling, with elevation —
  and transfers *less* well to GeoLife, which is mostly walking and short rides
  and records no elevation at all. Report it as a limitation of cross-corpus
  transfer, not as noise.

### Q18. How do you know it works in production?

Because it is deployed and I have exercised it end to end:

- `trana-fitness-tracker.onrender.com/model/info` reports `20261121.0023`,
  `corpus_rows: 43847`, `source_label: "Endomondo (FitRec) recorded workouts"`.
- The artifact is served from `trana-web.vercel.app/models/duration_model.json`
  — 960 trees, 376 KB, verified live.
- Plans saved through the UI persist to `public.predictions` with
  `model_version: 20261121.0023` and `basis: gradient_boosted_pace_factor`.
- 150 backend feature tests, 104 ML tests, 41 frontend smoke scripts, all green
  in CI.

If asked how confident I am right now: the read path is exercised, the write
path is exercised, and the number of saved production predictions is small
because the app is new. I would not claim production accuracy from a handful of
rows — the accuracy claim rests on the held-out benchmark, not on traffic.

### Q19. What are your limitations?

Volunteer these. Each one is documented in `SHIPPING.md` §3.

1. **Walk and hike are not evidenced.** n=7 each in the holdout. Hike has only 51
   workouts in the entire corpus. Predictions for hiking are the weakest thing
   the system produces and should be labelled as such.
2. **Distance is reconstructed, not recorded.** `distance_km ≈ 4 × gps_spread ×
   111.32`, which reproduces correct median speeds but under-estimates long
   point-to-point routes.
3. **Elevation is a band, not a gain.** `alt_range ÷ 2` is the climb of an
   out-and-back, so it is a lower bound on a one-way ascent.
4. **Intervals under-cover** at 65.5% against a nominal 80%. Mitigated in the UI
   by showing the measured error band instead.
5. **No post-hoc calibration** of the interval.
6. **The shipped artifact saw the holdout athletes during the final refit**, so
   its own card metrics are an upper bound; the benchmark candidate is the
   generalisation estimate.
7. **GeoLife transfer degraded** after the corpus swap (MAE 5.84 → 7.08 min,
   MdAPE 23.8% → 36.86%, R² 0.414 → 0.225).
8. **Tree ensembles are not monotonic.** Adding climb can, in sparse regions of
   the feature space, produce a locally *shorter* prediction. This is a known
   property of unconstrained gradient boosting and it is not corrected for.

### Q20. What would you do with more time?

In priority order, and say why for each:

1. **Fit interval calibration.** Conformal or isotonic on the Endomondo holdout.
   Coverage is the weakest product-facing metric and it is the cheapest to fix.
2. **Get a labelled hike corpus.** 51 hikes is not a corpus. This is the single
   highest-value data addition.
3. **Enforce monotonicity** in the elevation and distance features, using
   `HistGradientBoostingRegressor`'s monotonic constraints, so more climbing can
   never predict less time.
4. **Record real distance and elevation** rather than reconstructing them.
5. **Personalise the fuelling model** the way duration is personalised — it is
   currently deterministic sports-science rules, and sweat rate is highly
   individual.

---

## 4. Numbers you must know cold

| # | Number | What it is |
|---|---|---|
| 1 | **43,847** | Training rows — real recorded workouts |
| 2 | **218** | Athletes in the training corpus |
| 3 | **8,675** | Held-out workouts in the shipping benchmark |
| 4 | **65** | Held-out athletes, `user_overlap: 0` |
| 5 | **27.60 min** | Held-out MAE — the headline accuracy |
| 6 | **25.6%** | Held-out MdAPE |
| 7 | **0.630** | Held-out R² |
| 8 | **−5.09 min** | Bootstrap improvement, CI [−5.66, −4.50] |
| 9 | **65.5%** | 80% interval coverage |
| 10 | **0.4411** | `elevation_per_km` importance — the strongest feature |
| 11 | **960** | Trees evaluated per prediction (320 × 3 quantiles) |
| 12 | **4,362** | GeoLife rows, external validation only |

If you can hold twelve numbers, hold these twelve. Everything else can be looked
up by naming the file.

---

## 5. Traps — things that will cost marks

| Never say | Say instead |
|---|---|
| "We trained on 100,000 rows" | "43,847 recorded workouts from 218 athletes" — 50,018 is the source count before filtering, 102,343 is the upstream dataset size |
| "Our model is 99% accurate" | "Held-out MdAPE is 25.6% on 8,675 workouts. 0.9924 was the *superseded synthetic* model scoring itself" |
| "We used GeoLife for training" | "GeoLife is external validation only — it never touched training" |
| "The model uses AI to learn your pace" | Name it: gradient-boosted quantile regression + Ridge-fitted Riegel curve |
| "The ML makes it more accurate" | "The personalisation supplies most of the accuracy; the GBM supplies the correction and the interval" |
| "The model is deployed and trained on real data" (without the caveat) | Add: "and its own card metrics are an upper bound because the final refit saw all 218 athletes — the benchmark candidate is the clean estimate" |
| "We used deep learning" | You did not. Do not inflate. |
| "The 80% interval is 80% reliable" | "Nominal 80%, measured 65.5%; the UI shows measured error instead" |
| "It works for any distance" | State the trained ranges: run 1.5–45 km, ride 2–150, walk 0.5–22, hike 2–36 |
| "Hiking works too" | "Hike has 51 workouts total and n=7 in the holdout — I would not claim it" |
| "Retraining definitely improved accuracy" | Quote the paired benchmark, then note the separate retrain study found no difference on a different sample |

### The three questions that decide the defence

**1. "Your ablation shows the gradient boosting adds nothing. Why is it in the
final model?"**

> Accuracy was never the only requirement — the product needs an interval, and
> quantile regression supplies one natively. The ablation was on GeoLife, where
> elevation is unavailable, so the model's strongest feature was pinned at zero.
> That is why it is not the final word. The ship decision was made on the
> 8,675-workout paired benchmark, where the swap cut MAE by 5.09 minutes with a
> CI that excludes zero.

**2. "You refit on all 218 athletes. Isn't your reported accuracy contaminated?"**

> The shipped artifact's own card metrics are an upper bound — yes, and the
> artifact says so in a `note` field. The clean number is the benchmark
> candidate, which saw only the training split: MAE 28.10, R² 0.523. I quote the
> 27.60 figure as the shipping benchmark and 28.10 as the generalisation
> estimate, and I would not present the first as if it were the second.

**3. "Your external error got worse after retraining. Isn't that a regression?"**

> It is a trade-off, and it is reported rather than hidden. GeoLife is almost
> entirely walking and short rides with no elevation data; the Endomondo corpus
> is dominated by running and cycling with elevation. Specialising to the corpus
> that reflects the product's actual sports cost some transfer to GeoLife's
> distribution. I would rather have a model that is right on the sports people
> plan and worse on a benchmark they never use.

Do not get defensive on any of these. You tested your own design, found the
weakness, documented it, and kept what worked. That is engineering.

---

## 6. If you get asked something you don't know

Three honest moves, in order of preference:

1. **Name the artifact.** "That's in `endomondo_study.json` — the per-sport
   breakdown is there; I don't have the slice memorised."
2. **Name the boundary.** "I haven't measured that. GeoLife has no elevation
   data, so I can't tell you how it performs on hilly routes."
3. **Admit it.** "I don't know. That's a gap."

Never invent a number. Every figure here traces to a committed report, and an
examiner who opens `ml/evaluation/reports/` will find out immediately.

---

## 7. The five-minute demo, in order

Run it in this sequence — each step proves something the previous one did not.

| # | Action | What it proves |
|---|---|---|
| 1 | Open `trana-web.vercel.app` | Deployed, live, loads fast |
| 2 | Analytics → Duration model card | Model version, corpus size, held-out metrics, feature importances |
| 3 | Plan Activity → type `10`, elevation `120` | Prediction appears instantly — the model runs client-side |
| 4 | Change elevation to `0`, then `400` | Output moves — elevation is the dominant feature |
| 5 | Save plan → Dashboard | Row persists, "Next planned session" card appears |
| 6 | Track Activity → start a session | Live tracking, MET-based live burn, fuelling targets |
| 7 | Complete it → Analytics | Completed activity flows into trends, not the plan list |

**Before you demo, check:** log in once yourself. The post-login paths are the
only ones not covered by automated tests, and a stale PWA cache can serve an old
model card — hard-refresh with **Ctrl+Shift+R** if the Analytics numbers look
wrong.

**If asked why plans don't appear in Analytics:** plans are intent, activities
are evidence. Analytics measures what you actually did — feeding predicted
durations into a pace trend would make your personal bests things you never ran.

---

## 8. Where the evidence lives

| Claim | File |
|---|---|
| Shipped model, version, importances, card metrics | `ml/duration_model/model_card.json` |
| Why the weights changed, before/after, limitations | `ml/SHIPPING.md` |
| Shipping benchmark, per-sport, bootstrap CI | `ml/evaluation/reports/endomondo_study.json` |
| Before/after on the same 65 athletes | `ml/evaluation/reports/endomondo_upgrade.json` |
| External validation on real GPS | `ml/evaluation/reports/geolife_validation.json` |
| Curve vs model vs population prior | `ml/evaluation/reports/ablation_report.json` |
| Small-retrain study (no difference found) | `ml/evaluation/reports/retrain_study.json` |
| What the corpus actually contains | `ml/evaluation/reports/endomondo_dataset_summary.json` |
| The actual trees and feature order | `frontend/public/models/duration_model.json` |
| Training loop | `ml/duration_model/train.py` |
| Curve fitting, leakage guard, features | `ml/duration_model/preprocess.py` |
| Full method write-up | `docs/ml-methodology.md` |
| Architecture, API, database, tests | `docs/architecture.md`, `docs/api.md`, `docs/database.md`, `docs/test-report.md` |
