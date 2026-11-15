# data/

Training data is **not committed**. Synthetic data is generated for the
bootstrap model; real-data candidates use a consented, pseudonymized local CSV.
Keep source files outside Git and exclude direct identifiers and raw GPS/route
fields.

- `generate_dataset.py` builds the physics-informed synthetic bootstrap corpus
  (`python -m data.generate_dataset`).
- `duration_model.train --source synth` generates that corpus on demand.
- `--source csv --csv /secure/path/train.csv` is the documented real-data
  candidate workflow; audit first with `duration_model.audit` and validate with
  a separate, user-disjoint CSV.
- `--source supabase` remains available for compatibility but is **not** the
  default workflow. Do not use it with production data without separate
  approval.
