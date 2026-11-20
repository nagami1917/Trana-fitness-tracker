# CSST 102 Final Project Documentation — TRANA

Two builds exist, and **the template-format build is the one to submit.**

| Build | Files | What it is |
| --- | --- | --- |
| **Template format** (submit this) | `TRANA-CSST102-Template-Format.{docx,pdf,md}` | Follows the professor's template literally: same seven sections, same sub-headings, same six tables, same closing line. Built by cloning the official template, so the **LSPU seal in the page header** and the A4 geometry are inherited exactly. 22 pages. |
| Extended long-form | `TRANA-CSST102-Final-Project-Documentation.{docx,pdf,md}` | The original 50-page build with appendices, IEEE references and the full metric tables. Richer, but it does **not** carry the seal header and its headings are not the template's. Useful as a source document, not as the submission. |

The professor's template is `CSST 102(IS) - Documentation Template.docx`, kept in
the Google Drive `Documentation` folder. A copy must be present at
`google_drive/` for the template-format build to inherit the seal; without it the
generator falls back to assembling an equivalent page from the committed seal
image and warns you on stdout.

## What is here

| File | Purpose |
| --- | --- |
| `TRANA-CSST102-Template-Format.docx` | **Editable submission file** — fill in names and screenshots here |
| `TRANA-CSST102-Template-Format.pdf` | Fixed-layout preview of the same content, 22 pages |
| `TRANA-CSST102-Template-Format.md` | Same content in markdown, for review and diffing without Word |
| `TRANA-CSST102-Final-Project-Documentation.docx` | Extended 50-page build, editable |
| `TRANA-CSST102-Final-Project-Documentation.pdf` | Extended build, fixed layout |
| `TRANA-CSST102-Final-Project-Documentation.md` | Extended build in markdown |
| `generator/` | Scripts that produce every file above from one source |
| `generator/lspu_seal.jpeg` | The seal, extracted from the template, used by both builds |

Both builds render their `.docx` and `.pdf` in a single pass: the engine records
an ordered event log while writing the `.docx`, and the PDF renderer replays it,
so the two cannot drift apart.

## Template compliance

The template asks for a specific seven-section structure. The template-format
build follows it exactly — nothing added, nothing dropped:

| Template element | Where it is |
| --- | --- |
| Course line, "FINAL PROJECT DOCUMENTATION" | Cover |
| PROJECT NAME / PROPONENTS / YEAR AND SECTION | Cover |
| 1. PROJECT OVERVIEW — Description, Objectives, Problem Definition | Section 1 |
| 2. DATASET AND DATA PREPROCESSING — Description, Information Details table, Dataset Attributes table, Preprocessing, Splitting | Section 2 |
| 3. MACHINE LEARNING MODEL DEVELOPMENT — Selection, Training, Comparison table, Final Selection | Section 3 |
| 4. MODEL EVALUATION AND INTERPRETATION — Metrics, Results, Comparison Results, Interpretation, Limitations | Section 4 |
| 5. WEB APPLICATION DEVELOPMENT AND OUTPUT — screenshots with descriptions | Section 5 (10 numbered placeholders) |
| 6. GROUP CONTRIBUTIONS — table | Section 6 |
| 7. CONCLUSION | Section 7 |
| END OF DOCUMENTATION | Last line |

## Where the numbers come from

Every figure in both builds is copied from a committed artifact. Nothing is
estimated.

| Source | Feeds |
| --- | --- |
| `ml/evaluation/reports/geolife_validation.json` | External validation: MAE 5.84, MdAPE 23.84%, R² 0.414, coverage 16.96%, by-modality and by-history slices |
| `ml/evaluation/reports/ablation_report.json` | Curve vs. model comparison: 5.83 vs 5.84 MAE, population prior 7.10 |
| `ml/evaluation/reports/retrain_study.json` | Held-out retraining: coverage 15.94% → 67.83%, paired bootstrap CI [−0.071, +0.184] |
| `ml/duration_model/model_card.json` | Shipped model version, corpus 8,845 rows, 7,011/1,834 split, feature importances |
| `frontend/public/models/duration_model.json` | The deployed trees and feature order |

The synthetic internal score (R² 0.9924) is quoted **only** next to the external
score, and is labelled as a self-score. It measures how well the model reproduces
its own generator, not how well it predicts real activity.

## What the group still needs to do

Three things cannot be generated:

1. **Cover page** — replace the three `[SURNAME, First Name]` placeholders and
   `[Year and Section]`. If the group has more or fewer than three members, add
   or delete rows in the PROPONENTS block.
2. **Section 6** — replace the four `[SURNAME, First Name]` placeholders in the
   Group Contributions table. The responsibility and contribution columns are
   already accurate to the work performed; fill the names to match what each
   person actually built rather than dividing evenly.
3. **Section 5 screenshots** — ten placeholders, each naming exactly what to
   capture. Capture at 1440×900 or wider with realistic data (not empty states),
   insert at full width, and delete the placeholder box.

After inserting screenshots, select all (`Ctrl+A`) and press `F9` to refresh any
field codes.

## Regenerating

```bash
python -m venv /tmp/docenv
/tmp/docenv/bin/pip install python-docx reportlab pypdf

# Template format (the submission build)
/tmp/docenv/bin/python docs/thesis/generator/build_template_doc.py

# Extended build
/tmp/docenv/bin/python docs/thesis/generator/build_documentation.py
```

`build_template_doc.py` accepts `--template`, `--out`, `--pdf`, and
`--only docx|pdf`. Point `--template` at the official `.docx` if it lives
somewhere other than `google_drive/`.

## How the generator is laid out

| File | Role |
| --- | --- |
| `template_engine.py` | `TemplateDoc` — clones the template, then offers `section_bar`, `sub`, `body`, `table`, `code`, `figure_placeholder` |
| `template_content.py` | All prose and table data for the template-format build, with per-figure provenance comments |
| `template_pdf.py` | Replays the event log to PDF, including the seal header |
| `build_template_doc.py` | Entry point for the template-format build |
| `docx_engine.py` | `Doc` — the original engine behind the extended build |
| `section1.py` … `section8.py`, `section_front.py` | Content for the extended build |
| `pdf_engine.py`, `build_documentation.py` | PDF replay and entry point for the extended build |

The template-format engine deliberately does **not** reuse `docx_engine.py`.
That engine composes a document from scratch with its own navy-and-grey palette,
which would not match the school's Arial-on-A4 formatting. Cloning the template
is the only way to inherit the anchored seal without re-measuring it.
