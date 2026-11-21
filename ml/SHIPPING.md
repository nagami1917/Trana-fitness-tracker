# Shipping record — Endomondo-trained duration model

**Model version:** `20261121.0023`
**Supersedes:** `20261113.1328` (synthetic-trained)
**Date:** 2026-11-21
**Author:** TRANA ML

This file records *why* the shipped weights changed, with the numbers needed to
check the claim. It is the audit trail a reviewer should read alongside
`model_card.json`.

---

## 1. Why the weights were replaced

The previous artifact was trained on 8,845 activities produced by
`ml/data/generate_dataset.py` — a generator that computes duration from
published exercise-physiology formulas (Naismith's rule, the Riegel law, ACSM
metabolic equations). It is reproducible and internally consistent, but no
athlete ever performed those sessions.

The project requirement is that the primary model be trained on **real recorded
data**. `endomondo_activities.csv` — 43,847 real workouts from 218 athletes,
derived from the FitRec / Endomondo sample — fills that role and covers all four
modelled sports (run, ride, walk, hike), which GeoLife does not.

## 2. What was evaluated

Two artifacts, scored on **the same 8,675 workouts from the same 65 athletes**,
using the production protocol: each athlete's history accumulates
chronologically per activity type, elevation is passed through, and no holdout
athlete appears in training.

| | Before | After |
|---|---|---|
| Training corpus | 8,845 synthetic rows | 43,847 recorded workouts |
| Athletes in corpus | 240 generated | 218 real |
| MAE | 32.69 min | **27.60 min** |
| MdAPE | 31.0 % | **25.6 %** |
| R² | 0.450 | **0.630** |
| 80 % interval coverage | 15.4 % | **65.5 %** |
| Within 20 % | 34.8 % | **40.9 %** |

Paired bootstrap over 2,000 athlete resamples: **ΔMAE −5.09 min, 95 % CI
[−5.66, −4.50]**, better in 100.0 % of draws. The interval excludes zero, so the
improvement is not sampling noise.

### Per sport

| Sport | n | MAE before → after | R² before → after | Coverage before → after |
|---|---|---|---|---|
| run | 3,766 | 22.6 → **17.4** | 0.226 → **0.642** | 12.9 % → **67.7 %** |
| ride | 4,895 | 40.3 → **35.3** | 0.421 → **0.579** | 17.4 % → **63.9 %** |
| walk | 7 | 50.1 → 47.2 | −0.605 → −0.539 | 0.0 % → 57.1 % |
| hike | 7 | 92.6 → 115.9 | −0.804 → −2.595 | 28.6 % → 100.0 % |

Run and ride are the only two sports with enough holdout rows to support a
claim. **Walk and hike have n=7 each** — those figures are reported for
completeness and are not evidence either way.

## 3. Known limitations

**Hike is the weakest modality.** Only 51 of the 43,847 workouts are hikes,
median distance 4.6 km. The fitted model predicts hikes 1.5–2.5× slower than
Naismith's rule would suggest. This is learned, not a bug: the recorded hikes
move at a median 2.35 km/h, consistent with Alpine hiking rather than park
walking. Predictions beyond ~16 km (the 95th percentile) extrapolate.
**A labelled hike corpus is the single highest-value addition to this project.**

**Distance is reconstructed, not recorded.** The feature export carries no
distance column. `distance_km ≈ 4 × gps_spread × 111.32`, which reproduces
median speeds of 5.4 km/h walking, 7.7 km/h running and 18.7 km/h riding —
correct ranges. The approximation assumes a roughly loop-shaped route, so it
under-estimates long point-to-point traversals.

**Elevation is a band, not a gain.** `elevation_gain_m = alt_range ÷ 2` — half
the observed altitude spread, i.e. the climb of an out-and-back route. It is a
lower bound on a one-way ascent.

**Intervals still under-cover.** 65.5 % against a nominal 80 %. The frontend
therefore displays the measured error band, not the raw quantile interval.

**`calibration` is null.** No post-hoc interval calibration was fitted. The
Endomondo corpus would support it — this is the obvious next step.

## 4. How the artifact was produced

```
python ml/data/endomondo_features_to_csv.py \
    --features <endomondo_trained_predictions.csv> \
    --out ml/data/external/endomondo_activities.csv \
    --report ml/evaluation/reports/endomondo_dataset_summary.json

python -m duration_model.train \
    --source csv \
    --csv ml/data/external/endomondo_activities.csv \
    --source-label "Endomondo (FitRec) recorded workouts"
```

The shipped weights were fitted on the **full** corpus (all 218 athletes), then
copied into `ml/duration_model/` and mirrored to `frontend/public/models/`.
`train.py` writes to `ml/artifacts/duration_model-candidate` by default and
never overwrites shipped weights, so promotion is always a deliberate copy.

Evaluation:

```
python -m evaluation.endomondo_study      # reports/endomondo_study.json
```

## 5. Reproducibility

The corpus CSV is **git-ignored** — the FitRec terms forbid redistribution — so
the exact weights cannot be rebuilt from a clean clone without the source
feature export. That export lives in the owner's Google Drive
(`trainedDatasets/endomondo_trained_predictions.csv`). The generator that
derives the corpus from it *is* committed, and the summary of what it produced
is recorded in `ml/evaluation/reports/endomondo_dataset_summary.json`.

## 6. Rollback

The previous artifact is recoverable from git history at commit `0d14c30`:

```
git show 0d14c30:ml/duration_model/duration_model.joblib > ml/duration_model/duration_model.joblib
git show 0d14c30:ml/duration_model/model_card.json    > ml/duration_model/model_card.json
```

Reverting is only appropriate if the synthetic baseline is preferred for a
specific demonstration; on every measured axis it is the weaker model.
