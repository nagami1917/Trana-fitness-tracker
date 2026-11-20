"""Content for the CSST 102 template-format documentation.

Every heading and table below is dictated by the school's template
(``CSST 102(IS) - Documentation Template.docx``). Nothing is added to the
outline; nothing is dropped from it.

Every number is copied from a committed artifact in this repository:

* ``ml/evaluation/reports/geolife_validation.json``  — external validation
* ``ml/evaluation/reports/ablation_report.json``     — curve vs model ablation
* ``ml/evaluation/reports/retrain_study.json``       — held-out retraining study
* ``ml/duration_model/model_card.json``              — shipped model card
* ``frontend/public/models/duration_model.json``     — the deployed trees

Where a figure is a synthetic self-score it is labelled as one. The honest
external numbers are the ones the reader is pointed at.
"""

from __future__ import annotations

from template_engine import TemplateDoc

PROJECT_NAME = "TRANA"
PROJECT_TAGLINE = (
    "A Predictive Machine-Learning Web Application for Activity Duration "
    "Forecasting and Race-Day Fueling"
)
PROPONENTS = [
    "[SURNAME, First Name]",
    "[SURNAME, First Name]",
    "[SURNAME, First Name]",
]
YEAR_AND_SECTION = "[Year and Section]"
COURSE_LINE = "CSST 102 \u2013 BASIC MACHINE LEARNING"
DOC_LINE = "FINAL PROJECT DOCUMENTATION"

# Shipped model, read from ml/duration_model/model_card.json
MODEL_VERSION = "20261113.1328"
CORPUS_ROWS = 8845
TRAIN_ROWS = 7011
TEST_ROWS = 1834

# External validation, ml/evaluation/reports/geolife_validation.json
EXT_N = 4362
EXT_USERS = 51
EXT_MAE = 5.84
EXT_MAPE = 35.87
EXT_MDAPE = 23.84
EXT_W15 = 33.43
EXT_W20 = 43.81
EXT_R2 = 0.414
EXT_COVERAGE = 16.96
EXT_PRIOR_MAE = 7.10
EXT_CURVE_MAE = 5.83


def build(doc: TemplateDoc) -> None:
    _cover(doc)
    _section_1(doc)
    _section_2(doc)
    _section_3(doc)
    _section_4(doc)
    _section_5(doc)
    _section_6(doc)
    _section_7(doc)
    _closing(doc)


# --------------------------------------------------------------------- cover
def _cover(doc: TemplateDoc) -> None:
    doc.body(COURSE_LINE, align="center", size=13, space_after=2)
    doc.rich([(DOC_LINE, "b")], align="center", size=13, space_after=18)

    doc.key_value(
        [("PROJECT NAME:", PROJECT_NAME)],
        label_width=2.05,
    )
    doc.body(PROJECT_TAGLINE, align="left", size=10.5, italic=True,
             space_after=14, indent=2.05)

    doc.key_value(
        [("PROPONENTS:", PROPONENTS[0])]
        + [("", name) for name in PROPONENTS[1:]],
        label_width=2.05,
    )
    doc.key_value(
        [("YEAR AND SECTION:", YEAR_AND_SECTION)],
        label_width=2.05,
    )


# ------------------------------------------------------------ 1. OVERVIEW
def _section_1(doc: TemplateDoc) -> None:
    doc.section_bar(1, "PROJECT OVERVIEW")

    # ------------------------------------------------- Project Description
    doc.sub("Project Description", space_before=6)
    doc.body(
        "TRANA is a predictive web application that answers one question an "
        "endurance athlete asks before every session: how long will this "
        "activity take, and what do I need to eat and drink to finish it? "
        "Most fitness applications are retrospective \u2014 they report what was "
        "already burned. TRANA works before the activity starts. The athlete "
        "supplies a planned activity type, a planned distance, and a planned "
        "elevation gain; the system returns an estimated duration in minutes "
        "with an uncertainty range, plus a per-hour carbohydrate, fluid and "
        "sodium plan sized to that estimate."
    )
    doc.body(
        "The problem it addresses is planning error. Recreational runners, "
        "cyclists, hikers and walkers routinely misjudge how long a route will "
        "take, and that single error compounds: a finish time that is wrong by "
        "half an hour makes a fueling plan wrong by the same proportion. "
        "Under-fueling causes the well-documented late-race decline; "
        "over-fueling causes gastrointestinal distress. Either way the athlete "
        "blames their fitness rather than their plan. TRANA targets the plan."
    )
    doc.body(
        "The intended users are recreational and semi-competitive endurance "
        "athletes who already log their sessions and who train for events "
        "rather than commuting. The application is useful to them because it "
        "converts a log they already keep into a forward-looking estimate, and "
        "because it explains the uncertainty rather than hiding it: the "
        "interface presents a range, not a single false-precision number."
    )
    doc.body(
        "The application predicts elapsed activity duration, in minutes, for a "
        "planned session that has not happened yet. Machine learning is used to "
        "generate that prediction in two stacked stages. First, a personalised "
        "reference curve is fitted chronologically from the athlete's own past "
        "sessions of the same activity type \u2014 a Riegel power law in which time "
        "scales with distance raised to an exponent near 1.06. That curve gives "
        "a physics-grounded baseline for the planned distance. Second, a "
        "gradient-boosted quantile regressor predicts a multiplicative "
        "correction factor on top of that baseline, using nine features "
        "including elevation gain per kilometre, the athlete's experience "
        "level, and how much history the athlete has. Three models predict the "
        "10th, 50th and 90th percentile of that factor, which is what turns a "
        "single number into an honest range."
    )

    # --------------------------------------------------- Project Objectives
    doc.sub("Project Objectives")
    doc.body(
        "The group intends to build a working predictive application, not a "
        "notebook: a system a real athlete can open in a browser, use to plan a "
        "session, and evaluate against what actually happened."
    )
    doc.rich([("General Objective: ", "b"), (
        "To develop a web-based predictive machine-learning application that "
        "forecasts the duration of a planned endurance activity from an "
        "athlete's own training history and the planned route profile, and "
        "that uses that forecast to generate a personalised fueling plan.",
        "")])
    doc.rich([("Specific Objectives:", "b")], space_after=4)
    doc.numbered("1.", (
        "To construct a training corpus of activity records with a defensible "
        "target definition, and to fit a personalised Riegel reference curve "
        "per athlete per modality from chronological history only."))
    doc.numbered("2.", (
        "To train and tune gradient-boosted quantile regression models that "
        "predict the multiplicative pace-factor correction on top of that "
        "curve, producing a 10th/50th/90th percentile interval."))
    doc.numbered("3.", (
        "To evaluate the trained model on an independent external dataset it "
        "never saw during training, and to report the result honestly "
        "alongside the internal holdout score."))
    doc.numbered("4.", (
        "To deploy the model behind a FastAPI inference service and integrate "
        "it into a Svelte progressive web application that also generates a "
        "carbohydrate, fluid and sodium plan from the predicted duration."))

    # ----------------------------------------------------- Problem Definition
    doc.sub("Problem Definition")
    doc.body(
        "The specific problem is that an athlete planning a session has no "
        "reliable, personalised estimate of how long the session will take, "
        "and therefore no reliable basis for a fueling plan. Generic pace "
        "charts are population averages: they ignore the individual's own "
        "fitness, their terrain, and their history at the distance in "
        "question. The error is largest exactly where the stakes are highest "
        "\u2014 long sessions on unfamiliar terrain."
    )
    doc.body(
        "The intended users are individual endurance athletes who record "
        "sessions \u2014 runners, cyclists, walkers and hikers \u2014 and who plan "
        "training or events of between roughly thirty minutes and several "
        "hours. A secondary user is the same athlete in the days after the "
        "session, comparing the prediction against the outcome."
    )
    doc.body(
        "The information required as input is deliberately small, because "
        "every additional required field is a reason for the athlete to "
        "abandon the form. The system needs the activity type (run, ride, walk "
        "or hike), the planned distance in kilometres, the planned elevation "
        "gain in metres, and the athlete's own logged history. Experience "
        "level and history count are derived by the system; they are not typed "
        "in by the user."
    )
    doc.body(
        "The expected output is a duration estimate in minutes expressed as a "
        "range with a median, together with an interval width that widens "
        "when the athlete has little history or when the planned distance "
        "falls outside the range the model was trained on. Downstream, the "
        "median duration drives the fueling plan: carbohydrate grams per hour, "
        "fluid millilitres per hour, and sodium milligrams per hour."
    )
    doc.body(
        "The problem is suitable for a machine-learning approach rather than a "
        "closed-form formula because the relationship between distance, "
        "elevation and duration is real but individually variable. A physics "
        "formula such as Riegel's law captures the average fatigue behaviour "
        "of a population; it cannot capture that one athlete climbs well and "
        "another deteriorates badly past twenty kilometres, or that an "
        "athlete's pace at their tenth session differs systematically from "
        "their pace at their first. Those systematic residuals are learnable "
        "from historical records, they are not expressible in a fixed "
        "equation, and they are exactly what a supervised regression model "
        "extracts. Elevation gain per kilometre, for example, carries a "
        "feature importance of 0.6849 in the shipped model \u2014 nearly seven "
        "times the next most important feature \u2014 which quantifies how much "
        "terrain, rather than raw distance, drives the residual."
    )


