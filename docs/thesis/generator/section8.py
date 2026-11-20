"""Section 8 — References (IEEE style).

Numbered in order of first appearance in the body. Inline markers elsewhere in
the document are literal ``[n]`` strings that match the numbers below, so the
two cannot drift: if an entry moves, the markers must move with it.

Why this section exists
-----------------------
The first draft named its sources in prose ("GeoLife", "Riegel") without a
single inline citation or reference list. Naming a dataset is not citing it:
without a numbered list and in-text anchors, a panel cannot check the claims
and the MET constants, the quantile loss, and the shrinkage estimator each
appear to have been invented for this project rather than taken from the
literature.
"""

from __future__ import annotations


# (number, formatted IEEE entry, short label used by the appendix table)
REFERENCES: list[tuple[int, str, str]] = [
    (
        1,
        "X. Zheng, X. Xie, L. Wang, Y. Yu, and S. Jiang, \u201cMining interesting "
        "locations and travel sequences from GPS trajectories,\u201d in Proc. 17th Int. "
        "Conf. World Wide Web (WWW \u201908), Beijing, China, 2008, pp. 791\u2013800, "
        "doi: 10.1145/1367497.1367550.",
        "GeoLife GPS Trajectories dataset (Microsoft Research Asia), used as the "
        "external validation corpus and for the ablation in Section 4.",
    ),
    (
        2,
        "J. Ni, L. Muhlstein, and J. McAuley, \u201cModeling heart rate and activity "
        "data for personalized fitness recommendation,\u201d in Proc. World Wide Web "
        "Conf. (WWW \u201919), San Francisco, CA, USA, 2019, pp. 1343\u20131353, "
        "doi: 10.1145/3308558.3313643.",
        "FitRec / Endomondo corpus. Supplied the per-athlete history used by the "
        "personalisation study in Section 4.3.3. Released for academic use only; "
        "the data is not redistributed with this project.",
    ),
    (
        3,
        "P. S. Riegel, \u201cAthletic records and human endurance,\u201d American "
        "Scientist, vol. 69, no. 3, pp. 285\u2013290, 1981.",
        "The time \u221d distance^b endurance relation. Fitted per athlete as the "
        "reference curve that every prediction is built on (Sections 2.3.4 and 3.2).",
    ),
    (
        4,
        "W. W. Naismith, \u201cCruach Ardran, Stobinian, and Ben More,\u201d Scottish "
        "Mountaineering Club Journal, vol. 2, no. 3, p. 136, 1892.",
        "The original hill-walking time allowance for ascent, used to give the "
        "elevation penalty a physically motivated starting form (Section 3.1).",
    ),
    (
        5,
        "J. H. Friedman, \u201cGreedy function approximation: a gradient boosting "
        "machine,\u201d The Annals of Statistics, vol. 29, no. 5, pp. 1189\u20131232, "
        "2001, doi: 10.1214/aos/1013203451.",
        "Gradient boosting itself \u2014 the algorithm behind the three "
        "GradientBoostingRegressor instances (Section 3.2).",
    ),
    (
        6,
        "R. Koenker and G. Bassett, \u201cRegression quantiles,\u201d Econometrica, "
        "vol. 46, no. 1, pp. 33\u201350, 1978, doi: 10.2307/1913643.",
        "Quantile loss. Justifies predicting the 10th, 50th and 90th percentiles "
        "instead of a single point estimate, which is what produces the honest "
        "range shown in the interface (Sections 3.1 and 4.1).",
    ),
    (
        7,
        "A. E. Hoerl and R. W. Kennard, \u201cRidge regression: biased estimation for "
        "nonorthogonal problems,\u201d Technometrics, vol. 12, no. 1, pp. 55\u201367, "
        "1970, doi: 10.1080/00401706.1970.10488634.",
        "Weighted Ridge shrinkage of the Riegel exponent toward a sport-specific "
        "prior, so an athlete with three sessions cannot produce an absurd exponent "
        "(Section 2.3.4).",
    ),
    (
        8,
        "B. E. Ainsworth, W. L. Haskell, S. D. Herrmann, et al., \u201c2011 "
        "compendium of physical activities: a second update of codes and MET "
        "values,\u201d Medicine & Science in Sports & Exercise, vol. 43, no. 8, "
        "pp. 1575\u20131581, 2011, doi: 10.1249/MSS.0b013e31821ece12.",
        "The MET values behind kcal = MET \u00d7 mass \u00d7 hours \u2014 including the "
        "MET 9.52 shown on the fuelling card. Without this the energy figures are "
        "unfounded (Section 5).",
    ),
    (
        9,
        "A. E. Jeukendrup, \u201cA step towards personalized sports nutrition: "
        "carbohydrate intake during exercise,\u201d Sports Medicine, vol. 44, "
        "suppl. 1, pp. S25\u2013S33, 2014, doi: 10.1007/s40279-014-0148-z.",
        "The 30\u201360 g of carbohydrate per hour guidance used by the fuelling "
        "engine (Section 5).",
    ),
    (
        10,
        "L. M. Burke, J. A. Hawley, S. H. Wong, and A. E. Jeukendrup, "
        "\u201cCarbohydrates for training and competition,\u201d Journal of Sports "
        "Sciences, vol. 29, suppl. 1, pp. S17\u2013S27, 2011, "
        "doi: 10.1080/02640414.2011.585473.",
        "Body-mass-scaled carbohydrate targets (the 6 g/kg daily figure) and the "
        "intake-during-exercise ranges (Section 5).",
    ),
    (
        11,
        "M. J. Sawka, L. M. Burke, E. R. Eichner, R. J. Maughan, S. J. Montain, "
        "and N. S. Stachenfeld, \u201cAmerican College of Sports Medicine position "
        "stand: exercise and fluid replacement,\u201d Medicine & Science in Sports "
        "& Exercise, vol. 39, no. 2, pp. 377\u2013390, 2007, "
        "doi: 10.1249/mss.0b013e31802ca597.",
        "Fluid and sodium replacement rates, i.e. the ml/h and mg/h figures "
        "alongside the carbohydrate plan (Section 5).",
    ),
    (
        12,
        "D. G. Altman and J. M. Bland, \u201cMeasurement in medicine: the analysis "
        "of method comparison studies,\u201d The Statistician, vol. 32, no. 3, "
        "pp. 307\u2013317, 1983, doi: 10.2307/2987937.",
        "The reason Section 4.1 reports MAE and MdAPE side by side rather than one "
        "headline number: a mean is dominated by outliers, a median hides them.",
    ),
    (
        13,
        "F. Pedregosa et al., \u201cScikit-learn: machine learning in Python,\u201d "
        "Journal of Machine Learning Research, vol. 12, pp. 2825\u20132830, 2011.",
        "The library implementing GradientBoostingRegressor, Ridge and the quantile "
        "loss used throughout the model pipeline.",
    ),
]


