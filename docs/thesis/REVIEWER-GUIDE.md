# TRANA — Reviewer / Panel Guide

A defence companion for the machine-learning component. Every number here is
traceable to a committed artifact; the source is named beside it.

Use this in three passes:

1. **§1** — memorise the one-paragraph answer. It is the answer to "explain your ML."
2. **§3** — rehearse the questions. Panels ask the same twenty.
3. **§5** — read the traps. Most lost marks are lost here, not on the model.

---

## 1. The answer to "explain your machine learning"

> TRANA predicts how long a planned endurance activity will take, and uses that
> prediction to build a fueling plan.
>
> The model works in **two stacked stages**. Stage one is a *personalised Riegel
> reference curve*: a power law fitted from the athlete's own past sessions,
> where time scales with distance raised to an exponent near 1.06. That gives a
> physics-grounded baseline with no machine learning at all. Stage two is a
> *gradient-boosted quantile regressor* that learns a multiplicative correction
> on top of that curve — it only has to learn the part the physics gets wrong.
> Three models predict the 10th, 50th and 90th percentile of that correction,
> which is what turns a single number into an honest range.
>
> It is trained on 8,845 generated activity rows and validated on 4,362 real
> GPS trajectories it never saw. On that external set the median absolute
> percentage error is **23.84%** and R² is **0.414**.

That paragraph is defensible end to end. Everything below supports it.

---

## 2. The pipeline, in the order it runs

### 2.1 Input the athlete supplies

| Field | Type | Note |
|---|---|---|
| Activity type | run / ride / walk / hike | One-hot encoded into 4 flags |
| Distance | km | The dominant raw input |
| Elevation gain | m | Becomes `elevation_per_km`, the strongest feature |

Everything else is derived. The athlete types three things; that is deliberate,
because every extra required field is a reason to abandon the form.

### 2.2 Step 1 — build the athlete's history (the leakage guard)

For the activity being predicted, collect the athlete's **prior** sessions of
**the same modality**, sorted by start time, keeping only records strictly
earlier than the current one. The current activity is excluded by id.

> **Why the panel will like this:** this is the single most important line of
> code in the project. It is what stops the model being scored on information it
> would not have at prediction time. Say it explicitly.

### 2.3 Step 2 — fit the reference curve

Fit `log t = a + b · log d` by weighted least squares, with three constraints:

| Constraint | Value | Why |
|---|---|---|
| Ridge shrinkage toward the Riegel prior | 0.25 | Makes an athlete with 3 sessions usable instead of wild |
| Riegel priors by modality | run 1.06, walk 1.06, hike 1.15, ride 1.03 | Published literature |
| Clip the exponent | `b ∈ [1.00, 1.30]` | Prevents negative fatigue — a curve claiming a marathon is faster per km than a 5 km |

**No history?** Fall back to a population speed: run 8.8, ride 20.0, walk 4.7,
hike 3.6 km/h, scaled by experience level. This is the cold-start path.

**One history point?** Fit `a` through that point using the prior exponent.
**Two or more?** Weighted Ridge regression above.

### 2.4 Step 3 — build the training target

The target is **not** duration in minutes. It is:

```
log( duration ÷ flat-equivalent curve time )
```

A dimensionless correction factor centred near 1.0.

> **Why this matters:** the model cannot invent a duration wildly inconsistent
> with the athlete's own curve, and because the factor is multiplicative the
> interval stays positive and scales naturally with session length. If a
> panellist asks "why not just regress minutes directly?", this is the answer.

### 2.5 Step 4 — train three quantile models

```python
GradientBoostingRegressor(
    loss="quantile", alpha=0.10,      # and 0.50, 0.90
    n_estimators=320,
    learning_rate=0.06,
    max_depth=3,
    min_samples_leaf=12,
    subsample=0.9,
)
```

**Exactly two algorithms in the whole project**: gradient boosting (3× quantile)
and Ridge (for the curve exponent). That is the complete list. Do not oversell it.

### 2.6 Step 5 — the nine features

| # | Feature | Importance | Role |
|---|---|---|---|
| 1 | `elevation_per_km` | **0.6849** | Terrain. Dominates everything. |
| 2 | `history_count` | **0.1516** | How much the model should trust its own correction |
| 3 | `elevation_gain_m` | 0.0473 | Absolute climb |
| 4 | `distance_km` | 0.0372 | Session length |
| 5 | `is_ride` | 0.0347 | Modality |
| 6 | `is_run` | 0.0220 | Modality |
| 7 | `is_hike` | 0.0101 | Modality |
| 8 | `is_walk` | 0.0061 | Modality |
| 9 | `experience_level` | 0.0061 | Sets the cold-start fallback speed |