# ------------------------------------------------ 2. DATASET AND PREPROCESSING
def _section_2(doc: TemplateDoc) -> None:
    doc.section_bar(2, "DATASET AND DATA PREPROCESSING")

    doc.sub("Dataset Description", space_before=6)
    doc.body(
        "Two datasets are used, and they play different roles. The model that "
        "is deployed was trained on a physics-informed synthetic corpus, "
        "generated inside this project because the production database starts "
        "empty and no consented real athlete logs were available at training "
        "time. That model is then evaluated, untouched, on an independent "
        "external dataset of real GPS trajectories that it never saw: the "
        "GeoLife GPS Trajectories dataset from Microsoft Research. Reporting "
        "both is what makes the evaluation meaningful \u2014 the synthetic score "
        "is a self-score, and the external score is the honest one."
    )

    doc.sub("Information Details")
    doc.table(
        ["Information", "Details"],
        [
            ["Dataset Name",
             "TRANA synthetic activity corpus (primary training set); "
             "GeoLife GPS Trajectories v1.3 (external evaluation set)"],
            ["Dataset Source",
             "Synthetic corpus generated by ml/data/generate_dataset.py from "
             "published field formulas (Naismith's rule, ACSM metabolic cost) "
             "with per-athlete fitness factors. GeoLife: Microsoft Research, "
             "Zheng et al., WWW 2008."],
            ["Number of Records",
             f"{CORPUS_ROWS:,} generated activity rows from 240 athletes "
             f"(training {TRAIN_ROWS:,} / test {TEST_ROWS:,}); "
             f"{EXT_N:,} real GPS trajectories from {EXT_USERS} users for "
             "external evaluation"],
            ["Number of Attributes",
             "11 recorded attributes per row; 9 used as model features "
             "(see Dataset Attributes)"],
            ["Target Variable",
             "Elapsed activity duration in minutes. The model actually fits "
             "log(duration \u00f7 flat-equivalent time at the athlete's own "
             "reference curve), i.e. a log pace factor, then multiplies the "
             "curve back in at inference."],
            ["Type of Prediction",
             "Supervised regression (continuous target) with quantile output: "
             "10th, 50th and 90th percentile duration estimates."],
        ],
        widths=[1.55, 4.7],
    )

    doc.body(
        "The synthetic corpus is appropriate for bootstrapping because the "
        "target is not invented \u2014 it is computed from published formulas that "
        "describe how human locomotion actually behaves. Base speeds per "
        "modality, the Riegel fatigue exponent, and climbing sensitivity all "
        "come from the exercise-physiology literature, and per-athlete "
        "variation is injected as fitness, modality bias and day-to-day form. "
        "That gives the model a learnable structure that mirrors reality "
        "without requiring personal data from anyone."
    )
    doc.body(
        "What the synthetic corpus cannot do is prove the model generalises. "
        "A model trained on generated data and tested on generated data is "
        "tested on its own assumptions; the resulting R\u00b2 of 0.9924 measures "
        "consistency, not accuracy. That is why the GeoLife external "
        "evaluation exists, why it is reported in Section 4 as the headline "
        "result, and why the synthetic score is shown only with that caveat "
        "attached. GeoLife is appropriate as an external set precisely because "
        "it is real: 4,362 trajectories recorded by 51 volunteers in Beijing "
        "under real traffic, weather and terrain conditions, with none of the "
        "generator's assumptions."
    )

    # ------------------------------------------------------ Dataset Attributes
    doc.sub("Dataset Attributes")
    doc.body(
        "The nine features below are the complete model input. The order is "
        "part of the contract with the exported JSON trees and the browser "
        "evaluator, so it is fixed at export time and identical in the Python "
        "service and the client-side fallback."
    )
    doc.table(
        ["Attributes", "Description", "Role"],
        [
            ["distance_km", "Planned distance in kilometres.",
             "Input feature. Drives the reference curve directly and carries "
             "an importance of 0.0372 in the residual model."],
            ["elevation_gain_m", "Planned total elevation gain in metres.",
             "Input feature. Combined with distance to form the climb rate; "
             "importance 0.0473."],
            ["elevation_per_km", "Elevation gain divided by distance "
             "(m per km), the grade proxy.",
             "Input feature, and the single strongest one at 0.6849 "
             "importance. Terrain, not raw distance, explains most of the "
             "residual the model corrects."],
            ["experience_level", "Self-reported or inferred athlete "
             "experience, 1 (new) to 5 (seasoned).",
             "Input feature. Sets the population fallback speed when no "
             "history exists; importance 0.0061."],
            ["history_count", "Number of prior sessions of the same modality "
             "available to the athlete at prediction time.",
             "Input feature. Lets the model trust its own correction more as "
             "history accumulates; importance 0.1516, the second strongest."],
            ["is_run", "One-hot flag: activity type is a run.",
             "Input feature. Selects modality behaviour; importance 0.0220."],
            ["is_ride", "One-hot flag: activity type is a ride.",
             "Input feature. Highest of the four modality flags at 0.0347."],
            ["is_walk", "One-hot flag: activity type is a walk.",
             "Input feature. Importance 0.0061."],
            ["is_hike", "One-hot flag: activity type is a hike.",
             "Input feature. Importance 0.0101."],
            ["duration_min (target)", "Elapsed activity duration in minutes. "
             "Not a feature \u2014 the value being predicted.",
             "Transformed to log(duration \u00f7 curve time) before fitting, so "
             "the model learns a correction rather than the target itself."],
        ],
        widths=[1.35, 2.2, 2.7],
    )

    # ------------------------------------------------------ Data Preprocessing
    doc.sub("Data Preprocessing")
    doc.body(
        "Preprocessing is where this project's most consequential decisions "
        "were made, because the naive version of every step leaks information "
        "from the future into the past. The seven steps below are applied in "
        "this order, and the order matters."
    )
    doc.rich([("Chronological history construction. ", "b"), (
        "For every activity, the athlete's prior sessions of the same modality "
        "are collected by sorting on start time and keeping only records "
        "strictly earlier than the current one. The current activity is "
        "excluded by id. This is the leakage guard: an athlete's reference "
        "curve at the moment they plan a session can only contain what they "
        "had already done.", "")])
    doc.rich([("Flat-equivalent normalisation. ", "b"), (
        "Elevation gain is converted into an equivalent flat distance using a "
        "per-modality climbing sensitivity \u2014 0.85 for running, 0.45 for "
        "cycling, 0.70 for walking, 0.75 for hiking \u2014 so that a hilly 10 km "
        "run and a flat 10 km run become comparable before the curve is "
        "fitted. Without this, terrain variation is absorbed into the fatigue "
        "exponent and the curve stops meaning anything.", "")])
    doc.rich([("Outlier filtering and robust weighting. ", "b"), (
        "Sessions outside plausible moving-speed bounds for their modality are "
        "discarded: 2.5\u201330 km/h for runs, 1.5\u201365 for rides, 0.5\u201314 for "
        "walks and hikes. This removes paused timers, vehicle-mounted GPS "
        "glitches, and indoor sessions logged as outdoor ones. Surviving "
        "points are weighted by recency with a half-life, so an athlete's "
        "current fitness dominates their fitness three seasons ago.", "")])
    doc.rich([("Reference curve fitting with Ridge shrinkage. ", "b"), (
        "The athlete's curve log t = a + b \u00b7 log d is fitted by weighted least "
        "squares, with the exponent b shrunk toward the published Riegel "
        "prior for that modality (1.06 run and walk, 1.15 hike, 1.03 ride) by "
        "a Ridge penalty of 0.25, and then clipped to the physically "
        "defensible band [1.00, 1.30]. Shrinkage is what makes an athlete "
        "with three sessions usable: their curve is pulled toward the "
        "population prior instead of extrapolating wildly. The clip prevents "
        "a negative-fatigue curve, which would predict that a marathon is "
        "faster per kilometre than a 5 km.", "")])
    doc.rich([("Target transformation. ", "b"), (
        "The regression target is log(duration \u00f7 flat-equivalent curve time), "
        "not raw minutes. Two things follow. The model predicts a "
        "dimensionless correction factor centred near 1.0, so it cannot "
        "invent a duration wildly inconsistent with the athlete's own curve. "
        "And because the factor is multiplicative, the interval stays "
        "positive and scales naturally with session length.", "")])
    doc.rich([("Column dropping and the leakage audit. ", "b"), (
        "Three candidate features were removed after an explicit audit found "
        "they were derived from the target: points_per_sec, climb_rate and "
        "gps_spread. Each is a function of the recorded elapsed time or of "
        "the trajectory that produced it, so including any of them would have "
        "produced an impressive score that could not survive deployment. The "
        "audit is a committed script, not a one-time judgement.", "")])
    doc.rich([("Missing values and categorical encoding. ", "b"), (
        "Missing elevation is treated as zero gain rather than dropped, "
        "because a session with no elevation reading is usually a flat one "
        "and discarding it would bias the corpus toward hills. Activity type "
        "is one-hot encoded into the four is_* flags, which keeps the feature "
        "matrix numeric and gives the tree model an explicit modality split "
        "at every node it needs one.", "")])
    doc.body(
        "These techniques are necessary rather than decorative. The history "
        "and curve steps are what stop the model from being scored on "
        "information it would not have at prediction time; the shrinkage and "
        "clipping steps are what keep predictions physical for athletes with "
        "thin logs; and the transformation step is what makes a single model "
        "work across modalities whose absolute durations differ by an order "
        "of magnitude."
    )

    # ------------------------------------------- Data Splitting and Validation
    doc.sub("Data Splitting and Validation")
    doc.body(
        "Two independent protocols are used, and neither is a random row "
        "split. The first is the internal holdout that produced the model "
        "card; the second is the external evaluation that produced the "
        "honest headline."
    )
    doc.rich([("Internal holdout \u2014 grouped by user. ", "b"), (
        f"The {CORPUS_ROWS:,}-row corpus is divided {TRAIN_ROWS:,} training / "
        f"{TEST_ROWS:,} test, an 79/21 split, using GroupShuffleSplit on "
        "user_id rather than a random row split. No athlete appears in both "
        "halves. A random row split would put the same person's sessions on "
        "both sides of the split, and because the model's features include "
        "that person's history count, it would effectively memorise the "
        "individual and report an accuracy that does not transfer to a new "
        "user. Grouping by user makes the test set a genuine cold-start "
        "problem.", "")])
    doc.rich([("External validation \u2014 chronological walk-forward. ", "b"), (
        f"The {EXT_N:,} GeoLife trajectories from {EXT_USERS} users are "
        "evaluated by walking each user's timeline forward: for each "
        "trajectory in date order, the reference curve is fitted from that "
        "user's strictly earlier trajectories of the same modality, the "
        "prediction is made, and only then is the trajectory added to "
        "history. Every prediction is therefore made with exactly the "
        "information available at that moment in that athlete's life. "
        "Cold-start behaviour is reproduced naturally: the first trajectory "
        "of a modality has empty history and the model falls back to its "
        "population speed, which is what a brand-new account experiences.",
        "")])
    doc.body(
        "Data leakage is avoided by construction at four separate points, and "
        "each is worth naming because each closes a different hole. First, "
        "the user-level split prevents memorisation of individuals. Second, "
        "the chronological history construction prevents future sessions "
        "from informing past predictions. Third, the target transformation "
        "uses a curve fitted only on prior data, so the model cannot be "
        "trained against a baseline that already knows the answer. Fourth, "
        "the three derived columns were dropped after the leakage audit. "
        "The external evaluation adds a fifth layer for free: GeoLife was "
        "never used to fit any parameter of the shipped model, so it cannot "
        "be contaminated by it."
    )
    doc.body(
        "Cross-validation was considered and deliberately not used. K-fold "
        "shuffling would violate the chronological ordering that the entire "
        "product depends on, and grouped k-fold would still not reproduce "
        "the walk-forward condition under which predictions are actually "
        "made. A single held-out evaluation that mirrors deployment is more "
        "informative here than a cross-validated number that does not."
    )


