"""Tests for the duration-model ablation.

The ablation asks one question: once the personal curve is the baseline, does
multiplying by exp(GBM(features)) buy any accuracy? These tests pin the
*measurement* - that the comparison is genuinely paired, that the bootstrap is
deterministic and centred on zero when the two candidates are identical, and
that a correction which never leaves 1.0 is reported as such.

They deliberately do NOT pin the GeoLife numbers. Those move when the dataset
or the artifact is retrained; the method must hold either way.

    pip install -r requirements-dev.txt
    pytest -q
"""

from __future__ import annotations

import numpy as np
import pytest

from evaluation import ablation


# --- helpers ---------------------------------------------------------------


def _identical(n: int = 200, seed: int = 0):
    """Two candidates that predict exactly the same thing."""
    rng = np.random.default_rng(seed)
    actual = rng.uniform(100.0, 200.0, n)
    pred = actual + rng.normal(0.0, 5.0, n)
    return actual, pred, pred.copy()


# --- metric primitives -----------------------------------------------------


def test_mae_is_mean_absolute_error():
    actual = np.array([10.0, 20.0, 30.0])
    pred = np.array([12.0, 18.0, 33.0])
    assert ablation._mae(actual, pred) == pytest.approx((2 + 2 + 3) / 3)


def test_mdape_ignores_zero_actuals():
    """A zero-duration row must not divide by zero."""
    actual = np.array([0.0, 100.0])
    pred = np.array([5.0, 50.0])
    assert ablation._mdape(actual, pred) == pytest.approx(50.0)


def test_within_counts_rows_inside_tolerance():
    actual = np.array([100.0, 100.0, 100.0])
    pred = np.array([105.0, 115.0, 130.0])  # within 10%, within 20%, outside
    assert ablation._within(actual, pred, 0.10) == pytest.approx(100 / 3)
    assert ablation._within(actual, pred, 0.20) == pytest.approx(200 / 3)


def test_r2_is_one_for_a_perfect_prediction():
    actual = np.array([1.0, 2.0, 3.0, 4.0])
    assert ablation._r2(actual, actual.copy()) == pytest.approx(1.0)


def test_r2_is_none_when_actuals_have_no_variance():
    assert ablation._r2(np.array([5.0, 5.0]), np.array([5.0, 6.0])) is None


# --- the pairing is the whole point ---------------------------------------


def test_block_reports_model_minus_curve_in_both_units():
    actual = np.array([100.0, 200.0])
    curve = np.array([110.0, 210.0])  # MAE 10
    model = np.array([105.0, 205.0])  # MAE 5
    block = ablation._block(actual, curve, model, np.array([150.0, 300.0]))
    assert block["curve_mae_min"] == pytest.approx(10.0)
    assert block["model_mae_min"] == pytest.approx(5.0)
    assert block["model_minus_curve_mae_min"] == pytest.approx(-5.0)
    assert block["model_vs_curve_pct"] == pytest.approx(50.0)  # positive = better


def test_bootstrap_ci_brackets_zero_when_candidates_are_identical():
    """Same predictor twice must not manufacture a win."""
    actual, curve, model = _identical()
    boot = ablation._paired_bootstrap(actual, curve, model, draws=500)
    assert boot["straddles_zero"] is True
    assert boot["ci95_low_min"] <= 0.0 <= boot["ci95_high_min"]
    # A fair coin: neither side should dominate.
    assert 25.0 <= boot["share_draws_model_better_pct"] <= 75.0


def test_bootstrap_detects_a_real_improvement():
    """A model that is uniformly better must be called better."""
    actual, curve, _ = _identical()
    model = actual.copy()  # perfect predictions
    boot = ablation._paired_bootstrap(actual, curve, model, draws=500)
    assert boot["straddles_zero"] is False
    # Positive = the model has the lower MAE.
    assert boot["mae_improvement_min"] > 0.0
    assert boot["ci95_low_min"] > 0.0
    assert boot["share_draws_model_better_pct"] == pytest.approx(100.0)


def test_bootstrap_is_deterministic():
    """Same seed, same numbers - the report must be reproducible."""
    actual, curve, model = _identical()
    first = ablation._paired_bootstrap(actual, curve, model, draws=300)
    second = ablation._paired_bootstrap(actual, curve, model, draws=300)
    assert first == second


def test_bootstrap_uses_paired_resampling():
    """Resampling rows, not independent draws, keeps the variance small.

    With identical candidates the difference is exactly zero on every row, so
    the CI must collapse to zero no matter which rows get drawn.
    """
    rng = np.random.default_rng(3)
    actual = rng.uniform(20.0, 60.0, 40)
    pred = actual + rng.normal(0.0, 3.0, 40)
    boot = ablation._paired_bootstrap(actual, pred, pred.copy(), draws=200)
    assert boot["mae_improvement_min"] == pytest.approx(0.0, abs=1e-9)
    assert boot["ci95_low_min"] == pytest.approx(0.0, abs=1e-9)
    assert boot["ci95_high_min"] == pytest.approx(0.0, abs=1e-9)


def test_bootstrap_declines_to_quote_an_interval_from_too_few_rows():
    """Guessing a CI from a handful of activities would be false precision."""
    actual, curve, model = _identical(n=10)
    assert ablation._paired_bootstrap(actual, curve, model) == {
        "draws": 0,
        "note": "too few rows for a meaningful interval",
    }


# --- the mechanism: how far the correction moves a prediction --------------


def test_factor_distribution_describes_the_multiplier():
    factors = np.array([0.9, 0.99, 1.0, 1.01, 1.1])
    stats = ablation._factor_distribution(factors)
    assert stats["n"] == 5
    assert stats["median"] == pytest.approx(1.0)
    assert stats["max_upscale_pct"] == pytest.approx(10.0)
    assert stats["max_downscale_pct"] == pytest.approx(-10.0)
    assert stats["share_within_1pct_of_unity"] == pytest.approx(20.0)  # 1.0 only