**Headline:** terrain, not raw distance, explains most of the residual. That is
a finding worth stating out loud — it is why the model needs elevation at all.

### 2.7 Step 6 — inference

```
factor  = clip( exp(model.predict(features)), 0.7, 3.0 )
minutes = base_minutes × factor
```

Guard rails applied after:

- **Clip 0.7–3.0** — never more than 3× or less than 70% of the athlete's own curve
- **Non-crossing** — q10 can never exceed q50, q90 can never fall below q50
- **OOD widening** — distance beyond the trained domain halves confidence

### 2.8 Step 7 — the interval the user sees

Two different things are shown, and a panel may test whether you know the
difference:

| Layer | Source | Purpose |
|---|---|---|
| Model interval | q10 / q90 from the regressor | The model's own statistical spread |
| Displayed range | `VALIDATED_ERROR_PCT` — run 28.2%, ride 25.7%, walk 40.5% | What the model has *demonstrated* outward |

`VALIDATED_ERROR_PCT` is calibrated to measured external error, **not** to the
model's internal claim. That is why the app shows ±28% for a run rather than the
narrower interval the q10/q90 spread would suggest. The model was overconfident;
the display was corrected to match reality.

---

## 3. The twenty questions panels actually ask

### Q1. What does your system predict?

Elapsed activity duration, in minutes, for a planned session that has not
happened. Downstream, that duration drives carbohydrate, fluid and sodium
targets.

### Q2. Why machine learning instead of just a formula?

A formula captures the *average* fatigue behaviour of a population. It cannot
capture that one athlete climbs well and another deteriorates badly past 20 km.
Those systematic residuals are learnable from history and are not expressible in
a fixed equation. The evidence: the personal curve beats the population prior by
**17.9% in MAE (7.10 → 5.83)** — that gap is the learnable part.

### Q3. What algorithm, and why that one?

Gradient-boosted quantile regression. Four reasons:

1. Features interact non-linearly — the climb penalty accelerates on steep
   grades, and differently for cycling than hiking.
2. Quantile loss gives an interval as a first-class output, without assuming
   symmetric errors.
3. 8,845 rows is too small for a neural network, ample for shallow boosted trees.
4. The target is a *correction on a strong baseline*, so the model only learns
   the residual.

### Q4. What is your dataset?

Answer in three parts — this is the distinction that separates a strong defence
from a weak one:

| Dataset | Rows | Role |
|---|---|---|
| Synthetic corpus (generated in-repo) | 8,845 | **Training** |
| GeoLife GPS Trajectories | 4,362 (51 users) | **External validation** |
| FitRec / Endomondo | 33,884 history + 14,656 held out = 48,540 (209 athletes) | **Personalisation study only** |

Only the first trains the deployed model. Never blur these.

Expect a follow-up: *"where did 48,540 come from?"* — 209 athletes appear in both
folds of a chronological within-athlete split, giving 33,884 history rows and
14,656 held-out rows. Those numbers live in §4.3.3 of the documentation; the
Endomondo CSV itself is gitignored under the no-redistribution licence.

### Q5. How did you split your data?

**By user, not by row.** `GroupShuffleSplit` on `user_id`, 7,011 train / 1,834
test. No athlete appears in both halves.

> A random row split would put the same person's sessions on both sides, and
> because `history_count` is a feature, the model would memorise the individual
> and report an accuracy that never transfers to a new user.

### Q6. Why quantile regression and not ordinary regression?

Ordinary least squares gives a conditional mean plus a residual standard
deviation — which assumes symmetry and constant variance. Both are false here:
the error in minutes grows with session length. Quantile loss makes no
distributional assumption and produces the interval directly.

### Q7. Why predict a factor instead of minutes?

Three reasons: it is scale-free across modalities whose durations differ by an
order of magnitude; it cannot produce a duration wildly inconsistent with the
athlete's own curve; and the interval stays positive under multiplication.

### Q8. What is the Riegel curve?

A power law from running physiology: `t₂ = t₁ × (d₂/d₁)^b`, where `b` is roughly
1.06. TRANA fits `a` and `b` per athlete rather than assuming them, shrinking
`b` toward the published prior so thin histories stay stable.

### Q9. What are your features and which matters most?

