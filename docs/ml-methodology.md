# ML methodology

Two engines, deliberately different in kind:

| Engine | Type | Where |
| --- | --- | --- |
| **Duration model** | learned (quantile gradients) | `ml/duration_model/` |
| **Fueling engine** | deterministic (sports-science formulas) | `ml/fueling_model/` |

The split is intentional: fueling has no reliable public training corpus, and a
rule-based engine is transparent, auditable and safe for a health-facing product.

## Duration model

**Problem.** Predict how long an athlete needs for a *planned* session, using their
*own* history — not a population average.

**Anchor.** Each athlete × modality gets a Riegel-style distance→time curve fitted
to their logged activities (`duration_model/preprocess.py: reference_curve`):

```
base_minutes = exp(a + b·ln distance_km)
```

**Model.** `GradientBoostingRegressor` with quantile loss at α = 0.10 / 0.50 / 0.90,
learning a *pace factor* against that base — it corrects the personal curve for
elevation, mass, experience and sport:

```
duration = base · exp(f(features))
features = distance_km, elevation_gain_m, elevation_per_km,
           weight_kg, experience_level, is_run, is_ride, is_walk, is_hike
```

q10/q90 give an honest "estimated range" in the UI instead of one over-confident
number; `duration.confidence` derives from the interval width.

**Training.** `python -m duration_model.train` (from `ml/`):

- default: (re)generates the physics-informed synthetic bootstrap corpus
  (`data/generate_dataset.py`, ~8k activities from synthetic athletes) and trains on it;
- `--source supabase` trains on the real activity log (`DATABASE_URL`, optional dep `psycopg[binary]`);
- `--source csv --csv file.csv` trains on a Postgres export.

Current committed artifact (`ml/duration_model/duration_model.joblib`):

| Metric | Value |
| --- | --- |
| MAE | 9.56 min |
| RMSE | 27.16 min |
| R² | 0.952 |
| MAPE | 7.18 % |
| Interval coverage (q10–q90) | 76.8 % |
| Corpus | 7 988 rows (synthetic bootstrap) — **retrain on real data before relying on absolute numbers** |

Feature importance (q50): `elevation_per_km` 0.62, `distance_km` 0.19, `is_ride` 0.05.
Elevation/km dominates — expected, since climbing is the strongest duration driver.

`duration_model.json` is the same trees as plain JSON for the PWA's **on-device**
evaluator (`frontend/src/lib/ml/duration.js`); keep `frontend/public/models/duration_model.json`
in sync with `ml/duration_model/duration_model.json` when retraining.

**Guardrails.** Factor clamped to [0.7, 3.0]; q10/q50/q90 can never invert or go
below 1 minute; graceful physics fallback when artifacts are missing; `python -m evaluation.sanity_check`
asserts ±22 % against known-good reference points (exit 1 on failure).

## Fueling engine

Calories from METs × body mass × hours (modality- and speed-dependent, with a climb
penalty); carbohydrate rate from duration band and intensity (0 g/h below 60 min →
85+ g/h beyond 2.5 h, capped at 90 g/h); sodium and fluid from the athlete's sweat
profile and heat (×1.025 per °C above 22 °C); a 3-phase timeline (pre / during /
recovery); and intensity-graded notes. Every constant is documented inline in
`ml/fueling_model/predict.py` and mirrored 1:1 in `frontend/src/lib/ml/fueling.js`
(the PWA computes fueling offline, so the two must stay identical).

## Prediction flow

```
SPA ──POST /api/predictions──▶ Laravel ──POST /predict──▶ FastAPI (ml/api)
      feature        validation, normalisation   engine
```

1. `StorePredictionRequest` validates (distance optional when a route is drawn).
2. Laravel resolves the effective distance (drawn route wins, haversine-measured),
   assembles history + profile + goal, and calls FastAPI.
3. The ML response is normalised to camelCase (`DurationPredictionService` /
   `FuelingPredictionService`) and persisted as `predictions` (see
   [database.md](database.md)) with the full payload and `model_version`.
4. `docs/api.md` documents the exact request/response contract.

## Known limitations

- The committed artifact is trained on **synthetic** data — correct shape, wrong
  absolute accuracy for individual athletes until per-user personalization accrues.
- Age is not yet a feature (birth_year is stored, unused by the model).
- Wearable HR stream is stored (`avg_heart_rate`) but unused by the model.
- Interval coverage 76.8 % vs 80 % target — acceptable for a range display, not for pacing a race.