# -------------------------------------- 3. MACHINE LEARNING MODEL DEVELOPMENT
def _section_3(doc: TemplateDoc) -> None:
    doc.section_bar(3, "MACHINE LEARNING MODEL DEVELOPMENT")

    doc.sub("Model Selection", space_before=6)
    doc.body(
        "The final model is a gradient-boosted quantile regressor, "
        "implemented as three separate GradientBoostingRegressor instances "
        "from scikit-learn, one per quantile, stacked on top of a "
        "personalised Riegel reference curve. Gradient boosting was selected "
        "for four reasons, each of which rules out a simpler alternative."
    )
    doc.bullet(
        "The features are heterogeneous and interact non-linearly. Elevation "
        "per kilometre does not slow a runner down in a straight line \u2014 the "
        "penalty accelerates on steep grades, and it accelerates differently "
        "for cycling than for hiking. A tree ensemble captures that "
        "interaction without hand-specifying the shape; a linear model "
        "cannot, and a physics formula must assume the shape in advance.",
        bold_lead="Non-linear interactions: ")
    doc.bullet(
        "A duration estimate without an uncertainty range is not honest. "
        "Quantile loss trains three models that each predict a percentile "
        "directly, so the 10th and 90th percentile models produce the "
        "interval as a first-class output. Ordinary least squares gives a "
        "conditional mean and a residual standard deviation, which assumes "
        "symmetry and constant variance \u2014 both false here, because the error "
        "in minutes grows with session length.",
        bold_lead="Native quantile output: ")
    doc.bullet(
        "The corpus has 8,845 rows. That is far too small for a neural "
        "network to generalise from, and comfortably sufficient for a boosted "
        "ensemble of shallow trees. Depth is capped at three and leaves at "
        "twelve samples, which keeps the model deliberately conservative.",
        bold_lead="Small, tabular data: ")
    doc.bullet(
        "Because the target is a multiplicative correction on the athlete's "
        "own curve, the model starts from a strong baseline and only has to "
        "learn the residual. This is why a model this small is competitive: "
        "it is not fitting duration from scratch, it is fitting the part of "
        "duration that the physics gets wrong.",
        bold_lead="Strong physical prior: ")
    doc.body(
        "The alternative considered and rejected was a single direct "
        "regressor on duration in minutes. It was rejected on three grounds: "
        "it has no per-athlete baseline, so every prediction for a new user "
        "would be a population average; it has no native uncertainty; and it "
        "would have to relearn the Riegel relationship from 8,845 samples "
        "instead of starting from a curve that encodes it exactly."
    )

    # ------------------------------- Model Training and Implementation
    doc.sub("Model Training and Implementation")
    doc.body(
        "The model was developed in Python 3 using scikit-learn for the "
        "estimators and split, numpy for array handling, joblib for the "
        "deployable artifact, FastAPI for the inference service, and pandas "
        "for the preprocessing frame. Hyperparameters were fixed a priori "
        "from the size and shape of the data rather than found by a search, "
        "which is stated plainly because a search on 8,845 rows would have "
        "produced an over-fitted estimate."
    )
    doc.body(
        "The three quantile models are constructed identically apart from the "
        "alpha parameter. The excerpt below is the complete training loop as "
        "committed in ml/duration_model/train.py:"
    )
    doc.code(
        'QUANTILES = {"q10": 0.10, "q50": 0.50, "q90": 0.90}\n'
        "\n"
        "models: dict[str, GradientBoostingRegressor] = {}\n"
        "for name, alpha in QUANTILES.items():\n"
        "    model = GradientBoostingRegressor(\n"
        '        loss="quantile",\n'
        "        alpha=alpha,\n"
        "        n_estimators=320,\n"
        "        learning_rate=0.06,\n"
        "        max_depth=3,\n"
        "        min_samples_leaf=12,\n"
        "        subsample=0.9,\n"
        "        random_state=seed,\n"
        "    )\n"
        "    model.fit(x_train, y_train)\n"
        "    models[name] = model",
        caption="Listing 3.1 \u2014 the training loop (ml/duration_model/train.py).",
    )
    doc.body(
        "The per-athlete reference curve is fitted before training and is not "
        "part of the gradient boosting step. It uses weighted Ridge shrinkage "
        "toward the published Riegel exponent, with the prior strength and "
        "bounds applied explicitly:"
    )
    doc.code(
        "b = (s_xy + RIEGEL_PRIOR_STRENGTH * default_b) / (s_xx + RIEGEL_PRIOR_STRENGTH)\n"
        "b = float(min(1.30, max(1.00, b)))\n"
        "a = mean_y - b * mean_x",
        caption="Listing 3.2 \u2014 Ridge-shrunk Riegel exponent "
                "(ml/duration_model/preprocess.py).",
    )
    doc.body(
        "At inference the two stages compose in one line: the curve converts "
        "planned distance into a flat-equivalent baseline, and the boosted "
        "correction multiplies it."
    )
    doc.code(
        "factor  = np.clip(np.exp(model.predict(features)), 0.7, 3.0)\n"
        "minutes = base_minutes * factor",
        caption="Listing 3.3 \u2014 inference composition, with the physical clip.",
    )
    doc.body(
        "The clip of 0.7 to 3.0 is a guard rail, not a modelling choice. It "
        "bounds the correction to at most three times or at least seventy "
        "percent of the athlete's own curve, which prevents a single "
        "out-of-distribution feature vector from producing a physically "
        "absurd answer. Non-crossing guards are applied afterwards so the "
        "10th percentile can never exceed the median."
    )
    doc.body(
        "After training, the trees are exported to plain JSON "
        "(frontend/public/models/duration_model.json) so the progressive web "
        "application can evaluate them in the browser when the network is "
        "unavailable. The Python service and the browser evaluator are "
        "verified to produce identical output, which is why the feature order "
        "is treated as a contract."
    )

    # ------------------------------------------------------ Model Comparison
    doc.sub("Model Comparison")
    doc.body(
        "Four candidate approaches were compared. The comparison is the "
        "ablation study committed at ml/evaluation/reports/ablation_report.json, "
        "run on the 4,362 real GeoLife trajectories rather than on the "
        "synthetic corpus, because the synthetic corpus would favour "
        "whichever model best reproduced its generator."
    )
    doc.table(
        ["Model", "Description", "Purpose"],
        [
            ["Population prior",
             "Predicts the modality's average speed for every athlete and "
             "every route, with no personalisation and no terrain term.",
             "Lower bound. Establishes whether the project beats a pace chart "
             "at all."],
            ["Riegel reference curve",
             "Per-athlete power law fitted chronologically on that athlete's "
             "own prior sessions, with Ridge shrinkage toward the published "
             "exponent.",
             "Baseline. Establishes how much of the problem physics alone "
             "solves."],
            ["Curve + GBM correction (shipped)",
             "The reference curve multiplied by the quantile gradient-boosted "
             "correction described above. This is the deployed model.",
             "Final model. Tests whether learned residual correction earns "
             "its complexity over the curve."],
            ["Direct duration regressor",
             "A single gradient-boosted regressor on duration in minutes with "
             "no reference curve and no quantile output.",
             "Rejected. No personalisation baseline, no uncertainty, and it "
             "must relearn the Riegel law from limited data."],
        ],
        widths=[1.5, 2.7, 2.05],
    )
    doc.body(
        "The basis for selecting the final model is described in Section 3.4 "
        "and quantified in Section 4.3. In short: it is selected because it "
        "is the only candidate that delivers a calibrated uncertainty "
        "interval, and because the ablation shows it is at worst equal to the "
        "bare curve on accuracy while adding the interval, the guard rails "
        "and the cold-start behaviour the product needs."
    )

    # ---------------------------------------------------- Final Model Selection
    doc.sub("Final Model Selection")
    doc.body(
        "The final model is the reference curve with the gradient-boosted "
        "quantile correction, shipped as version 20261113.1328. It was "
        "selected on the development and evaluation results for four reasons."
    )
    doc.numbered("1.", (
        "It produces an uncertainty interval natively. The three quantile "
        "models give the interface a 10th and 90th percentile to display "
        "alongside the median, so the application can show a range. No other "
        "candidate does this without a distributional assumption the data "
        "violates."))
    doc.numbered("2.", (
        "It is never materially worse than the bare curve on point accuracy. "
        "On the external set the curve alone reaches an MAE of 5.83 minutes "
        "and the full model 5.84 \u2014 a difference of 0.01 minutes, which is "
        "reported here rather than hidden. The correction buys its place "
        "through the interval and the guard rails, not through a better mean "
        "error."))
    doc.numbered("3.", (
        "It degrades gracefully for new athletes. With no history the curve "
        "falls back to the population speed and the correction model still "
        "runs, so a brand-new account receives a usable estimate instead of "
        "an error. This is the cold-start path and it is measured separately "
        "in the evaluation."))
    doc.numbered("4.", (
        "It is deployable within the project's constraints. It trains in "
        "under a minute on a laptop, exports to a JSON file the browser can "
        "evaluate offline, and needs no GPU at inference time."))
    doc.body(
        "The fourth-place candidate \u2014 a direct duration regressor \u2014 was not "
        "selected because it cannot satisfy the first and third requirements "
        "simultaneously, and the ablation gives no evidence that its extra "
        "flexibility would have paid for that loss."
    )


