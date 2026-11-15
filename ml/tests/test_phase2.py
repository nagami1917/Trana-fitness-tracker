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
from duration_model.audit import audit_activities
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
    "id", "user_id", "activity_type", "distance_km", "duration_min",
    "started_at", "elevation_gain_m", "experience_level",
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

    queries = []

    class Cursor:
        description = [Col(c) for c in (
            "user_id", "activity_type", "distance_km", "duration_min", "started_at", "elevation_gain_m"
        )]

        def execute(self, query):
            self.query = query
            queries.append(query)

        def fetchall(self):
            # Postgres numeric columns arrive as Decimal; nullable cols may be None.
            return [(2, "run", Decimal("5.0"), Decimal("30.0"), "2026-11-01T07:00:00", None)]

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
    assert "fitness_profiles" not in queries[0]
    assert frame.iloc[0]["activity_type"] == "run"
    assert frame.iloc[0]["experience_level"] == 1
    assert "calories" not in frame.columns
    assert "weight_kg" not in frame.columns
    assert frame.iloc[0]["elevation_gain_m"] == pytest.approx(0.0)


def test_csv_loader_preserves_stable_pseudonym_strings(tmp_path):
    csv_path = tmp_path / "activities.csv"
    pd.DataFrame({
        "user_id": ["0000123"], "activity_type": ["walk"],
        "distance_km": [1.0], "duration_min": [12.0],
        "started_at": ["2026-01-01T08:00:00Z"],
    }).to_csv(csv_path, index=False)
    frame = load_activities("csv", str(csv_path))
    assert frame.loc[0, "user_id"] == "0000123"


def test_cli_refuses_tiny_real_corpus(tmp_path, monkeypatch):
    """A small local CSV must not replace the shipped model."""
    tiny = tmp_path / "tiny.csv"
    pd.DataFrame(
        {
            "user_id": [1, 1, 1],
            "activity_type": ["run"] * 3,
            "distance_km": [5.0, 6.0, 7.0],
            "duration_min": [30.0, 36.0, 42.0],
            "started_at": ["2026-01-01T08:00:00Z", "2026-01-02T08:00:00Z", "2026-01-03T08:00:00Z"],
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
            "started_at": [f"2026-01-{i + 1:02d}T08:00:00Z" for i in range(5)],
        }
    ).to_csv(tiny, index=False)
    monkeypatch.setattr(sys, "argv", ["calibrate", "--csv", str(tiny)])
    with pytest.raises(SystemExit, match=str(MIN_CALIBRATE_ROWS)):
        calibrate_main()


def test_normalize_activities_handles_lean_external_csv():
    lean = pd.DataFrame(
        [
            {"user_id": "u1", "activity_type": "walk", "distance_km": 1.0, "duration_min": 12.0, "started_at": "2026-01-01T08:00:00Z"},
            {"user_id": "u1", "activity_type": "walk", "distance_km": 2.0, "duration_min": 25.0, "started_at": "2026-01-02T08:00:00Z"},
        ]
    )
    lean.index = [0, 0]
    out = normalize_activities(lean)
    assert {"id", "elevation_gain_m", "experience_level"} <= set(out.columns)
    assert "weight_kg" not in out.columns
    assert list(out["id"]) == [1, 2]


def test_training_input_rejects_pii_and_drops_unused_columns():
    unsafe = pd.DataFrame({
        "user_id": ["u1"], "activity_type": ["run"], "distance_km": [5.0],
        "duration_min": [30.0], "started_at": ["2026-01-01T08:00:00Z"],
        "email": ["runner@example.test"],
    })
    with pytest.raises(SystemExit, match="personal or raw location"):
        normalize_activities(unsafe)

    safe = unsafe.drop(columns="email").assign(calories=[300], unused_note=["not a feature"])
    normalized = normalize_activities(safe)
    assert "calories" not in normalized.columns
    assert "unused_note" not in normalized.columns
    assert set(normalized.columns) <= set(train_mod.ALLOWED_ACTIVITY_COLUMNS)


