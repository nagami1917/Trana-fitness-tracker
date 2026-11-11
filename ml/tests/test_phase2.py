"""ML phase 2 tests: interval calibration + real-data (Supabase) training path.

    pytest -q tests
"""

from __future__ import annotations

import math
import sys
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from duration_model import train as train_mod
from duration_model.calibrate import MAX_FACTOR, MIN_CALIBRATE_ROWS, fit_factor, main as calibrate_main
from duration_model.model_store import DurationModel
from duration_model.train import load_activities, main, normalize_activities


# ---------------------------------------------------------------- calibration

def test_fit_factor_already_covered_stays_uncalibrated():
    actual = [10.0, 10.0, 10.0, 10.0]
    med = [10.0, 10.0, 10.0, 10.0]
    low = [5.0, 5.0, 5.0, 5.0]
    high = [15.0, 15.0, 15.0, 15.0]
    out = fit_factor(actual, low, med, high, target=0.80)
    assert out["factor"] == 1.0, "bands already covering must not narrow"
    assert out["achieved_coverage"] == 1.0
    assert out["n"] == 4


def test_fit_factor_widens_undercovering_bands():
    rng = np.random.default_rng(7)
    actual = 30.0 + rng.normal(0, 8, 400)          # noisy reality
    med = np.full(400, 30.0)
    low, high = med - 3.0, med + 3.0               # ±10 % band → ~30 % coverage
    before = float(np.mean((actual >= low) & (actual <= high)))
    out = fit_factor(actual, low, med, high, target=0.80)
    assert before < 0.5
    assert 1.0 < out["factor"] <= MAX_FACTOR
    assert out["achieved_coverage"] >= 0.75, "factor must reach the target region"
    k = out["factor"]
    assert np.mean(np.abs(actual - med) <= k * 3.0) == pytest.approx(out["achieved_coverage"], abs=1e-3)


def test_fit_factor_caps_at_max_factor():
    actual = np.full(50, 100.0)                     # reality far outside the band
    med = np.full(50, 30.0)
    low, high = med - 1.0, med + 1.0
    out = fit_factor(actual, low, med, high, target=0.80)
    assert out["factor"] == MAX_FACTOR, "never widen beyond the cap"


def test_fit_factor_skips_degenerate_bands():
    actual = [10.0, 10.0, 10.0]
    med = [10.0, 10.0, 10.0]
    low = [5.0, 10.0, 5.0]                          # row 2: zero-width band
    high = [15.0, 10.0, 15.0]
    out = fit_factor(actual, low, med, high)
    assert out["n"] == 2
    assert out["skipped"] == 1


def test_fit_factor_rejects_all_degenerate():
    with pytest.raises(ValueError):
        fit_factor([1.0], [1.0], [1.0], [1.0])


# ------------------------------------------------- server-side application

class _StubModel:
    def __init__(self, log_factor: float):
        self._v = log_factor

    def predict(self, x):
        return np.array([self._v])


def _store_with(bundle: dict) -> DurationModel:
    store = DurationModel.__new__(DurationModel)   # skip artifact loading
    store.bundle = bundle
    store.card = None
    return store


HISTORY = [
    {"activity_type": "run", "distance_km": 5.0, "duration_min": 30.0},
    {"activity_type": "run", "distance_km": 8.0, "duration_min": 49.0},
    {"activity_type": "run", "distance_km": 10.0, "duration_min": 63.0},
]


def _predict(store: DurationModel) -> dict:
    return store.predict(
        activity_type="run",
        distance_km=10.0,
        elevation_gain_m=0.0,
        weight_kg=60.0,
        history=HISTORY,
    )


def test_model_store_applies_calibration_factor():
    base_bundle = {
        "models": {
            "q10": _StubModel(math.log(0.9)),
            "q50": _StubModel(math.log(1.0)),
            "q90": _StubModel(math.log(1.1)),
        }
    }
    plain = _predict(_store_with(dict(base_bundle)))
    calibrated = _predict(_store_with({**base_bundle, "calibration": {"factor": 3.0}}))

    assert calibrated["minutes"] == plain["minutes"], "median must not move"
    width_plain = plain["range"]["high"] - plain["range"]["low"]
    width_cal = calibrated["range"]["high"] - calibrated["range"]["low"]
    assert width_cal > width_plain * 2.5, "band widens by ~the factor"
    assert calibrated["confidence"] < plain["confidence"], "wider band = lower confidence"


def test_model_store_without_calibration_is_unchanged():
    bundle = {
        "models": {
            "q10": _StubModel(math.log(0.9)),
            "q50": _StubModel(math.log(1.0)),
            "q90": _StubModel(math.log(1.1)),
        }
    }
    out = _predict(_store_with(bundle))
    assert out["range"]["low"] < out["minutes"] < out["range"]["high"]


# --------------------------------------------------- supabase source path

EXPECTED_COLS = [
    "id", "user_id", "activity_type", "distance_km", "elevation_gain_m",
    "duration_min", "calories", "started_at", "weight_kg", "experience_level",
]


def test_supabase_requires_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(SystemExit, match="DATABASE_URL"):
        load_activities("supabase", None)