# ------------------------------------ 4. MODEL EVALUATION AND INTERPRETATION
def _section_4(doc: TemplateDoc) -> None:
    doc.section_bar(4, "MODEL EVALUATION AND INTERPRETATION")

    doc.sub("Evaluation Metrics", space_before=6)
    doc.body(
        "Six metrics are reported. Each answers a different question, and "
        "reporting only one of them would be misleading in a specific way."
    )
    doc.table(
        ["Evaluation Metrics", "Definition", "Why it is appropriate"],
        [
            ["MAE (minutes)",
             "Mean absolute error between predicted and actual duration.",
             "Directly interpretable in the unit the user cares about: an MAE "
             "of 5.84 means a typical prediction is about six minutes out."],
            ["MAPE / MdAPE (%)",
             "Mean and median absolute percentage error.",
             "Scale-free, so a four-minute error on a short walk and a "
             "four-minute error on a long ride are not treated as equivalent. "
             "MdAPE is the more robust of the two."],
            ["Within 15% / Within 20%",
             "Share of predictions landing inside \u00b115% (\u00b120%) of actual "
             "duration.",
             "The practical question: how often is the plan close enough to "
             "fuel from? These are hit rates, not averages."],
            ["R\u00b2",
             "Coefficient of determination on held-out data.",
             "How much of the variance in duration the model explains beyond "
             "predicting the mean. Useful for comparison, not for users."],
            ["Interval coverage (%)",
             "Share of actual durations falling inside the predicted 10th\u201390th "
             "percentile interval.",
             "The metric that tests the interval itself. A nominal 80% "
             "interval should contain the truth about 80% of the time."],
        ],
        widths=[1.3, 2.2, 2.75],
    )
    doc.body(
        "Interval coverage deserves emphasis because it is the metric that "
        "distinguishes an honest model from a confident one. The shipped "
        "model predicts an 80% interval. Its external coverage is 16.96%, "
        "which means the interval is far too narrow on real data and is "
        "therefore not yet trustworthy as a probability statement. That "
        "failure is reported in Section 4.4 rather than omitted, and it is "
        "the single most important finding in this evaluation."
    )

    # --------------------------------------------------- Model Evaluation Results
    doc.sub("Model Evaluation Results")
    doc.body(
        f"The headline result is the external validation on {EXT_N:,} real "
        f"GPS trajectories from {EXT_USERS} users, none of which were seen "
        "during training:"
    )
    doc.table(
        ["Evaluation Metrics", "Result"],
        [
            ["Evaluated rows / users", f"{EXT_N:,} / {EXT_USERS}"],
            ["MAE", f"{EXT_MAE} minutes"],
            ["MAPE", f"{EXT_MAPE}%"],
            ["MdAPE", f"{EXT_MDAPE}%"],
            ["Within 15%", f"{EXT_W15}%"],
            ["Within 20%", f"{EXT_W20}%"],
            ["R\u00b2", f"{EXT_R2}"],
            ["Interval coverage (nominal 80%)", f"{EXT_COVERAGE}%"],
            ["Baseline MAE \u2014 population prior", f"{EXT_PRIOR_MAE} minutes"],
            ["Baseline MAE \u2014 reference curve alone", f"{EXT_CURVE_MAE} minutes"],
        ],
        widths=[3.0, 2.4],
        caption="External validation on GeoLife GPS Trajectories "
                "(ml/evaluation/reports/geolife_validation.json).",
    )
    doc.body(
        "Performance differs substantially by modality, and the difference is "
        "informative rather than noise:"
    )
    doc.table(
        ["Modality", "n", "MAE (min)", "MdAPE", "Within 20%", "R\u00b2",
         "Coverage"],
        [
            ["Ride", "1,372", "5.14", "19.66%", "50.80%", "0.474", "20.12%"],
            ["Walk", "2,988", "6.16", "26.16%", "40.60%", "0.386", "15.53%"],
            ["Run", "2", "2.78", "28.21%", "50.00%", "n/a", "0.00%"],
        ],
        widths=[0.9, 0.75, 0.9, 0.85, 1.0, 0.7, 0.9],
        caption="External validation by modality. The run slice has two rows "
                "and is reported only for completeness.",
    )
    doc.body(
        "The solid result is cycling: an MAE of 5.14 minutes and an MdAPE of "
        "under 20% on 1,372 real rides, with an R\u00b2 of 0.474. Walking is "
        "harder, at 6.16 minutes and 26.16%, because walking duration depends "
        "heavily on purpose \u2014 a stroll, a commute and a hill walk are the "
        "same modality but not the same activity. The run slice contains two "
        "trajectories and cannot support any conclusion; it is included "
        "because omitting it would look like selection, and labelled because "
        "quoting it would be worse."
    )
    doc.body(
        "Performance also tracks history depth, which is the expected and "
        "desirable behaviour for a personalisation system:"
    )
    doc.table(
        ["History depth", "n", "MAE (min)", "MdAPE", "R\u00b2", "Coverage"],
        [
            ["Cold start (0 prior)", "80", "11.80", "45.67%", "0.274", "13.75%"],
            ["Thin (1 prior)", "67", "12.51", "24.49%", "0.053", "19.40%"],
            ["Personalised (2+ prior)", "4,215", "5.62", "23.54%", "0.423",
             "16.99%"],
        ],
        widths=[1.6, 0.8, 1.0, 0.95, 0.7, 0.95],
        caption="External validation by available history.",
    )
    doc.body(
        "An athlete with two or more prior sessions gets an MAE of 5.62 "
        "minutes; an athlete with none gets 11.80. The personalisation is "
        "worth roughly a factor of two in error, which is the mechanism the "
        "product depends on and the clearest evidence that the reference "
        "curve is doing real work."
    )

    # ------------------------------------------------- Model Comparison Results
    doc.sub("Model Comparison Results")
    doc.body(
        "The ablation asks a narrow question: given that the athlete's own "
        "Riegel curve is already the baseline, does multiplying in a learned "
        "correction improve anything? The answer on 4,362 real trajectories "
        "is essentially no on point accuracy, and yes on interval."
    )
    doc.table(
        ["Model", "MAE (min)", "MdAPE", "Within 20%", "R\u00b2"],
        [
            ["Population prior", "7.10", "24.0%", "\u2014", "\u2014"],
            ["Reference curve alone", "5.83", "24.0%", "43.7%", "0.415"],
            ["Curve + GBM correction (shipped)", "5.84", "23.8%", "43.8%",
             "0.414"],
        ],
        widths=[2.5, 0.95, 0.85, 1.0, 0.8],
        caption="Ablation on 4,362 real trajectories "
                "(ml/evaluation/reports/ablation_report.json).",
    )
    doc.body(
        "The learned correction changes MAE by 0.01 minutes \u2014 a 0.2% "
        "difference, well inside noise \u2014 and actually moves R\u00b2 down by "
        "0.001. MdAPE improves marginally from 24.0% to 23.8%. By modality "
        "the picture splits: on cycling, where there are enough rows to "
        "speak, the curve alone is slightly better (5.07 versus 5.14 "
        "minutes), and on walking the correction is marginally better (6.18 "
        "versus 6.16). None of these differences is meaningful at this sample "
        "size, and presenting them as improvements would be dishonest."
    )
    doc.body(
        "What the comparison does establish is the value of the physics. The "
        "personal reference curve beats the population prior by 17.9% in MAE "
        "\u2014 7.10 to 5.83 minutes \u2014 and on cycling by 46.6%. That is a large, "
        "consistent, explainable gain, and it comes from personalisation "
        "rather than from learning. The project's honest conclusion is that "
        "the reference curve is the load-bearing component and the boosted "
        "correction is, on this evidence, not yet earning its place on "
        "accuracy alone."
    )
    doc.body(
        "A second comparison addresses whether that is a data problem. The "
        "held-out retraining study split the 51 GeoLife users 36 training / "
        "15 holdout, retrained a candidate on real data only, and scored both "
        "models on the same 1,085 unseen-path rows:"
    )
    doc.table(
        ["Metric", "Shipped (synthetic-trained)", "Retrained on real data",
         "Change"],
        [
            ["MAE (min)", "6.17", "6.11", "\u22120.06"],
            ["MdAPE", "26.68%", "24.42%", "\u22122.26 pts"],
            ["Within 20%", "38.71%", "42.49%", "+3.78 pts"],
            ["R\u00b2", "0.489", "0.466", "\u22120.023"],
            ["Interval coverage", "15.94%", "67.83%", "+51.89 pts"],
        ],
        widths=[1.3, 2.15, 1.95, 0.9],
        caption="Held-out retraining study, 1,085 rows from 15 unseen users "
                "(ml/evaluation/reports/retrain_study.json).",
    )
    doc.body(
        "The paired bootstrap over 2,000 draws gives a 95% confidence interval "
        "on the MAE difference of [\u22120.071, +0.184] minutes. That interval "
        "straddles zero, so the study's verdict is that retraining on real "
        "data produced no measurable accuracy difference at this sample size. "
        "The striking number is interval coverage: 15.94% became 67.83%. The "
        "interval was never a lie about the model's centre \u2014 it was a lie "
        "about its spread, and the spread was inherited from the synthetic "
        "corpus, which is far less variable than reality."
    )

    # ------------------------------------------------------ Results Interpretation
    doc.sub("Results Interpretation")
    doc.body(
        "Three findings follow from these results, and they matter more than "
        "the headline error figure."
    )
    doc.rich([("The pipeline works; some of the numbers attached to it were "
               "wrong. ", "b"), (
        "The personalisation mechanism is real and worth roughly a factor of "
        "two in error between a cold-start and an experienced user. The "
        f"external MdAPE of {EXT_MDAPE}% means a typical prediction is within "
        "about a quarter of the true duration, which is usable for planning a "
        "long session and marginal for a short one. But the internal holdout "
        "score of R\u00b2 0.9924 sits next to an external R\u00b2 of 0.414, and the "
        "gap between them is the model card measuring the model against its "
        "own generator. Reporting only the first number would misrepresent "
        "the system completely.", "")])
    doc.rich([("The learned correction is not earning its place yet. ", "b"), (
        "The ablation is unambiguous: 0.01 minutes of MAE separates the full "
        "model from the bare curve. This is a negative result about a "
        "component the project built, and it is documented as such. The "
        "correction remains in the shipped model because it supplies the "
        "quantile interval and the guard rails, not because it improves mean "
        "accuracy.", "")])
    doc.rich([("Calibration is a data problem, and the fix is measured. ", "b"), (
        "Interval coverage of 16.96% against a nominal 80% is a serious "
        "defect. The retraining study identifies the cause \u2014 the synthetic "
        "corpus under-represents real-world variance \u2014 and shows the fix: "
        "coverage jumps to 67.83% when the model is fitted on real "
        "trajectories. That is still short of nominal, but it is the correct "
        "direction and it is a data acquisition problem rather than a "
        "modelling one.", "")])
    doc.body(
        "The prediction errors themselves are structured, not random. The "
        "largest errors concentrate in three places: cold-start predictions, "
        "where the model has no personal curve to correct and must use a "
        "population speed; walking, where the modality label hides widely "
        "different activity purposes; and long sessions, where a percentage "
        "error compounds into a large absolute error in minutes. The system "
        "already widens its stated interval for the first and third of these, "
        "which is the right response even though the interval itself is "
        "currently too narrow."
    )
    doc.body(
        "How effectively the model addresses the identified problem therefore "
        "depends on the user. For a cyclist with a training log, the system "
        "predicts within about twenty percent most of the time and the "
        "fueling plan built on that prediction is materially better than a "
        "population chart. For a first-time user planning a long walk, the "
        "estimate is little better than a well-chosen average, and the "
        "interface should \u2014 and does \u2014 say so."
    )

    # ------------------------------------------------------------ Model Limitations
    doc.sub("Model Limitations")
    doc.table(
        ["Limitation", "Evidence"],
        [
            ["Interval coverage is far below nominal on real data.",
             f"{EXT_COVERAGE}% actual against an 80% target. The displayed "
             "range should not be read as an 80% probability until the model "
             "is refitted on real data."],
            ["The deployed model was trained on synthetic data.",
             "Training source is recorded as \"synthetic\" in the model card. "
             "Its internal metrics measure self-consistency, not field "
             "accuracy; the external numbers are the only honest ones."],
            ["Elevation is absent from the external evaluation set.",
             "GeoLife's feature table carries no terrain. All 4,362 external "
             "predictions were made with elevation forced to zero, so the "
             "strongest feature (importance 0.6849) contributed nothing "
             "during validation. Real-world accuracy on hilly routes is "
             "unmeasured."],
            ["The learned correction adds no measurable accuracy.",
             "MAE 5.83 versus 5.84 minutes; R\u00b2 0.415 versus 0.414. Its "
             "justification is the interval and the guard rails."],
            ["Walking is modelled as one activity when it is several.",
             "Walk MAE 6.16 minutes and MdAPE 26.16% across strolls, "
             "commutes and hill walks. The label carries no purpose."],
            ["The run slice is statistically empty.",
             "Two trajectories. No conclusion about running accuracy can be "
             "drawn from this evaluation."],
            ["Training data is not from real users of this application.",
             "No consented production logs were available. The retraining "
             "study estimates what changes when they are, but does not "
             "substitute for them."],
            ["Predictions are unreliable outside the trained distance ranges.",
             "1.5\u201345 km run, 2\u2013150 km ride, 0.5\u201322 km walk, 2\u201336 km hike. "
             "Beyond these the model extrapolates a correction it never "
             "learned."],
        ],
        widths=[2.35, 3.9],
        caption="Model limitations and the evidence for each.",
    )
    doc.body(
        "Two limitations deserve more than a table row. The first is the "
        "calibration defect, because a user reading a range believes it means "
        "something. Until the model is refitted on real trajectories, the "
        "range is best read as a relative indication of confidence \u2014 wider "
        "when the model is less sure \u2014 rather than as a calibrated "
        "probability, and the project should not present it otherwise. The "
        "second is the elevation blind spot in validation: the external "
        "evaluation could not test the feature that dominates the model, so "
        "its headline error is a lower bound on what a hilly real-world route "
        "would produce, not an estimate of it."
    )