def build_section_8(doc) -> None:
    doc.h1("8. REFERENCES")

    doc.p(
        "References are numbered in order of first appearance in the text, in IEEE "
        "style. In-text markers such as [1] point to the entries below. Scripts and "
        "software libraries are cited where they materially determine a result; all "
        "other tooling is named in Appendix A.",
        align="justify",
    )

    doc.h2("8.1 Works Cited")

    for number, entry, _ in REFERENCES:
        # The number is prepended here rather than baked into each string, so an
        # entry can never be renumbered in one place and not the other.
        assert not entry.startswith("["), f"entry {number} must not hardcode its number"
        doc.p(f"[{number}] {entry}", align="left", size=9.5)
        doc.spacer(3)

    doc.h2("8.2 What Each Source Supports")

    doc.p(
        "Every claim in this document that rests on prior work is listed here against "
        "the section that depends on it, so a reader can trace a number back to its "
        "origin.",
        align="justify",
    )

    doc.table(
        ["Ref.", "Supports", "Where used"],
        [
            ["[1]", REFERENCES[0][2], "Section 2.1.2, Section 4.2, Section 4.3"],
            ["[2]", REFERENCES[1][2], "Section 4.3.3"],
            ["[3]", REFERENCES[2][2], "Section 1.3, Section 2.3.4, Section 3.2"],
            ["[4]", REFERENCES[3][2], "Section 3.1, Section 3.2"],
            ["[5]", REFERENCES[4][2], "Section 3.1, Section 3.2"],
            ["[6]", REFERENCES[5][2], "Section 3.1, Section 3.2, Section 4.1"],
            ["[7]", REFERENCES[6][2], "Section 2.3.4"],
            ["[8]", REFERENCES[7][2], "Section 1.2, Section 5.2, Section 7.2"],
            ["[9]", REFERENCES[8][2], "Section 5.2"],
            ["[10]", REFERENCES[9][2], "Section 5.2"],
            ["[11]", REFERENCES[10][2], "Section 5.2"],
            ["[12]", REFERENCES[11][2], "Section 4.1"],
            ["[13]", REFERENCES[12][2], "Section 3.2, Appendix A"],
        ],
        caption="Citation map: which reference carries which claim.",
        widths=[0.7, 3.6, 2.2],
        align_numeric=False,
        font_size=8.5,
    )

    doc.h2("8.3 Data Availability and Licensing")

    doc.p(
        "GeoLife [1] is published by Microsoft Research for research use and is cited "
        "rather than redistributed here; the project ships only a derived per-trajectory "
        "feature table of 4,362 rows, with the derivation documented in "
        "ml/data/external/README.md. FitRec/Endomondo [2] is released for academic use "
        "only and explicitly forbids redistribution, so the corpus used in Section 4.3.3 "
        "is not committed to this repository or shipped with the application; only "
        "aggregate metrics are reported. The synthetic training corpus is generated "
        "locally by ml/data/generate_dataset.py and is reproducible from seed.",
        align="justify",
    )

    doc.p(
        "A panel checking reproducibility should note which figures depend on data this "
        "project cannot ship: every metric in Section 4.3.3, and the GeoLife validation "
        "in Section 4.2, require the reader to obtain the source corpora from their "
        "publishers under the terms above.",
        align="justify",
    )
