# CSST 102 Final Project Documentation — TRANA

The deliverable for the course is `TRANA-CSST102-Final-Project-Documentation.pdf`
(with `.docx` alongside as the editable source), built to the structure of the
professor's template (`CSST 102(IS) - Documentation Template.docx`, found in the
Google Drive `Documentation` folder).

## What is here

| File | Purpose |
| --- | --- |
| `TRANA-CSST102-Final-Project-Documentation.docx` | Editable deliverable — use this one if you still need to add names/screenshots |
| `TRANA-CSST102-Final-Project-Documentation.pdf` | **Submission-ready PDF**, 46 pages, fixed layout, page numbers |
| `TRANA-CSST102-Final-Project-Documentation.md` | Same content in markdown, for review and diffing without Word |
| `generator/` | Scripts that produce the `.docx` and `.pdf` from one source |

All three are the same content. `generator/` builds the `.docx` and `.pdf` in a
single pass — the `.pdf` renderer replays an event log recorded while the
`.docx` is written, so the two cannot drift apart.

## Template compliance

The professor's template asks for a specific seven-section structure. This
document follows it exactly, including the required header block
(PROJECT NAME / PROPONENTS / YEAR AND SECTION) on the cover:

| Template section | Where it is |
| --- | --- |
| Header block (name, proponents, year/section) | Cover page |
| 1. PROJECT OVERVIEW — Description, Objectives, Problem Definition | Section 1 |
| 2. DATASET AND DATA PREPROCESSING — Description, Attributes, Preprocessing, Splitting | Section 2 |
| 3. MACHINE LEARNING MODEL DEVELOPMENT — Selection, Training, Comparison, Final Selection | Section 3 |
| 4. MODEL EVALUATION AND INTERPRETATION — Metrics, Results, Comparison, Interpretation, Limitations | Section 4 |
| 5. WEB APPLICATION DEVELOPMENT AND OUTPUT — screenshots with descriptions | Section 5 (10 numbered placeholders) |
| 6. GROUP CONTRIBUTIONS | Section 6 |
| 7. CONCLUSION | Section 7 |

Beyond the template, three appendices were added because the professor asked
for maximum detail: reproduction commands, complete metric tables, and a
glossary.

## What the group still needs to do

Three things cannot be generated and must be added by hand:

1. **Cover page** — replace `[SURNAME, First Name]` (three times) and
   `[Year and Section]`. The project name and subtitle are already filled in.
2. **Section 6** — replace the six `[SURNAME, First Name]` placeholders in the
   Group Contributions table. The responsibility and contribution columns are
   already accurate to the work performed, and a member's row can be verified
   against commit history, so fill it to match what each person actually built
   rather than dividing evenly.
3. **Section 5 screenshots** — ten placeholders, each naming exactly what to
   capture. Capture at 1440×900 or wider, light theme, realistic data (not empty
   states). Insert at full width, then delete the placeholder box.

After inserting screenshots: select all (`Ctrl+A`) and press `F9` to refresh any
field codes, then update the table of contents if Word prompts.

## Regenerating both files

The generator needs `python-docx` and `reportlab`:

```bash
python3 -m venv .venv-docx
.venv-docx/bin/pip install python-docx reportlab
.venv-docx/bin/python docs/thesis/generator/build_documentation.py
```

That writes both `TRANA-CSST102-Final-Project-Documentation.docx` and
`TRANA-CSST102-Final-Project-Documentation.pdf`.

Single format, if you only need one:

```bash
.venv-docx/bin/python docs/thesis/generator/build_documentation.py --only pdf
.venv-docx/bin/python docs/thesis/generator/build_documentation.py --only docx
```

**Editing advice.** Once the group starts adding screenshots and names, the
`.docx` becomes the source of truth — edit it directly in Word, then export a
fresh PDF from Word (`File → Save As → PDF`) rather than rebuilding, or the
hand-added content will be lost. Rebuilding from the generator resets the text
to its current state and produces PDF placeholders in place of screenshots.

## PDF notes

The PDF is produced with reportlab and embeds DejaVu Sans, which covers every
glyph the document uses (→ ≤ ≥ × ± − ² ·). It has real page numbers in the
footer, repeating table headers on multi-page tables, and "Table N continued"
markers. Bookmarks/section structure are not included — the static Table of
Contents at the front lists every section and subsection.

## Where the numbers come from

Every figure in the document is copied from a committed report or a source file;
nothing is estimated. The main sources:

| Number | Source |
| --- | --- |
| ±23.84% MdAPE, 43.81% within 20%, R² 0.414, coverage 16.96% | `ml/evaluation/reports/geolife_validation.json` |
| Ablation: −0.009 min, CI [−0.019, +0.002], factor range 0.8823–1.0239 | `ml/evaluation/reports/ablation_report.json` |
| Retraining: coverage 15.94% → 67.83%, CI [−0.071, +0.184], 3 seeds | `ml/evaluation/reports/retrain_study.json` |
| R² 0.9924, MAPE 5.51%, feature importances, `training_source`, `calibration` | `ml/duration_model/model_card.json` |
| ±28.2% / ±25.7% / ±40.5%, `THIN_HISTORY_MULTIPLIER` | `frontend/src/lib/ml/duration.js` |
| 4,362 rows / 51 users / mode mix / distance range | `ml/data/external/geolife_activities.csv` |
| 9 features, Ridge bounds, Riegel priors | `ml/duration_model/preprocess.py` |
| Hyperparameters, split assertion, calibration guard | `ml/duration_model/train.py` |
| Deployed URLs, stack versions | `docs/DEPLOYMENT.md`, `package.json`, `composer.json` |

## A note on the framing

The document leads with the externally validated **±23.84%** figure and treats
the synthetic **5.51%** as tautological, because the synthetic generator computes
the target from distance and speed (`ml/data/generate_dataset.py` L99) and
therefore makes that metric partly measure the generator.

This is not a weakness in the documentation — it is the project's strongest
finding, and the document builds a chain of evidence around it: honest accuracy
(Section 4.2), ablation proving the learned correction adds nothing (4.3.1),
diagnosis that coverage is a data problem (4.3.2), and the measured fix
(coverage 16% → 68% with flat accuracy). If the professor asks "why not report
5.51%?", the answer is that a model reporting 5.51% and delivering 23.8% is more
dangerous to its users than one reporting the truth.
