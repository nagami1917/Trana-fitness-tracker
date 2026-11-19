"""Tests for the held-out retraining study.

The study asks whether training on real data beats training on the synthetic
corpus, measured on people neither model has seen. Two things make or break
that claim, and both are pinned here:

  1. **The split must be by user.** A row split would put the same athlete in
     training and holdout, and the per-user reference curve is fitted from that
     athlete's own rows - so the holdout would no longer be held out. This is
     the single failure mode that would invalidate the whole result silently.
  2. **The bootstrap must be paired.** Both models score identical rows; if the
     pairing degrades into independent resampling the interval stops being a
     statement about the difference.

The measured numbers are intentionally not asserted. They move with the seed
and the corpus; the protocol is what has to hold.

    pytest -q tests/test_retrain_study.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from evaluation import retrain_study as rs


def _frame(users: int = 12, per_user: int = 6) -> pd.DataFrame:
    rows = []
    for u in range(users):
        for i in range(per_user):
            rows.append(
                {
                    "user_id": f"{u:03d}",
                    "activity_type": "walk" if i % 2 else "ride",
                    "distance_km": 2.0 + i,
                    "duration_min": 20.0 + 5 * i,
                    "start_time": f"2008-01-{i + 1:02d} 08:00:00",
                    "source_path": f"{u}/Trajectory/Labelled/x.csv",
                    "mode_original": "walk",
                }
            )
    return pd.DataFrame(rows)


# --- the split is by user, and nothing leaks -------------------------------


def test_split_puts_no_user_on_both_sides():
    frame = _frame()
    train, holdout = rs._split_users(frame)

    assert not set(train) & set(holdout), "a user appears in both sides"
    assert len(train) + len(holdout) == frame["user_id"].nunique()


def test_split_is_deterministic():
    frame = _frame()
    assert rs._split_users(frame) == rs._split_users(frame)


def test_split_respects_the_requested_fraction():
    frame = _frame(users=20)
    train, holdout = rs._split_users(frame)
    assert len(holdout) == round(20 * rs.HOLDOUT_USER_FRACTION)


def test_split_survives_a_tiny_corpus():
    """Two users must still produce a usable split, not an empty side."""
    train, holdout = rs._split_users(_frame(users=2, per_user=2))
    assert holdout and train


def test_training_csv_contains_only_training_users():
    frame = _frame()
    train, _holdout = rs._split_users(frame)
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmp:
        out = rs._prepare_training_csv(frame, train, Path(tmp) / "train.csv")
        written = pd.read_csv(out, dtype={"user_id": str})

    assert set(written["user_id"].unique()) <= set(train)
    assert not set(written["user_id"].unique()) & set(_holdout)


def test_drop_list_actually_covers_the_location_column():
    """The trainer's audit rejects `source_path`, so the drop list must name it.

    Pinned separately from the CSV round-trip below: if someone empties
    DROP_BEFORE_TRAINING, the round-trip test still passes on a frame that has
    no location column, and the failure only shows up as a crashed training run.
    """
    assert "source_path" in rs.DROP_BEFORE_TRAINING


def test_training_csv_drops_location_and_redundant_columns():
    """`source_path` embeds a raw GPS path; the trainer's audit rejects it."""
    frame = _frame()
    train, _ = rs._split_users(frame)
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmp:
        out = rs._prepare_training_csv(frame, train, Path(tmp) / "train.csv")
        written = pd.read_csv(out, dtype={"user_id": str})

    for column in rs.DROP_BEFORE_TRAINING:
        assert column not in written.columns
    # The columns training actually needs must survive.
    for column in ("user_id", "activity_type", "distance_km", "duration_min", "start_time"):
        assert column in written.columns


# --- the bootstrap is paired and honest ------------------------------------


def _rows(synthetic_pred, retrained_pred, actual):
    return pd.DataFrame(
        {
            "actual": actual,
            "synthetic_pred": synthetic_pred,
            "retrained_pred": retrained_pred,
            "activity_type": "walk",
        }
    )


