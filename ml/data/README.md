# data/

Training data is **not committed** — it is generated or queried on demand.

- `generate_dataset.py` builds the physics-informed synthetic bootstrap corpus used
  when no real data exists yet (`python -m data.generate_dataset`).
- `duration_model.train --source synth` (default) generates the corpus on the fly and
  writes it to `data/activities.csv` (gitignored) before training.
- `--source supabase` trains straight from `DATABASE_URL` (needs `psycopg[binary]`).
- `--source csv --csv path/to/export.csv` trains from a Postgres activity export.