Nine, listed in §2.6. **`elevation_per_km` at 0.6849** — nearly seven times the
next feature. Terrain drives the residual, not distance.

### Q10. How do you avoid data leakage?

Four independent defences:

1. **User-level split** — prevents memorising individuals
2. **Chronological history construction** — prevents future informing past
3. **Target uses only prior data** — the curve cannot know the answer
4. **Feature audit dropped three derived columns** — `points_per_sec`,
   `climb_rate`, `gps_spread` were each a function of the target

Say all four. One is not convincing; four is a system.

### Q11. What metrics did you use?

MAE (interpretable in minutes), MAPE and MdAPE (scale-free), Within-15% and
Within-20% (hit rates — how often the plan is close enough to fuel from), R²
(variance explained), and **interval coverage** (does the claimed range actually
contain the truth).

### Q12. What is your accuracy?

Two answers, and give both:

| Context | Result |
|---|---|
| **External (real data)** | MAE **5.84 min**, MdAPE **23.84%**, R² **0.414**, Within-20% **43.81%** |
| Internal (synthetic holdout) | MAE 5.76, R² 0.9924 — **a self-score, not a result** |

Lead with the external number. Volunteer the synthetic one as a contrast.

### Q13. Why is your R² 0.99 in the model card but 0.41 here?

Because the 0.9924 is measured on data produced by the same generator that
produced the training data. It measures *consistency with its own assumptions*,
not accuracy against reality. The external 0.414 is the honest figure. The gap
between them is the entire lesson of the evaluation.

> Say this calmly and early. If they find it before you explain it, it looks
> like concealment.

### Q14. What is interval coverage, and why is 16.96% a problem?

The model claims an 80% interval. On real data only **16.96%** of actual
durations fall inside it. The interval is far too narrow — the model is
overconfident.

This is the single most important finding in the evaluation. It is reported, not
hidden, and the retraining study identifies the cause and quantifies the fix
(see Q17).

### Q15. Your ML model barely helps. Why keep it?

Honest answer: **on point accuracy it does not earn its place.** On 4,362 real
trajectories:

| Model | MAE | R² |
|---|---|---|
| Population prior | 7.10 | — |
| Reference curve alone | **5.83** | 0.415 |
| Curve + GBM (shipped) | 5.84 | 0.414 |

A difference of 0.01 minutes. The correction is kept for three things it
provides that the bare curve does not: the **quantile interval**, the **guard
rails**, and **graceful cold-start behaviour**. Not for accuracy.

> Volunteering a negative result about your own component is one of the
> strongest things you can do in a defence. It demonstrates you tested your own
> design instead of assuming it.

### Q16. Did you train on real data?

No. The deployed model was trained on the synthetic corpus; `model_card.json`
records `"training_source": "synthetic"`. Real data requires consent and
pseudonymisation; none was available during development.

What you *did* do is measure what would change — see Q17.

### Q17. What would happen if you retrained on real data?

You measured it. The held-out retraining study split 51 GeoLife users 36/15,
retrained on real data only, and scored both arms on the same 1,085 unseen rows:

| Metric | Shipped | Retrained | Change |
|---|---|---|---|
| MAE | 6.17 | 6.11 | −0.06 |
| MdAPE | 26.68% | 24.42% | −2.26 pts |
| Within-20% | 38.71% | 42.49% | +3.78 pts |
| **Coverage** | **15.94%** | **67.83%** | **+51.89 pts** |

The paired bootstrap over 2,000 draws gives a 95% CI on the MAE difference of
**[−0.071, +0.184] minutes** — straddling zero. So retraining produced **no
measurable accuracy change**, but it roughly quadrupled interval coverage.

**That is the finding.** The calibration defect was a *data* problem, not a
modelling one, and the fix is quantified.

### Q18. How do you know it works in production?

Three answers: the browser evaluator and the Python service are verified to
produce identical output from the same exported trees; the external validation
runs the same walk-forward protocol production uses; and the app labels its own
model as synthetic-trained in Settings → Prediction engine, so the user is not
misled.

Be honest that real-world accuracy on hilly routes is **unmeasured** — GeoLife
has no terrain data, so the strongest feature was zeroed during validation.

### Q19. What are your limitations?

Pick the three that matter, not all eight:

1. **Calibration** — 16.96% coverage against a nominal 80%
2. **Elevation blind** — validation could not test the dominant feature
3. **Synthetic training** — the shipped model has never seen a real athlete

Full list is Table in §4.5 of the documentation.