# ------------------------------ 5. WEB APPLICATION DEVELOPMENT AND OUTPUT
def _section_5(doc: TemplateDoc) -> None:
    doc.section_bar(5, "WEB APPLICATION DEVELOPMENT AND OUTPUT")
    doc.body(
        "TRANA is a three-tier application. The client is a Svelte 5 "
        "progressive web application built with Vite and styled with "
        "Tailwind CSS, deployable offline because it ships an IndexedDB cache "
        "and a JSON copy of the model trees. The application programming "
        "interface is Laravel 12 on PHP 8.2, handling authentication through "
        "Sanctum, activity storage, and the proxy to inference. The "
        "inference service is FastAPI on Python 3, loading the trained "
        "scikit-learn artifact and exposing the duration and fueling "
        "endpoints. The screenshots below document the interface and the "
        "major functionalities."
    )
    doc.body(
        "Each screenshot is presented with a description of what it "
        "demonstrates. Screenshots are to be captured from the deployed "
        "application at trana-web.vercel.app and inserted in place of the "
        "marked boxes."
    )

    doc.figure_placeholder(
        "Landing page",
        "Capture the public landing page at trana-web.vercel.app. Show the "
        "hero headline, the four-step Plan / Track / Fuel / Improve strip, "
        "and the primary call-to-action buttons.",
    )
    doc.body(
        "The landing page introduces the product's promise before asking for "
        "an account. It presents the four-step loop the application "
        "implements \u2014 plan a session, track it, fuel it, improve from the "
        "result \u2014 so the visitor understands that duration prediction and "
        "fueling are one workflow rather than two features."
    )

    doc.figure_placeholder(
        "Registration and onboarding",
        "Capture the registration form and the onboarding step that collects "
        "experience level and typical session types.",
    )
    doc.body(
        "Registration collects only what the model needs. Onboarding "
        "establishes the athlete's experience level and preferred modalities, "
        "which seed the reference curve before any activity exists and are "
        "what the cold-start path uses for a brand-new account."
    )

    doc.figure_placeholder(
        "Plan Activity \u2014 the primary machine-learning surface",
        "Capture the Plan Activity form with an activity type selected, a "
        "distance and elevation entered, and the resulting duration estimate "
        "with its range and fueling figures visible.",
    )
    doc.body(
        "This is the screen the machine learning exists for. The athlete "
        "chooses a modality, enters a planned distance and elevation gain, and "
        "the interface returns a median duration with a lower and upper "
        "bound. Every distinct input value shown on this screen is real "
        "output from the model: the three numbers are the 10th, 50th and 90th "
        "percentile predictions, and the fueling figures are derived from the "
        "median."
    )

    doc.figure_placeholder(
        "Fueling plan",
        "Capture the fueling panel showing carbohydrate grams per hour, fluid "
        "millilitres per hour, and sodium milligrams per hour for a session.",
    )
    doc.body(
        "The fueling plan is what makes the duration prediction useful rather "
        "than merely interesting. Carbohydrate, fluid and sodium targets are "
        "computed from the predicted session duration and intensity using "
        "published endurance-nutrition guidelines, so a longer predicted "
        "session yields higher per-hour and total targets. If the duration "
        "estimate were wrong by an hour, this panel would be wrong by the "
        "same hour \u2014 which is the practical argument for the whole system."
    )

    doc.figure_placeholder(
        "Route drawing and elevation profile",
        "Capture the route planner with a drawn route and the elevation "
        "profile beneath it.",
    )
    doc.body(
        "The route planner lets the athlete draw a planned route and reads "
        "elevation from the Copernicus global elevation model through "
        "Open-Meteo, filling in the elevation gain that the model needs. "
        "This closes the loop between the map and the prediction: the "
        "athlete draws where they intend to go, and the climb rate implied by "
        "the terrain feeds the strongest feature in the model."
    )

    doc.figure_placeholder(
        "Track \u2014 live session recording",
        "Capture an in-progress session showing elapsed time, distance, and "
        "GPS status.",
    )
    doc.body(
        "Tracking records the session the athlete planned, producing the "
        "actual duration that makes the prediction falsifiable. The recorded "
        "activity enters the athlete's history and is used as reference data "
        "for every future prediction, which is how accuracy improves with "
        "use."
    )

    doc.figure_placeholder(
        "Dashboard and analytics",
        "Capture the dashboard summary cards and the analytics charts.",
    )
    doc.body(
        "The dashboard and analytics surfaces summarise the athlete's log: "
        "weekly volume, pace trends, and the comparison between predicted and "
        "actual durations. The prediction-versus-actual view is what turns the "
        "system from a calculator into a feedback loop."
    )

    doc.figure_placeholder(
        "Activity history",
        "Capture the paginated activity history list with session rows.",
    )
    doc.body(
        "Activity history provides the chronological record from which the "
        "reference curve is fitted. Its ordering is the same ordering the "
        "walk-forward evaluation uses, which means what the athlete sees is "
        "exactly what the model sees."
    )

    doc.figure_placeholder(
        "Goals and calendar",
        "Capture the goals page with a target and the calendar view showing "
        "planned sessions.",
    )
    doc.body(
        "Goals and calendar let an athlete commit to a planned session in "
        "advance, which is the point in the workflow where the duration "
        "estimate has to be trusted before the fact."
    )

    doc.figure_placeholder(
        "Public preview \u2014 no account required",
        "Capture the /preview page showing an estimate generated without "
        "logging in.",
    )
    doc.body(
        "The preview surface runs the model for a visitor with no account and "
        "no history, which is the cold-start path made visible. It exists "
        "because the value of the estimate is easier to demonstrate than to "
        "describe, and because it exercises the population fallback in "
        "production."
    )


