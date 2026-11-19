"""Section 2 — Dataset and Data Preprocessing."""

from __future__ import annotations

from docx_engine import Doc


def build_section_2(doc: Doc) -> None:
    doc.h1("2. DATASET AND DATA PREPROCESSING")

    doc.p(
        "This project uses three datasets for three different jobs, and keeping them "
        "distinct is central to the credibility of the results. One corpus trains the shipped "
        "model. One corpus evaluates it externally, on people and GPS traces it has never "
        "seen. One subset of that external corpus is then used to test the retraining "
        "hypothesis. Conflating any two of them would invalidate the numbers.",
        align="justify",
    )

    doc.table(
        ["Dataset", "Role", "Rows", "Users", "Used for"],
        [
            ["Synthetic corpus (physics generator)",
             "Training corpus for the shipped model", "8,845", "240", "Fitting q10/q50/q90 trees"],
            ["GeoLife GPS Trajectories (external)",
             "Independent evaluation set", "4,362", "51", "Honest accuracy, ablation, diagnosis"],
            ["GeoLife, user-disjoint 70/30 split",
             "Retraining experiment", "3,277 train / 1,085 holdout", "36 / 15",
             "Testing the data-artefact hypothesis"],
        ],
        caption="The three datasets and the distinct role each one plays.",
        widths=[2.0, 1.6, 1.15, 0.7, 1.35],
        align_numeric=False,
    )

    # -------------------------------------------------------------- 2.1
    doc.h2("2.1 Dataset Description")

    doc.h3("2.1.1 Primary training corpus \u2014 physics-informed synthetic generator")

    doc.p(
        "The production database starts empty. A brand-new user has no history, and there is "
        "no public dataset of Filipino recreational athletes\u2019 training logs available to "
        "this project. Training the shipped model therefore required bootstrapping a corpus "
        "that encodes the physiological relationships the model is supposed to learn, so that "
        "a new account receives a defensible estimate before it has any data of its own.",
        align="justify",
    )

    doc.p(
        "The generator (ml/data/generate_dataset.py) simulates 240 athletes with individual "
        "fitness factors, each logging 12 to 60 activities across the four modalities. Each "
        "athlete has a persistent fitness multiplier and a fatigue-skill parameter, so the "
        "corpus contains both between-athlete variation (which the model must learn to "
        "condition on) and within-athlete variation (day-to-day form, weather, traffic). "
        "Speeds are drawn from a base speed per modality and then modified by four "
        "physiologically motivated terms:",
        align="justify",
    )

    doc.code(
        "base            = BASE_SPEED_KMH[activity_type]          # 9.6 run, 22.0 ride, 5.0 walk, 3.9 hike\n"
        "climb_penalty   = 1 / (1 + CLIMB_SENSITIVITY[type] * elevation_per_km / 100)\n"
        "fatigue         = (max(distance_km, 0.5) / REF_DIST_KM[type]) ** (-fatigue_exp)\n"
        "speed           = base * fitness * modality_bias * climb_penalty * fatigue\n"
        "speed          *= clip(normal(1.0, 0.055), 0.82, 1.2)    # day-to-day form\n"
        "duration_min    = distance_km / speed * 60.0               # <-- the target",
        caption="ml/data/generate_dataset.py, build_corpus() \u2014 the target is computed algebraically.",
    )

    doc.quote(
        "Why the synthetic R\u00b2 cannot be quoted as accuracy",
        "The line duration_min = distance_km / speed * 60.0 makes the target a deterministic "
        "function of variables the model also receives. Any model with enough capacity will "
        "recover most of that function, so the reported R\u00b2 of 0.9924 and MAPE of 5.51% are "
        "measuring the generator, not the world. They are reported in this document exactly "
        "once, in Table 4.3, captioned as tautological, and are never used as the project\u2019s "
        "accuracy claim. This is the single most important methodological caveat in the work.",
    )

    doc.p(
        "The corpus is also honest about what it excludes. It contains no wind, no altitude, "
        "no heat acclimation, and no injury state. Those omissions are recorded in the "
        "generator docstring and are the reason the retraining study in Section 4.3 was worth "
        "running rather than assuming the synthetic model was adequate.",
        align="justify",
    )

    doc.h3("2.1.2 External evaluation corpus \u2014 GeoLife GPS Trajectories")

    doc.p(
        "Microsoft Research released the GeoLife GPS Trajectories dataset (version 1.3) in "
        "2008 for research on trajectory mining. 182 volunteers in Beijing recorded their "
        "movement continuously over roughly five years. The raw data is a set of .plt files "
        "containing latitude, longitude, and timestamp at one sample every 1\u20135 seconds. "
        "Those raw traces are not directly usable for duration prediction: they must be "
        "segmented into trips, and each trip must be labelled with a transportation mode.",
        align="justify",
    )

    doc.p(
        "This project uses the pre-segmented feature table published by the Beijing "
        "Trajectories Project, which supplies, for each trip, the start time, elapsed "
        "duration, distance, mean speed, and a transportation-mode label. That table is "
        "reduced to activities comparable to a training session: bicycle is mapped to ride, "
        "walk to walk, and all motorised modes (car, bus, taxi, subway, train) are excluded "
        "because they are not exercise and have a completely different duration-distance "
        "relationship.",
        align="justify",
    )

    doc.table(
        ["Property", "Value"],
        [
            ["Dataset name", "GeoLife GPS Trajectories Dataset, version 1.3"],
            ["Publisher", "Microsoft Research Asia"],
            ["Primary reference",
             "Zheng, Y., Xie, X., Wang, L., Yu, Y., Jiang, S. (2008). Mining interesting "
             "locations and travel sequences from GPS trajectories. WWW \u201908."],
            ["Feature-table source",
             "github.com/jbremz/Beijing-Trajectories-Project (Metadata/trajFeatures.csv)"],
            ["Location", "Beijing, China"],
            ["Collection period", "April 2007 \u2013 December 2011"],
            ["Rows used", "4,362 activities"],
            ["Users used", "51 volunteers"],
            ["Mode distribution", "walk 2,988 (68.5%) \u00b7 ride 1,372 (31.5%) \u00b7 run 2 (0.05%)"],
            ["Distance range", "0.03 km \u2013 19.60 km (median trip is a short urban walk or ride)"],
            ["Committed size", "392 KB, ml/data/external/geolife_activities.csv"],
        ],
        caption="GeoLife dataset facts as configured in this project.",
        widths=[1.6, 4.8],
        align_numeric=False,
    )

    doc.p(
        "Two properties of GeoLife make it a genuinely useful external test set rather than a "
        "convenient one. First, it was collected by people who were not TRANA users, five to "
        "eight years before this project existed, so there is no possibility of the model "
        "having been tuned to them. Second, it is real GPS data with all the messiness that "
        "implies \u2014 stops at traffic lights, tunnel dropouts, walking through a mall \u2014 which "
        "means the durations include the pauses that an athletes\u2019 elapsed-time target also "
        "includes. That match in definition matters: TRANA predicts elapsed door-to-door time, "
        "not moving time.",
        align="justify",
    )

    doc.p(
        "Two properties limit it, and both are disclosed rather than glossed over. GeoLife "
        "contains no usable elevation: the .plt files do carry an altitude column, but it is "
        "GPS-derived altitude, which for this dataset has a median of roughly 102 m of "
        "apparent gain per kilometre against a true terrain value of 5\u201315 m/km for Beijing, "
        "with individual fixes peaking above 13,000 m. Suppressing that noise correctly "
        "requires a digital elevation model, which the project does not have for Beijing. "
        "Elevation is therefore set to zero for both the evaluation and the retraining study, "
        "and the report says so in its limitations block. Second, the mode mix is heavily "
        "skewed: only two of the 4,362 rows are runs. Any run-specific metric computed from "
        "GeoLife is computed from n=2 and is reported for completeness only.",
        align="justify",
    )

    doc.h3("2.1.3 Retraining experiment split")

    doc.p(
        "The retraining study reuses GeoLife but partitions it in a way that no single "
        "participant appears on both sides of the split. This is the only honest way to ask "
        "the question \u201cwould training on real data help?\u201d \u2014 if a user\u2019s own activities "
        "were in the training set, the model could memorise that individual\u2019s pace and the "
        "study would measure memorisation, not generalisation.",
        align="justify",
    )

    doc.table(
        ["Split property", "Value"],
        [
            ["Split strategy", "GroupShuffleSplit by user_id, 70/30"],
            ["Train users / holdout users", "36 / 15"],
            ["Train rows / holdout rows", "3,277 / 1,085"],
            ["Holdout mode mix", "walk 723 (66.6%) \u00b7 ride 361 (33.3%) \u00b7 run 1"],
            ["User overlap", "0 (asserted programmatically \u2014 the trainer raises if any overlap)"],
            ["Seeds reported", "7, 11, 23 (each run in turn by editing the SEED constant; the committed report is seed 7)"],
        ],
        caption="User-disjoint split configuration for the retraining study.",
        widths=[2.0, 4.4],
        align_numeric=False,
    )

    # -------------------------------------------------------------- 2.2
    doc.h2("2.2 Dataset Attributes")

    doc.p(
        "The following table documents the raw attributes available in each corpus. Note that "
        "the feature vector the model actually receives (Section 2.3) is smaller than the raw "
        "attribute set \u2014 deliberately so, because several raw columns would leak the target "
        "or would not be known at prediction time.",
        align="justify",
    )

    doc.table(
        ["Attribute", "Description", "Source", "Role"],
        [
            ["user_id", "Pseudonymous athlete identifier", "Both corpora", "Grouping key; used for user-level splits and history construction. Never a feature."],
            ["activity_type", "run / ride / walk / hike (synthetic); walk / bike (GeoLife)", "Both", "Encoded as four one-hot features"],
            ["distance_km", "Planned or completed distance", "Both", "Primary numeric feature"],
            ["elevation_gain_m", "Cumulative positive elevation gain", "Synthetic only (GeoLife = 0)", "Feature, plus derived elevation_per_km"],
            ["duration_min", "Elapsed time in minutes", "Both", "TARGET VARIABLE"],
            ["start_time", "Session timestamp", "Both", "Ordering for the chronological history; never a feature"],
            ["weight_kg", "Athlete body mass", "Synthetic; synthetic assumption for GeoLife", "Fuelling input; not a duration feature"],
            ["experience_level", "1\u20135 self-reported or history-inferred fitness", "Profile or inferred", "Feature"],
            ["avg_speed_kmh", "Mean speed over the trip", "GeoLife", "Derived from distance/duration; excluded as a feature (leakage)"],
            ["calories", "MET-based energy expenditure", "Synthetic", "Fuelling reference; excluded from duration features"],
            ["source_path", "File path of the originating .plt trajectory", "GeoLife", "DROPPED before training \u2014 see Section 2.3.3"],
            ["mode_original", "Raw transportation label before mapping", "GeoLife", "DROPPED before training \u2014 leaking artefact of the mapping"],
        ],
        caption="Raw dataset attributes and their role.",
        widths=[1.25, 2.15, 1.55, 1.45],
        align_numeric=False,
        font_size=8.5,
    )

    doc.h3("2.2.1 The nine model features")

    doc.p(
        "The feature order is part of a contract. It is asserted in Python "
        "(FEATURE_ORDER in preprocess.py), in the exported JSON tree ensemble, and in the "
        "JavaScript evaluator, because the browser and the server must walk the same trees "
        "with the same column positions.",
        align="justify",
    )

    doc.table(
        ["#", "Feature", "Type", "Description", "Why it earns its place"],
        [
            ["0", "distance_km", "continuous", "Planned distance in kilometres",
             "Duration scales super-linearly with distance; the strongest single signal after the curve anchor."],
            ["1", "elevation_gain_m", "continuous", "Cumulative positive gain in metres",
             "Climbing costs time independent of horizontal distance."],
            ["2", "elevation_per_km", "continuous", "Gain divided by distance",
             "Separates a flat 20 km from a 20 km with 400 m \u2014 the same absolute gain means very different things at different distances."],
            ["3", "experience_level", "ordinal 1\u20135", "Fitness level",
             "Experienced athletes fade less at long distances."],
            ["4", "history_count", "integer \u2265 0", "Sessions of this sport already logged",
             "Controls how much the personal curve can be trusted; also drives the uncertainty widening for thin history."],
            ["5", "is_run", "binary", "Activity-type flag", "Modality-specific pace relationships are not transferable."],
            ["6", "is_ride", "binary", "Activity-type flag", "Same."],
            ["7", "is_walk", "binary", "Activity-type flag", "Same."],
            ["8", "is_hike", "binary", "Activity-type flag", "Climbing hurts a hike far more than a ride at the same gradient."],
        ],
        caption="The complete feature vector. Nine features, no more \u2014 a deliberate size limit for interpretability.",
        widths=[0.3, 1.25, 0.9, 1.85, 2.1],
        align_numeric=False,
        font_size=8.5,
    )

    doc.p(
        "Feature importance from the shipped model card, for the q50 regressor, confirms the "
        "design intent. Elevation per kilometre dominates, followed by history count, which is "
        "the model\u2019s proxy for how much personalisation it can attempt:",
        align="justify",
    )

    doc.table(
        ["Feature", "Importance", "Reading"],
        [
            ["elevation_per_km", "0.6849", "Terrain grade is the largest source of pace variation in the corpus."],
            ["history_count", "0.1516", "The model explicitly conditions on how much personal data exists."],
            ["elevation_gain_m", "0.0473", "Absolute gain adds a secondary correction."],
            ["distance_km", "0.0372", "Small by design \u2014 distance is already absorbed by the curve anchor, so the trees only need a residual."],
            ["is_ride", "0.0347", "Modality correction."],
            ["is_run", "0.0220", "Modality correction."],
            ["is_hike", "0.0101", "Modality correction."],
            ["is_walk", "0.0061", "Modality correction."],
            ["experience_level", "0.0061", "Largely redundant with history_count, as expected."],
        ],
        caption="q50 feature importances from model_card.json. Distance ranks fourth, which is the intended architecture: the curve owns distance, the trees own the residual.",
        widths=[1.45, 1.0, 3.95],
        align_numeric=False,
    )

    # -------------------------------------------------------------- 2.3
    doc.h2("2.3 Data Preprocessing")

    doc.p(
        "Preprocessing is where most of this project\u2019s engineering lives, because the "
        "modelling problem is not \u201cfit a regressor to a table\u201d \u2014 it is \u201cconstruct a "
        "target that is stationary across athletes so a single model can learn it\u201d. Seven "
        "distinct steps are applied, in order.",
        align="justify",
    )

    doc.h3("2.3.1 Step 1 \u2014 Chronological history construction (the leakage guard)")

    doc.p(
        "For each row, the model needs to know only what the athlete knew before that session "
        "started. The training frame is therefore built row by row in timestamp order, and each "
        "row\u2019s reference curve is fitted from strictly earlier sessions of the same sport. "
        "This mirrors production inference exactly: at prediction time, a future session is by "
        "definition unavailable.",
        align="justify",
    )

    doc.p(
        "Getting this wrong is the classic way to produce a model that scores beautifully in "
        "validation and fails in production, because a model that has seen the future can "
        "\u201cpredict\u201d a duration by looking up what actually happened. The preprocess module "
        "states the invariant explicitly in its docstring: \u201ctraining_frame builds each row\u2019s "
        "anchor strictly chronologically from prior sessions only \u2014 matching real production "
        "inference with zero future leakage.\u201d",
        align="justify",
    )

    doc.h3("2.3.2 Step 2 \u2014 Flat-equivalent normalisation")

    doc.p(
        "Before fitting the reference curve, historical activities are normalised to "
        "flat-equivalent time, so that climbing cost is never absorbed into the anchor and "
        "then double-counted by the trees. If a hilly 10 km run were fed to the curve "
        "unmodified, the curve would conclude the athlete is slow, and the terrain penalty "
        "would be learned twice \u2014 once by the curve, once by the GBM. The invariant is "
        "enforced in code and documented as invariant 1 of the preprocessing contract.",
        align="justify",
    )

    doc.h3("2.3.3 Step 3 \u2014 Outlier filtering and robust weighting")

    doc.p(
        "Real training logs contain GPS glitches, forgotten timers, and pauses at a coffee "
        "shop. Four filters run before fitting:",
        align="justify",
    )
    doc.bullet("Sports the athlete has never recorded fall back to a population speed constant "
               "(8.8 km/h run, 20.0 ride, 4.7 walk, 3.6 hike) rather than producing a divide-by-zero.",
               bold_lead="Missing modality. ")
    doc.bullet("Implausible GPS or timer artefacts are dropped rather than winsorised, because a "
               "5-minute 40 km ride is not a noisy observation of a real ride.", bold_lead="Physically impossible rows. ")
    doc.bullet("Extreme pace outliers are down-weighted using a Huber/MAD criterion, so a single "
               "bad row cannot swing the curve.", bold_lead="Robust down-weighting. ")
    doc.bullet("Recent sessions receive higher weight, with a 90-day half-life when timestamps "
               "exist \u2014 an athlete\u2019s pace six months ago is weaker evidence than last week\u2019s.",
               bold_lead="Recency weighting. ")
    doc.bullet("GeoLife evaluation additionally trims speeds outside [0.5, 50.0] km/h.",
               bold_lead="Speed trim for external data. ")

    doc.h3("2.3.4 Step 4 \u2014 Reference curve fitting with Ridge shrinkage")

    doc.p(
        "The reference curve is base_minutes = exp(a + b\u00b7ln d), which is Riegel\u2019s formula "
        "time \u221d distance^b in log-linear form. The exponent b is fitted by weighted Ridge "
        "regression, shrunk toward a sport-specific prior and then hard-bounded:",
        align="justify",
    )
    doc.code(
        'RIEGEL_EXPONENT = {"run": 1.06, "walk": 1.06, "hike": 1.15, "ride": 1.03}\n'
        "# ... reference_curve() -- ml/duration_model/preprocess.py L178\n"
        'b = clip(ridge_estimate, 1.00, 1.30)',
        caption="Bounded shrinkage of the Riegel exponent. The prior stops a single outlier session from producing a nonsensical curve.",
    )
    doc.p(
        "The bounds are not arbitrary. A b below 1.00 would imply an athlete gets faster per "
        "kilometre as distance grows, which is physiologically impossible for an endurance "
        "effort. A b above 1.30 would imply catastrophic fatigue, far beyond anything observed "
        "in the literature for recreational athletes. Shrinkage is what makes the curve usable "
        "when an athlete has only two or three logged sessions: their own data nudges the "
        "prior rather than replacing it.",
        align="justify",
    )

    doc.h3("2.3.5 Step 5 \u2014 Target transformation")

    doc.p(
        "The regressors are not trained to predict minutes. They are trained to predict "
        "log(duration / flat-equivalent time at the athlete\u2019s own chronological reference "
        "curve) \u2014 that is, the log pace factor. Two consequences follow, and both are "
        "deliberate:",
        align="justify",
    )
    doc.bullet(
        "A 5-minute error on a 40-minute run and a 5-minute error on a 200-minute ride become "
        "commensurable, so the loss function is not dominated by long activities.",
        bold_lead="Relative error instead of absolute. ",
    )
    doc.bullet(
        "The model only has to learn a residual correction around 1.0, which is a much "
        "narrower target than raw minutes. In the ablation study this factor ranges only "
        "0.8823\u20131.0239 on real data \u2014 a sign the transformation worked, and the source of "
        "the diagnosis in Section 4.4.",
        bold_lead="A stationary, athlete-independent target. ",
    )

    doc.h3("2.3.6 Step 6 \u2014 Column dropping and the leakage audit")

    doc.p(
        "The retraining study discovered a real leakage path that had to be closed. When "
        "training from the GeoLife CSV, two columns must be dropped before the frame reaches "
        "the trainer:",
        align="justify",
    )
    doc.code(
        'DROP_BEFORE_TRAINING = ("source_path", "mode_original")\n'
        '# source_path   -- the .plt file path, from which the raw trajectory could be re-read\n'
        '# mode_original -- the pre-mapping label, a leaking artefact of how the CSV was built',
        caption="ml/evaluation/retrain_study.py \u2014 declared as a module constant so a test can assert it.",
    )
    doc.p(
        "This is worth documenting at length because of how it was caught. The CSV round-trip "
        "test passed even with an empty drop list, because the trainer was happy to accept the "
        "columns. Only a direct unit test asserting that the constant contains source_path "
        "actually prevented the regression. The lesson \u2014 recorded in the test file \u2014 is that "
        "testing that code runs is not the same as testing that the protocol is respected.",
        align="justify",
    )

    doc.h3("2.3.7 Step 7 \u2014 Missing values and categorical encoding")

    doc.p(
        "GeoLife has no elevation column, so elevation_gain_m and elevation_per_km are set to "
        "0.0 for every row rather than imputed. Imputation was rejected: filling elevation with "
        "the synthetic corpus median would inject a fabricated terrain profile into a dataset "
        "known to be flat-recorded, and any resulting metric would be partly an artefact of "
        "the imputer. Zeroing is a biased assumption, but it is an honest and stated one, and "
        "it applies identically to both arms of the retraining comparison, so the comparison "
        "itself stays valid.",
        align="justify",
    )
    doc.p(
        "Categorical encoding uses one-hot flags rather than a single ordinal code, so that "
        "hike and ride are not implicitly ordered. No scaling is applied to the numerics: "
        "gradient-boosted trees split on thresholds and are invariant to monotone "
        "transformations, so standardisation would add a preprocessing step that changes "
        "nothing except what the feature importances look like.",
        align="justify",
    )

    # -------------------------------------------------------------- 2.4
    doc.h2("2.4 Data Splitting and Validation")

    doc.p(
        "Three different splits are used, for three different questions. The table below is the "
        "quickest way to see why each one exists.",
        align="justify",
    )

    doc.table(
        ["Split", "Ratio", "Grouping", "Question it answers"],
        [
            ["Train / test (synthetic)",
             "80 / 20 (7,011 / 1,834 rows)",
             "GroupShuffleSplit by user_id",
             "Can the model fit the generator? (sanity check only)"],
            ["Shipped model \u2192 GeoLife",
             "100% of GeoLife used as test",
             "Per-user chronological walk-forward",
             "How accurate is the deployed model on real, unseen people?"],
            ["Retrain study",
             "70 / 30 by user (36 / 15 users)",
             "GroupShuffleSplit by user_id, then chronological within user",
             "Does training on real data improve on training on synthetic data?"],
        ],
        caption="The three splits and the distinct question each one is designed to answer.",
        widths=[1.5, 1.35, 1.8, 2.15],
        align_numeric=False,
    )

    doc.h3("2.4.1 The user-level holdout and why it is mandatory")

    doc.p(
        "A random row split is the wrong split for this problem, and the project treats the "
        "mistake as a first-class hazard. If athlete A has 40 sessions and rows are split "
        "randomly, 32 of A\u2019s sessions land in training and 8 in test. The model then learns "
        "A\u2019s personal pace and is scored on A\u2019s remaining sessions \u2014 which is a "
        "memorisation test, not a generalisation test. The result is an optimistic number that "
        "does not survive contact with a new user.",
        align="justify",
    )
    doc.p(
        "Every split in this project is therefore grouped by user_id, and the grouping is "
        "asserted rather than assumed. The trainer refuses to proceed on an overlapping split:",
        align="justify",
    )
    doc.code(
        "splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=seed)\n"
        "train_idx, test_idx = next(splitter.split(clean, groups=clean[\"user_id\"]))\n"
        "train_users, test_users = set(...), set(...)\n"
        "if train_users & test_users:\n"
        "    raise RuntimeError(\"user-level holdout split leaked pseudonymous users across partitions\")",
        caption="ml/duration_model/train.py L249\u2013256 \u2014 the overlap assertion is executable, not a comment.",
    )
    doc.p(
        "The same discipline governs the retraining study, where the split metadata records "
        "user_overlap: 0 in the report so a reader can verify it without reading the code.",
        align="justify",
    )

    doc.h3("2.4.2 The chronological walk-forward protocol")

    doc.p(
        "Within a user, evaluation proceeds in time order. For each activity in chronological "
        "sequence, the model is called with the history accumulated so far, the prediction is "
        "recorded, and only then is the actual duration appended to the history. This is "
        "identical to production behaviour \u2014 an athlete\u2019s plan is made before the session "
        "and the session is logged afterwards.",
        align="justify",
    )
    doc.code(
        "rows = frame.sort_values([\"user_id\", \"activity_type\", \"start_time\"])\n"
        "for (_user, activity_type), group in rows.groupby([\"user_id\", \"activity_type\"]):\n"
        "    history = []\n"
        "    for row in group.itertuples(index=False):\n"
        "        pred = model.predict(..., history=history)\n"
        "        evaluated.append({... \"actual_min\": row.duration_min, ...})\n"
        "        history.append({... \"duration_min\": actual, ...})   # appended AFTER predicting",
        caption="ml/evaluation/geolife_validation.py, evaluate_activities() L225\u2013290.",
    )

    doc.p(
        "A consequence worth naming: 80 of the 4,362 predictions are cold-start (history empty) "
        "and 67 have exactly one prior session. Those slices are reported separately, because "
        "averaging them into the headline would hide the fact that new users get a materially "
        "worse estimate (cold-start MAPE 51.3% against 35.3% for users with two or more prior "
        "sessions).",
        align="justify",
    )

    doc.h3("2.4.3 Cross-validation and the reason it is not used")

    doc.p(
        "No k-fold cross-validation is used, and the omission is a deliberate methodological "
        "choice rather than an oversight. Time-series data with per-user grouping cannot be "
        "randomly folded without either leaking the future into the past or leaking a user "
        "across folds. The correct analogue is grouped time-series cross-validation, which is "
        "exactly what the walk-forward protocol already implements in a single pass over "
        "every user. Repeating it across folds would resample the same 51 users, producing a "
        "variance estimate over user draws rather than over data draws \u2014 which is why the "
        "study instead reports three independent seeds (7, 11, 23) of the user-level split. "
        "That gives the same information about split sensitivity with a cleaner interpretation.",
        align="justify",
    )

    doc.h3("2.4.4 Leakage avoidance \u2014 complete checklist")

    doc.table(
        ["Leakage vector", "How it is closed", "Where it is enforced"],
        [
            ["Future sessions in the training frame",
             "history built strictly chronologically", "preprocess.training_frame"],
            ["Same user in train and test",
             "GroupShuffleSplit by user_id + explicit overlap assertion",
             "train.py L249; retrain_study.py"],
            ["Target-derived column as a feature",
             "log_pace_factor computed from the target; never fed as input",
             "FEATURE_ORDER is 9 fixed names"],
            ["Mean speed as a feature",
             "avg_speed_kmh excluded (it is distance/duration)",
             "FEATURE_ORDER"],
            ["File-path identifier",
             "source_path dropped before training",
             "DROP_BEFORE_TRAINING"],
            ["Pre-mapping mode label",
             "mode_original dropped before training",
             "DROP_BEFORE_TRAINING"],
            ["Calibration data from training users",
             "calibrate rejects overlapping pseudonymous users with SystemExit",
             "train.py L368\u2013372"],
            ["Tuning against the test set",
             "external GeoLife set never used for hyperparameter selection",
             "Section 3.2.4"],
        ],
        caption="Eight leakage vectors and the concrete mechanism that closes each one.",
        widths=[1.75, 2.95, 1.95],
        align_numeric=False,
        font_size=8.5,
    )

    doc.p(
        "The last row deserves emphasis. Hyperparameters were fixed before external validation "
        "ran, and were not subsequently adjusted in response to GeoLife results. That is why "
        "the honest accuracy figure (\u00b123.8%) is worse than the internal one \u2014 if the "
        "configuration had been tuned against GeoLife, the external set would have quietly "
        "become a second training set, and the number would no longer mean what it claims.",
        align="justify",
    )
