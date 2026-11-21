CSST 102 – BASIC MACHINE LEARNING

### FINAL PROJECT DOCUMENTATION

| PROJECT NAME: | TRANA |
|---|---|

A Predictive Machine-Learning Web Application for Activity Duration Forecasting and Race-Day Fueling

| PROPONENTS: | [SURNAME, First Name] |
|---|---|
|  | [SURNAME, First Name] |
|  | [SURNAME, First Name] |

| YEAR AND SECTION: | [Year and Section] |
|---|---|

## 1. PROJECT OVERVIEW

### Project Description

TRANA is a predictive web application that answers one question an endurance athlete asks before every session: how long will this activity take, and what do I need to eat and drink to finish it? Most fitness applications are retrospective — they report what was already burned. TRANA works before the activity starts. The athlete supplies a planned activity type, a planned distance, and a planned elevation gain; the system returns an estimated duration in minutes with an uncertainty range, plus a per-hour carbohydrate, fluid and sodium plan sized to that estimate.

The problem it addresses is planning error. Recreational runners, cyclists, hikers and walkers routinely misjudge how long a route will take, and that single error compounds: a finish time that is wrong by half an hour makes a fueling plan wrong by the same proportion. Under-fueling causes the well-documented late-race decline; over-fueling causes gastrointestinal distress. Either way the athlete blames their fitness rather than their plan. TRANA targets the plan.

The intended users are recreational and semi-competitive endurance athletes who already log their sessions and who train for events rather than commuting. The application is useful to them because it converts a log they already keep into a forward-looking estimate, and because it explains the uncertainty rather than hiding it: the interface presents a range, not a single false-precision number.

The application predicts elapsed activity duration, in minutes, for a planned session that has not happened yet. Machine learning is used to generate that prediction in two stacked stages. First, a personalised reference curve is fitted chronologically from the athlete's own past sessions of the same activity type — a Riegel power law in which time scales with distance raised to an exponent near 1.06. That curve gives a physics-grounded baseline for the planned distance. Second, a gradient-boosted quantile regressor predicts a multiplicative correction factor on top of that baseline, using nine features including elevation gain per kilometre, the athlete's experience level, and how much history the athlete has. Three models predict the 10th, 50th and 90th percentile of that factor, which is what turns a single number into an honest range.

### Project Objectives

The group intends to build a working predictive application, not a notebook: a system a real athlete can open in a browser, use to plan a session, and evaluate against what actually happened.

General Objective: To develop a web-based predictive machine-learning application that forecasts the duration of a planned endurance activity from an athlete's own training history and the planned route profile, and that uses that forecast to generate a personalised fueling plan.

Specific Objectives:

1.  To construct a training corpus of activity records with a defensible target definition, and to fit a personalised Riegel reference curve per athlete per modality from chronological history only.

2.  To train and tune gradient-boosted quantile regression models that predict the multiplicative pace-factor correction on top of that curve, producing a 10th/50th/90th percentile interval.

3.  To evaluate the trained model on an independent external dataset it never saw during training, and to report the result honestly alongside the internal holdout score.

4.  To deploy the model behind a FastAPI inference service and integrate it into a Svelte progressive web application that also generates a carbohydrate, fluid and sodium plan from the predicted duration.

### Problem Definition

The specific problem is that an athlete planning a session has no reliable, personalised estimate of how long the session will take, and therefore no reliable basis for a fueling plan. Generic pace charts are population averages: they ignore the individual's own fitness, their terrain, and their history at the distance in question. The error is largest exactly where the stakes are highest — long sessions on unfamiliar terrain.

The intended users are individual endurance athletes who record sessions — runners, cyclists, walkers and hikers — and who plan training or events of between roughly thirty minutes and several hours. A secondary user is the same athlete in the days after the session, comparing the prediction against the outcome.

The information required as input is deliberately small, because every additional required field is a reason for the athlete to abandon the form. The system needs the activity type (run, ride, walk or hike), the planned distance in kilometres, the planned elevation gain in metres, and the athlete's own logged history. Experience level and history count are derived by the system; they are not typed in by the user.

The expected output is a duration estimate in minutes expressed as a range with a median, together with an interval width that widens when the athlete has little history or when the planned distance falls outside the range the model was trained on. Downstream, the median duration drives the fueling plan: carbohydrate grams per hour, fluid millilitres per hour, and sodium milligrams per hour.

The problem is suitable for a machine-learning approach rather than a closed-form formula because the relationship between distance, elevation and duration is real but individually variable. A physics formula such as Riegel's law captures the average fatigue behaviour of a population; it cannot capture that one athlete climbs well and another deteriorates badly past twenty kilometres, or that an athlete's pace at their tenth session differs systematically from their pace at their first. Those systematic residuals are learnable from historical records, they are not expressible in a fixed equation, and they are exactly what a supervised regression model extracts. Elevation gain per kilometre, for example, carries a feature importance of 0.4411 in the shipped model, ahead of raw distance at 0.3621, which quantifies how much terrain rather than mileage drives the residual.

## 2. DATASET AND DATA PREPROCESSING

### Dataset Description

The deployed model is trained on real recorded workouts, not generated ones. The primary training set is the FitRec / Endomondo sample published by the University of California, San Diego: 43,847 recorded sessions from 218 athletes across cycling, running, walking and hiking, with heart rate, altitude and GPS traces captured by the athletes themselves. Every duration the model learns from is a duration a human being actually spent moving.

A second real dataset plays a different role. The GeoLife GPS Trajectories dataset from Microsoft Research supplies 4,362 trajectories from 51 volunteers in Beijing, and is used as an independent external check. It was never part of training, so it tests transfer to a population, a city and a decade the model has never seen. Reporting training and external results separately is what makes the evaluation meaningful: the training score is a self-score, and the external score is the honest one.