def test_bootstrap_reports_zero_for_identical_predictions():
    rng = np.random.default_rng(0)
    actual = rng.uniform(30, 90, 120)
    rows = _rows(actual + 3.0, actual + 3.0, actual)

    delta = rs._bootstrap_delta(rows, "synthetic", "retrained", draws=400)

    assert delta["mae_delta_min"] == pytest.approx(0.0)
    assert delta["excludes_zero"] is False
    assert delta["share_draws_a_better_pct"] == pytest.approx(50.0)


def test_bootstrap_sign_convention_is_negative_when_a_is_better():
    """`a` = synthetic here. When synthetic is better the delta must be negative."""
    actual = np.linspace(40, 100, 120)
    rows = _rows(actual + 1.0, actual + 8.0, actual)

    delta = rs._bootstrap_delta(rows, "synthetic", "retrained", draws=400)

    assert delta["mae_delta_min"] < 0
    assert delta["excludes_zero"] is True
    assert delta["share_draws_a_better_pct"] == pytest.approx(100.0)


def test_bootstrap_detects_when_b_is_better():
    actual = np.linspace(40, 100, 120)
    rows = _rows(actual + 8.0, actual + 1.0, actual)

    delta = rs._bootstrap_delta(rows, "synthetic", "retrained", draws=400)

    assert delta["mae_delta_min"] > 0
    assert delta["excludes_zero"] is True


def test_bootstrap_is_deterministic():
    actual = np.linspace(40, 100, 120)
    rows = _rows(actual + 2.0, actual + 5.0, actual)
    first = rs._bootstrap_delta(rows, "synthetic", "retrained", draws=300)
    second = rs._bootstrap_delta(rows, "synthetic", "retrained", draws=300)
    assert first == second


def test_bootstrap_declines_to_quote_an_interval_from_too_few_rows():
    actual = np.arange(10, dtype=float)
    rows = _rows(actual + 1, actual + 2, actual)
    assert rs._bootstrap_delta(rows, "synthetic", "retrained")["draws"] == 0


# --- the verdict logic -----------------------------------------------------


def _scores(cov: float, mae: float = 6.0) -> dict:
    return {"n": 100, "mae_min": mae, "mdape_pct": 25.0, "mape_pct": 30.0,
            "within_20_pct": 40.0, "r2": 0.45, "interval_coverage_pct": cov,
            "anchor_base_mae_min": 6.1}


def test_verdict_calls_a_clear_win():
    delta = {"draws": 2000, "mae_delta_min": -0.5, "ci95_low_min": -0.8, "ci95_high_min": -0.2,
             "excludes_zero": True}
    verdict = rs._verdict(delta, _scores(16.0), _scores(70.0))
    assert "retraining is worth pursuing" in verdict["recommendation"]


def test_verdict_refuses_to_claim_a_win_when_the_interval_straddles_zero():
    """This is the result the study actually produced - it must not overstate."""
    delta = {"draws": 2000, "mae_delta_min": 0.06, "ci95_low_min": -0.07,
             "ci95_high_min": 0.18, "excludes_zero": False}
    verdict = rs._verdict(delta, _scores(15.9), _scores(67.8))
    assert "no measurable difference" in verdict["recommendation"]
    # The coverage change is still reported rather than dropped.
    assert "67.8" in verdict["reason"]


def test_verdict_says_so_when_synthetic_wins():
    delta = {"draws": 2000, "mae_delta_min": 0.9, "ci95_low_min": 0.3,
             "ci95_high_min": 1.4, "excludes_zero": True}
    verdict = rs._verdict(delta, _scores(16.0), _scores(70.0))
    assert "synthetic model generalises better" in verdict["recommendation"]


def test_verdict_is_inconclusive_without_an_interval():
    assert rs._verdict({"draws": 0}, _scores(16.0), _scores(70.0))["recommendation"] == "inconclusive"