# ------------------------------------------------------ 6. GROUP CONTRIBUTIONS
def _section_6(doc: TemplateDoc) -> None:
    doc.section_bar(6, "GROUP CONTRIBUTIONS")
    doc.body(
        "Each member's assigned responsibilities and specific contributions "
        "are recorded below. Names are to be completed by the group before "
        "submission."
    )
    doc.table(
        ["Group Members", "Assigned Responsibilities", "Specific Contributions"],
        [
            ["[SURNAME, First Name]",
             "Machine-learning model development; evaluation and validation.",
             "Implemented the gradient-boosted quantile model and the "
             "Riegel reference curve; ran the external validation, ablation "
             "and held-out retraining studies; produced the model card and "
             "the evaluation reports."],
            ["[SURNAME, First Name]",
             "Dataset construction and preprocessing.",
             "Built the physics-informed corpus generator; implemented "
             "chronological history construction, flat-equivalent "
             "normalisation, Ridge shrinkage and the leakage audit; "
             "assembled the external evaluation set."],
            ["[SURNAME, First Name]",
             "Web application development and deployment.",
             "Built the Svelte and Laravel tiers, the FastAPI inference "
             "service, the browser model evaluator and the fueling planner; "
             "managed the deployment pipeline and the continuous integration "
             "checks."],
            ["[SURNAME, First Name]",
             "Documentation, testing and quality assurance.",
             "Wrote the technical documentation and the reference set; "
             "maintained the test suites across the three services; prepared "
             "the figures and verified every reported number against the "
             "committed reports."],
        ],
        widths=[1.5, 2.1, 2.65],
    )
    doc.body(
        "Add rows as necessary. Every member is expected to be able to "
        "explain the whole pipeline, not only their own part, and the "
        "contribution table is not a substitute for that."
    )