def test_factor_distribution_handles_an_empty_sample():
    assert ablation._factor_distribution(np.array([])) == {"n": 0}


def test_inert_correction_is_flagged_as_unity():
    """If exp(GBM) never leaves 1.0, the report must say so plainly."""
    stats = ablation._factor_distribution(np.ones(100))
    assert stats["min"] == pytest.approx(1.0)
    assert stats["max"] == pytest.approx(1.0)
    assert stats["max_upscale_pct"] == pytest.approx(0.0)
    assert stats["share_within_1pct_of_unity"] == pytest.approx(100.0)


# --- the verdict logic -----------------------------------------------------


def test_verdict_rejects_a_ci_that_straddles_zero():
    verdict = ablation._verdict(
        {"model_vs_curve_pct": -0.2},
        {
            "mae_improvement_min": -0.009,
            "straddles_zero": True,
            "ci95_low_min": -0.019,
            "ci95_high_min": 0.002,
        },
    )
    assert verdict["recommendation"] == "drop the corrected factor"
    assert "straddles zero" in verdict["reason"]


def test_verdict_keeps_a_correction_with_a_credible_gain():
    verdict = ablation._verdict(
        {"model_vs_curve_pct": -12.0},
        {
            "mae_improvement_min": 0.95,
            "straddles_zero": False,
            "ci95_low_min": 0.4,
            "ci95_high_min": 1.5,
        },
    )
    assert verdict["recommendation"] == "keep the corrected factor"


def test_verdict_is_inconclusive_when_there_is_no_interval():
    verdict = ablation._verdict({}, {"draws": 0})
    assert verdict["recommendation"] == "inconclusive"


# --- the scored columns are the columns we think they are ------------------


class _StubTrees:
    """Stands in for the q50 GradientBoostingRegressor."""

    def __init__(self, factor: float):
        self.factor = factor

    def predict(self, x):
        return np.full(len(x), np.log(self.factor), dtype=float)


class _StubModel:
    """A DurationModel whose learned correction is known exactly.

    A factor of 2.0 doubles every prediction, so the curve must beat it on
    every row. If evaluate() ever scores the wrong array in the `model`
    column, this test fails instead of quietly reporting a tie.
    """

    def __init__(self, factor: float):
        self.factor = factor
        self.ready = True
        self.bundle = {"models": {"q50": _StubTrees(factor)}}

    def predict(self, *, activity_type, distance_km, elevation_gain_m, weight_kg, history, experience):
        from duration_model.preprocess import base_minutes, experience_level, reference_curve

        # Mirror exactly what evaluate() does for its curve column, so the only
        # difference between the two columns is this stub's factor.
        exp = experience_level(len(history))
        a, b = reference_curve(history, activity_type, experience=exp)
        return {"minutes": base_minutes(distance_km, a, b) * self.factor}


def test_a_wrong_learned_factor_is_scored_as_wrong():
    """Doubling every prediction must show up as a large MAE penalty."""
    report = ablation.evaluate(_frame(users=4, each=12), _StubModel(factor=2.0))
    overall = report["overall"]
    assert overall["model_mae_min"] > overall["curve_mae_min"]
    assert overall["model_vs_curve_pct"] < 0.0
    assert report["learned_factor"]["median"] == pytest.approx(2.0)
    assert report["learned_factor"]["max_upscale_pct"] == pytest.approx(100.0)
    assert report["verdict"]["recommendation"] == "drop the corrected factor"


def test_an_inert_learned_factor_produces_a_tie_not_a_win():
    """factor == 1.0 means the correction changed nothing, and must say so."""
    report = ablation.evaluate(_frame(users=4, each=12), _StubModel(factor=1.0))
    overall = report["overall"]
    assert overall["model_mae_min"] == pytest.approx(overall["curve_mae_min"])
    assert overall["model_minus_curve_mae_min"] == pytest.approx(0.0)
    assert report["learned_factor"]["share_within_1pct_of_unity"] == pytest.approx(100.0)
    # The curve and the model are the same predictor, so the interval must not
    # separate: whatever the draws, zero stays inside it.
    assert report["paired_bootstrap"]["straddles_zero"] is True


# --- end to end on a frame the shipped artifact can score ------------------


def _frame(users: int = 2, each: int = 6):
    """A small synthetic frame; enough to exercise evaluate() end to end."""
    import pandas as pd

    rows = []
    for user in [f"u{i}" for i in range(users)]:
        for i in range(each):
            rows.append(
                {
                    "user_id": user,
                    "activity_type": "run",
                    "start_time": f"2008-{1 + i // 28:02d}-{1 + i % 28:02d} 08:00:00",
                    "distance_km": 5.0 + i,
                    "duration_min": 30.0 + 6 * i,
                }
            )
    return pd.DataFrame(rows)


def _tiny_frame():
    return _frame()


def test_evaluate_produces_every_slice_and_a_verdict():
    from duration_model.model_store import DurationModel

    model = DurationModel()
    if not model.ready:
        pytest.skip("no trained artifact in this checkout")

    report = ablation.evaluate(_tiny_frame(), model)

    assert report["overall"]["n"] == 12
    assert report["by_mode"]["run"]["n"] == 12
    assert sum(b["n"] for b in report["by_history"].values()) == 12
    # 12 rows is under the 30-row floor, so the bootstrap declines to guess.
    assert report["paired_bootstrap"]["draws"] == 0
    assert report["learned_factor"]["n"] == 12
    assert report["verdict"]["recommendation"]
