"""Section 5 — Web Application Development and Output.

Screenshots are inserted as marked placeholders so the group can drop in real
captures; every placeholder names exactly what to capture.
"""

from __future__ import annotations

from docx_engine import Doc


def build_section_5(doc: Doc) -> None:
    doc.h1("5. WEB APPLICATION DEVELOPMENT AND OUTPUT")

    doc.p(
        "TRANA is not a notebook with a report attached. It is a deployed, authenticated web "
        "application in which the machine-learning model is one service among several. This "
        "section documents the architecture, then walks through the interface screen by screen.",
        align="justify",
    )

    # -------------------------------------------------------------- 5.1
    doc.h2("5.1 System Architecture")

    doc.code(
        "  Browser (Svelte 5 PWA)                     \u2500\u2500 runs the exported tree ensemble locally\n"
        "        \u2502  HTTPS / JSON                              for instant preview\n"
        "        \u25bc\n"
        "  Laravel 12 API (PHP 8.2)                   \u2500\u2500 auth, validation, persistence, throttling\n"
        "        \u2502  internal HTTP + bearer token\n"
        "        \u25bc\n"
        "  FastAPI inference service (Python)         \u2500\u2500 duration model + fuelling engine\n"
        "        \u2502  joblib artifact\n"
        "        \u25bc\n"
        "  PostgreSQL (Supabase)                     \u2500\u2500 users, activities, predictions, plans",
        caption="Four layers. The browser can compute a duration preview without any of the three below it.",
    )

    doc.p(
        "The separation of concerns is deliberate and worth justifying. The machine-learning "
        "service is Python because scikit-learn is Python. The API is Laravel because the "
        "application layer needs first-class authentication, validation, rate limiting, and an "
        "ORM \u2014 rebuilding those in FastAPI would have been a distraction from the machine "
        "learning. The front end is Svelte because a progressive web app needs to be small and "
        "fast on a mid-range Android phone, and Svelte compiles components away rather than "
        "shipping a runtime.",
        align="justify",
    )

    doc.table(
        ["Layer", "Responsibility", "Key files"],
        [
            ["Svelte PWA",
             "Routing, offline cache, all UI, local model evaluation for previews",
             "frontend/src/App.svelte, routes/index.js, lib/ml/duration.js"],
            ["Laravel API",
             "Sanctum auth, Google sign-in, activity CRUD, prediction orchestration, "
             "rate limiting, error reporting",
             "backend/routes/api.php, app/Services/PredictionService.php"],
            ["FastAPI service",
             "Loads the joblib bundle, serves /predict and /predict/duration, exposes /health "
             "and /model/info",
             "ml/api/main.py"],
            ["PostgreSQL", "Persistent store, row-level security via Supabase policies",
             "backend/database/migrations/"],
        ],
        caption="Layer responsibilities.",
        widths=[1.25, 2.85, 2.3],
        align_numeric=False,
        font_size=8.5,
    )

    doc.h3("5.1.1 The prediction request, end to end")

    flow = [
        ("The athlete sets the inputs. ",
         "Activity type, distance, elevation, and optionally a drawn route. A slider adjustment "
         "triggers a local computation from the exported trees, so the number updates "
         "immediately with no network call."),
        ("The athlete requests a plan. ",
         "The front end POSTs to /api/predictions. Rate limiting (throttle:predictions) protects "
         "the ML service from abuse."),
        ("Laravel assembles the payload. ",
         "PredictionService pulls the athlete\u2019s profile (weight, fitness level, sweat "
         "profile), their activity history, their fuel items, and their energy-expenditure "
         "calibration factor. If a route was drawn, RouteService measures it by haversine and "
         "that distance overrides any typed value."),
        ("Laravel calls FastAPI. ",
         "A bearer-token internal call with a 12-second timeout (ML_TIMEOUT). The duration "
         "service normalises the returned clock, pace, and intervals."),
        ("FastAPI predicts. ",
         "DurationModel.predict() fits the athlete\u2019s reference curve from the posted history, "
         "builds the nine features, walks the three tree ensembles, and composes the interval."),
        ("Fueling is computed. ",
         "The predicted duration and intensity drive the ACSM metabolic calculation and the "
         "carbohydrate/sodium/fluid targets, then the athlete\u2019s own kit is scheduled into "
         "intake items."),
        ("The prediction is persisted and returned. ",
         "The saved record stores the profile context that produced it, so every plan is "
         "reproducible after the fact."),
    ]
    for i, (lead, text) in enumerate(flow, start=1):
        doc.numbered(text, bold_lead=f"Step {i} \u2014 {lead}", marker="")

    doc.p(
        "Step 1 and step 5 deserve a note on consistency. The browser computes a preview from "
        "the same JSON trees the server uses, which means the number the athlete sees while "
        "dragging a slider is produced by the same model that will serve the final plan. The "
        "two paths are different implementations of the same arithmetic, and a smoke test "
        "asserts they agree.",
        align="justify",
    )

    # -------------------------------------------------------------- 5.2
    doc.h2("5.2 Interface Walkthrough")

    doc.p(
        "The screenshots below document the delivered application. Each is followed by a "
        "description of what it does and, where relevant, which part of the machine-learning "
        "system it surfaces.",
        align="justify",
    )

    doc.h3("5.2.1 Landing page")
    doc.figure_placeholder(
        "Landing page.",
        "Capture the public landing view at trana-web.vercel.app before signing in. Show the "
        "hero, the value proposition, and the sign-up call to action.",
    )
    doc.p(
        "The landing page is the only screen reachable without authentication. It states what "
        "the application predicts and routes to registration or sign-in. No machine-learning "
        "output appears here, which is deliberate: an accuracy claim before the user has seen a "
        "prediction would be a claim without context.",
        align="justify",
    )

    doc.h3("5.2.2 Registration and onboarding")
    doc.figure_placeholder(
        "Registration and onboarding.",
        "Two captures: (a) the registration form, (b) the onboarding step that collects weight, "
        "height, fitness level, and sweat profile. These four values are what the model "
        "conditions on for a new user.",
    )
    doc.p(
        "Onboarding collects exactly the attributes the model is allowed to see, plus the "
        "attributes fuelling needs. It is also where the cold-start experience begins: a new "
        "athlete has no activity history, so their first predictions are computed from the "
        "population prior and are explicitly the least accurate the system will ever be. The "
        "interface compensates by widening the displayed error margin.",
        align="justify",
    )

    doc.h3("5.2.3 Dashboard")
    doc.figure_placeholder(
        "Dashboard.",
        "Capture the signed-in dashboard with at least a few logged activities so the weekly "
        "summary, streak, and next-session card are populated.",
    )
    doc.p(
        "The dashboard is the default authenticated route. It summarises the current week "
        "(distance, duration, sessions), shows goal progress, and surfaces the most recent "
        "prediction. It is the screen that makes the application feel like a training tool "
        "rather than a form.",
        align="justify",
    )

    doc.h3("5.2.4 Plan Activity \u2014 the primary machine-learning surface")
    doc.figure_placeholder(
        "Plan Activity screen with a duration prediction.",
        "THE MOST IMPORTANT CAPTURE. Show the activity-type selector, distance and elevation "
        "inputs, the predicted duration in minutes, the lower and upper bounds, and the \u00b1 "
        "error badge with its tooltip visible if possible.",
    )
    doc.p(
        "This is where the model is visible to the user. Four inputs produce a duration with a "
        "range. The error badge shows the externally validated margin for the selected modality "
        "\u2014 25.7% for rides, 40.5% for walks and hikes \u2014 and its tooltip explains that the "
        "figure comes from validation against real GPS data, not from the training set.",
        align="justify",
    )
    doc.p(
        "The range deserves close attention because it is the interface-level consequence of "
        "everything in Section 4. The model does produce its own q10\u2013q90 interval, and that "
        "interval covers the truth only 16.96% of the time. Displaying it would state a "
        "precision the model has never demonstrated. The interface therefore discards the "
        "model\u2019s own band and displays a measured one instead:",
        align="justify",
    )
    doc.code(
        "const errorFraction = validatedErrorFraction(activityType, historyCount);\n"
        "const honestLow  = Math.max(1, median * (1 - errorFraction));\n"
        "const honestHigh = median * (1 + errorFraction);\n"
        "\n"
        "return {\n"
        "  minutes: ..., low: <q10>, high: <q90>,          // model's own band (not displayed)\n"
        "  validatedLow, validatedHigh, validatedErrorPct, // measured band (displayed)\n"
        "  rangeBasis: 'geolife_validated',\n"
        "};",
        caption="frontend/src/lib/ml/duration.js L424\u2013437 \u2014 the model\u2019s quantile band is returned for diagnostics, but the UI renders the validated band.",
    )
    doc.p(
        "This is a deliberate two-track design and it is worth naming as such. The q10/q90 "
        "band remains in the payload for monitoring and for the ablation, where its narrowness "
        "is the finding. What the athlete reads is the measured error band, widened further for "
        "thin history. A smoke test (validated-range-smoke.mjs) pins the relationship so the "
        "honest band can never silently collapse back to the synthetic one.",
        align="justify",
    )

    doc.h3("5.2.5 Route drawing")
    doc.figure_placeholder(
        "Route planner.",
        "Capture the map view with a drawn route showing the computed distance and elevation "
        "gain being carried into the prediction inputs.",
    )
    doc.p(
        "An athlete who does not know their planned distance can draw the route on a map. The "
        "distance is measured by haversine along the drawn path, and elevation gain is "
        "retrieved from a Copernicus GDEM lookup via Open-Meteo. This is the one place where a "
        "third-party elevation source feeds the model, and it matters: elevation per kilometre "
        "is the model\u2019s highest-importance feature (0.685), so the quality of this lookup "
        "directly affects prediction quality.",
        align="justify",
    )

    doc.h3("5.2.6 Fueling plan")
    doc.figure_placeholder(
        "Fueling plan output.",
        "Capture the fuelling block: kcal total, carbohydrate g/h, sodium mg/h, fluid ml/h, the "
        "intensity label, and the scheduled intake items (gels, bottles, capsules) with times.",
    )
    doc.p(
        "The fuelling output is the second half of the product and, in user terms, arguably the "
        "more actionable half. Given a predicted 110-minute ride at moderate intensity, it "
        "returns a per-hour carbohydrate target, a sodium target adjusted for sweat profile and "
        "temperature, a fluid target, and a schedule of specific items from the athlete\u2019s own "
        "kit at fixed intervals.",
        align="justify",
    )
    doc.p(
        "It is important for the integrity of this documentation to state clearly what this "
        "block is not. It is not machine learning. It is a closed-form physiological calculation "
        "\u2014 MET \u00d7 mass \u00d7 hours for energy, ACSM/ISSN carbohydrate guidance for intake, and "
        "a sweat-profile lookup for sodium and fluid. Every number traces to a published "
        "formula. Section 5.4 explains why that boundary was drawn deliberately.",
        align="justify",
    )

    doc.h3("5.2.7 Activity logging and history")
    doc.figure_placeholder(
        "Track and History screens.",
        "Two captures: (a) an in-progress or completed tracked session, (b) the history list "
        "showing several logged activities with type, distance, duration, and date.",
    )
    doc.p(
        "Logging is what closes the feedback loop. Every session an athlete records becomes "
        "history, and history is what the reference curve is fitted from. The model literally "
        "improves as the athlete uses the application, which is why the accuracy table by "
        "history depth (Section 4.2.4) shows MAE halving between the first session and the "
        "fifth.",
        align="justify",
    )

    doc.h3("5.2.8 Analytics")
    doc.figure_placeholder(
        "Analytics screen.",
        "Capture the trend charts: weekly volume, pace trend by modality, and the acute:chronic "
        "workload ratio panel.",
    )
    doc.p(
        "Analytics is descriptive, not predictive, and the documentation is explicit about that "
        "distinction. The acute:chronic workload ratio shown here is a plain rolling arithmetic "
        "ratio over the last 7 and 28 days \u2014 a well-established sports-science heuristic, "
        "but not a machine-learning output. It is included because athletes expect it, not "
        "because the project claims it as a model.",
        align="justify",
    )

    doc.h3("5.2.9 Goals and calendar")
    doc.figure_placeholder(
        "Goals and calendar.",
        "Two captures: (a) the goal-setting screen with a weekly distance or session target, "
        "(b) the calendar with planned sessions distributed across the month.",
    )
    doc.p(
        "Goals and the calendar turn predictions into a training plan. A planned session on the "
        "calendar carries its predicted duration and fuelling plan with it, so the athlete can "
        "see the week\u2019s total predicted load before committing to it.",
        align="justify",
    )

    doc.h3("5.2.10 Admin and preview surfaces")
    doc.figure_placeholder(
        "Admin and model preview.",
        "Two captures: (a) the admin dashboard showing model version and internal metrics, "
        "(b) the /preview route demonstrating the model with adjustable inputs.",
    )
    doc.p(
        "The admin surface shows the model card: version, R\u00b2, MAPE, and the \u201c80% band\u201d "
        "coverage figure. Those are internal monitoring numbers computed on the synthetic "
        "split, and Section 4.4.4 flags that a future iteration should label them as internal "
        "so they are not mistaken for user-facing accuracy claims. The /preview route exists "
        "for demonstration: it lets a presenter vary distance and elevation live and watch "
        "both the prediction and the interval move.",
        align="justify",
    )

    # -------------------------------------------------------------- 5.3
    doc.h2("5.3 Engineering Quality")

    doc.p(
        "The application is supported by an automated test suite at every layer, because a "
        "prediction pipeline that silently returns a stale number is worse than one that fails "
        "loudly.",
        align="justify",
    )

    doc.table(
        ["Layer", "Test suite", "Count", "What it protects"],
        [
            ["Machine learning", "pytest, ml/tests/", "107 tests",
             "Feature contract, chronological leakage, quantile ordering, retraining protocol, "
             "CSV round-trip, split disjointness"],
            ["Backend API", "PHPUnit, backend/tests/", "20 feature + 1 unit",
             "Auth, activity CRUD, prediction orchestration, throttling, account deletion"],
            ["Front end", "Node smoke scripts, frontend/scripts/", "37 scripts",
             "Routing, model parity with Python, mobile layout, auth duplication, error "
             "monitoring, elevation guard"],
            ["CI", "GitHub Actions", "3 jobs",
             "ML tests, API tests, and a full frontend build run on every pull request"],
        ],
        caption="Test coverage by layer. The ML suite grew from 91 to 107 tests during the retraining study.",
        widths=[1.15, 1.9, 1.1, 2.25],
        align_numeric=False,
        font_size=8.5,
    )

    doc.p(
        "Two testing practices from this project are worth documenting because they changed the "
        "code. Mutation testing was used on the retraining study: the protocol was deliberately "
        "broken in four ways (row-level split instead of user-level, empty drop list, rolled "
        "predictions, always-claim-a-win) and the tests were checked for whether they noticed. "
        "Three of the four were caught immediately. The empty drop list survived \u2014 meaning a "
        "test could pass while the leakage guard was disabled \u2014 which led to adding a direct "
        "assertion on the constant itself rather than relying on an end-to-end test to imply it.",
        align="justify",
    )
    doc.p(
        "The second practice is determinism as a test. The retraining study was re-run from "
        "scratch and required to produce byte-identical numbers. It did: shipped 6.17 / 26.7% / "
        "15.9% / R\u00b2 0.489 and retrained 6.11 / 24.4% / 67.8% / R\u00b2 0.466, reproduced "
        "exactly. A study whose numbers cannot be reproduced is an anecdote.",
        align="justify",
    )

    # -------------------------------------------------------------- 5.4
    doc.h2("5.4 Design Decision: Where Machine Learning Stops")

    doc.p(
        "One architectural boundary in this system deserves explicit defence, because a reader "
        "could reasonably ask why the project did not apply machine learning to the fuelling "
        "prediction as well.",
        align="justify",
    )
    doc.p(
        "The fuelling engine is deterministic because the relationship it encodes is already "
        "known. Energy expenditure follows MET \u00d7 mass \u00d7 hours. Carbohydrate oxidation "
        "during exercise follows well-established duration and intensity bands. Sweat sodium "
        "loss correlates with measurable sweat rate and concentration. These are published "
        "physiological relationships with derivations, not empirical patterns waiting to be "
        "discovered. Wrapping them in a learned model would add opacity, add a training data "
        "requirement the project does not have, and add failure modes \u2014 in exchange for no "
        "accuracy gain, because there is nothing to learn that is not already known.",
        align="justify",
    )
    doc.p(
        "Duration is the opposite case. There is no closed-form equation that says how long "
        "this particular athlete will take over this particular terrain on this particular day. "
        "The relationship must be estimated from data. That is what makes it a legitimate "
        "machine-learning target.",
        align="justify",
    )
    doc.table(
        ["Component", "Method", "Justification"],
        [
            ["Activity duration", "Learned: gradient-boosted quantile regression",
             "No analytic form exists; per-athlete variation dominates; empirical estimation is the only route"],
            ["Fueling targets", "Derived: ACSM MET equations, ISSN carbohydrate guidance",
             "Closed-form physiology with published derivations; a learned model would add opacity without accuracy"],
            ["ACWR (analytics)", "Derived: rolling 7-day / 28-day arithmetic ratio",
             "A standard sports-science heuristic; presented descriptively, not as a prediction"],
            ["Reference curve", "Fitted per athlete: weighted Ridge on Riegel form",
             "Four or five parameters from a handful of sessions; a per-user neural network would be unidentifiable"],
        ],
        caption="The boundary between learned and derived components, and the reason for each side.",
        widths=[1.4, 2.4, 2.6],
        align_numeric=False,
        font_size=8.5,
    )
    doc.p(
        "This boundary is not a limitation of ambition. Deciding which parts of a system should "
        "learn and which should compute is the central design judgement in applied machine "
        "learning, and getting it wrong in the direction of \u201clearn everything\u201d is a common "
        "and expensive failure.",
        align="justify",
    )