def test_normalize_rejects_raw_route_aliases_phone_ids_and_missing_time():
    safe = pd.DataFrame({
        "user_id": ["pseudo-user"], "activity_type": ["run"],
        "distance_km": [5.0], "duration_min": [30.0],
        "started_at": ["2026-01-01T08:00:00Z"],
    })
    for unsafe_column in ("routePolyline", "startLatitude", "emailAddress"):
        with pytest.raises(SystemExit, match="personal or raw location"):
            normalize_activities(safe.assign(**{unsafe_column: ["sensitive"]}))

    with pytest.raises(SystemExit, match="phone-number-like"):
        normalize_activities(safe.assign(user_id=["+1 (555) 123-4567"]))
    with pytest.raises(SystemExit, match="started_at"):
        normalize_activities(safe.drop(columns="started_at"))


def test_audit_reports_rows_users_and_readiness():
    frame = pd.DataFrame({
        "user_id": [f"u{i % 6}" for i in range(36)],
        "activity_type": ["run"] * 36,
        "distance_km": [5.0] * 36,
        "duration_min": [30.0] * 36,
        "started_at": ["2026-01-01T08:00:00Z"] * 36,
        "route_polyline": ["discard me"] * 36,
    }).drop(columns="route_polyline")
    report = audit_activities(frame)
    assert report["rows_valid"] == 36
    assert report["pseudonymous_users"] == 6
    assert report["ready_for_interval_calibration"] is True
    assert report["ready_for_full_retraining"] is False
    assert report["minimums_are_accuracy_guarantees"] is False
    assert report["minimums"]["activities_for_interval_calibration"] == MIN_CALIBRATE_ROWS
    assert any("200 valid activities" in warning for warning in report["warnings"])


def test_training_artifacts_are_not_written_into_tracked_model_directories():
    from pathlib import Path

    with pytest.raises(SystemExit, match="candidate-only"):
        train_mod._validate_artifacts_dir(train_mod.ARTIFACTS)
    with pytest.raises(SystemExit, match="candidate-only"):
        train_mod._validate_artifacts_dir(Path(train_mod.ROOT.parent) / "frontend" / "public" / "models")


def test_real_training_refuses_too_few_users(tmp_path):
    rows = [
        {
            "user_id": f"u{i % 4}", "activity_type": "run", "distance_km": 5.0 + i % 3,
            "duration_min": 30.0 + i % 4,
            "started_at": (pd.Timestamp("2026-01-01", tz="UTC") + pd.Timedelta(days=i)).isoformat(),
        }
        for i in range(200)
    ]
    with pytest.raises(SystemExit, match="distinct pseudonymous users"):
        train_mod.train(pd.DataFrame(rows), training_source="csv", artifacts_dir=tmp_path)