# --------------------------------------------------------------- 7. CONCLUSION
def _section_7(doc: TemplateDoc) -> None:
    doc.section_bar(7, "CONCLUSION")
    doc.body(
        "TRANA was completed as a working predictive application rather than "
        "a model in a notebook. It takes an athlete's planned activity and "
        "returns an estimated duration with a range, then converts that "
        "estimate into a carbohydrate, fluid and sodium plan. The system runs "
        "as a progressive web application, a Laravel API and a FastAPI "
        "inference service, and it is deployed."
    )
    doc.body(
        "The overall experience of building it is best described as a "
        "sequence of corrections, each of which made the project more honest. "
        "The first was realising that a model scored on its own generated "
        f"data is not evaluated at all: the internal R\u00b2 of 0.9924 looked like "
        f"success and the external {EXT_R2} was the truth. The second was "
        "finding that three features were derived from the target and had to "
        "be removed. The third was the ablation, which showed that a "
        "component the group had built with care added 0.01 minutes of "
        "accuracy and had to be justified on other grounds. The fourth was "
        "the interval coverage of 16.96%, which meant the confidence range "
        "the interface displays was not yet calibrated. Each correction cost "
        "a number the group would have liked to keep, and each one moved the "
        "project closer to something a user could rely on."
    )
    doc.body(
        "The project demonstrates dataset preparation in the sense that "
        "matters \u2014 not cleaning rows, but preventing the future from "
        "reaching the past. The user-level split, the chronological history "
        "construction, the target transformation and the leakage audit are "
        "four independent defences against a score that cannot be reproduced "
        "in deployment. It demonstrates model development through a design "
        "decision the group can defend: personalise first with a physical "
        "baseline that works from three sessions, then learn only the "
        "residual, and carry an interval because a point estimate overstates "
        "what is known. It demonstrates model evaluation through the "
        "ablation and the held-out retraining study, both of which produced "
        "results the project did not want and both of which are reported. And "
        "it demonstrates web application integration because the model is "
        "reachable from a browser, evaluates offline, and drives a downstream "
        "computation the user actually acts on."
    )
    doc.body(
        "The knowledge and technical skills gained span four areas. In "
        "machine learning, the group learned quantile regression as a "
        "practical alternative to assuming normality, Ridge shrinkage as a "
        "way to make small samples usable, grouped splitting as a discipline, "
        "and ablated design as a habit rather than an afterthought. In data "
        "engineering, the group learned that feature auditing is a committed "
        "script and not a judgement made once. In software engineering, the "
        "group learned to keep two evaluators \u2014 Python and JavaScript \u2014 in "
        "exact agreement through an explicit feature-order contract, and to "
        "treat the exported JSON as a deployable artifact. In evaluation, the "
        "group learned to distinguish a self-score from a field result and to "
        "report both."
    )
    doc.body(
        "The challenges were specific and are worth naming. The synthetic "
        "corpus had to be built from published physiology because no "
        "consented real logs existed; the solution was to make its "
        "assumptions explicit and then measure how badly they transferred, "
        "which is what the external validation and the retraining study do. "
        "The elevation blind spot in the external set could not be fixed "
        "without a digital elevation model for Beijing, so it is documented "
        "as a bounded unknown rather than papered over. The interval "
        "miscalibration was traced to the corpus rather than the model, which "
        "converted an embarrassment into a concrete data-acquisition plan. "
        "The ablation's negative result was kept in the documentation because "
        "removing it would have made the evaluation untrue."
    )
    doc.body(
        "The work that remains is clearly identified. The model should be "
        "refitted on real, consented activity data, which the retraining "
        "study indicates would raise interval coverage from 15.94% to 67.83% "
        "without changing mean accuracy. Elevation must be validated against "
        "real terrain. Running needs more than two evaluation trajectories "
        "before any claim about it can be made. None of these requires "
        "rethinking the architecture; all of them require data."
    )
    doc.body(
        "TRANA therefore ends where a defensible student project should end: "
        "with a deployed system that works, a measured understanding of how "
        "well it works and where it does not, and a specific plan for the "
        "data that would make it better."
    )


def _closing(doc: TemplateDoc) -> None:
    doc.spacer(18)
    doc.body("END OF DOCUMENTATION", align="left", size=11)
