"""Section 7 — Conclusion and appendices."""

from __future__ import annotations

from docx_engine import Doc


def build_section_7(doc: Doc) -> None:
    doc.h1("7. CONCLUSION")

    doc.p(
        "This project set out to build a predictive machine-learning application that "
        "forecasts how long an endurance activity will take and converts that forecast into a "
        "fuelling plan. It delivered that application, and along the way it produced something "
        "arguably more valuable: a rigorous account of what the model can and cannot do.",
        align="justify",
    )

    # -------------------------------------------------------------- 7.1
    doc.h2("7.1 Summary of the Completed Project")

    doc.p(
        "The system is a four-layer web application. A Svelte 5 progressive web app presents "
        "the interface and runs the exported model locally for instant previews. A Laravel 12 "
        "API handles authentication, validation, persistence, and orchestrates the prediction. "
        "A FastAPI service loads the trained artifact and serves predictions. PostgreSQL on "
        "Supabase stores the user data. The machine-learning component is a two-part "
        "architecture: a per-athlete Riegel reference curve fitted chronologically from the "
        "athlete\u2019s own history, multiplied by a learned pace-factor correction produced by "
        "three gradient-boosted quantile regressors.",
        align="justify",
    )

    doc.p(
        "The model was trained on an 8,845-row synthetic corpus and evaluated on 4,362 real GPS "
        "activities from 51 unseen volunteers in the Microsoft Research GeoLife dataset. It "
        "achieves a median absolute percentage error of 23.84% on that external data, with "
        "43.81% of predictions within 20% of the true duration, and it beats a population "
        "average by 17.8% in MAE. Its uncertainty intervals cover 16.96% of outcomes against a "
        "nominal 80% target.",
        align="justify",
    )

    doc.p(
        "Three further experiments turned that last number from an embarrassment into the "
        "project\u2019s main contribution. A paired ablation established that the learned "
        "correction is statistically indistinguishable from the reference curve it multiplies "
        "(MAE improvement \u22120.009 min, 95% CI [\u22120.019, +0.002]). A diagnosis traced the "
        "low coverage to the synthetic training distribution rather than to the architecture. A "
        "held-out user retraining study then tested that diagnosis directly and confirmed it: "
        "the same architecture trained on real data moves coverage from 15.94% to 67.83% while "
        "leaving accuracy unchanged across three seeds.",
        align="justify",
    )

    # -------------------------------------------------------------- 7.2
    doc.h2("7.2 What the Project Demonstrates")

    doc.p(
        "The template asks how the project demonstrates understanding of dataset preparation, "
        "model development, evaluation, and web application integration. The honest answer is "
        "that each of those four areas taught a different lesson, and three of the four lessons "
        "were uncomfortable.",
        align="justify",
    )

    doc.table(
        ["Area", "What was demonstrated", "The lesson"],
        [
            ["Dataset preparation",
             "A documented synthetic generator with explicit physical assumptions; a real "
             "external dataset processed into a comparable schema; a user-disjoint split with an "
             "executable overlap assertion; eight leakage vectors identified and closed",
             "The most important preparation step was admitting what the synthetic generator "
             "could not represent. The leakage discovery (source_path, mode_original) came from "
             "building the retraining study, not from planning it"],
            ["Model development",
             "A deliberately decomposed architecture (analytic curve \u00d7 learned residual) "
             "with three quantile models, bounded shrinkage, and guards against interval "
             "inversion and multiplicative blow-up",
             "Decomposition is powerful but it concentrates the learning problem: when the "
             "analytic part solves most of the target, the learned part has almost nothing left "
             "to learn"],
            ["Model evaluation",
             "Internal holdout, external validation on unseen users, a paired ablation with "
             "bootstrap intervals, and a held-out retraining study across three seeds",
             "The single most valuable evaluation decision was measuring interval coverage. "
             "Every point-accuracy metric looked acceptable; only coverage revealed the real "
             "defect"],
            ["Web application integration",
             "A deployed four-layer system with the same model artifact evaluated in Python and "
             "JavaScript, authenticated prediction orchestration, and an interface that "
             "advertises the validated rather than the flattering error",
             "Integration is where honesty becomes a product decision. It was easy to render "
             "\u00b15.5%; it took the whole evaluation study to earn the right to render \u00b124%"],
        ],
        caption="What each discipline area demonstrated, and the specific lesson it produced.",
        widths=[1.15, 2.55, 2.7],
        align_numeric=False,
        font_size=8,
    )

    # -------------------------------------------------------------- 7.3
    doc.h2("7.3 Knowledge and Skills Gained")

    doc.p("Seven competencies were built or substantially deepened during this work.", align="justify")

    skills = [
        ("Leakage-safe validation design. ",
         "Grouped splitting, chronological walk-forward evaluation, and the discipline of writing "
         "an executable assertion for a protocol rule rather than a comment. The specific insight "
         "\u2014 that a test can pass while the guard it was supposed to protect is disabled \u2014 "
         "came from mutation testing and is unlikely to be forgotten."),
        ("Building a target, not just a model. ",
         "The most consequential work was not fitting regressors. It was constructing a target "
         "(log pace factor relative to a personal curve) that made the learning problem "
         "stationary across thousands of different athletes."),
        ("Quantile regression for uncertainty. ",
         "Training three models instead of one, and then \u2014 critically \u2014 measuring whether "
         "the resulting interval was calibrated rather than assuming it. Learning that an "
         "interval can look narrow and plausible while covering 17% of outcomes is the kind of "
         "lesson that changes how one reads every confidence band thereafter."),
        ("Paired statistical comparison. ",
         "Comparing two models on identical rows and placing a bootstrap interval on the "
         "difference. The discipline of asking not \u201cis the number better?\u201d but \u201cis the "
         "improvement distinguishable from noise?\u201d turned a tempting 0.06-minute win into a "
         "correctly reported null result."),
        ("Honest reporting of negative results. ",
         "Writing up an ablation that shows your own learned component does not earn its place, "
         "and then diagnosing and fixing the underlying cause, is harder than writing up a "
         "success. It is also more useful to anyone reading the work."),
        ("Full-stack engineering at production quality. ",
         "Three languages, three test suites, CI across all of them, containerised deployment, "
         "authentication, rate limiting, and a progressive web app that works on a mid-range "
         "phone."),
        ("Writing code that can be audited. ",
         "Model cards that record training_source and calibration as explicit fields; report "
         "JSONs committed alongside the code; constants such as DROP_BEFORE_TRAINING declared at "
         "module level so a test can assert them; and the habit of citing file and line range "
         "when quoting code in documentation."),
    ]
    for lead, text in skills:
        doc.bullet(text, bold_lead=lead)

    # -------------------------------------------------------------- 7.4
    doc.h2("7.4 Challenges and How They Were Addressed")

    doc.table(
        ["Challenge", "How it arose", "How it was addressed"],
        [
            ["No real training data existed",
             "The product launched to an empty database; no public corpus of Filipino athletes\u2019 "
             "training logs exists",
             "Built a physics-informed synthetic generator encoding published formulas, and "
             "recorded its assumptions so the limitation was explicit rather than hidden"],
            ["The internal metric was meaningless",
             "The generator computes duration from distance and speed, so R\u00b2 0.9924 measured "
             "the generator",
             "Obtained an independent external dataset and made the external number the project\u2019s "
             "only accuracy claim; the internal number is reported once, captioned as tautological"],
            ["The external dataset had no usable elevation",
             "GeoLife\u2019s GPS altitude showed ~102 m/km of apparent gain against a true 5\u201315 m/km",
             "Zeroed elevation for both arms of every comparison rather than imputing; disclosed in "
             "the report\u2019s limitations block"],
            ["The learned component added nothing",
             "The ablation showed a near-unity multiplier and a CI straddling zero",
             "Reported it as a negative result, then designed the retraining study to test whether "
             "the cause was data or architecture"],
            ["Coverage was 4.7\u00d7 too narrow",
             "16.96% empirical coverage against 80% nominal",
             "Diagnosed as a training-distribution artefact; confirmed by a user-disjoint retraining "
             "study that moved coverage to 67.8\u201376.7%"],
            ["A leakage vector survived the tests",
             "Mutation testing showed an empty drop list still passed the suite",
             "Added a direct assertion on the constant; re-ran the mutation to confirm it was now "
             "caught"],
            ["The retrained model could not ship",
             "GeoLife contains 2 runs and 0 hikes",
             "Kept the synthetic model in production and documented the study as diagnostic; the "
             "measured coverage gain became the evidence for the honest error margin in the UI"],
            ["Interface advertised the wrong accuracy",
             "The front end read the model card\u2019s synthetic MAPE",
             "Replaced with per-modality constants derived from the GeoLife report, defined once in a "
             "single exported object with a comment explaining provenance"],
        ],
        caption="Eight challenges and the response to each. Four of them were discovered by the evaluation rather than anticipated in design.",
        widths=[1.35, 2.3, 2.75],
        align_numeric=False,
        font_size=8,
    )

    # -------------------------------------------------------------- 7.5
    doc.h2("7.5 Concluding Statement")

    doc.p(
        "The most useful thing this project produced is not the 23.84%. It is the chain of "
        "reasoning that leads to it: here is a model, here is a flattering number that measures "
        "the wrong thing, here is the honest number from data the model never saw, here is why "
        "the gap exists, and here is the experiment that proves the diagnosis. A group that "
        "reported 5.51% would have delivered a worse product and learned less.",
        align="justify",
    )
    doc.p(
        "The application works. It predicts a duration, shows an honest range around it, "
        "converts the forecast into a fuelling plan grounded in published physiology, and tells "
        "the user how wrong it might be. Where it is weak, it says so \u2014 in the interface, in "
        "the model card, and in this document. For a system that people will use to decide how "
        "far they can run before they run out of food, that is the right standard.",
        align="justify",
    )

    # ---------------------------------------------------------- APPENDIX A
    doc.h1("APPENDIX A. REPRODUCING THE RESULTS")
    doc.p(
        "Every number in this document can be regenerated. The commands below assume a "
        "checkout of the repository and a Python 3.11+ environment.",
        align="justify",
    )
    doc.code(
        "# 1. Environment\n"
        "python3 -m venv .venv && source .venv/bin/activate\n"
        "pip install -r ml/requirements.txt pytest\n"
        "\n"
        "# 2. Train the shipped model (synthetic corpus, seed 7)\n"
        "cd ml && python -m duration_model.train --source synth\n"
        "\n"
        "# 3. External validation on GeoLife (writes the honest accuracy figures)\n"
        "python -m evaluation.geolife_validation --json evaluation/reports/geolife_validation.json\n"
        "\n"
        "# 4. Ablation: does the learned correction earn its place?\n"
        "python -m evaluation.ablation --json evaluation/reports/ablation_report.json\n"
        "\n"
        "# 5. Held-out user retraining study (writes the coverage result)\n"
        "python -m evaluation.retrain_study --json evaluation/reports/retrain_study.json\n"
        "\n"
        "# 6. Full test suite\n"
        "pytest tests",
        caption="Reproduction commands, in dependency order.",
    )

    doc.table(
        ["Artifact", "Path", "What it contains"],
        [
            ["Model card", "ml/duration_model/model_card.json", "Version, metrics, feature importance, training source, calibration state"],
            ["External validation report", "ml/evaluation/reports/geolife_validation.json", "All GeoLife metrics by mode and by history depth"],
            ["Ablation report", "ml/evaluation/reports/ablation_report.json", "Paired bootstrap over curve vs. model"],
            ["Retraining study report", "ml/evaluation/reports/retrain_study.json", "Split metadata, both arms' scores, bootstrap, verdict"],
            ["Methodology document", "docs/ml-methodology.md", "Narrative form of the same findings"],
            ["Test report", "docs/test-report.md", "Per-layer test results and known gaps"],
            ["Browser model export", "frontend/public/models/duration_model.json", "349 KB tree ensemble consumed by the PWA"],
        ],
        caption="Where each reported number lives.",
        widths=[1.4, 2.3, 2.7],
        align_numeric=False,
        font_size=8,
    )

    # ---------------------------------------------------------- APPENDIX B
    doc.h1("APPENDIX B. COMPLETE METRIC TABLES")

    doc.h2("B.1 External validation \u2014 every slice")
    doc.table(
        ["Slice", "n", "MAE", "MAPE", "MdAPE", "W15%", "W20%", "R\u00b2", "Coverage"],
        [
            ["Overall", "4,362", "5.84", "35.87", "23.84", "33.43", "43.81", "0.414", "16.96"],
            ["Ride", "1,372", "5.14", "25.70", "19.66", "38.05", "50.80", "0.474", "20.12"],
            ["Walk", "2,988", "6.16", "40.55", "26.16", "31.29", "40.60", "0.386", "15.53"],
            ["Run", "2", "2.78", "28.21", "28.21", "50.00", "50.00", "\u2014", "0.00"],
            ["Cold start", "80", "11.80", "51.26", "45.67", "16.25", "22.50", "0.274", "13.75"],
            ["1 prior", "67", "12.51", "52.62", "24.49", "26.87", "41.79", "0.053", "19.40"],
            ["2+ prior", "4,215", "5.62", "35.31", "23.54", "33.86", "44.25", "0.423", "16.99"],
            ["In-domain", "543", "17.94", "59.28", "32.69", "24.68", "32.78", "\u22120.433", "12.15"],
        ],
        caption="Every slice from geolife_validation.json. Percentages are shown without the % sign for width.",
        widths=[1.1, 0.65, 0.6, 0.65, 0.65, 0.6, 0.6, 0.65, 0.7],
        align_numeric=True,
        font_size=8,
    )

    doc.h2("B.2 Retraining study \u2014 all three seeds")
    doc.table(
        ["Seed", "Arm", "n", "MAE", "MAPE", "MdAPE", "W20%", "R\u00b2", "Coverage"],
        [
            ["7", "Shipped", "1,085", "6.17", "36.74", "26.68", "38.71", "0.489", "15.94"],
            ["7", "Retrained", "1,085", "6.11", "35.26", "24.42", "42.49", "0.466", "67.83"],
            ["11", "Shipped", "1,858", "4.99", "\u2014", "19.90", "\u2014", "\u2014", "19.70"],
            ["11", "Retrained", "1,858", "4.86", "\u2014", "18.90", "\u2014", "\u2014", "76.70"],
            ["23", "Shipped", "729", "6.72", "\u2014", "25.40", "\u2014", "\u2014", "18.00"],
            ["23", "Retrained", "729", "6.59", "\u2014", "23.90", "\u2014", "\u2014", "70.40"],
        ],
        caption="Retraining results. Dashes indicate values not transcribed into the summary report for that seed.",
        widths=[0.55, 1.0, 0.65, 0.6, 0.65, 0.65, 0.6, 0.6, 0.7],
        align_numeric=True,
        font_size=8,
    )

    doc.h2("B.3 Ablation \u2014 full comparison")
    doc.table(
        ["Slice", "n", "Curve MAE", "Model MAE", "Pop. prior MAE", "Model vs. curve"],
        [
            ["Overall", "4,362", "5.83", "5.84", "7.10", "\u22120.2%"],
            ["Ride", "1,372", "5.07", "5.14", "9.49", "\u22121.4%"],
            ["Walk", "2,988", "6.18", "6.16", "6.01", "+0.3%"],
            ["Cold start", "80", "11.43", "11.80", "12.36", "\u22123.2%"],
            ["2+ prior", "4,215", "5.62", "5.62", "6.92", "0.0%"],
        ],
        caption="The ablation table as published in docs/ml-methodology.md.",
        widths=[1.3, 0.8, 1.1, 1.1, 1.4, 1.3],
        align_numeric=True,
        font_size=8.5,
    )

    doc.h2("B.4 Synthetic holdout \u2014 quoted only to be disclaimed")
    doc.table(
        ["Metric", "Value", "Status"],
        [
            ["R\u00b2", "0.9924", "TAUTOLOGICAL"],
            ["MAPE", "5.51%", "TAUTOLOGICAL"],
            ["MAE", "5.76 min", "Internal only"],
            ["RMSE", "14.13 min", "Internal only"],
            ["Coverage", "78.9%", "Internal only"],
        ],
        caption="Included so that a reader encountering these values in the model card finds their explanation in the same document.",
        widths=[1.5, 1.5, 2.4],
        align_numeric=False,
    )

    # ---------------------------------------------------------- APPENDIX C
    doc.h1("APPENDIX C. GLOSSARY")

    doc.table(
        ["Term", "Definition"],
        [
            ["MdAPE", "Median absolute percentage error. The median of |actual \u2212 predicted| / actual across all rows. Preferred over MAPE because it is not distorted by outliers."],
            ["Coverage", "The percentage of actual outcomes that fall inside the model\u2019s predicted interval. A well-calibrated 80% interval should cover about 80%."],
            ["Quantile regression", "Fitting a model to a conditional quantile rather than the conditional mean. Training alpha=0.10 and alpha=0.90 gives a central 80% interval."],
            ["Riegel curve", "The endurance relationship time \u221d distance^b, with b typically 1.06 for running. Fitted per athlete here as exp(a + b\u00b7ln d)."],
            ["Base minutes", "The output of the athlete\u2019s reference curve at the planned distance, before the learned correction is applied."],
            ["Pace factor", "The multiplicative correction exp(GBM(features)). A value of 1.0 means the curve is correct unmodified."],
            ["Cold start", "A prediction made with no prior sessions of that sport, using population speed constants."],
            ["Chronological walk-forward", "An evaluation protocol that predicts each activity using only earlier activities, then appends the actual outcome to the history."],
            ["Grouped split", "A train/test split that keeps all of one user\u2019s rows on one side, preventing memorisation of individuals."],
            ["Paired bootstrap", "Resampling the same rows for two models and computing the difference distribution, giving a confidence interval on the difference rather than on either model."],
            ["Ablation", "Removing a component and measuring whether performance degrades. Here, removing exp(GBM) to test whether the learned correction matters."],
            ["Leakage", "Information available at training time that would not be available at prediction time, producing optimistic validation."],
            ["MET", "Metabolic equivalent of task. One MET is roughly resting energy expenditure; energy \u2248 MET \u00d7 mass \u00d7 hours."],
            ["ACSM", "American College of Sports Medicine. Source of the metabolic equations used in the fuelling engine."],
            ["Tautological metric", "A score that measures the generator that produced the data rather than the real-world relationship. This project\u2019s synthetic R\u00b2 of 0.9924 is one."],
            ["Model card", "A JSON artifact recording a model\u2019s version, metrics, feature importance, training source, and calibration state, so it can be audited at a glance."],
            ["Calibration (interval)", "Post-hoc widening of a prediction interval so that its empirical coverage matches its nominal level. Present as a mechanism in this project; not applied to the shipped artifact."],
        ],
        caption="Terms used throughout this document.",
        widths=[1.4, 5.0],
        align_numeric=False,
        font_size=8.5,
    )

    doc.spacer(20)
    doc.p("END OF DOCUMENTATION", bold=True, align="center")