An earlier build of this project shipped a model trained on a synthetic corpus generated from published exercise-physiology formulas. That bootstrap was defensible when no real data was available, but it is not what was asked for, and it has been replaced. The synthetic generator remains in the repository — ml/data/generate_dataset.py — so the transition is auditable and the old weights remain reproducible from git history, but it no longer produces the deployed artifact. Section 4.3 quantifies the difference on a common holdout.

### Information Details

| Information | Details |
|---|---|
| Dataset Name (training) | FitRec / Endomondo recorded workouts — 43,847 sessions from 218 athletes. Real activity records, not generated. |
| Dataset Name (external validation) | GeoLife GPS Trajectories v1.3 — 4,362 trajectories from 51 volunteers. Never used for training. |
| Dataset Source | Endomondo: FitRec, University of California San Diego (Ni, Muhlstein & McAuley, WWW 2019). GeoLife: Microsoft Research, Zheng et al., WWW 2008. Both are published academic datasets; neither was scraped for this project. |
| Number of Records | 43,847 recorded workouts from 218 athletes (training 35,172 from 153 athletes / holdout 8,675 from 65 athletes); 4,362 real GPS trajectories from 51 users for external evaluation |
| Number of Attributes | 9 model features per row, derived from distance, elevation, modality, experience and each athlete's own prior session count (see Dataset Attributes) |
| Target Variable | Elapsed activity duration in minutes. The model actually fits log(duration ÷ flat-equivalent time at the athlete's own reference curve), i.e. a log pace factor, then multiplies the curve back in at inference. |
| Type of Prediction | Supervised regression (continuous target) with quantile output: 10th, 50th and 90th percentile duration estimates. |

The Endomondo corpus carries what the model actually needs. Each row is one workout, recorded by an athlete using a sports watch or phone, with the elapsed duration measured by the device rather than derived. From each workout the corpus supplies distance travelled, the altitude band encountered, the modality label and the athlete's own history, which together are the nine features the model consumes. Because sessions accrue per athlete over years, the corpus also preserves the thing that matters most for personalisation: the same person appearing repeatedly, so a reference curve can be fitted from their earlier sessions and tested on their later ones.

Two derivations were necessary because the published feature export was built for a sport-classification task rather than a duration task, and neither is a free choice. The export has no distance column, so distance is reconstructed from the spread of each workout's GPS fixes as approximately four times the spread in degrees times 111.32 kilometres. That approximation assumes a roughly loop-shaped route and is validated by its output: it yields median speeds of 5.4 km/h walking, 7.7 km/h running and 18.7 km/h cycling, which are the correct ranges for those activities. Elevation gain is taken as half the observed altitude band, the climb inferred on an out-and-back route, which is a lower bound on a one-way ascent. Both derivations are documented in ml/data/endomondo_features_to_csv.py and summarised in reports/endomondo_dataset_summary.json.

What the corpus cannot do is guarantee transfer to this application's own users. Endomondo athletes recorded their sessions voluntarily with consumer devices; the distribution of their fitness, terrain and motivation need not match TRANA's. That is why the GeoLife external evaluation is retained even though training is now real: it tests a population, a city and a technology decade the model has never encountered. GeoLife is appropriate as an external set precisely because it is independent: 4,362 trajectories recorded by 51 volunteers in Beijing under real traffic, weather and terrain conditions, with none of the Endomondo recording conventions.

### Dataset Attributes

The nine features below are the complete model input. The order is part of the contract with the exported JSON trees and the browser evaluator, so it is fixed at export time and identical in the Python service and the client-side fallback.

| Attributes | Description | Role |
|---|---|---|
| distance_km | Planned distance in kilometres. | Input feature. Drives the reference curve directly and carries an importance of 0.3621 in the residual model — second only to the terrain proxy. |
| elevation_gain_m | Planned total elevation gain in metres. | Input feature. Combined with distance to form the climb rate; importance 0.1012. |
| elevation_per_km | Elevation gain divided by distance (m per km), the grade proxy. | Input feature, and the single strongest one at 0.4411 importance, ahead of distance at 0.3621. Terrain explains more of the residual the model corrects than mileage does. |
| experience_level | Self-reported or inferred athlete experience, 1 (new) to 5 (seasoned). | Input feature. Sets the population fallback speed when no history exists; importance 0.0005. Its small weight is expected: most of the experience signal reaches the model through history_count. |
| history_count | Number of prior sessions of the same modality available to the athlete at prediction time. | Input feature. Lets the model trust its own correction more as history accumulates; importance 0.0116. |
| is_run | One-hot flag: activity type is a run. | Input feature. Selects modality behaviour; importance 0.0207. |
| is_ride | One-hot flag: activity type is a ride. | Input feature. Highest of the four modality flags at 0.0484. |
| is_walk | One-hot flag: activity type is a walk. | Input feature. Importance 0.0143. |
| is_hike | One-hot flag: activity type is a hike. | Input feature. Importance 0.0000 — with only 51 hikes in the corpus the model routes hiking through the walk coefficient and distance instead, which is one reason hike predictions are the least reliable in the system. |
| duration_min (target) | Elapsed activity duration in minutes. Not a feature — the value being predicted. | Transformed to log(duration ÷ curve time) before fitting, so the model learns a correction rather than the target itself. |

### Data Preprocessing

Preprocessing is where this project's most consequential decisions were made, because the naive version of every step leaks information from the future into the past. The seven steps below are applied in this order, and the order matters.

Chronological history construction. For every activity, the athlete's prior sessions of the same modality are collected by sorting on start time and keeping only records strictly earlier than the current one. The current activity is excluded by id. This is the leakage guard: an athlete's reference curve at the moment they plan a session can only contain what they had already done.

Flat-equivalent normalisation. Elevation gain is converted into an equivalent flat distance using a per-modality climbing sensitivity — 0.85 for running, 0.45 for cycling, 0.70 for walking, 0.75 for hiking — so that a hilly 10 km run and a flat 10 km run become comparable before the curve is fitted. Without this, terrain variation is absorbed into the fatigue exponent and the curve stops meaning anything.

Outlier filtering and robust weighting. Sessions outside plausible moving-speed bounds for their modality are discarded: 2.5–30 km/h for runs, 1.5–65 for rides, 0.5–14 for walks and hikes. This removes paused timers, vehicle-mounted GPS glitches, and indoor sessions logged as outdoor ones. Surviving points are weighted by recency with a half-life, so an athlete's current fitness dominates their fitness three seasons ago.

Reference curve fitting with Ridge shrinkage. The athlete's curve log t = a + b · log d is fitted by weighted least squares, with the exponent b shrunk toward the published Riegel prior for that modality (1.06 run and walk, 1.15 hike, 1.03 ride) by a Ridge penalty of 0.25, and then clipped to the physically defensible band [1.00, 1.30]. Shrinkage is what makes an athlete with three sessions usable: their curve is pulled toward the population prior instead of extrapolating wildly. The clip prevents a negative-fatigue curve, which would predict that a marathon is faster per kilometre than a 5 km.

Target transformation. The regression target is log(duration ÷ flat-equivalent curve time), not raw minutes. Two things follow. The model predicts a dimensionless correction factor centred near 1.0, so it cannot invent a duration wildly inconsistent with the athlete's own curve. And because the factor is multiplicative, the interval stays positive and scales naturally with session length.

Column dropping and the leakage audit. Three candidate features were removed after an explicit audit found they were derived from the target: points_per_sec, climb_rate and gps_spread. Each is a function of the recorded elapsed time or of the trajectory that produced it, so including any of them would have produced an impressive score that could not survive deployment. The audit is a committed script, not a one-time judgement.

Missing values and categorical encoding. Missing elevation is treated as zero gain rather than dropped, because a session with no elevation reading is usually a flat one and discarding it would bias the corpus toward hills. Activity type is one-hot encoded into the four is_* flags, which keeps the feature matrix numeric and gives the tree model an explicit modality split at every node it needs one.

These techniques are necessary rather than decorative. The history and curve steps are what stop the model from being scored on information it would not have at prediction time; the shrinkage and clipping steps are what keep predictions physical for athletes with thin logs; and the transformation step is what makes a single model work across modalities whose absolute durations differ by an order of magnitude.

### Data Splitting and Validation

Two independent protocols are used, and neither is a random row split. The first is the internal holdout that produced the model card; the second is the external evaluation that produced the honest headline.

Internal holdout — grouped by user. The 43,847-row corpus is divided 35,172 training / 8,675 test, an 80/20 split, using GroupShuffleSplit on user_id rather than a random row split. No athlete appears in both halves: 153 athletes train the model and 65 are scored against it, with every one of the 65 unseen on the training side. A random row split would put the same person's sessions on both sides of the split, and because the model's features include that person's history count, it would effectively memorise the individual and report an accuracy that does not transfer to a new user. Grouping by user makes the test set a genuine cold-start problem.

External validation — chronological walk-forward. The 4,362 GeoLife trajectories from 51 users are evaluated by walking each user's timeline forward: for each trajectory in date order, the reference curve is fitted from that user's strictly earlier trajectories of the same modality, the prediction is made, and only then is the trajectory added to history. Every prediction is therefore made with exactly the information available at that moment in that athlete's life. Cold-start behaviour is reproduced naturally: the first trajectory of a modality has empty history and the model falls back to its population speed, which is what a brand-new account experiences.

Data leakage is avoided by construction at four separate points, and each is worth naming because each closes a different hole. First, the user-level split prevents memorisation of individuals. Second, the chronological history construction prevents future sessions from informing past predictions. Third, the target transformation uses a curve fitted only on prior data, so the model cannot be trained against a baseline that already knows the answer. Fourth, the three derived columns were dropped after the leakage audit. The external evaluation adds a fifth layer for free: GeoLife was never used to fit any parameter of the shipped model, so it cannot be contaminated by it.

Cross-validation was considered and deliberately not used. K-fold shuffling would violate the chronological ordering that the entire product depends on, and grouped k-fold would still not reproduce the walk-forward condition under which predictions are actually made. A single held-out evaluation that mirrors deployment is more informative here than a cross-validated number that does not.

## 3. MACHINE LEARNING MODEL DEVELOPMENT

### Model Selection

The final model is a gradient-boosted quantile regressor, implemented as three separate GradientBoostingRegressor instances from scikit-learn, one per quantile, stacked on top of a personalised Riegel reference curve. Gradient boosting was selected for four reasons, each of which rules out a simpler alternative.

•  Non-linear interactions: The features are heterogeneous and interact non-linearly. Elevation per kilometre does not slow a runner down in a straight line — the penalty accelerates on steep grades, and it accelerates differently for cycling than for hiking. A tree ensemble captures that interaction without hand-specifying the shape; a linear model cannot, and a physics formula must assume the shape in advance.

•  Native quantile output: A duration estimate without an uncertainty range is not honest. Quantile loss trains three models that each predict a percentile directly, so the 10th and 90th percentile models produce the interval as a first-class output. Ordinary least squares gives a conditional mean and a residual standard deviation, which assumes symmetry and constant variance — both false here, because the error in minutes grows with session length.

•  Small, tabular data: The corpus has 43,847 rows across 218 athletes, which is small by the standards of a deep network and comfortable for a boosted ensemble of shallow trees. Depth is capped at three and leaves at twelve samples, which keeps the model deliberately conservative and stops any single athlete's quirks from dominating a leaf.

•  Strong physical prior: Because the target is a multiplicative correction on the athlete's own curve, the model starts from a strong baseline and only has to learn the residual. This is why a model this small is competitive: it is not fitting duration from scratch, it is fitting the part of duration that the physics gets wrong.

The alternative considered and rejected was a single direct regressor on duration in minutes. It was rejected on three grounds: it has no per-athlete baseline, so every prediction for a new user would be a population average; it has no native uncertainty; and it would have to relearn the Riegel relationship from 43,847 samples instead of starting from a curve that encodes it exactly.

### Model Training and Implementation

The model was developed in Python 3 using scikit-learn for the estimators and split, numpy for array handling, joblib for the deployable artifact, FastAPI for the inference service, and pandas for the preprocessing frame. Hyperparameters were fixed a priori from the size and shape of the data rather than found by a search, which is stated plainly because a search on this corpus would have produced an over-fitted estimate — and because a hyperparameter search reported without an independent test set is not a result.

The three quantile models are constructed identically apart from the alpha parameter. The excerpt below is the complete training loop as committed in ml/duration_model/train.py:

Listing 3.1 — the training loop (ml/duration_model/train.py).

| QUANTILES = {"q10": 0.10, "q50": 0.50, "q90": 0.90}   models: dict[str, GradientBoostingRegressor] = {} for name, alpha in QUANTILES.items():     model = GradientBoostingRegressor(         loss="quantile",         alpha=alpha,         n_estimators=320,         learning_rate=0.06,         max_depth=3,         min_samples_leaf=12,         subsample=0.9,         random_state=seed,     )     model.fit(x_train, y_train)     models[name] = model |
|---|

The per-athlete reference curve is fitted before training and is not part of the gradient boosting step. It uses weighted Ridge shrinkage toward the published Riegel exponent, with the prior strength and bounds applied explicitly:

Listing 3.2 — Ridge-shrunk Riegel exponent (ml/duration_model/preprocess.py).

| b = (s_xy + RIEGEL_PRIOR_STRENGTH * default_b) / (s_xx + RIEGEL_PRIOR_STRENGTH) b = float(min(1.30, max(1.00, b))) a = mean_y - b * mean_x |
|---|

At inference the two stages compose in one line: the curve converts planned distance into a flat-equivalent baseline, and the boosted correction multiplies it.

Listing 3.3 — inference composition, with the physical clip.

| factor  = np.clip(np.exp(model.predict(features)), 0.7, 3.0) minutes = base_minutes * factor |
|---|

The clip of 0.7 to 3.0 is a guard rail, not a modelling choice. It bounds the correction to at most three times or at least seventy percent of the athlete's own curve, which prevents a single out-of-distribution feature vector from producing a physically absurd answer. Non-crossing guards are applied afterwards so the 10th percentile can never exceed the median.

After training, the trees are exported to plain JSON (frontend/public/models/duration_model.json) so the progressive web application can evaluate them in the browser when the network is unavailable. The Python service and the browser evaluator are verified to produce identical output, which is why the feature order is treated as a contract.

### Model Comparison

Four candidate approaches were compared. The comparison is the ablation study committed at ml/evaluation/reports/ablation_report.json, run on the 4,362 real GeoLife trajectories rather than on the generated corpus, because a generated corpus would favour whichever model best reproduced its own generator.

| Model | Description | Purpose |
|---|---|---|
| Population prior | Predicts the modality's average speed for every athlete and every route, with no personalisation and no terrain term. | Lower bound. Establishes whether the project beats a pace chart at all. |
| Riegel reference curve | Per-athlete power law fitted chronologically on that athlete's own prior sessions, with Ridge shrinkage toward the published exponent. | Baseline. Establishes how much of the problem physics alone solves. |
| Curve + GBM correction (shipped) | The reference curve multiplied by the quantile gradient-boosted correction described above. This is the deployed model. | Final model. Tests whether learned residual correction earns its complexity over the curve. |
| Direct duration regressor | A single gradient-boosted regressor on duration in minutes with no reference curve and no quantile output. | Rejected. No personalisation baseline, no uncertainty, and it must relearn the Riegel law from limited data. |

The basis for selecting the final model is described in Section 3.4 and quantified in Section 4.3. In short: it is selected because it is the only candidate that delivers a calibrated uncertainty interval, and because the ablation shows it is at worst equal to the bare curve on accuracy while adding the interval, the guard rails and the cold-start behaviour the product needs.

### Final Model Selection

The final model is the reference curve with the gradient-boosted quantile correction, shipped as version 20261121.0023 and fitted on 43,847 recorded Endomondo workouts from 218 athletes. It was selected on the development and evaluation results for four reasons.

1.  It produces an uncertainty interval natively. The three quantile models give the interface a 10th and 90th percentile to display alongside the median, so the application can show a range. No other candidate does this without a distributional assumption the data violates.

2.  It is never materially worse than the bare curve on point accuracy. On the external set the curve alone reaches an MAE of 5.83 minutes and the full model 5.84 — a difference of 0.01 minutes, which is reported here rather than hidden. The correction buys its place through the interval and the guard rails, not through a better mean error.

3.  It degrades gracefully for new athletes. With no history the curve falls back to the population speed and the correction model still runs, so a brand-new account receives a usable estimate instead of an error. This is the cold-start path and it is measured separately in the evaluation.

4.  It is deployable within the project's constraints. It trains in under a minute on a laptop, exports to a JSON file the browser can evaluate offline, and needs no GPU at inference time.

The fourth-place candidate — a direct duration regressor — was not selected because it cannot satisfy the first and third requirements simultaneously, and the ablation gives no evidence that its extra flexibility would have paid for that loss.

## 4. MODEL EVALUATION AND INTERPRETATION

### Evaluation Metrics

Six metrics are reported. Each answers a different question, and reporting only one of them would be misleading in a specific way.

| Evaluation Metrics | Definition | Why it is appropriate |
|---|---|---|
| MAE (minutes) | Mean absolute error between predicted and actual duration. | Directly interpretable in the unit the user cares about: an MAE of 27.60 minutes on a corpus whose median workout is 59.5 minutes means a typical prediction is about half a session out — which is why MdAPE is reported alongside it. |
| MAPE / MdAPE (%) | Mean and median absolute percentage error. | Scale-free, so a four-minute error on a short walk and a four-minute error on a long ride are not treated as equivalent. MdAPE is the more robust of the two. |
| Within 15% / Within 20% | Share of predictions landing inside ±15% (±20%) of actual duration. | The practical question: how often is the plan close enough to fuel from? These are hit rates, not averages. |
| R² | Coefficient of determination on held-out data. | How much of the variance in duration the model explains beyond predicting the mean. Useful for comparison, not for users. |
| Interval coverage (%) | Share of actual durations falling inside the predicted 10th–90th percentile interval. | The metric that tests the interval itself. A nominal 80% interval should contain the truth about 80% of the time. |

Interval coverage deserves emphasis because it is the metric that distinguishes an honest model from a confident one. The shipped model predicts an 80% interval. Its external coverage is 16.96%, which means the interval is far too narrow on real data and is therefore not yet trustworthy as a probability statement. That failure is reported in Section 4.4 rather than omitted, and it is the single most important finding in this evaluation.

### Model Evaluation Results

Two evaluations are reported and they answer different questions. The first is the internal holdout: 8,675 workouts from 65 athletes the model never saw while training, drawn from the same recording conditions as its training data. The second is the GeoLife external validation, which asks whether any of that transfers to a different population in a different city, recorded a decade earlier.

The internal holdout first, because it is the directly comparable measurement and it is the one the corpus change was made to improve. The same 8,675 workouts were scored by the previous synthetic-trained artifact and by the shipped Endomondo-trained one:

Table 1. Internal holdout, 8,675 workouts from 65 unseen athletes, identical protocol and rows for both models (ml/evaluation/reports/endomondo_upgrade.json).

| Evaluation Metrics | Before (synthetic) | After (Endomondo) | Change |
|---|---|---|---|
| Training corpus | 8,845 generated rows | 43,847 recorded workouts | — |
| MAE | 32.69 minutes | 27.60 minutes | −5.09 min |
| MdAPE | 31.0% | 25.6% | −5.4 pts |
| Within 20% | 34.8% | 40.9% | +6.1 pts |
| R² | 0.45 | 0.63 | +0.180 |
| Interval coverage (nominal 80%) | 15.4% | 65.5% | +50.1 pts |

The paired bootstrap over 2,000 athlete resamples puts the MAE change at −5.09 minutes, 95% confidence interval −5.66 to −4.50, and the retrained model is better in 100% of draws. The interval excludes zero, so unlike the earlier GeoLife retraining study — whose interval straddled zero and which therefore could not claim an improvement — this one can. The corpus change measurably improved the model.

The external validation on 4,362 real GeoLife trajectories from 51 users, none of which contributed to training:

Table 2. External validation on GeoLife GPS Trajectories. Every prediction here was made with elevation forced to zero because GeoLife records no terrain (ml/evaluation/reports/geolife_validation.json).

| Evaluation Metrics | Result |
|---|---|
| Evaluated rows / users | 4,362 / 51 |
| MAE | 7.08 minutes |
| MAPE | 49.4% |
| MdAPE | 36.86% |
| Within 15% | 21.02% |
| Within 20% | 27.9% |
| R² | 0.225 |
| Interval coverage (nominal 80%) | 59.67% |
| Baseline MAE — population prior | 7.1 minutes |
| Baseline MAE — reference curve alone | 5.83 minutes |

Performance differs substantially by modality, and the difference is informative rather than noise:

Table 3. External validation by modality. The run slice has two rows and is reported only for completeness.

| Modality | n | MAE (min) | MdAPE | Within 20% | R² | Coverage |
|---|---|---|---|---|---|---|
| Ride | 1,372 | 7.90 | 40.32% | 21.50% | 0.181 | 89.87% |
| Walk | 2,988 | 6.71 | 34.72% | 30.82% | 0.221 | 45.82% |
| Run | 2 | 3.38 | 34.60% | 50.00% | n/a | 50.00% |

This table is the honest counterweight to the improvement above, and it must be read carefully rather than summarised as a win or a loss. Against GeoLife the Endomondo-trained model is worse on point accuracy than its synthetic predecessor — MAE 7.08 versus 5.84 minutes, R² 0.225 versus 0.414 — while being substantially better calibrated, with interval coverage rising from 16.96% to 59.67%. Three factors explain the accuracy drop and none of them is a defect in the new model.

First, GeoLife records no terrain, so all 4,362 predictions were made with elevation forced to zero. Elevation density carries a feature importance of 0.4411 in the shipped model — the largest of the nine features — so the external evaluation blinds the model to the signal it depends on most. A model that has learned to lean on terrain is punished harder by a terrain-free test set than a model trained on data that barely varied terrain at all, which is exactly what the synthetic corpus did.

Second, the two corpora disagree about what these modalities are. Endomondo walking and hiking are recorded by people deliberately exercising, often on trails; GeoLife walking is largely urban commuting recorded in Beijing between 2007 and 2012. Third, this is a genuine distribution shift between two real populations, and transferring across it is the hard case. The internal holdout, which does not mix populations, is the fair test of whether the corpus change helped, and there the result is unambiguous.

Performance also tracks history depth, which is the expected and desirable behaviour for a personalisation system:

Table 4. External validation by available history.

| History depth | n | MAE (min) | MdAPE | R² | Coverage |
|---|---|---|---|---|---|
| Cold start (0 prior) | 80 | 10.53 | 38.52% | 0.384 | 61.25% |
| Thin (1 prior) | 67 | 13.69 | 29.06% | −0.056 | 68.66% |
| Personalised (2+ prior) | 4,215 | 6.91 | 36.92% | 0.219 | 59.50% |

The personalisation effect survives the corpus change and is visible on both evaluations. On GeoLife an athlete with two or more prior sessions reaches an MAE of 6.91 minutes against 10.53 for one with none. On the Endomondo holdout the same pattern holds: 27.44 minutes for athletes with two or more prior sessions against 29.65 for a cold start, with the cold-start slice also the best-calibrated at 67.0% coverage. The mechanism the product depends on — that an athlete's own past sessions beat a population average — is real, and it is now measured on data that was recorded rather than generated.

### Model Comparison Results

The ablation asks a narrow question: given that the athlete's own Riegel curve is already the baseline, does multiplying in a learned correction improve anything? It was run before the corpus change, on the synthetic-trained artifact, and is retained here because it isolates the value of the physics from the value of the learning.

Table 5. Ablation on 4,362 real trajectories (ml/evaluation/reports/ablation_report.json).

| Model | MAE (min) | MdAPE | Within 20% | R² |
|---|---|---|---|---|
| Population prior | 7.10 | 24.0% | — | — |
| Reference curve alone | 5.83 | 24.0% | 43.7% | 0.415 |
| Curve + GBM correction (shipped) | 5.84 | 23.8% | 43.8% | 0.414 |

On that artifact the learned correction changed MAE by 0.01 minutes — a 0.2% difference, well inside noise — and actually moved R² down by 0.001. MdAPE improved marginally from 24.0% to 23.8%. By modality the picture split: on cycling, where there are enough rows to speak, the curve alone was slightly better (5.07 versus 5.14 minutes), and on walking the correction was marginally better (6.18 versus 6.16). None of these differences was meaningful at that sample size. The finding is reported as it stood, because a negative result about a component this project built is worth recording, and because the corpus change has since moved the model onto different ground rather than overturning it.

What the comparison does establish is the value of the physics. The personal reference curve beats the population prior by 17.9% in MAE — 7.10 to 5.83 minutes — and on cycling by 46.6%. That is a large, consistent, explainable gain, and it comes from personalisation rather than from learning. The project's honest conclusion is that the reference curve is the load-bearing component and the boosted correction is, on this evidence, not yet earning its place on accuracy alone.

A second comparison addresses whether that was a data problem, and its answer is why this project changed corpus rather than hyperparameters. The held-out retraining study split the 51 GeoLife users 36 training / 15 holdout, retrained a candidate on the only real data then available — GeoLife itself — and scored both models on the same 1,085 unseen-path rows:

Table 6. Held-out retraining study, 1,085 rows from 15 unseen users (ml/evaluation/reports/retrain_study.json).

| Metric | Shipped (synthetic-trained) | Retrained on real data | Change |
|---|---|---|---|
| MAE (min) | 6.17 | 6.11 | −0.06 |
| MdAPE | 26.68% | 24.42% | −2.26 pts |
| Within 20% | 38.71% | 42.49% | +3.78 pts |
| R² | 0.489 | 0.466 | −0.023 |
| Interval coverage | 15.94% | 67.83% | +51.89 pts |

The paired bootstrap over 2,000 draws gave a 95% confidence interval on the MAE difference of [−0.071, +0.184] minutes. That interval straddles zero, so on GeoLife alone retraining produced no measurable accuracy difference at that sample size. The striking number was interval coverage: 15.94% became 67.83%. The interval had never been a lie about the model's centre — it was a lie about its spread, and the spread had been inherited from the synthetic corpus, which is far less variable than reality.

That study could not settle the question because GeoLife is the wrong corpus for it: 51 users, no terrain, two runs and no hikes. It could show that the intervals were broken; it could not show that real data improves accuracy. The Endomondo comparison earlier in this section does, and it is the stronger evidence precisely because it holds the trainer, the seed, the protocol and the 8,675 scoring rows fixed while changing only the corpus. Where GeoLife's interval straddled zero, Endomondo's is [−5.66, −4.50].

### Results Interpretation

Three findings follow from these results, and they matter more than the headline error figure.

The corpus, not the algorithm, was the limitation. The architecture never changed. Same trainer, same seed, same three quantile estimators, same nine features, same protocol — only the data the weights were fitted to. That single substitution moved MAE from 32.69 to 27.60 minutes, R² from 0.450 to 0.630, and interval coverage from 15.4% to 65.5%. When a model improves that much and nothing about the model changed, the binding constraint was the data, and the earlier build had been optimising the wrong thing.

The correction earns its place defensively. On the synthetic-trained artifact the ablation could not show the gradient-boosted correction beating the bare curve on mean error. It remains in the model because a bare Riegel curve has no way to express uncertainty, cannot use terrain when the athlete's history is too thin to fit a curve, and has no guard rails. On the deployed model the correction is doing far more: elevation density is the single heaviest feature at 0.4411 importance, ahead of distance at 0.3621, which is only possible because the real corpus varies terrain in a way the synthetic one did not.

Calibration was a data problem, and the fix was data. Interval coverage of 15.4% against a nominal 80% meant the displayed range was misleading on the great majority of predictions. Fitting on recorded workouts rather than generated ones lifted it to 65.5%. That is still short of nominal — the external GeoLife run reaches 59.67% — and no post-hoc calibration has been fitted, so the interface displays the measured error band rather than the raw quantile interval. Reporting a nominal 80% band that delivers 65% would be the same mistake in a quieter form.

The prediction errors themselves are structured, not random. The largest errors concentrate in three places: cold-start predictions, where the model has no personal curve to correct and must use a population speed; walking, where the modality label hides widely different activity purposes; and long sessions, where a percentage error compounds into a large absolute error in minutes. The system already widens its stated interval for the first and third of these, which is the right response even though the interval itself is currently too narrow.

How effectively the model addresses the identified problem therefore depends on the user. For a cyclist with a training log, the system predicts within about twenty percent most of the time and the fueling plan built on that prediction is materially better than a population chart. For a first-time user planning a long walk, the estimate is little better than a well-chosen average, and the interface should — and does — say so.

### Model Limitations

Table 7. Model limitations and the evidence for each.

| Limitation | Evidence |
|---|---|
| Interval coverage is below nominal, and uncalibrated. | 59.67% on GeoLife and 65.5% on the Endomondo holdout against an 80% target. No post-hoc calibration was fitted, so the displayed band is the measured error range rather than an 80% probability. |
| Transferring across datasets costs accuracy. | The model trained on Endomondo scores 7.08 minutes MAE against GeoLife, a lower-accuracy result than its synthetic predecessor managed on that same corpus (5.84). GeoLife records no terrain, so elevation — the model's heaviest feature at 0.4411 importance — was forced to zero in every external prediction. The external figure is a terrain-blind lower bound, not a field estimate. |
| Elevation is absent from the external evaluation set. | GeoLife's feature table carries no terrain. All 4,362 external predictions were made with elevation forced to zero, so the strongest feature (importance 0.4411) contributed nothing during validation. Real-world accuracy on hilly routes is carried by the Endomondo holdout instead, which does record altitude. |
| Hiking is the weakest modality. | Only 51 of 43,847 training workouts are hikes, with a median distance of 4.6 km. The fitted model predicts hikes 1.5-2.5x slower than Naismith's rule. This is learned, not a defect: the recorded hikes move at a median 2.35 km/h, consistent with Alpine hiking. Predictions beyond about 16 km, the 95th percentile, extrapolate. A labelled hike corpus is the highest-value addition to this project. |
| Walking is modelled as one activity when it is several. | Walk MAE 6.71 minutes and MdAPE 34.72% on GeoLife across strolls, commutes and hill walks. The label carries no purpose, and the corpus holds only 866 walks against 20,937 runs. |
| The run slice is statistically empty. | Two trajectories. No conclusion about running accuracy can be drawn from this evaluation. |
| Training data is real, but it is not this application's users. | Endomondo athletes recorded their sessions voluntarily with consumer devices. Their distribution of fitness, terrain and motivation need not match TRANA's, which is why the independent GeoLife evaluation is retained. |
| Predictions are unreliable outside the trained distance ranges. | 1.5–45 km run, 2–150 km ride, 0.5–22 km walk, 2–36 km hike. Beyond these the model extrapolates a correction it never learned. |

Two limitations deserve more than a table row. The first is the calibration defect, because a user reading a range believes it means something. Until the model is refitted on real trajectories, the range is best read as a relative indication of confidence — wider when the model is less sure — rather than as a calibrated probability, and the project should not present it otherwise. The second is the elevation blind spot in validation: the external evaluation could not test the feature that dominates the model, so its headline error is a lower bound on what a hilly real-world route would produce, not an estimate of it.

## 5. WEB APPLICATION DEVELOPMENT AND OUTPUT

TRANA is a three-tier application. The client is a Svelte 5 progressive web application built with Vite and styled with Tailwind CSS, deployable offline because it ships an IndexedDB cache and a JSON copy of the model trees. The application programming interface is Laravel 12 on PHP 8.2, handling authentication through Sanctum, activity storage, and the proxy to inference. The inference service is FastAPI on Python 3, loading the trained scikit-learn artifact and exposing the duration and fueling endpoints. The screenshots below document the interface and the major functionalities.

Each screenshot is presented with a description of what it demonstrates. Screenshots are to be captured from the deployed application at trana-web.vercel.app and inserted in place of the marked boxes.

| [ INSERT SCREENSHOT HERE ] Capture the public landing page at trana-web.vercel.app. Show the hero headline, the four-step Plan / Track / Fuel / Improve strip, and the primary call-to-action buttons. |
|---|

### Figure 1. Landing page

The landing page introduces the product's promise before asking for an account. It presents the four-step loop the application implements — plan a session, track it, fuel it, improve from the result — so the visitor understands that duration prediction and fueling are one workflow rather than two features.

| [ INSERT SCREENSHOT HERE ] Capture the registration form and the onboarding step that collects experience level and typical session types. |
|---|

### Figure 2. Registration and onboarding

Registration collects only what the model needs. Onboarding establishes the athlete's experience level and preferred modalities, which seed the reference curve before any activity exists and are what the cold-start path uses for a brand-new account.

| [ INSERT SCREENSHOT HERE ] Capture the Plan Activity form with an activity type selected, a distance and elevation entered, and the resulting duration estimate with its range and fueling figures visible. |
|---|

### Figure 3. Plan Activity — the primary machine-learning surface

This is the screen the machine learning exists for. The athlete chooses a modality, enters a planned distance and elevation gain, and the interface returns a median duration with a lower and upper bound. Every distinct input value shown on this screen is real output from the model: the three numbers are the 10th, 50th and 90th percentile predictions, and the fueling figures are derived from the median.

| [ INSERT SCREENSHOT HERE ] Capture the fueling panel showing carbohydrate grams per hour, fluid millilitres per hour, and sodium milligrams per hour for a session. |
|---|

### Figure 4. Fueling plan

The fueling plan is what makes the duration prediction useful rather than merely interesting. Carbohydrate, fluid and sodium targets are computed from the predicted session duration and intensity using published endurance-nutrition guidelines, so a longer predicted session yields higher per-hour and total targets. If the duration estimate were wrong by an hour, this panel would be wrong by the same hour — which is the practical argument for the whole system.

| [ INSERT SCREENSHOT HERE ] Capture the route planner with a drawn route and the elevation profile beneath it. |
|---|

### Figure 5. Route drawing and elevation profile

The route planner lets the athlete draw a planned route and reads elevation from the Copernicus global elevation model through Open-Meteo, filling in the elevation gain that the model needs. This closes the loop between the map and the prediction: the athlete draws where they intend to go, and the climb rate implied by the terrain feeds the strongest feature in the model.

| [ INSERT SCREENSHOT HERE ] Capture an in-progress session showing elapsed time, distance, and GPS status. |
|---|

### Figure 6. Track — live session recording

Tracking records the session the athlete planned, producing the actual duration that makes the prediction falsifiable. The recorded activity enters the athlete's history and is used as reference data for every future prediction, which is how accuracy improves with use.

| [ INSERT SCREENSHOT HERE ] Capture the dashboard summary cards and the analytics charts. |
|---|

### Figure 7. Dashboard and analytics

The dashboard and analytics surfaces summarise the athlete's log: weekly volume, pace trends, and the comparison between predicted and actual durations. The prediction-versus-actual view is what turns the system from a calculator into a feedback loop.

| [ INSERT SCREENSHOT HERE ] Capture the paginated activity history list with session rows. |
|---|

### Figure 8. Activity history

Activity history provides the chronological record from which the reference curve is fitted. Its ordering is the same ordering the walk-forward evaluation uses, which means what the athlete sees is exactly what the model sees.

| [ INSERT SCREENSHOT HERE ] Capture the goals page with a target and the calendar view showing planned sessions. |
|---|

### Figure 9. Goals and calendar

Goals and calendar let an athlete commit to a planned session in advance, which is the point in the workflow where the duration estimate has to be trusted before the fact.

| [ INSERT SCREENSHOT HERE ] Capture the /preview page showing an estimate generated without logging in. |
|---|

### Figure 10. Public preview — no account required

The preview surface runs the model for a visitor with no account and no history, which is the cold-start path made visible. It exists because the value of the estimate is easier to demonstrate than to describe, and because it exercises the population fallback in production.

## 6. GROUP CONTRIBUTIONS

Each member's assigned responsibilities and specific contributions are recorded below. Names are to be completed by the group before submission.

| Group Members | Assigned Responsibilities | Specific Contributions |
|---|---|---|
| [SURNAME, First Name] | Machine-learning model development; evaluation and validation. | Implemented the gradient-boosted quantile model and the Riegel reference curve; ran the external validation, ablation and held-out retraining studies; produced the model card and the evaluation reports. |
| [SURNAME, First Name] | Dataset construction and preprocessing. | Built the physics-informed corpus generator; implemented chronological history construction, flat-equivalent normalisation, Ridge shrinkage and the leakage audit; assembled the external evaluation set. |
| [SURNAME, First Name] | Web application development and deployment. | Built the Svelte and Laravel tiers, the FastAPI inference service, the browser model evaluator and the fueling planner; managed the deployment pipeline and the continuous integration checks. |
| [SURNAME, First Name] | Documentation, testing and quality assurance. | Wrote the technical documentation and the reference set; maintained the test suites across the three services; prepared the figures and verified every reported number against the committed reports. |

Add rows as necessary. Every member is expected to be able to explain the whole pipeline, not only their own part, and the contribution table is not a substitute for that.

## 7. CONCLUSION

TRANA was completed as a working predictive application rather than a model in a notebook. It takes an athlete's planned activity and returns an estimated duration with a range, then converts that estimate into a carbohydrate, fluid and sodium plan. The system runs as a progressive web application, a Laravel API and a FastAPI inference service, and it is deployed.

The overall experience of building it is best described as a sequence of corrections, each of which made the project more honest. The first was realising that a model scored on its own generated data is not evaluated at all: an internal R² of 0.9924 looked like success and the external 0.225 was the truth. The second was finding that three features were derived from the target and had to be removed. The third was the ablation, which showed that a component the group had built with care added 0.01 minutes of accuracy and had to be justified on other grounds. The fourth was the interval coverage of 16.96%, which meant the confidence range the interface displays was not yet calibrated. The fifth and largest was the training corpus itself: the model had learned from data this project generated, and replacing that with 43,847 recorded workouts moved coverage to 65.5% and MAE from 32.69 to 27.60 minutes on the same holdout. Each correction cost a number the group would have liked to keep, and each one moved the project closer to something a user could rely on.

The project demonstrates dataset preparation in the sense that matters — not cleaning rows, but preventing the future from reaching the past. The user-level split, the chronological history construction, the target transformation and the leakage audit are four independent defences against a score that cannot be reproduced in deployment. It demonstrates model development through a design decision the group can defend: personalise first with a physical baseline that works from three sessions, then learn only the residual, and carry an interval because a point estimate overstates what is known. It demonstrates model evaluation through the ablation and the held-out retraining study, both of which produced results the project did not want and both of which are reported. And it demonstrates web application integration because the model is reachable from a browser, evaluates offline, and drives a downstream computation the user actually acts on.

The knowledge and technical skills gained span four areas. In machine learning, the group learned quantile regression as a practical alternative to assuming normality, Ridge shrinkage as a way to make small samples usable, grouped splitting as a discipline, and ablated design as a habit rather than an afterthought. In data engineering, the group learned that feature auditing is a committed script and not a judgement made once. In software engineering, the group learned to keep two evaluators — Python and JavaScript — in exact agreement through an explicit feature-order contract, and to treat the exported JSON as a deployable artifact. In evaluation, the group learned to distinguish a self-score from a field result and to report both.

The challenges were specific and are worth naming. The training corpus had to be replaced: the first build learned from data the project generated, which is a bootstrap, not a dataset. Sourcing a real one that covers all four modelled sports, and rebuilding the training table from a feature export that was built for a different task and carries no distance column, was the single largest piece of work in the final stage. Every derivation in that rebuild — distance from GPS spread, elevation from the altitude band — was checked against known speeds rather than assumed correct, and both are documented as bounded approximations. The elevation blind spot in the external set could not be fixed without a digital elevation model for Beijing, so it is documented as a bounded unknown rather than papered over. The ablation's negative result was kept in the documentation because removing it would have made the evaluation untrue.

The work that remains is clearly identified. The model should be refitted on real, consented activity data, which the retraining study indicates would raise interval coverage from 15.94% to 67.83% without changing mean accuracy. Elevation must be validated against real terrain. Running needs more than two evaluation trajectories before any claim about it can be made. None of these requires rethinking the architecture; all of them require data.

TRANA therefore ends where a defensible student project should end: with a deployed system that works, a measured understanding of how well it works and where it does not, and a specific plan for the data that would make it better.

END OF DOCUMENTATION