def test_supabase_requires_psycopg(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/trana")
    monkeypatch.setitem(sys.modules, "psycopg", None)  # `import psycopg` → ImportError
    with pytest.raises(SystemExit, match="psycopg"):
        load_activities("supabase", None)


def test_supabase_loader_reads_expected_shape(monkeypatch):
    from decimal import Decimal

    class Col:
        def __init__(self, name):
            self.name = name

    class Cursor:
        description = [Col(c) for c in EXPECTED_COLS]

        def execute(self, query):
            self.query = query

        def fetchall(self):
            # Postgres numeric columns arrive as Decimal; nullable cols may be None.
            return [(1, 2, "run", Decimal("5.0"), None, Decimal("30.0"), 300, "2026-11-01T07:00:00", Decimal("62.0"), 3)]

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    class Conn:
        def cursor(self):
            return Cursor()

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/trana")
    monkeypatch.setitem(sys.modules, "psycopg", SimpleNamespace(connect=lambda dsn: Conn()))

    frame = load_activities("supabase", None)
    assert list(frame.columns) == EXPECTED_COLS
    assert len(frame) == 1
    assert frame.iloc[0]["activity_type"] == "run"
    assert frame.iloc[0]["weight_kg"] == pytest.approx(62.0)
    assert frame.iloc[0]["elevation_gain_m"] == pytest.approx(0.0)


def test_cli_refuses_tiny_real_corpus(tmp_path, monkeypatch):
    """A barely-started Supabase source must not replace the trained model."""
    tiny = tmp_path / "tiny.csv"
    pd.DataFrame(
        {
            "user_id": [1, 1, 1],
            "activity_type": ["run"] * 3,
            "distance_km": [5.0, 6.0, 7.0],
            "duration_min": [30.0, 36.0, 42.0],
        }
    ).to_csv(tiny, index=False)
    monkeypatch.setattr(sys, "argv", ["train", "--source", "csv", "--csv", str(tiny)])
    with pytest.raises(SystemExit, match="200"):
        main()


def test_calibrate_cli_refuses_tiny_corpus(tmp_path, monkeypatch):
    """Calibration also enforces a minimum row floor before fitting k."""
    tiny = tmp_path / "tiny_cal.csv"
    pd.DataFrame(
        {
            "user_id": ["u1"] * 5,
            "activity_type": ["run"] * 5,
            "distance_km": [5.0] * 5,
            "duration_min": [30.0] * 5,
        }
    ).to_csv(tiny, index=False)
    monkeypatch.setattr(sys, "argv", ["calibrate", "--csv", str(tiny)])
    with pytest.raises(SystemExit, match=str(MIN_CALIBRATE_ROWS)):
        calibrate_main()


def test_normalize_activities_handles_lean_external_csv():
    lean = pd.DataFrame(
        [
            {"user_id": "u1", "activity_type": "walk", "distance_km": 1.0, "duration_min": 12.0},
            {"user_id": "u1", "activity_type": "walk", "distance_km": 2.0, "duration_min": 25.0},
        ]
    )
    out = normalize_activities(lean)
    assert {"id", "elevation_gain_m", "weight_kg", "experience_level"} <= set(out.columns)
    assert list(out["id"]) == [1, 2]
    assert (out["weight_kg"] == 60.0).all()


def test_train_and_calibrate_roundtrip_on_isolated_dir(tmp_path, monkeypatch):
    """Holdout calibration writes factor into joblib, browser json, and card."""
    import json
    import shutil

    monkeypatch.setattr(train_mod, "ARTIFACTS", tmp_path)

    rng = np.random.default_rng(7)
    rows = []
    for u in range(10):
        for i in range(12):
            d = float(3 + i)
            rows.append(
                {
                    "user_id": u,
                    "activity_type": "run",
                    "distance_km": d,
                    "duration_min": float(d * 6.0 * (1.0 + rng.normal(0, 0.15))),
                    "elevation_gain_m": float((i % 4) * 25),
                    "weight_kg": 62.0,
                    "experience_level": 2,
                }
            )
    card = train_mod.train(
        pd.DataFrame(rows),
        seed=7,
        training_source="csv",
        calibrate_on_holdout=True,
    )
    assert card["calibration"] is not None
    assert 1.0 <= card["calibration"]["factor"] <= MAX_FACTOR
    exported = json.loads((tmp_path / "duration_model.json").read_text())
    assert exported["calibration"]["factor"] == card["calibration"]["factor"]

    # Standalone calibrate --write updates all three artifacts in place.
    cal_csv = tmp_path / "lean_cal.csv"
    pd.DataFrame(rows[:40])[["user_id", "activity_type", "distance_km", "duration_min"]].to_csv(cal_csv, index=False)
    copy_dir = tmp_path / "copy"
    copy_dir.mkdir()
    for fname in ("duration_model.joblib", "duration_model.json", "model_card.json"):
        shutil.copy2(tmp_path / fname, copy_dir / fname)

    monkeypatch.setattr(
        sys,
        "argv",
        ["calibrate", "--csv", str(cal_csv), "--bundle", str(copy_dir / "duration_model.joblib"), "--target", "0.90", "--write"],
    )
    calibrate_main()
    updated_card = json.loads((copy_dir / "model_card.json").read_text())
    updated_json = json.loads((copy_dir / "duration_model.json").read_text())
    assert updated_card["calibration"]["target_coverage"] == 0.90
    assert updated_json["calibration"] == updated_card["calibration"]

