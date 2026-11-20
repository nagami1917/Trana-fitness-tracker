"""Section 1 — Project Overview (template: Project Description, Objectives, Problem Definition)."""

from __future__ import annotations

from docx_engine import Doc


def build_section_1(doc: Doc) -> None:
    doc.h1("1. PROJECT OVERVIEW")

    # ------------------------------------------------------------ 1.1
    doc.h2("1.1 Project Description")

    doc.p(
        "TRANA is a web application that predicts how long an athletic session will take "
        "and, from that prediction, tells the athlete how much carbohydrate, sodium, and "
        "fluid to carry. The user chooses an activity type (run, ride, walk, or hike), "
        "enters a planned distance and elevation gain, and receives a duration estimate in "
        "minutes with a lower and upper bound. The estimate is then carried forward into a "
        "fueling plan that states grams of carbohydrate per hour, milligrams of sodium per "
        "hour, millilitres of fluid per hour, and \u2014 if the athlete has entered their own "
        "kit \u2014 the number of gels, bottles, and electrolyte capsules required.",
        align="justify",
    )

    doc.p(
        "The problem it addresses is a preparation problem, not a tracking problem. "
        "Existing fitness applications record what already happened. They answer "
        "\u201chow far did I go?\u201d after the session is over. An athlete standing at the "
        "start line of a long run or a sportive has a different question: \u201cif I set out "
        "for 21 km with 300 m of climbing, when will I be back, and how much should I "
        "eat?\u201d Getting that wrong has consequences that range from a ruined training "
        "block to a bonked race. Underestimating duration means running out of fuel and "
        "water; overestimating means carrying unnecessary weight for four hours.",
        align="justify",
    )

    doc.p(
        "What makes this a machine-learning problem rather than a table lookup is that the "
        "same distance takes wildly different times for different people, and for the same "
        "person on different days. A 10 km run is 42 minutes for one athlete and 75 minutes "
        "for another; a hilly 40 km ride can take longer than a flat 60 km ride. A single "
        "population average cannot serve either case. TRANA therefore learns from the "
        "athlete\u2019s own history.",
        align="justify",
    )

    doc.quote(
        "The core prediction, stated precisely",
        "duration_minutes = base_minutes(distance) \u00d7 exp(f(features))  where "
        "base_minutes = exp(a + b\u00b7ln(distance)) is the athlete\u2019s own Riegel reference "
        "curve fitted from their prior sessions of the same sport, and f(\u00b7) is a "
        "gradient-boosted regressor trained on nine features that outputs a multiplicative "
        "pace-factor correction. Three such regressors are trained at the 10th, 50th, and "
        "90th quantiles, producing the interval rather than a point.",
    )

    doc.p(
        "The machine-learning component is genuinely load-bearing but it is deliberately not "
        "the whole story. Section 4.3 reports, candidly, that on external data the learned "
        "correction is statistically indistinguishable from the curve alone. That finding is "
        "part of the project\u2019s contribution rather than a failure of it: the work "
        "measures its own model honestly, diagnoses the cause of the gap, and demonstrates "
        "the fix. Section 4.4 explains what that means for the deployed product.",
        align="justify",
    )

    doc.h3("How machine learning generates the prediction, step by step")

    steps = [
        ("Input collection. ",
         "The browser collects activity type, distance, elevation gain, and the athlete\u2019s "
         "session history. All four are things the athlete knows before they leave."),
        ("Reference curve fitting. ",
         "From the athlete\u2019s prior sessions of that sport, a weighted Ridge regression fits "
         "the Riegel exponent b in time \u221d distance^b, shrunk toward a sport-specific prior "
         "and bounded to [1.00, 1.30]. With no history, a population prior is used and the "
         "prediction is explicitly labelled cold-start."),
        ("Feature construction. ",
         "Nine features are assembled: distance, absolute elevation gain, elevation gain per "
         "kilometre, experience level, history count, and four one-hot activity-type flags."),
        ("Learned correction. ",
         "The gradient-boosted trees output a log pace-factor per quantile. Exponentiation "
         "returns a multiplier, which is clamped to [0.7, 3.0] as a guard against "
         "out-of-range input."),
        ("Composition. ",
         "Curve \u00d7 multiplier yields the median estimate; the q10 and q90 branches yield the "
         "bounds. The bounds are forced non-crossing and floored at one minute."),
        ("Handoff to the fuelling engine. ",
         "The predicted duration drives the ACSM metabolic calculation [8], [11]: "
         "kcal = MET \u00d7 mass \u00d7 hours, and carbohydrate/sodium/fluid targets are "
         "selected by duration band and intensity."),
    ]
    for i, (lead, text) in enumerate(steps, start=1):
        doc.numbered(text, bold_lead=f"Step {i} \u2014 {lead}", marker="")

    doc.p(
        "One architectural detail matters for the credibility of the whole system: the same "
        "gradient-boosted ensemble is exported to a JSON tree representation and evaluated "
        "twice \u2014 once by scikit-learn on the server, and once by a hand-written tree "
        "walker in the browser (frontend/src/lib/ml/duration.js). The browser copy exists so "
        "the interface can show an instant preview while the athlete is still adjusting the "
        "distance slider, without a network round trip. Both paths consume the same exported "
        "artifact and are tested to agree.",
        align="justify",
    )

    # ------------------------------------------------------------ 1.2
    doc.h2("1.2 Project Objectives")

    doc.h3("General Objective")
    doc.p(
        "To design, develop, and evaluate a predictive machine-learning web application that "
        "forecasts the duration of a planned endurance activity from an athlete\u2019s own "
        "history and converts that forecast into an actionable fueling plan.",
        align="justify",
    )

    doc.h3("Specific Objectives")
    objectives = [
        ("Build a reproducible training pipeline. ",
         "Produce a training script that consumes a documented dataset contract, is "
         "invokable from the command line for both synthetic and real data sources, and "
         "emits a versioned artifact plus a model card recording every metric and "
         "hyperparameter needed to audit it."),
        ("Engineer features that encode real physiology. ",
         "Rather than feeding raw distance and elevation to a black box, normalise history to "
         "flat-equivalent time and fit a Riegel curve, so the learned component only has to "
         "model the residual pace factor."),
        ("Produce calibrated uncertainty, not just a point estimate. ",
         "Train quantile regressors so the application can state a range, and measure "
         "empirical interval coverage against the nominal 80% target."),
        ("Validate on data the model has never seen. ",
         "Obtain and evaluate against an independent external dataset (GeoLife GPS "
         "Trajectories), using a per-user chronological protocol that forbids any use of "
         "future data, and report the resulting metrics as the honest accuracy figure."),
        ("Audit the model adversarially and report the outcome. ",
         "Run an ablation that isolates the learned correction from the reference curve it "
         "multiplies, and place a bootstrap confidence interval on the difference."),
        ("Diagnose and remedy the identified defect. ",
         "Determine why interval coverage is low, then run a held-out user retraining study "
         "to test whether the defect is a modelling limit or a training-data artefact."),
        ("Deliver a working, deployed application. ",
         "Ship a progressive web app with authentication, activity logging, planning, "
         "analytics, and the prediction feature, deployed and publicly reachable."),
        ("Make the system honest in its interface. ",
         "Surface the externally validated error margin in the user interface rather than the "
         "flattering in-distribution number."),
    ]
    for lead, text in objectives:
        doc.bullet(text, bold_lead=lead)

    doc.table(
        ["Objective", "How it is verified", "Where the evidence lives"],
        [
            ["Reproducible pipeline",
             "Deterministic re-run with fixed seed reproduces identical metrics",
             "ml/evaluation/retrain_study.py; report JSON"],
            ["Physiological features",
             "Curve parameters bounded and inspected; features documented",
             "ml/duration_model/preprocess.py"],
            ["Calibrated uncertainty",
             "Empirical coverage measured against 80% nominal",
             "geolife_validation.json \u2192 interval_coverage_pct"],
            ["External validation",
             "4,362 activities from 51 unseen users",
             "ml/evaluation/reports/geolife_validation.json"],
            ["Adversarial audit",
             "Paired bootstrap over 2,000 resamples",
             "ml/evaluation/reports/ablation_report.json"],
            ["Diagnose and remedy",
             "User-disjoint 70/30 retrain study, 3 seeds",
             "ml/evaluation/reports/retrain_study.json"],
            ["Deployed application",
             "Public URL, health endpoint returns model_ready",
             "https://trana-web.vercel.app"],
            ["Honest interface",
             "Error margin sourced from the GeoLife report",
             "frontend/src/lib/ml/duration.js, VALIDATED_ERROR_PCT"],
        ],
        caption="Objectives mapped to their verification method and evidence location.",
        widths=[1.5, 2.5, 2.4],
        align_numeric=False,
    )

    # ------------------------------------------------------------ 1.3
    doc.h2("1.3 Problem Definition")

    doc.h3("The specific problem")
    doc.p(
        "An endurance athlete preparing for a session must decide two things before starting: "
        "how long to budget, and how much fuel and fluid to carry. Both decisions are "
        "currently made by guesswork or by consulting a flat pace table that ignores terrain, "
        "personal history, and the shape of the athlete\u2019s own fatigue curve. A pace table "
        "says a 5:30/km runner needs 1h 56m for a half marathon; it does not know that this "
        "particular athlete fades badly after 15 km, or that the course climbs 400 m.",
        align="justify",
    )

    doc.h3("Intended users")
    users = [
        ("Recreational runners and cyclists",
         "Train 3\u20136 times per week, plan sessions the night before, and have a phone but "
         "no coach. They are the primary user and the group the interface is designed for."),
        ("Hikers and walkers",
         "Have the largest duration uncertainty of any modality (this documentation reports "
         "40.5% MAPE for walking) and therefore benefit most from an honest range."),
        ("Beginner athletes with no history",
         "The cold-start case. The system must still produce a defensible estimate and must "
         "say so, rather than silently guessing."),
        ("Race-day planners",
         "Use the fueling output, not the duration output, as the primary artifact: a gel "
         "schedule pinned to the predicted finish time."),
    ]
    for lead, text in users:
        doc.bullet(text, bold_lead=lead + " \u2014 ")

    doc.h3("Required input")
    doc.table(
        ["Input", "Type", "Source", "Required?"],
        [
            ["activity_type", "categorical: run / ride / walk / hike", "User selection", "Yes"],
            ["distance_km", "float > 0", "User entry or drawn route", "Yes"],
            ["elevation_gain_m", "float \u2265 0", "User entry or route lookup", "No (defaults 0)"],
            ["history[]", "list of prior sessions (type, distance, duration, timestamp)",
             "Athlete\u2019s logged activities", "No (cold start allowed)"],
            ["weight_kg", "float", "Profile", "Yes for fueling"],
            ["sweat_profile", "categorical: low / normal / high", "Profile", "No (defaults normal)"],
            ["temperature_c", "float", "User entry or profile default", "No (defaults 26)"],
        ],
        caption="Model inputs. Only three are strictly required; everything else has a documented fallback.",
        widths=[1.35, 2.05, 1.85, 1.15],
        align_numeric=False,
    )

    doc.h3("Expected output")
    doc.p(
        "The system returns a duration in minutes (the q50 estimate), a lower bound (q10), an "
        "upper bound (q90), the basis string identifying which code path produced the answer "
        "(gradient_boosted_pace_factor or physics_fallback), and \u2014 where history exists \u2014 "
        "the reference curve parameters that the correction was applied to. The fueling block "
        "returns kcal, carbohydrate g/h, sodium mg/h, fluid ml/h, an intensity label, and a "
        "scheduled list of intake items at fixed intervals.",
        align="justify",
    )
    doc.code(
        '{\n'
        '  "minutes": 110.4,\n'
        '  "range": { "low": 92.1, "high": 131.8 },\n'
        '  "basis": "gradient_boosted_pace_factor",\n'
        '  "reference_curve": { "a": 2.71, "b": 1.06 },\n'
        '  "fueling": {\n'
        '    "kcal_total": 1180, "carbs_per_hour_g": 60, "sodium_per_hour_mg": 550,\n'
        '    "fluid_per_hour_ml": 650, "intensity": "moderate"\n'
        '  }\n'
        '}',
        caption="Illustrative response shape (values shown are representative, not a recorded call).",
    )

    doc.h3("Why this problem is suitable for a machine-learning approach")
    doc.p(
        "Four properties make supervised learning the right tool, and it is worth being "
        "explicit about them because a badly chosen problem is the most common reason a "
        "machine-learning project fails.",
        align="justify",
    )
    reasons = [
        ("A genuine target variable exists. ",
         "Duration is recorded to the minute in every activity log. There is no proxy, no "
         "human labelling, and no ambiguity: the target is measured, not inferred."),
        ("The relationship is non-linear and interacting. ",
         "Duration scales super-linearly with distance (Riegel\u2019s exponent is >1 [3]), grows "
         "with elevation gain per kilometre, and the penalty for climbing depends on the "
         "modality. Trees capture those interactions without hand-specifying them."),
        ("There is per-user signal worth personalising. ",
         "Two athletes of the same fitness differ by tens of percent at the same distance. A "
         "model that can condition on the athlete\u2019s own history can serve both."),
        ("Errors are asymmetric in cost, so uncertainty has value. ",
         "Under-predicting duration means under-fuelling. A quantile model that says "
         "\u201c110 minutes, likely between 92 and 132\u201d lets the athlete pack for 132. A point "
         "estimate does not."),
    ]
    for lead, text in reasons:
        doc.bullet(text, bold_lead=lead)

    doc.p(
        "It is equally worth stating what does not need machine learning. The fueling "
        "calculation is closed-form physiology \u2014 MET-based energy expenditure and ACSM/ISSN "
        "carbohydrate guidance. Attaching a neural network to a formula that already has a "
        "derivation would add opacity without adding accuracy, and for a health-facing "
        "feature that is a bad trade. The split in this project is therefore deliberate: "
        "learn what is genuinely empirical (duration), derive what is genuinely physical "
        "(fueling). Section 5.4 returns to this boundary.",
        align="justify",
    )

    doc.h3("Scope boundaries")
    doc.table(
        ["In scope", "Out of scope, and why"],
        [
            ["Duration prediction for run / ride / walk / hike",
             "Swimming and strength training have no distance-duration coupling to learn from"],
            ["Fueling targets in carbohydrate, sodium, fluid",
             "Individual sweat-sodium testing requires lab equipment the project does not have"],
            ["Activity logging, planning, analytics, goals",
             "Real-time GPS navigation during a session (crowded by mature competitors; not a "
             "machine-learning problem)"],
            ["External validation on an independent public dataset",
             "Collecting a primary dataset from real TRANA users \u2014 not available within the "
             "project timeline; Section 4.5 treats this as the principal limitation"],
            ["Held-out retraining study to test the data hypothesis",
             "Deploying the retrained GeoLife model to production \u2014 it cannot serve runs and "
             "hikes, which have almost no representation in GeoLife (n=2 runs in 4,362 rows)"],
        ],
        caption="Scope decisions, including the reasoning behind each exclusion.",
        widths=[2.7, 3.7],
        align_numeric=False,
    )
