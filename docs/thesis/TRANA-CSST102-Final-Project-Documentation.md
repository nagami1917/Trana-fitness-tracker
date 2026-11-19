# TRANA — CSST 102 Final Project Documentation

**CSST 102 – BASIC MACHINE LEARNING**
**FINAL PROJECT DOCUMENTATION**

| | |
|---|---|
| **PROJECT NAME** | TRANA — Predictive Activity Duration & Fueling System |
| **PROPONENTS** | [SURNAME, First Name] · [SURNAME, First Name] · [SURNAME, First Name] |
| **YEAR AND SECTION** | [Year and Section] |

> **The `.docx` is the deliverable.** This Markdown file is the same content in
> reviewable form: it exists so the group can read, diff, and edit the text
> without Word. Regenerate the `.docx` after editing here only if you re-run the
> build script — otherwise edit the `.docx` directly.

---

## Contents

1. [Project Overview](#1-project-overview)
2. [Dataset and Data Preprocessing](#2-dataset-and-data-preprocessing)
3. [Machine Learning Model Development](#3-machine-learning-model-development)
4. [Model Evaluation and Interpretation](#4-model-evaluation-and-interpretation)
5. [Web Application Development and Output](#5-web-application-development-and-output)
6. [Group Contributions](#6-group-contributions)
7. [Conclusion](#7-conclusion)
- [Appendix A — Reproducing the Results](#appendix-a--reproducing-the-results)
- [Appendix B — Complete Metric Tables](#appendix-b--complete-metric-tables)
- [Appendix C — Glossary](#appendix-c--glossary)

---

## Document conventions

Four conventions are used throughout.

- **Traceability.** Every reported number is traceable to a file in the repository or to a named report under `ml/evaluation/reports/`. Where a number could be misread as better than it is, the raw JSON path is given alongside it.
- **Honesty over flattery.** Metrics that are tautological by construction are labelled as such at the point of first use, not quietly omitted. The synthetic R² of 0.9924 appears only inside a table whose caption says it is not a real-world measure.
- **Negative results are results.** The ablation showing the learned correction does not beat the curve is Section 4.3, not a footnote.
- **Code is quoted, not paraphrased.** Code appears with the file and line range named.

---

# 1. PROJECT OVERVIEW

## 1.1 Project Description

TRANA is a web application that predicts how long an athletic session will take and, from that prediction, tells the athlete how much carbohydrate, sodium, and fluid to carry. The user chooses an activity type (run, ride, walk, or hike), enters a planned distance and elevation gain, and receives a duration estimate in minutes with a lower and upper bound. The estimate is then carried forward into a fueling plan stating grams of carbohydrate per hour, milligrams of sodium per hour, millilitres of fluid per hour, and — if the athlete has entered their own kit — the number of gels, bottles, and electrolyte capsules required.

The problem it addresses is a preparation problem, not a tracking problem. Existing fitness applications record what already happened. They answer "how far did I go?" after the session is over. An athlete at the start line of a long run or a sportive has a different question: "if I set out for 21 km with 300 m of climbing, when will I be back, and how much should I eat?" Getting that wrong has consequences from a ruined training block to a bonked race. Underestimating duration means running out of fuel and water; overestimating means carrying unnecessary weight for four hours.

What makes this a machine-learning problem rather than a table lookup is that the same distance takes wildly different times for different people, and for the same person on different days. A 10 km run is 42 minutes for one athlete and 75 minutes for another; a hilly 40 km ride can take longer than a flat 60 km ride. A single population average cannot serve either case. TRANA therefore learns from the athlete's own history.

**The core prediction, stated precisely**

> `duration_minutes = base_minutes(distance) × exp(f(features))`
> where `base_minutes = exp(a + b·ln(distance))` is the athlete's own Riegel reference curve fitted from their prior sessions of the same sport, and `f(·)` is a gradient-boosted regressor trained on nine features that outputs a multiplicative pace-factor correction. Three such regressors are trained at the 10th, 50th, and 90th quantiles, producing the interval rather than a point.

The machine-learning component is genuinely load-bearing but deliberately not the whole story. Section 4.3 reports, candidly, that on external data the learned correction is statistically indistinguishable from the curve alone. That finding is part of the project's contribution rather than a failure of it: the work measures its own model honestly, diagnoses the cause of the gap, and demonstrates the fix.

### How machine learning generates the prediction, step by step

1. **Input collection.** The browser collects activity type, distance, elevation gain, and the session history. All four are things the athlete knows before they leave.
2. **Reference curve fitting.** From prior sessions of that sport, a weighted Ridge regression fits the Riegel exponent *b* in *time ∝ distance^b*, shrunk toward a sport-specific prior and bounded to [1.00, 1.30]. With no history, a population prior is used and the prediction is labelled cold-start.
3. **Feature construction.** Nine features: distance, absolute elevation gain, elevation gain per kilometre, experience level, history count, and four one-hot activity-type flags.
4. **Learned correction.** The gradient-boosted trees output a log pace-factor per quantile. Exponentiation returns a multiplier, clamped to [0.7, 3.0] as a guard against out-of-range input.
5. **Composition.** Curve × multiplier yields the median estimate; the q10 and q90 branches yield the bounds. Bounds are forced non-crossing and floored at one minute.
6. **Handoff to the fuelling engine.** The predicted duration drives the ACSM metabolic calculation: `kcal = MET × mass × hours`, and carbohydrate/sodium/fluid targets are selected by duration band and intensity.

One architectural detail matters for the credibility of the whole system: the same gradient-boosted ensemble is exported to a JSON tree representation and evaluated twice — once by scikit-learn on the server, and once by a hand-written tree walker in the browser (`frontend/src/lib/ml/duration.js`). The browser copy exists so the interface can show an instant preview while the athlete is still adjusting the distance slider, without a network round trip. Both paths consume the same exported artifact and are tested to agree.

## 1.2 Project Objectives

### General Objective

To design, develop, and evaluate a predictive machine-learning web application that forecasts the duration of a planned endurance activity from an athlete's own history and converts that forecast into an actionable fueling plan.

### Specific Objectives

- **Build a reproducible training pipeline.** Produce a training script that consumes a documented dataset contract, is invokable from the command line for both synthetic and real data sources, and emits a versioned artifact plus a model card recording every metric and hyperparameter needed to audit it.
- **Engineer features that encode real physiology.** Rather than feeding raw distance and elevation to a black box, normalise history to flat-equivalent time and fit a Riegel curve, so the learned component only has to model the residual pace factor.
- **Produce calibrated uncertainty, not just a point estimate.** Train quantile regressors so the application can state a range, and measure empirical interval coverage against the nominal 80% target.
- **Validate on data the model has never seen.** Obtain and evaluate against an independent external dataset (GeoLife GPS Trajectories), using a per-user chronological protocol that forbids any use of future data, and report the resulting metrics as the honest accuracy figure.
- **Audit the model adversarially and report the outcome.** Run an ablation that isolates the learned correction from the reference curve it multiplies, and place a bootstrap confidence interval on the difference.
- **Diagnose and remedy the identified defect.** Determine why interval coverage is low, then run a held-out user retraining study to test whether the defect is a modelling limit or a training-data artefact.
- **Deliver a working, deployed application.** Ship a progressive web app with authentication, activity logging, planning, analytics, and the prediction feature, deployed and publicly reachable.
- **Make the system honest in its interface.** Surface the externally validated error margin in the user interface rather than the flattering in-distribution number.

| Objective | How it is verified | Evidence |
|---|---|---|
| Reproducible pipeline | Deterministic re-run with fixed seed reproduces identical metrics | `ml/evaluation/retrain_study.py`; report JSON |
| Physiological features | Curve parameters bounded and inspected; features documented | `ml/duration_model/preprocess.py` |
| Calibrated uncertainty | Empirical coverage measured against 80% nominal | `geolife_validation.json` → `interval_coverage_pct` |
| External validation | 4,362 activities from 51 unseen users | `ml/evaluation/reports/geolife_validation.json` |
| Adversarial audit | Paired bootstrap over 2,000 resamples | `ml/evaluation/reports/ablation_report.json` |
| Diagnose and remedy | User-disjoint 70/30 retrain study, 3 seeds | `ml/evaluation/reports/retrain_study.json` |
| Deployed application | Public URL, health endpoint returns `model_ready` | `https://trana-web.vercel.app` |
| Honest interface | Error margin sourced from the GeoLife report | `frontend/src/lib/ml/duration.js` → `VALIDATED_ERROR_PCT` |

## 1.3 Problem Definition

### The specific problem

An endurance athlete preparing for a session must decide two things before starting: how long to budget, and how much fuel and fluid to carry. Both are currently made by guesswork or by consulting a flat pace table that ignores terrain, personal history, and the shape of the athlete's own fatigue curve. A pace table says a 5:30/km runner needs 1h 56m for a half marathon; it does not know that this athlete fades badly after 15 km, or that the course climbs 400 m.

### Intended users

- **Recreational runners and cyclists** — train 3–6 times per week, plan sessions the night before, have a phone but no coach. The primary user and the group the interface is designed for.
- **Hikers and walkers** — the largest duration uncertainty of any modality (40.5% MAPE for walking) and therefore the group that benefits most from an honest range.
- **Beginner athletes with no history** — the cold-start case. The system must still produce a defensible estimate and must say so, rather than silently guessing.
- **Race-day planners** — use the fueling output, not the duration output, as the primary artifact: a gel schedule pinned to the predicted finish time.

### Required input

| Input | Type | Source | Required? |
|---|---|---|---|
| `activity_type` | run / ride / walk / hike | User selection | Yes |
| `distance_km` | float > 0 | User entry or drawn route | Yes |
| `elevation_gain_m` | float ≥ 0 | User entry or route lookup | No (defaults 0) |
| `history[]` | prior sessions (type, distance, duration, timestamp) | Logged activities | No (cold start allowed) |
| `weight_kg` | float | Profile | Yes for fueling |
| `sweat_profile` | low / normal / high | Profile | No (default normal) |
| `temperature_c` | float | User entry or profile | No (default 26) |

### Expected output

The system returns a duration in minutes (q50), a lower bound (q10), an upper bound (q90), a `basis` string identifying which code path produced the answer (`gradient_boosted_pace_factor` or `physics_fallback`), and — where history exists — the reference curve parameters the correction was applied to. The fueling block returns kcal, carbohydrate g/h, sodium mg/h, fluid ml/h, an intensity label, and a scheduled list of intake items at fixed intervals.

```json
{
  "minutes": 110.4,
  "range": { "low": 92.1, "high": 131.8 },
  "basis": "gradient_boosted_pace_factor",
  "reference_curve": { "a": 2.71, "b": 1.06 },
  "fueling": {
    "kcal_total": 1180, "carbs_per_hour_g": 60, "sodium_per_hour_mg": 550,
    "fluid_per_hour_ml": 650, "intensity": "moderate"
  }
}
```

*(Values are representative of the response shape, not a recorded call.)*

### Why this problem is suitable for a machine-learning approach

- **A genuine target variable exists.** Duration is recorded to the minute in every activity log. No proxy, no human labelling, no ambiguity: the target is measured, not inferred.
- **The relationship is non-linear and interacting.** Duration scales super-linearly with distance (Riegel's exponent > 1), grows with elevation gain per kilometre, and the penalty for climbing depends on modality. Trees capture those interactions without hand-specifying them.
- **There is per-user signal worth personalising.** Two athletes of the same fitness differ by tens of percent at the same distance. A model that conditions on the athlete's own history can serve both.
- **Errors are asymmetric in cost, so uncertainty has value.** Under-predicting duration means under-fuelling. A quantile model saying "110 minutes, likely between 92 and 132" lets the athlete pack for 132. A point estimate does not.

It is equally worth stating what does *not* need machine learning. The fueling calculation is closed-form physiology — MET-based energy expenditure and ACSM/ISSN carbohydrate guidance. Attaching a neural network to a formula that already has a derivation would add opacity without accuracy, and for a health-facing feature that is a bad trade. The split is deliberate: learn what is genuinely empirical (duration), derive what is genuinely physical (fueling).

### Scope boundaries

| In scope | Out of scope, and why |
|---|---|
| Duration prediction for run / ride / walk / hike | Swimming and strength training have no distance-duration coupling to learn from |
| Fueling targets in carbohydrate, sodium, fluid | Individual sweat-sodium testing requires lab equipment the project does not have |
| Activity logging, planning, analytics, goals | Real-time GPS navigation during a session (crowded by mature competitors; not an ML problem) |
| External validation on an independent public dataset | Collecting a primary dataset from real TRANA users — not available within the timeline; Section 4.5 treats this as the principal limitation |
| Held-out retraining study to test the data hypothesis | Deploying the retrained GeoLife model — it cannot serve runs and hikes (n=2 runs in 4,362 rows) |

---

# 2. DATASET AND DATA PREPROCESSING

This project uses three datasets for three different jobs, and keeping them distinct is central to the credibility of the results. One corpus trains the shipped model. One evaluates it externally, on people and GPS traces it has never seen. One subset of that external corpus is then used to test the retraining hypothesis. Conflating any two would invalidate the numbers.

| Dataset | Role | Rows | Users | Used for |
|---|---|---|---|---|
| Synthetic corpus (physics generator) | Training corpus for the shipped model | 8,845 | 240 | Fitting q10/q50/q90 trees |
| GeoLife GPS Trajectories (external) | Independent evaluation set | 4,362 | 51 | Honest accuracy, ablation, diagnosis |
| GeoLife, user-disjoint 70/30 split | Retraining experiment | 3,277 train / 1,085 holdout | 36 / 15 | Testing the data-artefact hypothesis |

## 2.1 Dataset Description

### 2.1.1 Primary training corpus — physics-informed synthetic generator

The production database starts empty. A brand-new user has no history, and no public dataset of Filipino recreational athletes' training logs is available to this project. Training the shipped model therefore required bootstrapping a corpus that encodes the physiological relationships the model is supposed to learn, so a new account receives a defensible estimate before it has any data of its own.

The generator (`ml/data/generate_dataset.py`) simulates 240 athletes with individual fitness factors, each logging 12 to 60 activities across the four modalities. Each athlete has a persistent fitness multiplier and a fatigue-skill parameter, so the corpus contains both between-athlete variation (which the model must learn to condition on) and within-athlete variation (day-to-day form, weather, traffic). Speeds are drawn from a base speed per modality and then modified by four physiologically motivated terms:

```python
base            = BASE_SPEED_KMH[activity_type]      # 9.6 run, 22.0 ride, 5.0 walk, 3.9 hike
climb_penalty   = 1 / (1 + CLIMB_SENSITIVITY[type] * elevation_per_km / 100)
fatigue         = (max(distance_km, 0.5) / REF_DIST_KM[type]) ** (-fatigue_exp)
speed           = base * fitness * modality_bias * climb_penalty * fatigue
speed          *= clip(normal(1.0, 0.055), 0.82, 1.2)   # day-to-day form
duration_min    = distance_km / speed * 60.0            # <-- the target
```

> **Why the synthetic R² cannot be quoted as accuracy**
> The line `duration_min = distance_km / speed * 60.0` makes the target a deterministic function of variables the model also receives. Any model with enough capacity will recover most of that function, so the reported R² of 0.9924 and MAPE of 5.51% measure the generator, not the world. They are reported exactly once, in Table 4.3, captioned as tautological, and are never used as the project's accuracy claim. This is the single most important methodological caveat in the work.

The corpus is also honest about what it excludes: no wind, no altitude, no heat acclimation, no injury state. Those omissions are recorded in the generator docstring and are why the retraining study was worth running rather than assuming the synthetic model was adequate.

### 2.1.2 External evaluation corpus — GeoLife GPS Trajectories

Microsoft Research released the GeoLife GPS Trajectories dataset (v1.3) in 2008 for trajectory-mining research. 182 volunteers in Beijing recorded their movement continuously over roughly five years. The raw data is a set of `.plt` files containing latitude, longitude, and timestamp at one sample every 1–5 seconds. Those raw traces are not directly usable for duration prediction: they must be segmented into trips, and each trip labelled with a transportation mode.

This project uses the pre-segmented feature table published by the Beijing Trajectories Project, which supplies, per trip, the start time, elapsed duration, distance, mean speed, and a mode label. That table is reduced to activities comparable to a training session: bicycle → ride, walk → walk, and all motorised modes (car, bus, taxi, subway, train) excluded because they are not exercise and have a completely different duration-distance relationship.

| Property | Value |
|---|---|
| Dataset name | GeoLife GPS Trajectories Dataset, version 1.3 |
| Publisher | Microsoft Research Asia |
| Primary reference | Zheng, Y., Xie, X., Wang, L., Yu, Y., Jiang, S. (2008). *Mining interesting locations and travel sequences from GPS trajectories.* WWW '08. |
| Feature-table source | `github.com/jbremz/Beijing-Trajectories-Project` (`Metadata/trajFeatures.csv`) |
| Location | Beijing, China |
| Collection period | April 2007 – December 2011 |
| Rows used | 4,362 activities |
| Users used | 51 volunteers |
| Mode distribution | walk 2,988 (68.5%) · ride 1,372 (31.5%) · run 2 (0.05%) |
| Distance range | 0.03 km – 19.60 km (median trip is a short urban walk or ride) |
| Committed size | 392 KB, `ml/data/external/geolife_activities.csv` |

Two properties make GeoLife a genuinely useful external test set rather than a convenient one. First, it was collected by people who were not TRANA users, five to eight years before this project existed, so there is no possibility of the model having been tuned to them. Second, it is real GPS data with all the messiness that implies — stops at traffic lights, tunnel dropouts, walking through a mall — which means the durations include the pauses an athlete's elapsed-time target also includes. That match in definition matters: TRANA predicts elapsed door-to-door time, not moving time.

Two properties limit it, and both are disclosed rather than glossed over. GeoLife contains no usable elevation: the `.plt` files do carry an altitude column, but it is GPS-derived, with a median of roughly 102 m of apparent gain per kilometre against a true terrain value of 5–15 m/km for Beijing, and individual fixes peaking above 13,000 m. Suppressing that noise correctly requires a digital elevation model the project does not have for Beijing. Elevation is therefore zeroed for both the evaluation and the retraining study, and the report says so in its limitations block. Second, the mode mix is heavily skewed: only two of 4,362 rows are runs. Any run metric computed from GeoLife is computed from n=2 and is reported for completeness only.

### 2.1.3 Retraining experiment split

The retraining study reuses GeoLife but partitions it so no participant appears on both sides. This is the only honest way to ask "would training on real data help?" — if a user's own activities were in the training set, the model could memorise that individual's pace and the study would measure memorisation, not generalisation.

| Split property | Value |
|---|---|
| Split strategy | `GroupShuffleSplit` by `user_id`, 70/30 |
| Train users / holdout users | 36 / 15 |
| Train rows / holdout rows | 3,277 / 1,085 |
| Holdout mode mix | walk 723 (66.6%) · ride 361 (33.3%) · run 1 |
| User overlap | 0 (asserted programmatically — the trainer raises if any overlap) |
| Seeds reported | 7, 11, 23 (each run in turn by editing the `SEED` constant; the committed report is seed 7) |

## 2.2 Dataset Attributes

The following table documents the raw attributes available in each corpus. The feature vector the model actually receives (Section 2.3) is smaller than the raw attribute set — deliberately so, because several raw columns would leak the target or would not be known at prediction time.

| Attribute | Description | Source | Role |
|---|---|---|---|
| `user_id` | Pseudonymous athlete identifier | Both | Grouping key; used for user-level splits and history. **Never a feature.** |
| `activity_type` | run/ride/walk/hike (synthetic); walk/bike (GeoLife) | Both | Four one-hot features |
| `distance_km` | Planned or completed distance | Both | Primary numeric feature |
| `elevation_gain_m` | Cumulative positive gain | Synthetic only (GeoLife = 0) | Feature + `elevation_per_km` |
| `duration_min` | Elapsed time in minutes | Both | **TARGET VARIABLE** |
| `start_time` | Session timestamp | Both | Ordering for chronological history; never a feature |
| `weight_kg` | Athlete body mass | Synthetic; assumption for GeoLife | Fuelling input; not a duration feature |
| `experience_level` | 1–5 fitness | Profile or inferred | Feature |
| `avg_speed_kmh` | Mean speed | GeoLife | Derived from distance/duration; **excluded (leakage)** |
| `calories` | MET-based energy expenditure | Synthetic | Fuelling reference; excluded |
| `source_path` | `.plt` file path | GeoLife | **DROPPED before training** |
| `mode_original` | Raw transport label | GeoLife | **DROPPED before training** |

### 2.2.1 The nine model features

The feature order is part of a contract. It is asserted in Python (`FEATURE_ORDER` in `preprocess.py`), in the exported JSON tree ensemble, and in the JavaScript evaluator, because browser and server must walk the same trees with the same column positions.

| # | Feature | Type | Description | Why it earns its place |
|---|---|---|---|---|
| 0 | `distance_km` | continuous | Planned distance | Duration scales super-linearly with distance |
| 1 | `elevation_gain_m` | continuous | Cumulative positive gain | Climbing costs time independent of horizontal distance |
| 2 | `elevation_per_km` | continuous | Gain / distance | Separates a flat 20 km from a 20 km with 400 m |
| 3 | `experience_level` | ordinal 1–5 | Fitness level | Experienced athletes fade less at long distances |
| 4 | `history_count` | integer ≥ 0 | Sessions of this sport logged | Controls how much the personal curve can be trusted |
| 5 | `is_run` | binary | Activity-type flag | Modality-specific pace relationships are not transferable |
| 6 | `is_ride` | binary | Activity-type flag | Same |
| 7 | `is_walk` | binary | Activity-type flag | Same |
| 8 | `is_hike` | binary | Activity-type flag | Climbing hurts a hike far more than a ride at the same gradient |

Feature importance from the shipped model card, for the q50 regressor, confirms the design intent. Elevation per kilometre dominates, followed by history count — the model's proxy for how much personalisation it can attempt:

| Feature | Importance | Reading |
|---|---|---|
| `elevation_per_km` | 0.6849 | Terrain grade is the largest source of pace variation in the corpus |
| `history_count` | 0.1516 | The model explicitly conditions on how much personal data exists |
| `elevation_gain_m` | 0.0473 | Absolute gain adds a secondary correction |
| `distance_km` | 0.0372 | Small by design — distance is absorbed by the curve anchor; the trees only need a residual |
| `is_ride` | 0.0347 | Modality correction |
| `is_run` | 0.0220 | Modality correction |
| `is_hike` | 0.0101 | Modality correction |
| `is_walk` | 0.0061 | Modality correction |
| `experience_level` | 0.0061 | Largely redundant with `history_count`, as expected |

## 2.3 Data Preprocessing

Preprocessing is where most of this project's engineering lives, because the modelling problem is not "fit a regressor to a table" — it is "construct a target that is stationary across athletes so a single model can learn it". Seven distinct steps are applied, in order.

### 2.3.1 Step 1 — Chronological history construction (the leakage guard)

For each row, the model needs to know only what the athlete knew before that session started. The training frame is built row by row in timestamp order, and each row's reference curve is fitted from strictly earlier sessions of the same sport. This mirrors production inference exactly: at prediction time, a future session is by definition unavailable.

Getting this wrong is the classic way to produce a model that scores beautifully in validation and fails in production, because a model that has seen the future can "predict" a duration by looking up what actually happened. The preprocess module states the invariant in its docstring: *"training_frame builds each row's anchor strictly chronologically from prior sessions only — matching real production inference with zero future leakage."*

### 2.3.2 Step 2 — Flat-equivalent normalisation

Before fitting the reference curve, historical activities are normalised to flat-equivalent time, so climbing cost is never absorbed into the anchor and then double-counted by the trees. If a hilly 10 km run were fed to the curve unmodified, the curve would conclude the athlete is slow, and the terrain penalty would be learned twice — once by the curve, once by the GBM. The invariant is enforced in code and documented as invariant 1 of the preprocessing contract.

### 2.3.3 Step 3 — Outlier filtering and robust weighting

Real training logs contain GPS glitches, forgotten timers, and pauses at a coffee shop. Five filters run before fitting:

- **Missing modality.** Sports the athlete has never recorded fall back to a population speed constant (8.8 km/h run, 20.0 ride, 4.7 walk, 3.6 hike) rather than producing a divide-by-zero.
- **Physically impossible rows.** Implausible GPS or timer artefacts are dropped rather than winsorised, because a 5-minute 40 km ride is not a noisy observation of a real ride.
- **Robust down-weighting.** Extreme pace outliers are down-weighted using a Huber/MAD criterion, so a single bad row cannot swing the curve.
- **Recency weighting.** Recent sessions receive higher weight, with a 90-day half-life when timestamps exist — pace six months ago is weaker evidence than last week's.
- **Speed trim for external data.** GeoLife evaluation trims speeds outside [0.5, 50.0] km/h.

### 2.3.4 Step 4 — Reference curve fitting with Ridge shrinkage

The reference curve is `base_minutes = exp(a + b·ln d)`, which is Riegel's formula *time ∝ distance^b* in log-linear form. The exponent *b* is fitted by weighted Ridge regression, shrunk toward a sport-specific prior and then hard-bounded:

```python
RIEGEL_EXPONENT = {"run": 1.06, "walk": 1.06, "hike": 1.15, "ride": 1.03}
# ... reference_curve() -- ml/duration_model/preprocess.py L178
b = clip(ridge_estimate, 1.00, 1.30)
```

The bounds are not arbitrary. A *b* below 1.00 would imply an athlete gets faster per kilometre as distance grows, which is physiologically impossible for an endurance effort. A *b* above 1.30 would imply catastrophic fatigue far beyond anything observed for recreational athletes. Shrinkage is what makes the curve usable when an athlete has only two or three logged sessions: their own data nudges the prior rather than replacing it.

### 2.3.5 Step 5 — Target transformation

The regressors are not trained to predict minutes. They are trained to predict `log(duration / flat-equivalent time at the athlete's own chronological reference curve)` — the log pace factor. Two consequences follow, both deliberate:

- **Relative error instead of absolute.** A 5-minute error on a 40-minute run and a 5-minute error on a 200-minute ride become commensurable, so the loss is not dominated by long activities.
- **A stationary, athlete-independent target.** The model only has to learn a residual correction around 1.0. In the ablation that factor ranges only 0.8823–1.0239 on real data — a sign the transformation worked, and the source of the diagnosis in Section 4.4.

### 2.3.6 Step 6 — Column dropping and the leakage audit

The retraining study discovered a real leakage path that had to be closed. When training from the GeoLife CSV, two columns must be dropped before the frame reaches the trainer:

```python
DROP_BEFORE_TRAINING = ("source_path", "mode_original")
# source_path   -- the .plt file path, from which the raw trajectory could be re-read
# mode_original -- the pre-mapping label, a leaking artefact of how the CSV was built
```

This is worth documenting at length because of how it was caught. The CSV round-trip test passed even with an empty drop list, because the trainer was happy to accept the columns. Only a direct unit test asserting that the constant contains `source_path` actually prevented the regression. The lesson — recorded in the test file — is that testing that code runs is not the same as testing that the protocol is respected.

### 2.3.7 Step 7 — Missing values and categorical encoding

GeoLife has no elevation column, so `elevation_gain_m` and `elevation_per_km` are set to 0.0 for every row rather than imputed. Imputation was rejected: filling elevation with the synthetic corpus median would inject a fabricated terrain profile into a dataset known to be flat-recorded, and any resulting metric would be partly an artefact of the imputer. Zeroing is a biased assumption, but it is an honest and stated one, and it applies identically to both arms of the retraining comparison, so the comparison itself stays valid.

Categorical encoding uses one-hot flags rather than a single ordinal code, so hike and ride are not implicitly ordered. No scaling is applied to the numerics: gradient-boosted trees split on thresholds and are invariant to monotone transformations, so standardisation would add a preprocessing step that changes nothing.

## 2.4 Data Splitting and Validation

Three different splits are used, for three different questions.

| Split | Ratio | Grouping | Question it answers |
|---|---|---|---|
| Train / test (synthetic) | 80/20 (7,011 / 1,834 rows) | `GroupShuffleSplit` by `user_id` | Can the model fit the generator? (sanity check only) |
| Shipped model → GeoLife | 100% of GeoLife as test | Per-user chronological walk-forward | How accurate on real, unseen people? |
| Retrain study | 70/30 by user (36 / 15 users) | `GroupShuffleSplit` by `user_id`, chronological within user | Does training on real data improve on synthetic? |

### 2.4.1 The user-level holdout and why it is mandatory

A random row split is the wrong split for this problem, and the project treats the mistake as a first-class hazard. If athlete A has 40 sessions and rows are split randomly, 32 of A's sessions land in training and 8 in test. The model then learns A's personal pace and is scored on A's remaining sessions — a memorisation test, not a generalisation test. The result is an optimistic number that does not survive contact with a new user.

Every split in this project is therefore grouped by `user_id`, and the grouping is asserted rather than assumed. The trainer refuses to proceed on an overlapping split:

```python
splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=seed)
train_idx, test_idx = next(splitter.split(clean, groups=clean["user_id"]))
train_users, test_users = set(...), set(...)
if train_users & test_users:
    raise RuntimeError("user-level holdout split leaked pseudonymous users across partitions")
```

*`ml/duration_model/train.py` L249–256 — the overlap assertion is executable, not a comment.*

The same discipline governs the retraining study, where the split metadata records `user_overlap: 0` in the report so a reader can verify it without reading the code.

### 2.4.2 The chronological walk-forward protocol

Within a user, evaluation proceeds in time order. For each activity in chronological sequence, the model is called with the history accumulated so far, the prediction is recorded, and only then is the actual duration appended to the history. This is identical to production behaviour — an athlete's plan is made before the session and the session logged afterwards.

```python
rows = frame.sort_values(["user_id", "activity_type", "start_time"])
for (_user, activity_type), group in rows.groupby(["user_id", "activity_type"]):
    history = []
    for row in group.itertuples(index=False):
        pred = model.predict(..., history=history)
        evaluated.append({... "actual_min": row.duration_min, ...})
        history.append({... "duration_min": actual, ...})   # appended AFTER predicting
```

*`ml/evaluation/geolife_validation.py`, `evaluate_activities()` L225–290.*

A consequence worth naming: 80 of the 4,362 predictions are cold-start (history empty) and 67 have exactly one prior session. Those slices are reported separately, because averaging them into the headline would hide that new users get a materially worse estimate (cold-start MAPE 51.3% against 35.3% for users with two or more prior sessions).

### 2.4.3 Cross-validation and the reason it is not used

No k-fold cross-validation is used, and the omission is a deliberate methodological choice rather than an oversight. Time-series data with per-user grouping cannot be randomly folded without either leaking the future into the past or leaking a user across folds. The correct analogue is grouped time-series cross-validation, which is exactly what the walk-forward protocol already implements in a single pass over every user. Repeating it across folds would resample the same 51 users, producing a variance estimate over user draws rather than over data draws — which is why the study instead reports three independent seeds (7, 11, 23) of the user-level split. That gives the same information about split sensitivity with a cleaner interpretation.

### 2.4.4 Leakage avoidance — complete checklist

| Leakage vector | How it is closed | Enforced in |
|---|---|---|
| Future sessions in the training frame | History built strictly chronologically | `preprocess.training_frame` |
| Same user in train and test | `GroupShuffleSplit` by `user_id` + explicit overlap assertion | `train.py` L249; `retrain_study.py` |
| Target-derived column as a feature | `log_pace_factor` computed from the target; never fed as input | `FEATURE_ORDER` is 9 fixed names |
| Mean speed as a feature | `avg_speed_kmh` excluded (it is distance/duration) | `FEATURE_ORDER` |
| File-path identifier | `source_path` dropped before training | `DROP_BEFORE_TRAINING` |
| Pre-mapping mode label | `mode_original` dropped before training | `DROP_BEFORE_TRAINING` |
| Calibration data from training users | `calibrate` rejects overlapping pseudonymous users with `SystemExit` | `train.py` L368–372 |
| Tuning against the test set | External GeoLife set never used for hyperparameter selection | Section 3.2.4 |

The last row deserves emphasis. Hyperparameters were fixed before external validation ran, and were not subsequently adjusted in response to GeoLife results. That is why the honest accuracy figure (±23.8%) is worse than the internal one — if the configuration had been tuned against GeoLife, the external set would have quietly become a second training set, and the number would no longer mean what it claims.

---

# 3. MACHINE LEARNING MODEL DEVELOPMENT

## 3.1 Model Selection

The final model is a gradient-boosted quantile regressor from scikit-learn: three `GradientBoostingRegressor` instances fitted with `loss="quantile"` at alpha 0.10, 0.50, and 0.90. Each learns the log pace factor described in Section 2.3.5.

```
duration_min(d)  =  exp(a + b · ln d)  ×  exp( GBM_q(features) )
                     └── reference curve ──┘     └── learned correction ──┘

q ∈ {0.10, 0.50, 0.90}   →   (lower bound, median, upper bound)
```

### 3.1.1 Why gradient boosting, specifically

| Candidate | Why considered | Why not chosen |
|---|---|---|
| Linear regression on log-time | Simple, interpretable; Riegel is already log-linear | Cannot represent elevation × modality interaction without hand-built terms; no quantiles without distributional assumptions |
| Random forest | Robust, low tuning burden, non-linear | Quantile regression forests not available in scikit-learn; gives a point prediction, and this project needs calibrated bounds |
| Neural network (MLP) | Universal approximator | 8,845 rows × 9 features do not justify the parameter count; no interpretable importance; awkward to export to a browser evaluator |
| Physics-only formula (Riegel + Naismith) | Zero training cost, fully explainable | Cannot personalise beyond a single exponent, cannot learn terrain × modality interaction — retained as the baseline in 3.3 |
| **Gradient boosting with quantile loss** | Non-linear, captures interactions, native quantile loss gives three models from one pipeline, exports to a compact JSON tree walker | **SELECTED** |

Three specific properties made gradient boosting the right answer rather than merely an acceptable one:

- **Native quantile loss.** `GradientBoostingRegressor` accepts `loss="quantile"` with an `alpha` parameter. Training three instances gives a median and two bounds from one pipeline, with no distributional assumption about the residuals. This is what makes an honest uncertainty interval possible at all.
- **Interactions without specification.** Trees partition on thresholds, so `elevation_per_km` can mean something different for a hike than for a ride without the engineer writing an interaction term.
- **Exportable to the browser.** A fitted tree ensemble is a list of (feature index, threshold, left child, right child, leaf value) tuples. That serialises to 349 KB of JSON and can be walked by roughly forty lines of JavaScript.

### 3.1.2 Why the model predicts a factor rather than minutes

This is the most consequential design decision in the project. Predicting minutes directly would force one model to serve a 5 km park run and a 150 km sportive. The residual variance would be dominated by distance, and the model would spend its capacity relearning the Riegel relationship that is already known analytically.

By fitting a per-athlete curve first and asking the trees only for a multiplicative correction, the learned target becomes stationary: it sits near 1.0 for every athlete, every distance, every modality. The model can concentrate on the part of the problem that is genuinely empirical — how terrain and fatigue interact differently across sports.

The trade-off is that the model inherits the curve's weaknesses. If the curve is badly fitted for an athlete — say, only one prior session — no amount of tree capacity can recover, because the correction is a multiplier near 1.0 and cannot invent a better anchor. Section 4.2 shows exactly this: cold-start and thin-history are the worst-performing slices, and Section 4.3 shows the correction is worth statistically nothing at all.

## 3.2 Model Training and Implementation

### 3.2.1 Technology stack

| Layer | Technology | Version | Role |
|---|---|---|---|
| Training and evaluation | Python | 3.11+ | Pipeline, studies, reports |
| Modelling | scikit-learn | ≥1.4, <2.0 | `GradientBoostingRegressor`, `GroupShuffleSplit`, Ridge, metrics |
| Data handling | pandas, NumPy | ≥2.1 / ≥1.26 | Frames, arrays, resampling |
| Artifact serialisation | joblib | ≥1.4 | `duration_model.joblib` |
| Browser export | custom JSON tree format | — | `duration_model.json` (349 KB) |
| Inference service | FastAPI + Uvicorn | ≥0.115 / ≥0.30 | REST endpoints |
| API orchestration | Laravel (PHP) | 12.x on PHP ≥8.2 | Auth, persistence, ML call |
| Front end | Svelte + Vite | 5.19 / 6.0 | PWA, offline, instant preview |
| Database | PostgreSQL (Supabase) | — | Users, activities, predictions |

### 3.2.2 Hyperparameters and the absence of a search

```python
for name, alpha in QUANTILES.items():          # q10 / q50 / q90
    model = GradientBoostingRegressor(
        loss="quantile",
        alpha=alpha,
        n_estimators=320,
        learning_rate=0.06,
        max_depth=3,
        min_samples_leaf=12,
        subsample=0.9,
        random_state=seed,
    )
    model.fit(x_train, y_train)
```

*`ml/duration_model/train.py` L385–398 — the complete model definition.*

No `GridSearchCV` or `RandomizedSearchCV` appears anywhere in the repository, and the reason is deliberately not hidden: the configuration is a fixed, defensible default rather than a tuned optimum.

| Hyperparameter | Value | Reasoning |
|---|---|---|
| `n_estimators` | 320 | Enough capacity for a 9-feature residual; beyond ~400 the validation curve flattens and the export grows without benefit |
| `learning_rate` | 0.06 | Conservative shrinkage; pairs with 320 trees so the ensemble does not overfit a small, smooth residual |
| `max_depth` | 3 | Keeps interactions to at most three variables. The residual is smooth; deep trees would memorise individual sessions |
| `min_samples_leaf` | 12 | Prevents a leaf from isolating one athlete's single session — the main overfitting risk with grouped data |
| `subsample` | 0.9 | Light stochastic averaging for variance reduction |
| `random_state` | seed (7) | Full determinism — a re-run must reproduce the same artifact bit for bit |
| `loss` / `alpha` | quantile / 0.10, 0.50, 0.90 | Produces the 80% central interval the interface displays |

The honest trade-off is stated plainly: a hyperparameter search would probably have improved the internal synthetic metrics by a small margin, and would have improved nothing that matters, because the synthetic target is a deterministic function the model already recovers to R² 0.99. Tuning against a tautological metric would have produced a better-looking number and a worse experiment. Given the emphasis on external validity, not searching was the correct call — but it is a documented limitation, not a claim that the values are optimal. Section 4.5 lists it as such.

### 3.2.3 Training pipeline, end to end

1. **Load and validate.** `--source synth | csv | supabase`. Column allow-lists checked; fewer than 200 rows or fewer than 5 distinct users aborts with `SystemExit` rather than training an unvalidatable model.
2. **Clean.** Impossible rows dropped, pace outliers down-weighted, recency weights assigned.
3. **Split by user.** `GroupShuffleSplit` 80/20 with an executable overlap assertion.
4. **Build chronological frames.** `training_frame()` constructs each row's anchor from strictly prior sessions.
5. **Fit three quantile regressors.** Identical hyperparameters, different alpha, identical `random_state`.
6. **Evaluate with inference-identical post-processing.** Predictions exponentiated, clamped to [0.7, 3.0], multiplied by the anchor, forced non-crossing — the same guards the production path applies.
7. **Optional calibration.** If a separate calibration CSV is supplied, `calibrate.fit_factor()` fits a widening factor *k*. Calibration users must be disjoint from training users, or the script exits with an error.
8. **Persist.** `duration_model.joblib` for the server, `duration_model.json` for the browser, and `model_card.json` recording every metric, the feature importance vector, the training source, and the calibration state.

Two details separate a working model from a model that only works in a notebook. First, the evaluation applies the exact same clamping and non-crossing logic as inference, so the reported metric measures what production will actually output. Second, the model card records `training_source: "synthetic"` and `calibration: null`, so a reviewer can tell at a glance that the shipped artifact was not trained on real data and that no interval calibration was applied. That transparency is deliberate; a model card omitting those fields invites a false assumption.

### 3.2.4 The calibration mechanism

The architecture includes a hook for widening the interval after the fact. When a bundle carries `calibration.factor = k > 1.0`, `predict()` widens the band asymmetrically around the median, preserving the shape of the quantile estimates rather than adding a symmetric pad:

```python
k = float((self.bundle.get("calibration") or {}).get("factor", 1.0) or 1.0)
if k > 1.0:
    lo_dev = (q50 - q10) if (q50 - q10) > 1e-9 else halfwidth
    hi_dev = (q90 - q50) if (q90 - q50) > 1e-9 else halfwidth
    q10 = q50 - k * lo_dev
    q90 = q50 + k * hi_dev
```

*`ml/duration_model/model_store.py` L128–134 — the interval-widening path.*

In the shipped artifact `calibration` is `null`, so *k* defaults to 1.0 and this branch never executes. That is the mechanism the retraining study effectively exercises from the other direction: rather than post-hoc widening the synthetic model's band, the study retrains on real data and lets the quantile models learn a true spread. The result (coverage 15.94% → 67.83%) suggests the training-data route is the stronger of the two. The calibration hook remains available for the case where a deployment cannot be retrained but its uncertainty must be honest.

### 3.2.5 Inference path and the dual evaluator

| Path | Implementation | When it runs | Why it exists |
|---|---|---|---|
| Python / scikit-learn | `model_store.DurationModel.predict()` | Every API prediction; all offline evaluation | Authoritative path; matches training exactly |
| JavaScript / tree walker | `frontend/src/lib/ml/duration.js` | Instant preview while the athlete edits inputs | Removes a network round trip from a slider interaction |

```javascript
function treeValue(tree, x) {
  let node = 0;
  while (tree.left[node] !== -1) {
    node = x[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
  }
  return tree.value[node];
}
```

*`frontend/src/lib/ml/duration.js` L308–314 — the entire browser evaluator.*

The risk of two evaluators is silent divergence: server and browser disagree by a fraction of a minute and nobody notices until an athlete sees two different numbers. The project guards against this with a parity smoke test that runs the same feature rows through both paths and asserts agreement, plus the elevation guard test which checks clamping behaviour identically on both sides. When the artifact is updated, both `duration_model.json` and `model_card.json` must be copied to `frontend/public/models/`, because the interface reads the model card to display its error margin — a stale copy would make the interface advertise the wrong accuracy.

### 3.2.6 Guard rails in the prediction path

A model that outputs a negative duration, or an interval whose upper bound is below its median, is worse than no model at all. Five guards run on every prediction:

- **Multiplicative blow-up guard.** The pace-factor multiplier is clipped to [0.7, 3.0] before composition.
- **Non-crossing quantiles.** `q50 ≥ q10` and `q90 ≥ q50` are enforced by `max()`, so the interval can never invert.
- **Physical floor.** Duration floored at one minute; the anchor at two minutes per the relevant distance term.
- **Graceful degradation.** If the artifact is missing or unloadable, `predict()` falls back to a closed-form physics estimate and labels the basis `physics_fallback` rather than failing the request or silently returning a stale number.
- **Guard, not crutch.** The [0.7, 3.0] clamp is provably inert on today's model — the observed factor range on 4,362 real activities is 0.8823–1.0239. It is a guard against a future retrained artifact, not a shaper of current output.

## 3.3 Model Comparison

| Model | Description | Purpose |
|---|---|---|
| Population prior | `duration = distance / population_speed × 60`, fixed speed per modality (8.8 run, 20.0 ride, 4.7 walk, 3.6 hike) | The "no personalisation at all" floor |
| Personal reference curve | `duration = exp(a + b·ln d)`, *a* and *b* fitted per athlete by weighted Ridge; no learned correction | The "personalisation without machine learning" baseline — the model the GBM must beat to justify itself |
| Shipped model | Coefficient × `exp(GBM_q)`, three quantile regressors, trained on synthetic | The deployed model |
| Retrained candidate | Identical architecture and hyperparameters, trained on 3,277 GeoLife rows from 36 users | Tests whether training data, rather than algorithm, is the limiting factor |

The middle row is the one that matters most, and it is why this evaluation is more informative than a typical model report. Comparing a learned model to a population average is a low bar almost any model clears. Comparing it to the personalised curve it multiplies is the fair test, because the curve is what the model would be replaced by if the ML layer were removed. Section 4.3 reports that comparison, and the answer is uncomfortable.

## 3.4 Final Model Selection

The shipped artifact is the synthetic-trained quantile GBM, version `20261113.1328`:

| Field | Value |
|---|---|
| `name` | TRANA duration model |
| `version` | 20261113.1328 |
| `algorithm` | `GradientBoostingRegressor` (quantile loss, q10/q50/q90) |
| `target` | `log(duration / flat-equivalent time at the chronological reference curve)` |
| `output` | activity duration in minutes (`base × exp(prediction)`) |
| `features` | 9 (distance, elevation ×2, experience, history_count, 4 × modality) |
| `corpus_rows` | 8,845 |
| `train_rows` / `test_rows` | 7,011 / 1,834 |
| `trained_at` | 2026-11-13T13:28:54+00:00 |
| `training_source` | `synthetic` |
| `calibration` | `null` (no post-hoc widening applied) |

The choice of this artifact over the retrained candidate is a product decision, stated with its reasoning:

- **It cannot serve the product's modality mix.** GeoLife contains 2 runs and 0 hikes out of 4,362 rows. A model trained on GeoLife would have essentially no training signal for two of the four modalities TRANA supports.
- **It does not improve accuracy.** The measured difference is not statistically significant (paired bootstrap 95% CI on MAE difference [−0.071, +0.184] min). There is no accuracy argument for switching, only a coverage argument.
- **Its value is diagnostic.** The retraining study answers a research question — is the coverage shortfall a data problem? — with a clear yes. It is not a deployment candidate.

What the shipped model does inherit from that study is intellectual honesty: because the study measured the real accuracy, the interface now advertises ±24% rather than the synthetic 5.51%. The model did not change; the truth about it did, and the product changed to match.

---

# 4. MODEL EVALUATION AND INTERPRETATION

This section reports four separate experiments, in the order they were run, because each one raised the question the next one answered.

| # | Experiment | Question | Answer |
|---|---|---|---|
| 1 | Internal holdout | Does the model fit the training distribution? | Yes, R² 0.9924 — but tautologically so |
| 2 | External validation on GeoLife | How accurate on real, unseen people? | ±23.84% median error, R² 0.414 |
| 3 | Ablation vs. the reference curve | Does the learned correction earn its place? | No — statistically indistinguishable from the curve alone |
| 4 | Held-out user retraining study | Is the gap a data problem or a model problem? | Data. Coverage 15.94% → 67.83% with no accuracy change |

## 4.1 Evaluation Metrics

Six metrics are reported, each because it answers a question the others cannot. Reporting only R² or only MAPE would have hidden the most interesting findings.

| Metric | Definition | Why appropriate here |
|---|---|---|
| MAE (minutes) | `mean(|actual − predicted|)` | Interpretable in the unit the athlete cares about, without the squaring that lets one long ride dominate |
| MAPE (%) | `mean(|actual − predicted| / actual) × 100` | Scale-free; included for comparability with published work, but inflated by short activities |
| **MdAPE (%)** | `median(|actual − predicted| / actual) × 100` | **The honest headline.** One catastrophic outlier cannot move it. The figure the interface quotes |
| Within-15% / within-20% | % inside the tolerance | The practical question: how often is the estimate good enough to plan around? |
| R² | `1 − SS_res / SS_tot` | Variance explained; useful for baseline comparison, but punishes long-distance errors heavily |
| **Interval coverage (%)** | % of actuals inside [q10, q90] | **The single most diagnostic metric here.** Against 80% nominal, it measures whether the uncertainty is calibrated |

Two metrics are deliberately absent. RMSE is computed and stored but not used for model comparison, because squaring gives a handful of long rides disproportionate influence. Mean signed error is reported only implicitly: the project cares about magnitude more than direction, because an athlete planning a session budgets from the upper bound regardless of which side the median error falls on.

### 4.1.1 Why interval coverage is the key metric

A duration model that says "110 minutes" is making an implicit claim: that the true answer is 110. A model that says "110 minutes, 80% likely between 92 and 132" is making a falsifiable claim that can be checked on data. Count how often the actual duration falls inside the band. If it is close to 80%, the uncertainty is calibrated and the athlete can trust the range. If it is 17%, the range is a lie, and packing for the upper bound protects against nothing.

This is why coverage, rather than accuracy, drove the second half of the project. The shipped model's coverage is 16.96% — a 4.7× shortfall against its own nominal promise. That single number motivated the ablation, then the retraining study, and finally the decision to advertise a wider ±24% error margin in the user interface.

## 4.2 Model Evaluation Results

### 4.2.1 Internal holdout — for completeness, and with a warning

| Metric | Result | Status |
|---|---|---|
| MAE | 5.76 min | Not a real-world measure |
| RMSE | 14.13 min | Not a real-world measure |
| R² | 0.9924 | **TAUTOLOGICAL — do not quote** |
| MAPE | 5.51% | **TAUTOLOGICAL — do not quote** |
| Interval coverage | 78.9% | Close to nominal 80%, but on synthetic data |
| Train / test rows | 7,011 / 1,834 | — |

This table exists for one reason: a reader who finds R² 0.9924 in the model card must also find, in the same document, an explanation of why that number cannot be used. The generator computes the target from distance and speed, and the model receives distance and speed-equivalent features. It is recovering an equation it was handed, not learning the world. The 78.9% coverage is similarly uninformative: the quantile models fit the generator's imposed Gaussian noise, so their intervals are calibrated to a distribution no real athlete follows.

### 4.2.2 External validation on GeoLife — the honest headline

The shipped model, unchanged, evaluated on 4,362 real GPS activities from 51 people it had never seen, with per-user chronological walk-forward and elevation zeroed:

| Metric | Result | Reading |
|---|---|---|
| Activities evaluated | 4,362 | 51 users, 2007–2011 |
| MAE | 5.84 min | Typical absolute error in minutes |
| **MdAPE** | **23.84%** | **THE HEADLINE ACCURACY FIGURE** |
| MAPE | 35.87% | Inflated by short activities |
| Within 15% | 33.43% | One prediction in three lands within 15% |
| Within 20% | 43.81% | Just under half land within 20% |
| R² | 0.414 | Explains 41% of variance in real data |
| Interval coverage | 16.96% | Against 80% nominal — a 4.7× shortfall |
| MAE vs. population prior | 17.8% better | 5.84 vs. 7.10 min |
| MAE vs. reference curve | −0.1% (worse) | 5.84 vs. 5.83 min — the correction adds nothing |

> **The claim this project makes**
> TRANA predicts activity duration with a median absolute error of 23.84% on real, unseen GPS data, and 43.81% of its predictions fall within 20% of the true duration. It is meaningfully better than a population average (17.8% lower MAE) and equivalent to a personalised reference curve. Its uncertainty intervals are not yet trustworthy on this training distribution, and the interface compensates by advertising a wider error margin than the model would otherwise claim.

### 4.2.3 Performance by modality

| Modality | n | MAE | MdAPE | Within 15% | Within 20% | R² | Coverage |
|---|---|---|---|---|---|---|---|
| Ride | 1,372 | 5.14 | 19.66% | 38.05% | 50.80% | 0.474 | 20.12% |
| Walk | 2,988 | 6.16 | 26.16% | 31.29% | 40.60% | 0.386 | 15.53% |
| Run | 2 | 2.78 | 28.21% | 50.00% | 50.00% | — | 0.00% |
| **All** | **4,362** | **5.84** | **23.84%** | **33.43%** | **43.81%** | **0.414** | **16.96%** |

Cycling is the strongest modality by every measure: 19.66% median error, over half of predictions within 20%, and the highest R². This is expected — cycling pace is comparatively stable, terrain dominates over fatigue for most recreational rides, and GeoLife rides are comparatively short (longest 19.6 km, against a synthetic training range reaching 150 km), so the evaluation measures the part of the problem where the curve is best identified.

Walking is the weakest at 26.16% median error, and the project reports that without softening it. The reason is largely definitional: a GeoLife "walk" is door-to-door movement including pauses, window shopping, and waiting, whereas a TRANA walk is a deliberate exercise session. Two people walking 2 km at the same speed can differ by 40% in elapsed time depending on what they stopped to do. No model can predict the number of shop windows. This is a genuine limitation of the external dataset's definition, and one reason the interface advertises 40.5% error for walking and hiking rather than the headline 23.8%.

### 4.2.4 Performance by history depth

| History depth | n | MAE | MAPE | MdAPE | R² | Coverage |
|---|---|---|---|---|---|---|
| Cold start (0 prior) | 80 | 11.80 | 51.26% | 45.67% | 0.274 | 13.75% |
| Thin history (1 prior) | 67 | 12.51 | 52.62% | 24.49% | 0.053 | 19.40% |
| Personalised (2+ prior) | 4,215 | 5.62 | 35.31% | 23.54% | 0.423 | 16.99% |

The personalisation claim is supported: with two or more prior sessions of the same sport, MAE halves from 11.80 to 5.62 minutes. That is the strongest evidence that the per-athlete curve is doing real work, and the one place where the architecture's design intent is measurably vindicated.

The cold-start MAPE of 51.26% is what the interface is built around. Rather than pretending a new user's estimate is as good as an established user's, the frontend multiplies the advertised error by a factor derived from these very numbers (`THIN_HISTORY_MULTIPLIER`: 1.27× with no history, 1.30× with one session, 1.0× thereafter). The user sees a wider range before they have data and a tighter one after, and both numbers trace back to this table.

### 4.2.5 The in-domain slice — a result that went the wrong way

| Slice | n | MAE | MdAPE | R² | vs. population prior |
|---|---|---|---|---|---|
| In-training-domain | 543 | 17.94 | 32.69% | **−0.433** | 4.1% **worse** |

*In-domain defined as walks ≥ 1.5 km, rides ≥ 10 km, or any run.*

This slice was defined to test the hypothesis that the model would do better on activities resembling its training distribution — longer distances, the kind of session an athlete actually plans. It does not. On 543 activities that sit squarely inside the intended use case, MAE rises to 17.94 minutes and R² goes negative (−0.433), meaning predictions there are worse than simply guessing the mean duration.

The result is reported rather than dropped for the obvious reason: it is inconvenient and it is real. Its most plausible explanation is that these 543 rows are dominated by long GeoLife rides and walks where elapsed time diverges most from exercise time — the same definitional mismatch that hurts the walking slice, concentrated at the distances where elapsed time has the most room to drift. It is also the strongest single piece of evidence that the synthetic training corpus does not represent the real-duration distribution, which is precisely the hypothesis the retraining study was built to test.

## 4.3 Model Comparison Results

### 4.3.1 Ablation — does the learned correction earn its place?

The ablation scores the population prior, the personalised curve, and the shipped model on identical chronological rows, so the comparison is paired by construction. Because the rows are the same, the difference in MAE is a difference between two predictions of the same event — which is what makes a paired bootstrap valid here.

| Slice | n | Curve MAE | Model MAE | Population prior MAE | Model vs. curve |
|---|---|---|---|---|---|
| Overall | 4,362 | 5.83 | 5.84 | 7.10 | −0.2% |
| Ride | 1,372 | 5.07 | 5.14 | 9.49 | −1.4% |
| Walk | 2,988 | 6.18 | 6.16 | 6.01 | +0.3% |
| Cold start | 80 | 11.43 | 11.80 | 12.36 | −3.2% |
| ≥2 prior activities | 4,215 | 5.62 | 5.62 | 6.92 | 0.0% |

Paired bootstrap, 2,000 resamples of the 4,362 rows: the model's MAE improvement over the curve is **−0.009 minutes, 95% CI [−0.019, +0.002]**. The interval straddles zero, and the model wins only **5.3% of draws** — worse than a coin flip. In plain language: the learned correction is statistically indistinguishable from doing nothing.

The mechanism is visible in the multiplier itself. Across those 4,362 activities, `exp(GBM q50)` has a median of **0.9904**, ranges **0.8823 to 1.0239**, and has a standard deviation of 0.0167. **35.9%** of predictions land within 1% of unity. At most the model moves a prediction by +2.4% or −11.8%. A correction confined to that band cannot repair a 23.8% median error, and the ablation measures precisely that.

| Statistic on `exp(GBM q50)` | Value | Interpretation |
|---|---|---|
| Median | 0.9904 | The typical correction is about −1% |
| Standard deviation | 0.0167 | Extremely tight distribution |
| Minimum observed | 0.8823 | −11.8% at the extreme |
| Maximum observed | 1.0239 | +2.4% at the extreme |
| Within ±1% of unity | 35.9% of predictions | More than a third are essentially untouched |
| Clamp bounds [0.7, 3.0] | never approached | The guard is inert on this artifact |

Two consequences follow, both recorded in the methodology document. First, the [0.7, 3.0] clamp is inert — a guard against a retrained artifact going wild, not a shaper of today's output. Second, on walks the correction is actively unhelpful: the curve beats the population prior by 2.8% on walks, and the model gives some of that back (+0.3% versus the curve).

> **Why this is a contribution, not a failure**
> The ablation does not say the machine learning is broken. It says the machine learning was pointed at a target that was already solved by an analytic formula, on a training distribution that does not resemble real data. That is a specific, testable diagnosis — and it is the diagnosis the retraining study was designed to act on, which is why the next experiment moved coverage by 52 percentage points.

### 4.3.2 Held-out user retraining study — is the gap a data problem?

The study asks one question: does training on real GPS data beat training on the synthetic corpus, measured on people neither model has seen? The protocol is strict, and the strictness is the point.

| Protocol element | Choice | Why |
|---|---|---|
| Split | 70/30 by `user_id` | No person appears on both sides |
| Train / holdout | 36 users / 15 users | 3,277 / 1,085 rows |
| Dropped columns | `source_path`, `mode_original` | Leakage vectors discovered during the study |
| Training invocation | `duration_model.train --source csv` | Same trainer, same hyperparameters as production |
| Evaluation | Per-user chronological walk-forward | Identical to `geolife_validation`, so the shipped arm reproduces the published report |
| Bootstrap | 2,000 paired draws | Interval on the MAE difference |
| Seeds | 7, 11, 23 | Split sensitivity. `SEED` is a module constant, so each seed was run in turn; the committed report is seed 7 |
| Elevation | 0 for both arms | Not recorded in GeoLife |

| Seed | n | Shipped MAE / MdAPE / coverage | Retrained MAE / MdAPE / coverage | Paired 95% CI on MAE diff |
|---|---|---|---|---|
| 7 | 1,085 | 6.17 / 26.68% / 15.94% | 6.11 / 24.42% / 67.83% | [−0.071, +0.184] |
| 11 | 1,858 | 4.99 / 19.90% / 19.70% | 4.86 / 18.90% / 76.70% | [−0.044, +0.301] |
| 23 | 729 | 6.72 / 25.40% / 18.00% | 6.59 / 23.90% / 70.40% | [−0.181, +0.484] |

The verdict is identical across all three seeds: **no measurable difference in MAE.** The retrained model is nominally better on every seed — 6.11 vs. 6.17, 4.86 vs. 4.99, 6.59 vs. 6.72 — but every interval includes zero, and the largest improvement is 0.13 minutes on a 6-minute typical error. Claiming a win here would be over-reading noise.

What did change, dramatically and consistently, is **interval coverage**. On seed 7 it moved from 15.94% to 67.83%. On seed 11, from 19.70% to 76.70% — essentially calibrated. On seed 23, from 18.00% to 70.40%. A 50-point swing on a metric the synthetic model was failing by a factor of nearly five.

| Metric | Shipped (seed 7) | Retrained (seed 7) | Change |
|---|---|---|---|
| MAE (min) | 6.17 | 6.11 | −0.06 (n.s.) |
| MdAPE | 26.68% | 24.42% | −2.26 pts |
| MAPE | 36.74% | 35.26% | −1.48 pts |
| Within 20% | 38.71% | 42.49% | +3.78 pts |
| R² | 0.489 | 0.466 | −0.023 |
| **Interval coverage** | **15.94%** | **67.83%** | **+51.89 pts** |

| Modality | Shipped MdAPE | Retrained MdAPE | Shipped coverage | Retrained coverage |
|---|---|---|---|---|
| Ride (n=361) | 23.94% | 19.21% | 17.45% | 70.64% |
| Walk (n=723) | 28.26% | 28.51% | 15.21% | 66.39% |

The modality breakdown is the most useful part of the study, and the reason the retrained model is not in production. For rides, retraining genuinely helps: MdAPE improves from 23.94% to 19.21%, about 4.7 percentage points, at no cost in MAE. For walks it does essentially nothing (28.26% → 28.51%), confirming the hypothesis in 4.2.3 — walking error is dominated by the elapsed-time definition mismatch, not by training data, so no amount of GeoLife training can fix it. And the study evaluates no runs and no hikes in any meaningful quantity, because GeoLife has none.

> **The finding, stated precisely**
> The model's accuracy is limited by its training data, not by its algorithm. Given real data, the same architecture with the same hyperparameters produces intervals that are approximately calibrated (67.8–76.7% coverage against an 80% target, versus 15.9–19.7% before) without sacrificing point accuracy. The remaining accuracy gap is a property of the task and the external dataset, not a defect the model can train its way out of.

## 4.4 Results Interpretation

Four things follow from these results, in order of how much they should change a reader's view of the system.

### 4.4.1 The pipeline works; the numbers attached to it were wrong

Every architectural decision the project made is validated by the external evaluation. The per-user chronological protocol produces a trustworthy number. The grouped split prevents memorisation. The two-component design gives a model that beats a population average by 17.8%. The quantile approach gives a real interval that can be scored. The browser and server evaluators agree. None of that was undone by the external results.

What was undone is the claim that the model is 5.51% accurate. The synthetic evaluation was measuring the generator. The correct figure is 23.84%, and the difference between those two numbers — a factor of four — is the single most important finding of this project. A model that reports 5.51% and delivers 23.8% is more dangerous to its users than a model that reports 23.8% and delivers 23.8%.

### 4.4.2 The learned correction is not earning its place, and that is now documented

The ablation is a negative result and it is reported as one. The gradient-boosted correction is confined to a ±2% band and cannot repair a 24% error. Its MAE improvement over the reference curve is −0.009 minutes with a confidence interval that includes zero, and it wins only 5.3% of bootstrap draws.

Two readings are possible and both are worth stating. The uncharitable one is that the ML layer is decorative: the curve does the work, and the trees add complexity for nothing. The charitable one is that the architecture correctly decomposed the problem — it isolated the analytically solvable part into the curve, and the learned part was left with a residual so small that the trees correctly learned to output approximately 1.0. Under the second reading, a near-unity multiplier is evidence the decomposition was right, not evidence the model failed.

The project takes the second reading but does not use it to avoid the first. Per the scope agreed for this work, the ablation measures and documents the finding but does not change the shipped prediction path; removing `exp(GBM)` from production is recorded as a separate product decision that has not been made.

### 4.4.3 Calibration is a data problem, and the fix is measured

The retraining study is the part of this project that turns a criticism into a contribution. It would have been easy to note the 16.96% coverage, call it a limitation, and move on. Instead the project formed a hypothesis — the intervals are narrow because the synthetic training distribution is narrow — and tested it with a user-disjoint split across three seeds.

The hypothesis is confirmed. Coverage jumps from 15.94% to 67.83% while accuracy is unchanged. This is a clean dissociation: the variable manipulated was training data, the variable that moved was calibration, and the variable that stayed fixed was accuracy. That pattern is what a causal claim in machine learning looks like.

### 4.4.4 What the user sees, and why

The interface does not display 5.51%. It displays the per-modality error derived from the GeoLife report: 28.2% for runs, 25.7% for rides, and 40.5% for walks and hikes. Those constants live in a single exported object with a comment explaining their provenance.

```javascript
export const VALIDATED_ERROR_PCT = {
  run: 28.2,
  ride: 25.7,
  walk: 40.5,
  hike: 40.5,   // run's n is 2, so both are the conservative walk/run envelope
};
```

*`frontend/src/lib/ml/duration.js` L71–76 — the only place a user-facing accuracy claim exists.*

Three design choices in that snippet are deliberate. Walking and hiking share the walk figure because GeoLife has no hikes and the walk error is the worse of the two measured modalities, so reusing it is conservative rather than flattering. Run uses 28.2%, but the comment acknowledges this comes from n=2 and is therefore an envelope, not a measurement. And the value is a single exported constant rather than a string written into a template, so the same number appears everywhere the interface quotes an error — no screen can drift.

A fourth choice is subtler and is the one a careful reader should notice. The card also shows a "model confidence" chip, and the source comment above it says explicitly that this score weights band width against history depth — it is how much the model trusts itself, not how often it was right. The tooltip distinguishes the two in one sentence: *"Model self-confidence (N%). Measured real-world error for this sport is ±M%."* Two numbers that could easily have been conflated are labelled as different quantities in the interface.

The duration **range** the athlete sees is also not the model's own quantile band. The model produces a q10–q90 interval that covers the truth only 16.96% of the time, so the interface discards it and displays a measured band instead:

```javascript
const errorFraction = validatedErrorFraction(activityType, historyCount);
const honestLow  = Math.max(1, median * (1 - errorFraction));
const honestHigh = median * (1 + errorFraction);

return {
  minutes: ..., low: <q10>, high: <q90>,          // model's own band (not displayed)
  validatedLow, validatedHigh, validatedErrorPct, // measured band (displayed)
  rangeBasis: 'geolife_validated',
};
```

*`frontend/src/lib/ml/duration.js` L424–437 — the model's quantile band is returned for diagnostics; the UI renders the validated band.*

This is a deliberate two-track design. The q10/q90 band remains in the payload for monitoring and for the ablation, where its narrowness is the finding. What the athlete reads is the measured error band, widened further for thin history. A smoke test (`validated-range-smoke.mjs`) pins the relationship so the honest band can never silently collapse back to the synthetic one.

| Where the number appears | Value shown | Source | Honest? |
|---|---|---|---|
| Prediction card, duration range | median ± validated error | `validatedLow` / `validatedHigh` | Yes — measured on GeoLife |
| Prediction card, error badge | ±28.2% / ±25.7% / ±40.5% | `VALIDATED_ERROR_PCT` | Yes — per-modality external MAPE |
| Prediction card, confidence chip | model self-confidence | `confidence` | Yes — labelled as self-confidence, not accuracy |
| Prediction card, tooltip | Names GeoLife as the source | `FuelingPlan.svelte` L53 | Yes |
| Admin dashboard, model card | R² 0.9924, MAPE 5.51% | `model_card.json` | Internal only — should be labelled as such |
| Analytics, "80% band" | 78.9% coverage | `model_card.json` | Internal only — synthetic, not real-world |

The last two rows are a known inconsistency and are listed as such in the pre-presentation checklist: the admin screens surface synthetic metrics because they read the model card, which is the correct source of truth for internal monitoring but is not a user-facing accuracy claim. A future iteration should label those panels explicitly as internal. The user-facing screens are already correct.

## 4.5 Model Limitations

The limitations below are ordered by how much they should reduce a reader's confidence in the system. The first is disqualifying for any use beyond personal planning; the rest are constraints rather than defects.

| # | Limitation | Evidence | Consequence |
|---|---|---|---|
| 1 | No training data from real athletes; calibration unrepresentative | `training_source: synthetic`; coverage 16.96% vs. 80% nominal | Intervals cannot be trusted as displayed. Mitigated in the UI by advertising the measured ±24% error instead |
| 2 | External dataset is Beijing commuters, not athletes | GeoLife: 51 users, walk 68.5%, run n=2 | Walking and hiking over-represented in the error figures; running accuracy untested in practice |
| 3 | No elevation in the external dataset | GeoLife elevation zeroed; GPS altitude unusable (~102 m/km apparent) | The model's largest feature (importance 0.685) is untested on real data — zero for every evaluation row |
| 4 | Retraining study cannot serve all modalities | GeoLife has 2 runs, 0 hikes | The measured fix is diagnostic, not deployable. Production keeps the synthetic model |
| 5 | Elapsed time includes non-exercise stops | GeoLife durations are door-to-door | Walking MdAPE 26.16% partly measures behaviour, not model error |
| 6 | No hyperparameter search | Fixed config in `train.py` L385–398 | Configuration is defensible but not optimal |
| 7 | No primary user study | Project timeline | The strongest possible validation has not been run |
| 8 | Cold start is materially worse | MAPE 51.26% at zero history vs. 35.31% at 2+ | A new user's first prediction is rough. Disclosed via `THIN_HISTORY_MULTIPLIER` |
| 9 | Endomondo validation never executed | `docs/test-report.md` L200 — pending CSV | A second external dataset was designed for but not obtained |
| 10 | Weight and experience are assumptions on GeoLife | `weight_kg=60.0` fixed; experience inferred | Fuelling outputs for GeoLife rows are not evaluated at all — only duration is |

### 4.5.1 The limitation that matters most

The first row deserves more than a table cell. The shipped model was trained on data whose noise structure the generator chose. Its quantile regressors therefore learned to produce intervals sized for Gaussian noise with a standard deviation of 5.5% of speed. Real athletes do not have Gaussian day-to-day variation: they have fat tails from illness, travel, heat, and motivation. The consequence is that the q10–q90 band covers 17% of real outcomes instead of 80%.

The project's response is the correct one, and worth naming as a design principle: **when a model's uncertainty cannot be trusted, do not display it.** The interface shows the measured error margin (±24%) rather than the model's own interval, because the former is validated on real data and the latter is not. The retraining study shows what would be required to fix this properly: real training data, a user-disjoint split, and the measurement to prove the fix worked.

### 4.5.2 What would change the conclusions

A reader should know what evidence would overturn this document's claims, not just what evidence supports them.

- **The 23.84% figure would fall** if a corpus of real TRANA users' logged sessions showed external MdAPE materially below 23.84%. Section 4.5 row 7 is the gap.
- **The ablation finding would change** if the correction were retrained with elevation present and still produced a near-unity multiplier on a real dataset with terrain variation.
- **The retraining verdict would flip** if a study with several hundred training users, which would have power to detect a 0.06-minute MAE difference, found a consistent significant improvement. The deployment decision in 3.4 would then need revisiting.

---

# 5. WEB APPLICATION DEVELOPMENT AND OUTPUT

TRANA is not a notebook with a report attached. It is a deployed, authenticated web application in which the machine-learning model is one service among several.

## 5.1 System Architecture

```
  Browser (Svelte 5 PWA)                     ── runs the exported tree ensemble locally
        │  HTTPS / JSON                          for instant preview
        ▼
  Laravel 12 API (PHP 8.2)                   ── auth, validation, persistence, throttling
        │  internal HTTP + bearer token
        ▼
  FastAPI inference service (Python)         ── duration model + fuelling engine
        │  joblib artifact
        ▼
  PostgreSQL (Supabase)                      ── users, activities, predictions, plans
```

The separation of concerns is deliberate. The ML service is Python because scikit-learn is Python. The API is Laravel because the application layer needs first-class authentication, validation, rate limiting, and an ORM — rebuilding those in FastAPI would have been a distraction from the machine learning. The front end is Svelte because a PWA needs to be small and fast on a mid-range Android phone.

| Layer | Responsibility | Key files |
|---|---|---|
| Svelte PWA | Routing, offline cache, all UI, local model evaluation for previews | `App.svelte`, `routes/index.js`, `lib/ml/duration.js` |
| Laravel API | Sanctum auth, Google sign-in, activity CRUD, prediction orchestration, rate limiting, error reporting | `routes/api.php`, `Services/PredictionService.php` |
| FastAPI service | Loads the joblib bundle, serves `/predict` and `/predict/duration`, exposes `/health` and `/model/info` | `ml/api/main.py` |
| PostgreSQL | Persistent store, row-level security via Supabase policies | `database/migrations/` |

### 5.1.1 The prediction request, end to end

1. **The athlete sets the inputs.** Activity type, distance, elevation, optionally a drawn route. A slider adjustment triggers a local computation from the exported trees — the number updates immediately with no network call.
2. **The athlete requests a plan.** The front end POSTs to `/api/predictions`. Rate limiting (`throttle:predictions`) protects the ML service from abuse.
3. **Laravel assembles the payload.** `PredictionService` pulls the profile (weight, fitness level, sweat profile), activity history, fuel items, and the energy-expenditure calibration factor. If a route was drawn, `RouteService` measures it by haversine and that distance overrides any typed value.
4. **Laravel calls FastAPI.** A bearer-token internal call with a 12-second timeout (`ML_TIMEOUT`). The duration service normalises the returned clock, pace, and intervals.
5. **FastAPI predicts.** `DurationModel.predict()` fits the athlete's reference curve from the posted history, builds the nine features, walks the three tree ensembles, and composes the interval.
6. **Fueling is computed.** The predicted duration and intensity drive the ACSM metabolic calculation and the carbohydrate/sodium/fluid targets, then the athlete's own kit is scheduled into intake items.
7. **The prediction is persisted and returned.** The saved record stores the profile context that produced it, so every plan is reproducible after the fact.

Steps 1 and 5 deserve a note on consistency: the browser computes a preview from the same JSON trees the server uses, so the number the athlete sees while dragging a slider is produced by the same model that will serve the final plan.

## 5.2 Interface Walkthrough

> **Screenshot checklist for the group.** The `.docx` contains ten numbered placeholders, each naming exactly what to capture. Insert real screenshots at full width, then delete the placeholder box. Capture at 1440×900 or wider, light theme, with realistic data (not empty states).

| # | Screen | What to capture |
|---|---|---|
| 1 | Landing page | Public hero, value proposition, sign-up CTA |
| 2 | Registration & onboarding | Registration form; onboarding step collecting weight, height, fitness level, sweat profile |
| 3 | Dashboard | Signed-in dashboard with logged activities, weekly summary, streak, next-session card |
| 4 | **Plan Activity** | **The most important capture.** Activity type, distance/elevation, predicted duration, bounds, ± error badge with tooltip |
| 5 | Route drawing | Map with a drawn route showing computed distance and elevation carried into inputs |
| 6 | Fueling plan | kcal total, carbs g/h, sodium mg/h, fluid ml/h, intensity label, scheduled intake items with times |
| 7 | Track & History | In-progress or completed session; history list with several logged activities |
| 8 | Analytics | Trend charts: weekly volume, pace trend by modality, ACWR panel |
| 9 | Goals & calendar | Goal-setting screen; calendar with planned sessions across the month |
| 10 | Admin & preview | Admin dashboard showing model version and internal metrics; `/preview` route |

### Screen descriptions

**Landing page.** The only screen reachable without authentication. It states what the application predicts and routes to registration or sign-in. No ML output appears here — deliberately: an accuracy claim before the user has seen a prediction would be a claim without context.

**Registration and onboarding.** Collects exactly the attributes the model is allowed to see, plus the attributes fuelling needs. It is also where the cold-start experience begins: a new athlete has no history, so first predictions come from the population prior and are the least accurate the system will ever be. The interface compensates by widening the displayed error margin.

**Dashboard.** The default authenticated route. Summarises the current week (distance, duration, sessions), shows goal progress, surfaces the most recent prediction.

**Plan Activity — the primary ML surface.** Four inputs produce a duration with a range. The error badge shows the externally validated margin for the selected modality and its tooltip explains that the figure comes from validation against real GPS data. The displayed range is the *validated* band, not the model's own q10–q90 band, for the reasons in Section 4.4.4.

**Route drawing.** For athletes who do not know their planned distance. Distance is measured by haversine along the drawn path; elevation gain comes from a Copernicus GDEM lookup via Open-Meteo. This matters more than it looks: elevation per kilometre is the model's highest-importance feature (0.685), so lookup quality directly affects prediction quality.

**Fueling plan.** Given a predicted 110-minute ride at moderate intensity, returns a per-hour carbohydrate target, a sodium target adjusted for sweat profile and temperature, a fluid target, and a schedule of specific items from the athlete's own kit at fixed intervals.

**It is important for the integrity of this documentation to state clearly what this block is not.** It is not machine learning. It is a closed-form physiological calculation — MET × mass × hours for energy, ACSM/ISSN carbohydrate guidance for intake, and a sweat-profile lookup for sodium and fluid. Every number traces to a published formula. Section 5.4 explains why that boundary was drawn deliberately.

**Activity logging and history.** Logging closes the feedback loop. Every recorded session becomes history, and history is what the reference curve is fitted from. The model literally improves as the athlete uses the application — which is why the accuracy table by history depth shows MAE halving between the first session and the fifth.

**Analytics.** Descriptive, not predictive. The acute:chronic workload ratio is a plain rolling arithmetic ratio over the last 7 and 28 days — a well-established sports-science heuristic, but not an ML output. Included because athletes expect it, not because the project claims it as a model.

**Goals and calendar.** Turn predictions into a training plan. A planned session carries its predicted duration and fuelling plan, so the athlete can see the week's total predicted load before committing.

**Admin and preview.** The admin surface shows the model card: version, R², MAPE, and the "80% band" coverage. Those are internal monitoring numbers on the synthetic split; Section 4.4.4 flags that a future iteration should label them as internal. The `/preview` route exists for demonstration: vary distance and elevation live and watch both the prediction and the interval move.

## 5.3 Engineering Quality

| Layer | Test suite | Count | What it protects |
|---|---|---|---|
| Machine learning | `pytest`, `ml/tests/` | **107 tests** | Feature contract, chronological leakage, quantile ordering, retraining protocol, CSV round-trip, split disjointness |
| Backend API | PHPUnit, `backend/tests/` | 20 feature + 1 unit | Auth, activity CRUD, prediction orchestration, throttling, account deletion |
| Front end | Node smoke scripts, `frontend/scripts/` | 37 scripts | Routing, model parity with Python, mobile layout, auth duplication, error monitoring, elevation guard |
| CI | GitHub Actions | 3 jobs | ML tests, API tests, and a full frontend build run on every pull request |

Two testing practices from this project are worth documenting because they changed the code.

**Mutation testing.** The retraining protocol was deliberately broken in four ways — row-level split instead of user-level, empty drop list, rolled predictions, always-claim-a-win — and the tests were checked for whether they noticed. Three of the four were caught immediately. The empty drop list survived, meaning a test could pass while the leakage guard was disabled, which led to adding a direct assertion on the constant itself rather than relying on an end-to-end test to imply it.

**Determinism as a test.** The retraining study was re-run from scratch and required to produce byte-identical numbers. It did: shipped 6.17 / 26.7% / 15.9% / R² 0.489 and retrained 6.11 / 24.4% / 67.8% / R² 0.466, reproduced exactly. A study whose numbers cannot be reproduced is an anecdote.

## 5.4 Design Decision: Where Machine Learning Stops

One architectural boundary deserves explicit defence, because a reader could reasonably ask why the project did not apply machine learning to the fuelling prediction as well.

The fuelling engine is deterministic because the relationship it encodes is already known. Energy expenditure follows MET × mass × hours. Carbohydrate oxidation during exercise follows well-established duration and intensity bands. Sweat sodium loss correlates with measurable sweat rate and concentration. These are published physiological relationships with derivations, not empirical patterns waiting to be discovered. Wrapping them in a learned model would add opacity, add a training data requirement the project does not have, and add failure modes — in exchange for no accuracy gain, because there is nothing to learn that is not already known.

Duration is the opposite case. There is no closed-form equation that says how long *this particular athlete* will take over *this particular terrain* on *this particular day*. The relationship must be estimated from data. That is what makes it a legitimate machine-learning target.

| Component | Method | Justification |
|---|---|---|
| Activity duration | **Learned**: gradient-boosted quantile regression | No analytic form exists; per-athlete variation dominates; empirical estimation is the only route |
| Fueling targets | **Derived**: ACSM MET equations, ISSN carbohydrate guidance | Closed-form physiology with published derivations; a learned model would add opacity without accuracy |
| ACWR (analytics) | **Derived**: rolling 7/28-day arithmetic ratio | A standard sports-science heuristic; presented descriptively, not as a prediction |
| Reference curve | **Fitted per athlete**: weighted Ridge on Riegel form | Four or five parameters from a handful of sessions; a per-user neural network would be unidentifiable |

This boundary is not a limitation of ambition. Deciding which parts of a system should learn and which should compute is the central design judgement in applied machine learning, and getting it wrong in the direction of "learn everything" is a common and expensive failure.

---

# 6. GROUP CONTRIBUTIONS

The responsibility areas below are the actual workstreams this project contained, so the mapping can be made accurately rather than generically. Replace the bracketed name placeholders; the responsibility and contribution columns are already accurate to the work performed.

| Group Member | Assigned Responsibilities | Specific Contributions |
|---|---|---|
| [SURNAME, First Name] | Machine learning: dataset preparation and model development | Built the synthetic corpus generator; fitted the Riegel reference curve with Ridge shrinkage; trained the three quantile regressors; exported the JSON tree ensemble for browser parity |
| [SURNAME, First Name] | Machine learning: evaluation and validation | Built the per-user chronological walk-forward evaluator; obtained and processed the GeoLife dataset; ran external validation and the paired ablation; authored the held-out retraining study and its 16 tests |
| [SURNAME, First Name] | Backend and inference service | Implemented the FastAPI inference service and its endpoints; built the Laravel prediction orchestration, authentication, throttling, and persistence layer |
| [SURNAME, First Name] | Front end and interface | Built the Svelte progressive web app; implemented the client-side tree evaluator and its parity test; wired the externally validated error margin into the prediction card; built the map route planner |
| [SURNAME, First Name] | Data layer, deployment, and quality | Designed the PostgreSQL schema and migrations; configured CI across all three layers; deployed the API, ML service, and web app; authored the smoke-test suite |
| [SURNAME, First Name] | Documentation and analysis | Authored the methodology document and this documentation; produced the reporting JSON artifacts; built the presentation deck and the demonstration checklist |

**How to complete this table honestly:** the contribution descriptors correspond to real, separable artifacts in the repository (the generator, the evaluator, the retraining study, the inference service, the front-end evaluator, the CI configuration). A member's row can be verified against commit history, so fill it to match what each person actually built rather than dividing evenly for appearance. If one member carried several workstreams, name several workstreams in their row.

---

# 7. CONCLUSION

This project set out to build a predictive machine-learning application that forecasts how long an endurance activity will take and converts that forecast into a fuelling plan. It delivered that application, and along the way produced something arguably more valuable: a rigorous account of what the model can and cannot do.

## 7.1 Summary of the Completed Project

The system is a four-layer web application. A Svelte 5 PWA presents the interface and runs the exported model locally for instant previews. A Laravel 12 API handles authentication, validation, persistence, and orchestrates the prediction. A FastAPI service loads the trained artifact and serves predictions. PostgreSQL on Supabase stores user data. The ML component is a two-part architecture: a per-athlete Riegel reference curve fitted chronologically from the athlete's own history, multiplied by a learned pace-factor correction produced by three gradient-boosted quantile regressors.

The model was trained on an 8,845-row synthetic corpus and evaluated on 4,362 real GPS activities from 51 unseen volunteers in the GeoLife dataset. It achieves a median absolute percentage error of 23.84% on that external data, with 43.81% of predictions within 20% of true duration, and it beats a population average by 17.8% in MAE. Its uncertainty intervals cover 16.96% of outcomes against a nominal 80% target.

Three further experiments turned that last number from an embarrassment into the project's main contribution. A paired ablation established that the learned correction is statistically indistinguishable from the reference curve it multiplies (MAE improvement −0.009 min, 95% CI [−0.019, +0.002]). A diagnosis traced the low coverage to the synthetic training distribution rather than the architecture. A held-out user retraining study then tested that diagnosis directly and confirmed it: the same architecture trained on real data moves coverage from 15.94% to 67.83% while leaving accuracy unchanged across three seeds.

## 7.2 What the Project Demonstrates

| Area | What was demonstrated | The lesson |
|---|---|---|
| **Dataset preparation** | A documented synthetic generator with explicit physical assumptions; a real external dataset processed into a comparable schema; a user-disjoint split with an executable overlap assertion; eight leakage vectors identified and closed | The most important preparation step was admitting what the synthetic generator could not represent. The leakage discovery came from building the retraining study, not from planning it |
| **Model development** | A deliberately decomposed architecture (analytic curve × learned residual) with three quantile models, bounded shrinkage, and guards against interval inversion and multiplicative blow-up | Decomposition is powerful but it concentrates the learning problem: when the analytic part solves most of the target, the learned part has almost nothing left to learn |
| **Model evaluation** | Internal holdout, external validation on unseen users, a paired ablation with bootstrap intervals, and a held-out retraining study across three seeds | The single most valuable evaluation decision was measuring interval coverage. Every point-accuracy metric looked acceptable; only coverage revealed the real defect |
| **Web application integration** | A deployed four-layer system with the same model artifact evaluated in Python and JavaScript, authenticated prediction orchestration, and an interface advertising the validated rather than the flattering error | Integration is where honesty becomes a product decision. It was easy to render ±5.5%; it took the whole evaluation study to earn the right to render ±24% |

## 7.3 Knowledge and Skills Gained

- **Leakage-safe validation design.** Grouped splitting, chronological walk-forward evaluation, and the discipline of writing an executable assertion for a protocol rule rather than a comment. The specific insight — that a test can pass while the guard it was supposed to protect is disabled — came from mutation testing and is unlikely to be forgotten.
- **Building a target, not just a model.** The most consequential work was not fitting regressors. It was constructing a target (log pace factor relative to a personal curve) that made the learning problem stationary across thousands of different athletes.
- **Quantile regression for uncertainty.** Training three models instead of one, and then measuring whether the resulting interval was calibrated rather than assuming it. Learning that an interval can look narrow and plausible while covering 17% of outcomes changes how one reads every confidence band thereafter.
- **Paired statistical comparison.** Comparing two models on identical rows and placing a bootstrap interval on the difference. The discipline of asking not "is the number better?" but "is the improvement distinguishable from noise?" turned a tempting 0.06-minute win into a correctly reported null result.
- **Honest reporting of negative results.** Writing up an ablation that shows your own learned component does not earn its place, then diagnosing and fixing the underlying cause, is harder than writing up a success. It is also more useful to anyone reading the work.
- **Full-stack engineering at production quality.** Three languages, three test suites, CI across all of them, containerised deployment, authentication, rate limiting, and a PWA that works on a mid-range phone.
- **Writing code that can be audited.** Model cards that record `training_source` and `calibration` as explicit fields; report JSONs committed alongside the code; constants such as `DROP_BEFORE_TRAINING` declared at module level so a test can assert them; and the habit of citing file and line range when quoting code in documentation.

## 7.4 Challenges and How They Were Addressed

| Challenge | How it arose | How it was addressed |
|---|---|---|
| No real training data existed | Empty database at launch; no public corpus of Filipino athletes' logs | Built a physics-informed synthetic generator encoding published formulas, and recorded its assumptions so the limitation was explicit |
| The internal metric was meaningless | The generator computes duration from distance and speed, so R² 0.9924 measured the generator | Obtained an independent external dataset and made the external number the only accuracy claim; the internal number is reported once, captioned as tautological |
| The external dataset had no usable elevation | GPS altitude showed ~102 m/km of apparent gain against a true 5–15 m/km | Zeroed elevation for both arms of every comparison rather than imputing; disclosed in the limitations block |
| The learned component added nothing | The ablation showed a near-unity multiplier and a CI straddling zero | Reported it as a negative result, then designed the retraining study to test whether the cause was data or architecture |
| Coverage was 4.7× too narrow | 16.96% empirical coverage against 80% nominal | Diagnosed as a training-distribution artefact; confirmed by a user-disjoint retraining study that moved coverage to 67.8–76.7% |
| A leakage vector survived the tests | Mutation testing showed an empty drop list still passed the suite | Added a direct assertion on the constant; re-ran the mutation to confirm it was now caught |
| The retrained model could not ship | GeoLife contains 2 runs and 0 hikes | Kept the synthetic model in production and documented the study as diagnostic; the coverage gain became the evidence for the honest error margin in the UI |
| Interface advertised the wrong accuracy | The front end read the model card's synthetic MAPE | Replaced with per-modality constants derived from the GeoLife report, defined once in a single exported object with a comment explaining provenance |

Four of these eight were discovered by the evaluation rather than anticipated in design.

## 7.5 Concluding Statement

The most useful thing this project produced is not the 23.84%. It is the chain of reasoning that leads to it: here is a model, here is a flattering number that measures the wrong thing, here is the honest number from data the model never saw, here is why the gap exists, and here is the experiment that proves the diagnosis. A group that reported 5.51% would have delivered a worse product and learned less.

The application works. It predicts a duration, shows an honest range around it, converts the forecast into a fuelling plan grounded in published physiology, and tells the user how wrong it might be. Where it is weak, it says so — in the interface, in the model card, and in this document. For a system that people will use to decide how far they can run before they run out of food, that is the right standard.

---

# APPENDIX A — Reproducing the Results

Every number in this document can be regenerated.

```bash
# 1. Environment
python3 -m venv .venv && source .venv/bin/activate
pip install -r ml/requirements.txt pytest

# 2. Train the shipped model (synthetic corpus, seed 7)
cd ml && python -m duration_model.train --source synth

# 3. External validation on GeoLife (writes the honest accuracy figures)
python -m evaluation.geolife_validation --json evaluation/reports/geolife_validation.json

# 4. Ablation: does the learned correction earn its place?
python -m evaluation.ablation --json evaluation/reports/ablation_report.json

# 5. Held-out user retraining study (writes the coverage result)
python -m evaluation.retrain_study --json evaluation/reports/retrain_study.json

# 6. Full test suite
pytest tests
```

| Artifact | Path | Contents |
|---|---|---|
| Model card | `ml/duration_model/model_card.json` | Version, metrics, feature importance, training source, calibration state |
| External validation report | `ml/evaluation/reports/geolife_validation.json` | All GeoLife metrics by mode and history depth |
| Ablation report | `ml/evaluation/reports/ablation_report.json` | Paired bootstrap over curve vs. model |
| Retraining study report | `ml/evaluation/reports/retrain_study.json` | Split metadata, both arms' scores, bootstrap, verdict |
| Methodology document | `docs/ml-methodology.md` | Narrative form of the same findings |
| Test report | `docs/test-report.md` | Per-layer test results and known gaps |
| Browser model export | `frontend/public/models/duration_model.json` | 349 KB tree ensemble consumed by the PWA |

---

# APPENDIX B — Complete Metric Tables

## B.1 External validation — every slice

| Slice | n | MAE | MAPE | MdAPE | W15% | W20% | R² | Coverage |
|---|---|---|---|---|---|---|---|---|
| Overall | 4,362 | 5.84 | 35.87 | 23.84 | 33.43 | 43.81 | 0.414 | 16.96 |
| Ride | 1,372 | 5.14 | 25.70 | 19.66 | 38.05 | 50.80 | 0.474 | 20.12 |
| Walk | 2,988 | 6.16 | 40.55 | 26.16 | 31.29 | 40.60 | 0.386 | 15.53 |
| Run | 2 | 2.78 | 28.21 | 28.21 | 50.00 | 50.00 | — | 0.00 |
| Cold start | 80 | 11.80 | 51.26 | 45.67 | 16.25 | 22.50 | 0.274 | 13.75 |
| 1 prior | 67 | 12.51 | 52.62 | 24.49 | 26.87 | 41.79 | 0.053 | 19.40 |
| 2+ prior | 4,215 | 5.62 | 35.31 | 23.54 | 33.86 | 44.25 | 0.423 | 16.99 |
| In-domain | 543 | 17.94 | 59.28 | 32.69 | 24.68 | 32.78 | −0.433 | 12.15 |

## B.2 Retraining study — all three seeds

| Seed | Arm | n | MAE | MAPE | MdAPE | W20% | R² | Coverage |
|---|---|---|---|---|---|---|---|---|
| 7 | Shipped | 1,085 | 6.17 | 36.74 | 26.68 | 38.71 | 0.489 | 15.94 |
| 7 | Retrained | 1,085 | 6.11 | 35.26 | 24.42 | 42.49 | 0.466 | 67.83 |
| 11 | Shipped | 1,858 | 4.99 | — | 19.90 | — | — | 19.70 |
| 11 | Retrained | 1,858 | 4.86 | — | 18.90 | — | — | 76.70 |
| 23 | Shipped | 729 | 6.72 | — | 25.40 | — | — | 18.00 |
| 23 | Retrained | 729 | 6.59 | — | 23.90 | — | — | 70.40 |

## B.3 Ablation — full comparison

| Slice | n | Curve MAE | Model MAE | Pop. prior MAE | Model vs. curve |
|---|---|---|---|---|---|
| Overall | 4,362 | 5.83 | 5.84 | 7.10 | −0.2% |
| Ride | 1,372 | 5.07 | 5.14 | 9.49 | −1.4% |
| Walk | 2,988 | 6.18 | 6.16 | 6.01 | +0.3% |
| Cold start | 80 | 11.43 | 11.80 | 12.36 | −3.2% |
| 2+ prior | 4,215 | 5.62 | 5.62 | 6.92 | 0.0% |

## B.4 Synthetic holdout — quoted only to be disclaimed

| Metric | Value | Status |
|---|---|---|
| R² | 0.9924 | **TAUTOLOGICAL** |
| MAPE | 5.51% | **TAUTOLOGICAL** |
| MAE | 5.76 min | Internal only |
| RMSE | 14.13 min | Internal only |
| Coverage | 78.9% | Internal only |

---

# APPENDIX C — Glossary

| Term | Definition |
|---|---|
| **MdAPE** | Median absolute percentage error. The median of \|actual − predicted\| / actual. Preferred over MAPE because it is not distorted by outliers. |
| **Coverage** | The percentage of actual outcomes inside the model's predicted interval. A well-calibrated 80% interval should cover about 80%. |
| **Quantile regression** | Fitting a model to a conditional quantile rather than the mean. Training alpha=0.10 and alpha=0.90 gives a central 80% interval. |
| **Riegel curve** | The endurance relationship *time ∝ distance^b*, with *b* typically 1.06 for running. Fitted per athlete as `exp(a + b·ln d)`. |
| **Base minutes** | The output of the athlete's reference curve at the planned distance, before the learned correction. |
| **Pace factor** | The multiplicative correction `exp(GBM(features))`. A value of 1.0 means the curve is correct unmodified. |
| **Cold start** | A prediction made with no prior sessions of that sport, using population speed constants. |
| **Chronological walk-forward** | An evaluation protocol that predicts each activity using only earlier activities, then appends the actual outcome to the history. |
| **Grouped split** | A train/test split keeping all of one user's rows on one side, preventing memorisation of individuals. |
| **Paired bootstrap** | Resampling the same rows for two models and computing the difference distribution, giving a CI on the difference rather than on either model. |
| **Ablation** | Removing a component and measuring whether performance degrades. Here, removing `exp(GBM)` to test whether the learned correction matters. |
| **Leakage** | Information available at training time that would not be available at prediction time, producing optimistic validation. |
| **MET** | Metabolic equivalent of task. One MET is roughly resting energy expenditure; energy ≈ MET × mass × hours. |
| **ACSM** | American College of Sports Medicine. Source of the metabolic equations used in the fuelling engine. |
| **Tautological metric** | A score that measures the generator that produced the data rather than the real-world relationship. This project's synthetic R² of 0.9924 is one. |
| **Model card** | A JSON artifact recording a model's version, metrics, feature importance, training source, and calibration state, so it can be audited at a glance. |
| **Calibration (interval)** | Post-hoc widening of a prediction interval so its empirical coverage matches its nominal level. Present as a mechanism here; not applied to the shipped artifact. |

---

**END OF DOCUMENTATION**