### Q20. What would you do with more time?

In priority order: obtain consented real activity data and refit (this alone
should lift coverage toward 67.83%); validate elevation against real terrain;
collect more running trajectories (the current slice has **n=2** and supports no
conclusion); and replace the static `VALIDATED_ERROR_PCT` table with a
per-prediction calibrated spread.

---

## 4. Numbers you must know cold

If you can recite these ten without looking, you will survive the technical
questions:

| # | Number | What it is |
|---|---|---|
| 1 | **8,845** | Training rows (7,011 / 1,834 split) |
| 2 | **4,362** | External validation rows, 51 users |
| 3 | **9** | Number of features |
| 4 | **5.84 min** | External MAE |
| 5 | **23.84%** | External MdAPE — the headline accuracy |
| 6 | **0.414** | External R² |
| 7 | **16.96%** | Interval coverage (bad — nominal is 80%) |
| 8 | **0.6849** | `elevation_per_km` importance |
| 9 | **7.10 → 5.83** | Population prior → personal curve (the real win) |
| 10 | **15.94% → 67.83%** | Coverage after retraining on real data |

Plus one contrast pair, because it will be asked:

**Cold start 11.80 min MAE → personalised 5.62 min.** Personalisation is worth
roughly a factor of two. That is the mechanism the product depends on.

---

## 5. Traps — things that will cost you marks

| Never say | Say instead |
|---|---|
| "We trained on 100,000 rows" | "We trained on 8,845 generated rows" — the 102,343 figure is the *upstream Endomondo size*, not your training set |
| "Our model is 99% accurate" | "R² 0.9924 is a synthetic self-score; the honest external figure is R² 0.414, MdAPE 23.84%" |
| "We used GeoLife for training" | "GeoLife is external validation only" |
| "The model uses AI to learn your pace" | Name the two algorithms: gradient-boosted quantile regression + Ridge |
| "The ML makes it more accurate" | "The ML supplies the interval and guard rails; the *personalisation* supplies the accuracy" |
| "We used deep learning" | You did not. Do not inflate. |
| "The interval is 80% reliable" | "Nominal 80%, measured 16.96% — currently miscalibrated, cause identified" |
| "It works for any distance" | State the trained ranges: run 1.5–45 km, ride 2–150, walk 0.5–22, hike 2–36 |

### The one question that decides the defence

> **"Your ablation shows the gradient boosting adds nothing. Why is it in the
> final model?"**

Answer: *"Because accuracy was never the only requirement. The product needs an
uncertainty interval, and quantile regression supplies one natively. The
ablation shows the correction is accuracy-neutral on real data — 5.83 versus
5.84 minutes, well inside noise — and it is what produces the q10/q90 bounds,
the 0.7–3.0 guard rails, and usable output for a brand-new account. I would not
claim it improves accuracy, and the documentation does not."*

Do not get defensive. You tested your own design, found it neutral, and kept it
for a stated reason. That is engineering.

---

## 6. If you get asked something you don't know

Three honest moves, in order of preference:

1. **Name the artifact.** "That's measured in the ablation report — MAE 5.83 vs
   5.84 — I don't have the per-slice breakdown memorised."
2. **Name the boundary.** "That's outside what I validated. GeoLife has no
   elevation data, so I can't tell you how it performs on hilly routes."
3. **Admit it.** "I don't know. That's a gap."

Never invent a number. Every figure in the documentation is traceable to a
committed report, and an examiner who opens `ml/evaluation/reports/` will find
out immediately.

---

## 7. Where the evidence lives

| Claim | File |
|---|---|
| External accuracy, by modality, by history depth | `ml/evaluation/reports/geolife_validation.json` |
| Curve vs model vs population prior | `ml/evaluation/reports/ablation_report.json` |
| Retraining study, bootstrap CI | `ml/evaluation/reports/retrain_study.json` |
| Shipped model, version, feature importances | `ml/duration_model/model_card.json` |
| The actual trees and feature order | `frontend/public/models/duration_model.json` |
| Training loop | `ml/duration_model/train.py` |
| Curve fitting, leakage guard, feature order | `ml/duration_model/preprocess.py` |
| Inference endpoints | `ml/api/main.py` |
| Browser evaluator, displayed error table | `frontend/src/lib/ml/duration.js` |
| Corpus generator | `ml/data/generate_dataset.py` |
| GeoLife derivation and licence | `ml/data/external/README.md` |

If a panellist asks to see a number, open the JSON. Do not reconstruct it.
