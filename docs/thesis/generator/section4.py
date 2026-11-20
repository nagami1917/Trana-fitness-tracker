"""Section 4 — Model Evaluation and Interpretation."""

from __future__ import annotations

from docx_engine import Doc


def build_section_4(doc: Doc) -> None:
    doc.h1("4. MODEL EVALUATION AND INTERPRETATION")

    doc.p(
        "This section reports four separate experiments. They are presented in the order they "
        "were run, because each one raised the question that the next one answered.",
        align="justify",
    )

    doc.table(
        ["#", "Experiment", "Question", "Answer"],
        [
            ["1", "Internal holdout", "Does the model fit the training distribution?",
             "Yes, R\u00b2 0.9924 \u2014 but tautologically so"],
            ["2", "External validation on GeoLife", "How accurate is it on real, unseen people?",
             "\u00b123.84% median error, R\u00b2 0.414"],
            ["3", "Ablation vs. the reference curve", "Does the learned correction earn its place?",
             "No \u2014 statistically indistinguishable from the curve alone"],
            ["4", "Held-out user retraining study", "Is the gap a data problem or a model problem?",
             "Data. Coverage 15.94% \u2192 67.83% with no accuracy change"],
        ],
        caption="The four experiments and the chain of reasoning that connects them.",
        widths=[0.3, 1.7, 2.1, 2.3],
        align_numeric=False,
    )

    # -------------------------------------------------------------- 4.1
    doc.h2("4.1 Evaluation Metrics")

    doc.p(
        "Six metrics are reported, and each one is included because it answers a question the "
        "others cannot [12]. Reporting only R\u00b2, or only MAPE, would have hidden the most "
        "interesting findings in this project.",
        align="justify",
    )

    doc.table(
        ["Metric", "Definition", "Why it is appropriate here"],
        [
            ["MAE (minutes)",
             "mean(|actual \u2212 predicted|)",
             "Interpretable in the unit the athlete cares about. Mean absolute error answers "
             "\u201chow many minutes off am I, typically?\u201d without the squaring that lets one "
             "long ride dominate."],
            ["MAPE (%)",
             "mean(|actual \u2212 predicted| / actual) \u00d7 100",
             "Scale-free, so a 40-minute run and a 200-minute ride contribute comparably. "
             "Included for comparability with published work, but it is inflated by short "
             "activities."],
            ["MdAPE (%)",
             "median(|actual \u2212 predicted| / actual) \u00d7 100",
             "The honest headline. Unlike MAPE, one catastrophic outlier cannot move it. This "
             "is the figure the interface quotes."],
            ["Within-15% / within-20%",
             "% of predictions inside the tolerance",
             "The practical question: \u201chow often is the estimate good enough to plan "
             "around?\u201d A percentage of hits is easier to interpret than any error average."],
            ["R\u00b2",
             "1 \u2212 SS_res / SS_tot",
             "Variance explained. Useful for comparison with the baselines, but it punishes "
             "long-distance errors heavily and can go negative when the model beats a weak "
             "baseline on mean but not on variance."],
            ["Interval coverage (%)",
             "% of actuals falling inside [q10, q90]",
             "The single most diagnostic metric in this project. Against a nominal 80% target, "
             "it measures whether the model\u2019s uncertainty is calibrated \u2014 a question no "
             "point-accuracy metric can answer."],
        ],
        caption="Why each metric is present. The last row is what exposed the project\u2019s central finding.",
        widths=[1.2, 1.9, 3.3],
        align_numeric=False,
        font_size=8.5,
    )

    doc.p(
        "Two metrics are deliberately absent. RMSE is computed and stored in the reports but is "
        "not used for model comparison, because squaring gives a handful of long rides "
        "disproportionate influence over a metric intended to summarise typical performance. "
        "Mean signed error (bias) is reported only implicitly: the project cares about magnitude "
        "of error more than direction, because an athlete planning a session budgets from the "
        "upper bound regardless of which side the median error falls on.",
        align="justify",
    )

    doc.h3("4.1.1 Why interval coverage is the key metric")

    doc.p(
        "A duration model that says \u201c110 minutes\u201d is making an implicit claim: that the "
        "true answer is 110. A model that says \u201c110 minutes, 80% likely between 92 and 132\u201d "
        "is making a falsifiable claim that can be checked on data. Count how often the actual "
        "duration falls inside the band. If it is close to 80%, the uncertainty is calibrated "
        "and the athlete can trust the range. If it is 17%, the range is a lie, and packing for "
        "the upper bound does not protect against anything.",
        align="justify",
    )
    doc.p(
        "This is why coverage, rather than accuracy, drove the second half of the project. The "
        "shipped model\u2019s coverage is 16.96% \u2014 a 4.7\u00d7 shortfall against its own nominal "
        "promise. That single number is what motivated the ablation, and then the retraining "
        "study, and finally the decision to advertise a wider \u00b124% error margin in the user "
        "interface.",
        align="justify",
    )

    # -------------------------------------------------------------- 4.2
    doc.h2("4.2 Model Evaluation Results")

    doc.h3("4.2.1 Internal holdout \u2014 for completeness, and with a warning")

    doc.table(
        ["Metric", "Result", "Status"],
        [
            ["MAE", "5.76 min", "Not a real-world measure"],
            ["RMSE", "14.13 min", "Not a real-world measure"],
            ["R\u00b2", "0.9924", "TAUTOLOGICAL \u2014 do not quote"],
            ["MAPE", "5.51%", "TAUTOLOGICAL \u2014 do not quote"],
            ["Interval coverage", "78.9%", "Close to nominal 80%, but on synthetic data"],
            ["Train / test rows", "7,011 / 1,834", "\u2014"],
        ],
        caption="Internal holdout results. These appear in the model card and in the Admin dashboard, and they overstate real-world performance by a factor of roughly four. See Section 2.1.1 for why.",
        widths=[1.5, 1.7, 3.2],
        align_numeric=False,
    )

    doc.p(
        "This table exists in the documentation for one reason: a reader who finds R\u00b2 0.9924 "
        "in the model card must also find, in the same document, an explanation of why that "
        "number cannot be used. The synthetic generator computes the target from distance and "
        "speed, and the model receives distance and speed-equivalent features. It is recovering "
        "an equation it was handed, not learning the world. The 78.9% coverage is similarly "
        "uninformative: the quantile models fit the generator\u2019s imposed noise, which is "
        "Gaussian by construction, so their intervals are calibrated to a distribution no real "
        "athlete follows.",
        align="justify",
    )

    doc.h3("4.2.2 External validation on GeoLife \u2014 the honest headline")

    doc.p(
        "This is the number the project stands behind. The shipped model, unchanged, evaluated "
        "on 4,362 real GPS activities from 51 people it had never seen, with per-user "
        "chronological walk-forward and elevation zeroed:",
        align="justify",
    )

    doc.table(
        ["Metric", "Result", "Reading"],
        [
            ["Activities evaluated", "4,362", "51 users, 2007\u20132011"],
            ["MAE", "5.84 min", "Typical absolute error in minutes"],
            ["MdAPE", "23.84%", "THE HEADLINE ACCURACY FIGURE"],
            ["MAPE", "35.87%", "Inflated by short activities"],
            ["Within 15%", "33.43%", "One prediction in three lands within 15%"],
            ["Within 20%", "43.81%", "Just under half land within 20%"],
            ["R\u00b2", "0.414", "Explains 41% of variance in real data"],
            ["Interval coverage", "16.96%", "Against 80% nominal \u2014 a 4.7\u00d7 shortfall"],
            ["MAE vs. population prior", "17.8% better", "5.84 vs. 7.10 min"],
            ["MAE vs. reference curve", "\u22120.1% (worse)", "5.84 vs. 5.83 min \u2014 the correction adds nothing"],
        ],
        caption="External validation results on GeoLife. The gap between the 23.84% here and the 5.51% in Table 4.3 is the measure of how much the synthetic evaluation flattered the model.",
        widths=[1.6, 1.4, 3.4],
        align_numeric=False,
    )

    doc.quote(
        "The claim this project makes",
        "TRANA predicts activity duration with a median absolute error of 23.84% on real, "
        "unseen GPS data, and 43.81% of its predictions fall within 20% of the true duration. "
        "It is meaningfully better than a population average (17.8% lower MAE) and equivalent "
        "to a personalised reference curve. Its uncertainty intervals are not yet trustworthy "
        "on this training distribution, and the interface compensates by advertising a wider "
        "error margin than the model would otherwise claim.",
    )

    doc.h3("4.2.3 Performance by modality")

    doc.table(
        ["Modality", "n", "MAE (min)", "MdAPE", "Within 15%", "Within 20%", "R\u00b2", "Coverage"],
        [
            ["Ride", "1,372", "5.14", "19.66%", "38.05%", "50.80%", "0.474", "20.12%"],
            ["Walk", "2,988", "6.16", "26.16%", "31.29%", "40.60%", "0.386", "15.53%"],
            ["Run", "2", "2.78", "28.21%", "50.00%", "50.00%", "\u2014", "0.00%"],
            ["All", "4,362", "5.84", "23.84%", "33.43%", "43.81%", "0.414", "16.96%"],
        ],
        caption="Per-modality results. The run row is reported for completeness only \u2014 n=2 cannot support a conclusion, and no claim in this document rests on it.",
        widths=[0.9, 0.6, 0.85, 0.8, 0.8, 0.85, 0.6, 0.8],
        align_numeric=True,
        font_size=8.5,
    )

    doc.p(
        "Cycling is the strongest modality by every measure: 19.66% median error, over half of "
        "predictions within 20%, and the highest R\u00b2. This is expected. Cycling pace is "
        "comparatively stable, terrain dominates over fatigue for most recreational rides, and "
        "GeoLife rides are comparatively short (the longest is 19.6 km, against a synthetic "
        "training range that reaches 150 km), so the evaluation is measuring the part of the "
        "problem where the curve is best identified.",
        align="justify",
    )
    doc.p(
        "Walking is the weakest, at 26.16% median error, and the project reports that without "
        "softening it. The reason is largely definitional: a GeoLife \u201cwalk\u201d is door-to-door "
        "movement that includes pauses, window shopping, and waiting, whereas a TRANA walk is a "
        "deliberate exercise session. Two people walking 2 km at the same speed can differ by "
        "40% in elapsed time depending on what they stopped to do. No model can predict the "
        "number of shop windows. This is a genuine limitation of the external dataset\u2019s "
        "definition, and it is one reason the interface advertises 40.5% error for walking and "
        "hiking rather than the headline 23.8%.",
        align="justify",
    )

    doc.h3("4.2.4 Performance by history depth")

    doc.table(
        ["History depth", "n", "MAE (min)", "MAPE", "MdAPE", "R\u00b2", "Coverage"],
        [
            ["Cold start (0 prior)", "80", "11.80", "51.26%", "45.67%", "0.274", "13.75%"],
            ["Thin history (1 prior)", "67", "12.51", "52.62%", "24.49%", "0.053", "19.40%"],
            ["Personalised (2+ prior)", "4,215", "5.62", "35.31%", "23.54%", "0.423", "16.99%"],
        ],
        caption="Error by amount of personal history. The cold-start penalty is real and is disclosed to the user.",
        widths=[1.5, 0.6, 0.85, 0.8, 0.75, 0.6, 0.8],
        align_numeric=True,
        font_size=8.5,
    )

    doc.p(
        "The personalisation claim is supported: with two or more prior sessions of the same "
        "sport, MAE halves from 11.80 to 5.62 minutes. That is the strongest evidence in the "
        "project that the per-athlete curve is doing real work, and it is the one place where "
        "the architecture\u2019s design intent is measurably vindicated.",
        align="justify",
    )
    doc.p(
        "The cold-start MAPE of 51.26% is what the interface is built around. Rather than "
        "pretending a new user\u2019s estimate is as good as an established user\u2019s, the frontend "
        "multiplies the advertised error by a factor derived from these very numbers "
        "(THIN_HISTORY_MULTIPLIER: 1.27\u00d7 with no history, 1.30\u00d7 with one session, 1.0\u00d7 "
        "thereafter). The user sees a wider range before they have data and a tighter one "
        "after, and both numbers trace back to this table.",
        align="justify",
    )

    doc.h3("4.2.5 The in-domain slice \u2014 a result that went the wrong way")

    doc.table(
        ["Slice", "n", "MAE (min)", "MdAPE", "R\u00b2", "vs. population prior"],
        [
            ["In-training-domain", "543", "17.94", "32.69%", "\u22120.433", "4.1% WORSE"],
            ["Everything else", "3,819", "4.12", "\u2014", "\u2014", "\u2014"],
        ],
        caption="The in-domain slice, defined as walks \u2265 1.5 km, rides \u2265 10 km, or any run. R\u00b2 goes negative, which means the model is worse than predicting the mean.",
        widths=[1.9, 0.7, 1.0, 0.9, 0.9, 1.5],
        align_numeric=True,
        font_size=8.5,
    )

    doc.p(
        "This slice was defined to test the hypothesis that the model would do better on "
        "activities resembling its training distribution \u2014 longer distances, the kind of "
        "session an athlete actually plans. It does not. On 543 activities that sit squarely "
        "inside the intended use case, MAE rises to 17.94 minutes and R\u00b2 goes negative "
        "(\u22120.433), meaning the predictions there are worse than simply guessing the mean "
        "duration.",
        align="justify",
    )
    doc.p(
        "The result is reported rather than dropped for the obvious reason: it is inconvenient "
        "and it is real. Its most plausible explanation is that these 543 rows are dominated by "
        "long GeoLife rides and walks where elapsed time diverges most from exercise time \u2014 "
        "the same definitional mismatch that hurts the walking slice, concentrated at the "
        "distances where elapsed time has the most room to drift. It is also the strongest "
        "single piece of evidence that the synthetic training corpus does not represent the "
        "real-duration distribution, which is precisely the hypothesis the retraining study "
        "(Section 4.3) was built to test.",
        align="justify",
    )

    # -------------------------------------------------------------- 4.3
    doc.h2("4.3 Model Comparison Results")

    doc.h3("4.3.1 Ablation \u2014 does the learned correction earn its place?")

    doc.p(
        "The ablation scores the population prior, the personalised curve, and the shipped "
        "model on identical chronological rows, so the comparison is paired by construction. "
        "Because the rows are the same, the difference in MAE is a difference between two "
        "predictions of the same event, not a difference between two samples \u2014 which is what "
        "makes a paired bootstrap valid here.",
        align="justify",
    )

    doc.table(
        ["Slice", "n", "Curve MAE", "Model MAE", "Population prior MAE", "Model vs. curve"],
        [
            ["Overall", "4,362", "5.83", "5.84", "7.10", "\u22120.2%"],
            ["Ride", "1,372", "5.07", "5.14", "9.49", "\u22121.4%"],
            ["Walk", "2,988", "6.18", "6.16", "6.01", "+0.3%"],
            ["Cold start", "80", "11.43", "11.80", "12.36", "\u22123.2%"],
            ["\u22652 prior activities", "4,215", "5.62", "5.62", "6.92", "0.0%"],
        ],
        caption="Ablation results. Negative means the model is worse than the curve alone.",
        widths=[1.7, 0.75, 1.05, 1.05, 1.5, 1.25],
        align_numeric=True,
        font_size=8.5,
    )

    doc.p(
        "Paired bootstrap, 2,000 resamples of the 4,362 rows: the model\u2019s MAE improvement "
        "over the curve is \u22120.009 minutes, 95% CI [\u22120.019, +0.002]. The interval straddles "
        "zero, and the model wins only 5.3% of draws \u2014 worse than a coin flip. In plain "
        "language: the learned correction is statistically indistinguishable from doing nothing.",
        align="justify",
    )

    doc.p(
        "The mechanism is visible in the multiplier itself. Across those 4,362 activities, "
        "exp(GBM q50) has a median of 0.9904, ranges from 0.8823 to 1.0239, and has a standard "
        "deviation of 0.0167. 35.9% of predictions land within 1% of unity. At most the model "
        "moves a prediction by +2.4% or \u221211.8%. A correction confined to that band cannot "
        "repair a 23.8% median error, and the ablation measures precisely that.",
        align="justify",
    )

    doc.table(
        ["Statistic on exp(GBM q50)", "Value", "Interpretation"],
        [
            ["Median", "0.9904", "The typical correction is about \u22121%"],
            ["Standard deviation", "0.0167", "Extremely tight distribution"],
            ["Minimum observed", "0.8823", "\u221211.8% at the extreme"],
            ["Maximum observed", "1.0239", "+2.4% at the extreme"],
            ["Within \u00b11% of unity", "35.9% of predictions", "More than a third are essentially untouched"],
            ["Clamp bounds [0.7, 3.0]", "never approached", "The guard is inert on this artifact"],
        ],
        caption="The learned multiplier on real data. Its narrowness is the diagnosis, not a defect of measurement.",
        widths=[2.0, 1.4, 3.0],
        align_numeric=False,
    )

    doc.p(
        "Two consequences follow, and both are recorded in the methodology document. First, the "
        "[0.7, 3.0] clamp is inert \u2014 it is a guard against a retrained artifact going wild, "
        "not a shaper of today\u2019s output. Second, on walks the correction is actively "
        "unhelpful: the curve beats the population prior by 2.8% on walks, and the model gives "
        "some of that back (+0.3% versus the curve).",
        align="justify",
    )

    doc.quote(
        "Why this is a contribution, not a failure",
        "The ablation does not say the machine learning is broken. It says the machine learning "
        "was pointed at a target that was already solved by an analytic formula, on a training "
        "distribution that does not resemble real data. That is a specific, testable diagnosis, "
        "and it is the diagnosis the retraining study was designed to act on \u2014 which is why "
        "the next experiment moved coverage by 52 percentage points.",
    )

    doc.h3("4.3.2 Held-out user retraining study \u2014 is the gap a data problem?")

    doc.p(
        "The study asks one question: does training on real GPS data beat training on the "
        "synthetic corpus, measured on people neither model has seen? The protocol is strict, "
        "and the strictness is the point.",
        align="justify",
    )

    doc.table(
        ["Protocol element", "Choice", "Why"],
        [
            ["Split", "70 / 30 by user_id", "No person appears on both sides"],
            ["Train / holdout", "36 users / 15 users", "3,277 / 1,085 rows"],
            ["Dropped columns", "source_path, mode_original", "Leakage vectors discovered during the study"],
            ["Training invocation", "duration_model.train --source csv", "Same trainer, same hyperparameters as production"],
            ["Evaluation", "Per-user chronological walk-forward", "Identical to geolife_validation, so the shipped arm reproduces the published report"],
            ["Bootstrap", "2,000 paired draws", "Interval on the MAE difference"],
            ["Seeds", "7, 11, 23", "Split sensitivity. SEED is a module constant, so each seed was run in turn; the committed report is seed 7"],
            ["Elevation", "0 for both arms", "Not recorded in GeoLife"],
        ],
        caption="Retraining study protocol.",
        widths=[1.5, 1.9, 3.0],
        align_numeric=False,
        font_size=8.5,
    )

    doc.table(
        ["Seed", "n", "Shipped MAE / MdAPE / coverage", "Retrained MAE / MdAPE / coverage", "Paired 95% CI on MAE diff"],
        [
            ["7", "1,085", "6.17 / 26.68% / 15.94%", "6.11 / 24.42% / 67.83%", "[\u22120.071, +0.184]"],
            ["11", "1,858", "4.99 / 19.90% / 19.70%", "4.86 / 18.90% / 76.70%", "[\u22120.044, +0.301]"],
            ["23", "729", "6.72 / 25.40% / 18.00%", "6.59 / 23.90% / 70.40%", "[\u22120.181, +0.484]"],
        ],
        caption="Retraining study results across three seeds. Every confidence interval straddles zero on accuracy; every one shows a large coverage gain.",
        widths=[0.5, 0.7, 1.85, 1.9, 1.45],
        align_numeric=False,
        font_size=8.5,
    )

    doc.p(
        "The verdict is identical across all three seeds: no measurable difference in MAE. The "
        "retrained model is nominally better on every seed \u2014 6.11 vs. 6.17, 4.86 vs. 4.99, "
        "6.59 vs. 6.72 \u2014 but every interval includes zero, and the largest improvement is "
        "0.13 minutes on a 6-minute typical error. Claiming a win here would be over-reading "
        "noise.",
        align="justify",
    )

    doc.p(
        "What did change, dramatically and consistently, is interval coverage. On seed 7 it "
        "moved from 15.94% to 67.83%. On seed 11, from 19.70% to 76.70% \u2014 essentially "
        "calibrated. On seed 23, from 18.00% to 70.40%. That is a 50-point swing on a metric "
        "the synthetic model was failing by a factor of nearly five.",
        align="justify",
    )

    doc.table(
        ["Metric", "Shipped (seed 7)", "Retrained (seed 7)", "Change"],
        [
            ["MAE (min)", "6.17", "6.11", "\u22120.06 (n.s.)"],
            ["MdAPE", "26.68%", "24.42%", "\u22122.26 pts"],
            ["MAPE", "36.74%", "35.26%", "\u22121.48 pts"],
            ["Within 20%", "38.71%", "42.49%", "+3.78 pts"],
            ["R\u00b2", "0.489", "0.466", "\u22120.023"],
            ["Interval coverage", "15.94%", "67.83%", "+51.89 pts"],
        ],
        caption="Detailed comparison on seed 7. Accuracy is flat; calibration is transformed.",
        widths=[1.7, 1.5, 1.5, 1.7],
        align_numeric=False,
        font_size=8.5,
    )

    doc.table(
        ["Modality", "Shipped MdAPE", "Retrained MdAPE", "Shipped coverage", "Retrained coverage"],
        [
            ["Ride (n=361)", "23.94%", "19.21%", "17.45%", "70.64%"],
            ["Walk (n=723)", "28.26%", "28.51%", "15.21%", "66.39%"],
        ],
        caption="By-modality breakdown on seed 7. Retraining helps rides modestly and walks not at all on accuracy, while fixing coverage for both.",
        widths=[1.3, 1.4, 1.4, 1.4, 1.5],
        align_numeric=False,
        font_size=8.5,
    )

    doc.p(
        "The modality breakdown is the most useful part of the study, and it is the reason the "
        "retrained model is not the one in production. For rides, retraining genuinely helps: "
        "MdAPE improves from 23.94% to 19.21%, about 4.7 percentage points, at no cost in MAE. "
        "For walks, it does essentially nothing (28.26% \u2192 28.51%), which confirms the "
        "hypothesis in Section 4.2.3 \u2014 walking error is dominated by the elapsed-time "
        "definition mismatch, not by training data, so no amount of GeoLife training can fix "
        "it. And the study evaluates no runs and no hikes in any meaningful quantity, because "
        "GeoLife has none.",
        align="justify",
    )

    doc.quote(
        "The finding, stated precisely",
        "The model\u2019s accuracy is limited by its training data, not by its algorithm. Given "
        "real data, the same architecture with the same hyperparameters produces intervals that "
        "are approximately calibrated (67.8\u201376.7% coverage against an 80% target, versus "
        "15.9\u201319.7% before) without sacrificing point accuracy. The remaining accuracy gap "
        "is a property of the task and the external dataset, not a defect the model can train "
        "its way out of.",
    )


    # -------------------------------------------------------------- 4.3.3
    doc.h3("4.3.3 Personalisation study \u2014 does an athlete\u2019s own history help?")

    doc.p(
        "Every result up to this point was produced with a user-disjoint split, which is the "
        "correct protocol for measuring generalisation to new people. It has a consequence that "
        "had not been examined: if no athlete appears in both training and test sets, then no "
        "experiment in this document has ever tested the mechanism the product actually relies "
        "on. TRANA does not ship a population model. It ships a personalised Riegel reference "
        "curve fitted from the athlete\u2019s own chronological history, multiplied by a learned "
        "correction. A user-disjoint split evaluates the second factor and removes the first "
        "entirely.",
        align="justify",
    )

    doc.quote(
        "Why this mattered",
        "The personalisation arm of every earlier experiment was inert. When the protocol holds "
        "out whole users, an athlete\u2019s training history and their test rows never coexist, so "
        "the history term has nothing to act on. Measuring its effect as \u201czero\u201d would have "
        "been an artefact of the split, not a finding about the model. The study below changes "
        "the split, not the model.",
    )

    doc.p(
        "The Endomondo/FitRec corpus [2] makes this test possible for the first time, because it is "
        "the only dataset available to the project that carries a genuine per-athlete key "
        "alongside enough activities per athlete to build a history. It supplies 219 distinct "
        "athletes with a median of 150 activities each, against GeoLife\u2019s 51 users with a "
        "handful of labelled trajectories.",
        align="justify",
    )

    doc.table(
        ["Property", "Value"],
        [
            ["Source", "FitRec / Endomondo trained-prediction export (UCSD)"],
            ["Rows in export", "50,018"],
            ["Rows after cleaning", "48,556"],
            ["Distinct athletes", "219"],
            ["Median activities per athlete", "150"],
            ["Athletes with \u2265 10 activities", "200"],
            ["Retained modalities", "run, ride, walk, hike"],
            ["Duration target", "elapsed minutes, 3 min \u2013 24 h trim"],
        ],
        caption="Personalisation corpus. The per-athlete key is what the GeoLife protocol could never supply.",
        widths=[2.6, 3.9],
        align_numeric=False,
        font_size=8.5,
    )

    doc.h4("4.3.3.1 Three features that had to be removed")

    doc.p(
        "The export is a sport-classification feature table, not a duration table, and three of "
        "its columns are algebraically derived from the target. Each was found by testing rather "
        "than by inspection, and each would have produced a spectacular and entirely false "
        "result. They are documented here because the same trap is present in any feature store "
        "built for one task and reused for another.",
        align="justify",
    )

    doc.table(
        ["Column", "Relationship to the target", "Evidence", "Why it leaks"],
        [
            ["points_per_sec", "num_points / duration_sec",
             "median relative error 0.00000000",
             "Given num_points, duration is recovered in one division"],
            ["climb_rate", "alt_range / duration_sec \u00d7 60",
             "correlation +1.000000, ratio exactly 60.0",
             "Given alt_range, duration is recovered in one division"],
            ["gps_spread", "grows with time in motion",
             "Spearman \u03c1 = +0.60 with log duration",
             "Recapitulates how long the session lasted"],
        ],
        caption="Leaking columns identified by algebraic reconstruction and incremental feature addition.",
        widths=[1.1, 1.9, 1.5, 2.0],
        align_numeric=False,
        font_size=8.5,
    )

    doc.p(
        "The detection method is worth recording because it generalises. Scoring each column\u2019s "
        "log-log correlation with the target flagged only moderate relationships, and a single "
        "feature reached at best R\u00b2 0.25. The leak emerged only when features were added one at "
        "a time and the model\u2019s R\u00b2 was watched: it sat near 0.38 with four features and "
        "jumped to 0.9919 the moment climb_rate entered. A step change that large in a model "
        "whose parts are each weak is the signature of an algebraic relationship between "
        "features, and the direct reconstruction test confirmed it exactly. With the three "
        "columns removed, the same model falls to R\u00b2 0.28 on a user-disjoint split \u2014 which is "
        "the honest figure for terrain and heart rate alone.",
        align="justify",
    )

    doc.h4("4.3.3.2 Protocol")

    doc.p(
        "The split is chronological within each athlete: the earliest 70% of each person\u2019s "
        "activities form the history, the most recent 30% are held out. This is the protocol the "
        "product uses in production \u2014 predictions are always made from the past, never from "
        "the future \u2014 and it is the only split under which personalisation is measurable. "
        "209 athletes appear in both folds, yielding 33,884 history rows and 14,656 held-out rows.",
        align="justify",
    )

    doc.p(
        "The personalised predictor is deliberately simple, so that any gain is attributable to "
        "history rather than to extra capacity. A global gradient-boosted model is trained on "
        "terrain and heart-rate features. Each athlete\u2019s mean residual in log-duration is then "
        "computed from the history fold alone and applied to their held-out rows, shrunk toward "
        "zero by n / (n + 2) so that athletes with little history are pulled back to the "
        "population prediction. The shrinkage constant was not tuned on the test fold.",
        align="justify",
    )

    doc.table(
        ["Metric", "Global model only", "+ athlete\u2019s own history", "Change"],
        [
            ["MAE (minutes)", "96.92", "91.92", "\u22125.00"],
            ["MdAPE", "49.06%", "48.59%", "\u22120.47 pts"],
            ["R\u00b2", "0.133", "0.202", "+0.068"],
        ],
        caption="Personalisation on 14,656 held-out activities from 209 athletes. History improves every metric, and it improves MAE most.",
        widths=[1.7, 1.9, 2.0, 1.1],
        align_numeric=False,
        font_size=8.5,
    )

    doc.p(
        "The finding is that the history term earns its place. It reduces mean absolute error by "
        "five minutes per activity and raises R\u00b2 by 0.068, on rows the model has never seen and "
        "for athletes whose future behaviour could not have been memorised. The effect is "
        "larger than the ablation\u2019s \u22120.009 min for the learned correction and larger than the "
        "entire 11-fold corpus expansion of the scaling study, which moved MAE by 0.01 min. Of "
        "the interventions this project has measured, knowing who the athlete is turns out to "
        "matter more than either a bigger corpus or a cleverer correction.",
        align="justify",
    )

    doc.h4("4.3.3.3 What this does and does not establish")

    doc.p(
        "The result confirms the architecture, not the shipped accuracy. The absolute errors "
        "here are far larger than the 5.84 min reported against GeoLife, and the reason is "
        "structural rather than a defect: this export contains no distance column. TRANA predicts "
        "duration from distance and climb, and distance is precisely the input with the strongest "
        "physical relationship to elapsed time. A model asked to infer duration from terrain "
        "shape and heart rate alone is being asked to solve a harder and different problem. The "
        "MAE of 91.92 min is therefore not comparable to any other figure in this document and "
        "must not be presented as one.",
        align="justify",
    )

    doc.p(
        "What the experiment does establish is narrower and more useful: the personalisation "
        "mechanism produces a measurable, out-of-sample improvement when it is given the chance "
        "to operate. That had never been demonstrated in this project, and it could not have "
        "been demonstrated with GeoLife, whose per-user activity counts are too small to fit a "
        "reference curve.",
        align="justify",
    )

    doc.p(
        "A second observation deserves care rather than a claim. Grouping held-out error by "
        "history depth does not show the monotonic improvement one would hope for: athletes with "
        "150 or more prior activities show the largest absolute error (96.40 min), while the "
        "50\u2013150 band is lowest (73.41 min). That pattern is confounded, because athletes with "
        "long histories are also the ones recording the longest and most varied sessions, and "
        "absolute error scales with session length. The honest reading is that history depth "
        "cannot be separated from activity mix in this corpus, and no conclusion about how much "
        "history is enough is drawn here.",
        align="justify",
    )

    doc.quote(
        "The finding, stated precisely",
        "Personalisation is real and measurable, and it had been invisible because the "
        "user-disjoint protocol suppresses it by construction. On 14,656 held-out activities "
        "from 209 athletes, an athlete\u2019s own history reduces mean absolute error by 5.0 minutes "
        "and raises R\u00b2 from 0.133 to 0.202 relative to an otherwise identical global model. "
        "Absolute error in this study is not comparable to the GeoLife result, because the "
        "export carries no distance feature.",
    )


    # -------------------------------------------------------------- 4.4
    doc.h2("4.4 Results Interpretation")

    doc.p(
        "Four things follow from these results, and they are stated in order of how much they "
        "should change a reader\u2019s view of the system.",
        align="justify",
    )

    doc.h3("4.4.1 The pipeline works; the numbers attached to it were wrong")

    doc.p(
        "Every architectural decision the project made is validated by the external evaluation. "
        "The per-user chronological protocol produces a trustworthy number. The grouped split "
        "prevents memorisation. The two-component design gives a model that beats a population "
        "average by 17.8%. The quantile approach gives a real interval that can be scored. The "
        "browser and server evaluators agree. None of that was undone by the external results.",
        align="justify",
    )
    doc.p(
        "What was undone is the claim that the model is 5.51% accurate. The synthetic evaluation "
        "was measuring the generator. The correct figure is 23.84%, and the difference between "
        "those two numbers \u2014 a factor of four \u2014 is the single most important finding of this "
        "project. A model that reports 5.51% and delivers 23.8% is more dangerous to its users "
        "than a model that reports 23.8% and delivers 23.8%.",
        align="justify",
    )

    doc.h3("4.4.2 The learned correction is not earning its place, and that is now documented")

    doc.p(
        "The ablation is a negative result and it is reported as one. The gradient-boosted "
        "correction is confined to a \u00b12% band and cannot repair a 24% error. Its MAE "
        "improvement over the reference curve is \u22120.009 minutes with a confidence interval "
        "that includes zero, and it wins only 5.3% of bootstrap draws.",
        align="justify",
    )
    doc.p(
        "Two readings of that are possible and both are worth stating. The uncharitable one is "
        "that the machine-learning layer is decorative: the curve does the work, and the trees "
        "add complexity for nothing. The charitable one is that the architecture correctly "
        "decomposed the problem \u2014 it isolated the analytically solvable part into the curve, "
        "and the learned part was left with a residual so small that the trees correctly learned "
        "to output approximately 1.0. Under the second reading, a near-unity multiplier is "
        "evidence the decomposition was right, not evidence the model failed.",
        align="justify",
    )
    doc.p(
        "The project takes the second reading but does not use it to avoid the first. Per the "
        "scope agreed for this work, the ablation measures and documents the finding but does "
        "not change the shipped prediction path; removing exp(GBM) from production is recorded "
        "as a separate product decision that has not been made.",
        align="justify",
    )

    doc.h3("4.4.3 Calibration is a data problem, and the fix is measured")

    doc.p(
        "The retraining study is the part of this project that turns a criticism into a "
        "contribution. It would have been easy to note the 16.96% coverage, call it a "
        "limitation, and move on. Instead the project formed a hypothesis \u2014 the intervals are "
        "narrow because the synthetic training distribution is narrow \u2014 and tested it with a "
        "user-disjoint split across three seeds.",
        align="justify",
    )
    doc.p(
        "The hypothesis is confirmed. Coverage jumps from 15.94% to 67.83% while accuracy is "
        "unchanged. This is a clean dissociation: the variable that was manipulated was training "
        "data, the variable that moved was calibration, and the variable that stayed fixed was "
        "accuracy. That pattern is what a causal claim in machine learning looks like.",
        align="justify",
    )

    doc.h3("4.4.4 What the user sees, and why")

    doc.p(
        "The interface does not display 5.51%. It displays \u00b124% \u2014 or, more precisely, it "
        "displays the per-modality error derived from the GeoLife report: 28.2% for runs, 25.7% "
        "for rides, and 40.5% for walks and hikes. Those constants live in a single exported "
        "object in the frontend, with a comment explaining their provenance.",
        align="justify",
    )
    doc.code(
        "export const VALIDATED_ERROR_PCT = {\n"
        "  run: 28.2,\n"
        "  ride: 25.7,\n"
        "  walk: 40.5,\n"
        "  hike: 40.5,   // run's n is 2, so both are the conservative walk/run envelope\n"
        "};",
        caption="frontend/src/lib/ml/duration.js L71\u201376 \u2014 the only place a user-facing accuracy claim exists.",
    )
    doc.p(
        "Three design choices in that snippet are deliberate. Walking and hiking share the "
        "walk figure because GeoLife has no hikes and the walk error is the worse of the two "
        "measured modalities, so reusing it is conservative rather than flattering. Run uses "
        "28.2%, but the code comment acknowledges that this comes from n=2 and is therefore an "
        "envelope, not a measurement. And the value is a single exported constant rather than a "
        "string written into a template, so the same number appears everywhere the interface "
        "quotes an error \u2014 there is no way for one screen to drift.",
        align="justify",
    )
    doc.p(
        "A fourth choice is subtler and is the one a careful reader should notice. The card also "
        "shows a \u201cmodel confidence\u201d chip, and the source comment above it says explicitly "
        "that this score weights band width against history depth \u2014 it is how much the model "
        "trusts itself, not how often it was right. The tooltip distinguishes the two in one "
        "sentence: \u201cModel self-confidence (N%). Measured real-world error for this sport is "
        "\u00b1M%.\u201d Two numbers that could easily have been conflated are labelled as different "
        "quantities in the interface.",
        align="justify",
    )

    doc.table(
        ["Where the number appears", "Value shown", "Source", "Honest?"],
        [
            ["Prediction card, duration range",
             "median \u00b1 validated error", "validatedLow / validatedHigh", "Yes \u2014 measured on GeoLife"],
            ["Prediction card, error badge", "\u00b128.2% / \u00b125.7% / \u00b140.5%",
             "VALIDATED_ERROR_PCT", "Yes \u2014 per-modality external MAPE"],
            ["Prediction card, confidence chip", "model self-confidence",
             "confidence", "Yes \u2014 labelled as self-confidence, not accuracy"],
            ["Prediction card, tooltip", "Names GeoLife as the source",
             "FuelingPlan.svelte L53", "Yes"],
            ["Admin dashboard, model card", "R\u00b2 0.9924, MAPE 5.51%",
             "model_card.json", "Internal only \u2014 should be labelled as such"],
            ["Analytics, \u201c80% band\u201d", "78.9% coverage",
             "model_card.json", "Internal only \u2014 synthetic, not real-world"],
        ],
        caption="Where accuracy appears in the product. The user-facing screens are honest; two admin panels surface internal synthetic metrics.",
        widths=[1.55, 1.55, 1.6, 1.7],
        align_numeric=False,
        font_size=8.5,
    )

    doc.p(
        "The last two rows are a known inconsistency and are listed as such in the "
        "pre-presentation checklist: the admin screens surface synthetic metrics because they "
        "read the model card, which is the correct source of truth for internal monitoring but "
        "is not a user-facing accuracy claim. A future iteration should label those panels "
        "explicitly as internal. The user-facing screens are already correct.",
        align="justify",
    )

    # -------------------------------------------------------------- 4.5
    doc.h2("4.5 Model Limitations")

    doc.p(
        "The limitations below are ordered by how much they should reduce a reader\u2019s "
        "confidence in the system. The first is disqualifying for any use beyond personal "
        "planning; the rest are constraints rather than defects.",
        align="justify",
    )

    doc.table(
        ["#", "Limitation", "Evidence", "Consequence"],
        [
            ["1", "No training data from real athletes; calibration is unrepresentative",
             "training_source: synthetic; coverage 16.96% vs. 80% nominal",
             "Intervals cannot be trusted as displayed. Mitigated in the UI by advertising the "
             "measured \u00b124% error instead of the interval."],
            ["2", "External dataset is Beijing commuters, not athletes",
             "GeoLife: 51 users, walk 68.5%, run n=2",
             "Walking and hiking are over-represented in the error figures; running accuracy is "
             "untested in practice."],
            ["3", "No elevation in the external dataset",
             "GeoLife elevation zeroed; measured GPS altitude unusable (\u2248102 m/km apparent)",
             "The model\u2019s largest feature (importance 0.685) is untested on real data \u2014 it was "
             "zero for every evaluation row."],
            ["4", "Held-out retraining study cannot serve all modalities",
             "GeoLife has 2 runs, 0 hikes",
             "The measured fix is diagnostic, not deployable. Production keeps the synthetic model."],
            ["5", "Elapsed time includes non-exercise stops",
             "GeoLife durations are door-to-door",
             "Walking MdAPE 26.16% partly measures behaviour, not model error."],
            ["6", "No hyperparameter search",
             "Fixed config in train.py L385\u2013398",
             "Configuration is defensible but not optimal; internal metrics might improve slightly."],
            ["7", "No primary user study",
             "Project timeline",
             "The strongest possible validation \u2014 real TRANA users\u2019 own logs \u2014 has not been run."],
            ["8", "Cold start is materially worse",
             "MAPE 51.26% at zero history vs. 35.31% at 2+",
             "A new user\u2019s first prediction is rough. Disclosed via THIN_HISTORY_MULTIPLIER."],
            ["9", "Endomondo validation never executed",
             "docs/test-report.md L200 \u2014 pending user-supplied CSV",
             "A second external dataset was designed for but not obtained."],
            ["10", "Weight and experience are assumptions on GeoLife",
             "weight_kg=60.0 fixed; experience inferred from history length",
             "Fuelling outputs for GeoLife rows are not evaluated at all \u2014 only duration is."],
        ],
        caption="Complete limitation register, with evidence and consequence for each entry.",
        widths=[0.3, 1.75, 1.85, 2.5],
        align_numeric=False,
        font_size=8,
    )

    doc.h3("4.5.1 The limitation that matters most, explained")

    doc.p(
        "The first row deserves more than a table cell. The shipped model was trained on data "
        "whose noise structure the generator chose. Its quantile regressors therefore learned "
        "to produce intervals sized for Gaussian noise with a standard deviation of 5.5% of "
        "speed. Real athletes do not have Gaussian day-to-day variation: they have fat tails "
        "from illness, travel, heat, and motivation. The consequence is that the q10\u2013q90 band "
        "covers 17% of real outcomes instead of 80%.",
        align="justify",
    )
    doc.p(
        "The project\u2019s response is the correct one, and it is worth naming as a design "
        "principle: when a model\u2019s uncertainty cannot be trusted, do not display it. The "
        "interface shows the measured error margin (\u00b124%) rather than the model\u2019s own "
        "interval, because the former is validated on real data and the latter is not. The "
        "retraining study shows what would be required to fix this properly: real training "
        "data, a user-disjoint split, and the measurement to prove the fix worked.",
        align="justify",
    )

    doc.h3("4.5.2 What would change the conclusions")

    doc.p(
        "A reader should know what evidence would overturn this document\u2019s claims, not just "
        "what evidence supports them.",
        align="justify",
    )
    doc.bullet(
        "If a corpus of real TRANA users\u2019 logged sessions showed external MdAPE materially "
        "below 23.84%, the headline figure is pessimistic and should be replaced. Section 4.5 "
        "row 7 is the gap.",
        bold_lead="The 23.84% figure would fall. ",
    )
    doc.bullet(
        "If the correction were retrained with elevation present and still produced a "
        "near-unity multiplier on a real dataset with terrain variation, the ablation\u2019s "
        "negative result would generalise beyond GeoLife\u2019s elevation-blind setting.",
        bold_lead="The ablation finding would change. ",
    )
    doc.bullet(
        "The retraining study used 36 training users. A study with several hundred would have "
        "the power to detect a 0.06-minute MAE difference. If such a study found a consistent, "
        "significant improvement, the deployment decision in Section 3.4 would need revisiting.",
        bold_lead="The retraining verdict would flip. ",
    )