def test_train_and_calibrate_roundtrip_on_isolated_dir(tmp_path, monkeypatch):
    """Holdout calibration writes factor into joblib, browser json, and card."""
    import json
    import shutil

    monkeypatch.setattr(train_mod, "ARTIFACTS", tmp_path)

    rng = np.random.default_rng(7)
    rows = []
    for u in range(25):
        for i in range(12):
            d = float(3 + i)
            rows.append(
                {
                    "user_id": u,
                    "activity_type": "run",
                    "distance_km": d,
                    "duration_min": float(d * 6.0 * (1.0 + rng.normal(0, 0.15))),
                    "started_at": (pd.Timestamp("2026-01-01", tz="UTC") + pd.Timedelta(days=i)).isoformat(),
                    "elevation_gain_m": float((i % 4) * 25),
                    "experience_level": 2,
                }
            )
    with pytest.raises(SystemExit, match="athletes disjoint"):
        train_mod.train(
            pd.DataFrame(rows), training_source="csv", calibrate=pd.DataFrame(rows[:40]),
            artifacts_dir=tmp_path / "rejected",
        )

    candidate_dir = tmp_path / "candidate"
    card = train_mod.train(
        pd.DataFrame(rows),
        seed=7,
        training_source="csv",
        calibrate_on_holdout=True,
        artifacts_dir=candidate_dir,
    )
    assert card["calibration"] is not None
    assert 1.0 <= card["calibration"]["factor"] <= MAX_FACTOR
    assert card["validation"]["split_strategy"] == "80/20 GroupShuffleSplit by user_id"
    assert card["validation"]["user_overlap"] == 0
    assert card["validation"]["by_activity_type"]["run"]["n"] > 0
    assert card["validation"]["by_elevation_density"]
    assert card["validation"]["by_history"]
    assert card["data_requirements"]["minimums_are_accuracy_guarantees"] is False
    assert "mae_improvement_vs_anchor_pct" in card["metrics"]
    exported = json.loads((candidate_dir / "duration_model.json").read_text())
    assert exported["calibration"]["factor"] == card["calibration"]["factor"]
    assert DurationModel(candidate_dir).ready

    from evaluation.validate_csv import evaluate_csv

    validation_rows = [
        {
            "user_id": "heldout-runner-1", "activity_type": "run", "distance_km": distance,
            "duration_min": duration, "started_at": (pd.Timestamp("2026-03-01", tz="UTC") + pd.Timedelta(days=index)).isoformat(),
            "elevation_gain_m": 20.0,
        }
        for index, (distance, duration) in enumerate([(5.0, 31.0), (8.0, 50.0), (10.0, 63.0)])
    ]
    training_user_ids = {str(row["user_id"]) for row in rows}
    evaluation = evaluate_csv(pd.DataFrame(validation_rows), DurationModel(candidate_dir), training_user_ids)
    assert evaluation["dataset"]["rows_evaluated"] == 3
    assert evaluation["dataset"]["training_user_overlap"] == 0
    assert evaluation["by_activity_type"]["run"]["n"] == 3
    assert evaluation["by_history"]["cold_start"]["n"] == 1
    assert evaluation["by_history"]["two_or_more_prior_activities"]["n"] == 1
    assert evaluation["elevation_density_available"] is True
    assert evaluation["by_elevation_density"]["low_lt_20_m_per_km"]["interval_coverage_pct"] is not None
    assert "baseline_anchor_base_mae_min" in evaluation["overall"]
    with pytest.raises(SystemExit, match="disjoint"):
        evaluate_csv(pd.DataFrame(validation_rows), DurationModel(candidate_dir), {"heldout-runner-1"})

    # Standalone calibration writes into a separate candidate and never edits its source bundle.
    cal_csv = tmp_path / "disjoint_cal.csv"
    cal_rows = [
        {
            "user_id": f"calibration-user-{user}", "activity_type": "run",
            "distance_km": float(3 + index % 12), "duration_min": float((3 + index % 12) * 6.2),
            "started_at": (pd.Timestamp("2026-04-01", tz="UTC") + pd.Timedelta(days=index)).isoformat(),
            "elevation_gain_m": float((index % 4) * 25),
        }
        for user in range(2) for index in range(20)
    ]
    pd.DataFrame(cal_rows).to_csv(cal_csv, index=False)
    train_csv = tmp_path / "train.csv"
    pd.DataFrame(rows).to_csv(train_csv, index=False)
    source_dir = tmp_path / "source-bundle"
    source_dir.mkdir()
    for fname in ("duration_model.joblib", "duration_model.json", "model_card.json"):
        shutil.copy2(candidate_dir / fname, source_dir / fname)
    source_bundle_before = (source_dir / "duration_model.joblib").read_bytes()
    output_dir = tmp_path / "calibrated-candidate"

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "calibrate", "--csv", str(cal_csv), "--training-csv", str(train_csv),
            "--bundle", str(source_dir / "duration_model.joblib"), "--target", "0.90",
            "--output-dir", str(output_dir), "--write",
        ],
    )
    calibrate_main()
    updated_card = json.loads((output_dir / "model_card.json").read_text())
    updated_json = json.loads((output_dir / "duration_model.json").read_text())
    assert updated_card["calibration"]["target_coverage"] == 0.90
    assert updated_card["calibration"]["protocol"] == "separate_user_disjoint_csv"
    assert updated_json["calibration"] == updated_card["calibration"]
    assert (source_dir / "duration_model.joblib").read_bytes() == source_bundle_before

    calibrated_model = DurationModel(output_dir)
    with pytest.raises(SystemExit, match="calibration CSV"):
        evaluate_csv(pd.DataFrame(validation_rows), calibrated_model, training_user_ids)
    evaluation_after_calibration = evaluate_csv(
        pd.DataFrame(validation_rows), calibrated_model, training_user_ids,
        {"calibration-user-0", "calibration-user-1"},
    )
    assert evaluation_after_calibration["dataset"]["calibration_user_overlap"] == 0

