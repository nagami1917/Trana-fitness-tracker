"""Check that the checked-in Supabase snapshot matches its source SQL files."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[2]
sql_dir = root / "supabase" / "sql"
source = (sql_dir / "001_schema.sql").read_text() + (sql_dir / "002_rls.sql").read_text()
snapshot = (root / "supabase/migrations/20261108105133_trana_laravel_baseline.sql").read_text()
if not snapshot.endswith(source):
    raise SystemExit("Supabase migration snapshot differs from the baseline SQL files")
names = re.findall(r"'((?:0001|2026)_\d{2}_\d{2}_\d{6}_[a-z_]+)'", source)
for name in names:
    if not (root / "backend/database/migrations" / f"{name}.php").is_file():
        raise SystemExit(f"Baseline records a missing Laravel migration: {name}")
if len(names) != 7 or len(set(names)) != 7:
    raise SystemExit("Expected seven distinct Laravel migration records in the baseline")
print("Supabase baseline snapshot and Laravel migration records match")
