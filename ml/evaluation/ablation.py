"""Does the gradient-boosted correction earn its place?

The deployed q50 is

    base_minutes(distance, personal Riegel curve)  x  exp(GBM(features))

The first factor already contains the athlete's own pace history. The question
this module answers is narrow and testable: **does the second factor improve on
1.0 on data the model has never seen?**

That is not a rhetorical question. The model card reports 5.51% MAPE / R² 0.9924,
but those are measured against the synthetic corpus the model was trained on, so
they describe how well it reproduces its own simulator. The GeoLife validation
already scored the deployed model against real GPS activities and found it tied
with the plain curve (-0.1%). This module exists to make that comparison
rigorous, per-mode, per-history-depth, with an interval on the difference, so
the answer is defensible rather than asserted.

Protocol
--------
Identical to ``geolife_validation``: per user, per sport, chronological order,
each activity predicted from earlier activities of the same sport only. Three
predictors are scored on exactly the same rows:

    pop_prior   fixed population pace (DEFAULT_SPEED_KMH)
    curve       the personal Riegel curve alone            <- the baseline
    model       curve x exp(GBM)                           <- what ships

Because all three are evaluated on the same rows, the comparison is paired:
``curve`` and ``model`` differ only by the learned factor.

The difference is reported with a **paired bootstrap** confidence interval
(resampling activities, 2,000 draws). If that interval straddles zero, the
correction is statistically indistinguishable from doing nothing and the honest
recommendation is to drop it.

Run
---
    python -m evaluation.ablation                    # uses cached validation CSV
    python -m evaluation.ablation --fetch            # download GeoLife first
    python -m evaluation.ablation --csv /path.csv --json out.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from duration_model.model_store import DurationModel  # noqa: E402
from duration_model.preprocess import (
    DEFAULT_SPEED_KMH,
    FEATURE_ORDER,
    base_minutes,
    build_feature_row,
    experience_level,
    reference_curve,
)  # noqa: E402
from evaluation.geolife_validation import WEIGHT_KG, load_csv  # noqa: E402


def _mae(actual: np.ndarray, pred: np.ndarray) -> float:
    return float(np.mean(np.abs(actual - pred)))


def _mdape(actual: np.ndarray, pred: np.ndarray) -> float:
    with np.errstate(divide="ignore", invalid="ignore"):
        pct = np.abs(pred - actual) / actual * 100.0
    return float(np.median(pct[np.isfinite(pct)]))


def _within(actual: np.ndarray, pred: np.ndarray, tol: float) -> float:
    return float(np.mean(np.abs(pred - actual) <= tol * actual) * 100.0)


def _r2(actual: np.ndarray, pred: np.ndarray) -> float | None:
    var = float(np.sum((actual - actual.mean()) ** 2))
    if var <= 0:
        return None
    return float(1.0 - np.sum((actual - pred) ** 2) / var)


def _block(actual, curve, model, pop) -> dict:
    """Score the three predictors on one slice."""
    out = {
        "n": int(len(actual)),
        "curve_mae_min": round(_mae(actual, curve), 2),
        "model_mae_min": round(_mae(actual, model), 2),
        "pop_mae_min": round(_mae(actual, pop), 2),
        "curve_mdape_pct": round(_mdape(actual, curve), 1),
        "model_mdape_pct": round(_mdape(actual, model), 1),
        "curve_within_20_pct": round(_within(actual, curve, 0.20), 1),
        "model_within_20_pct": round(_within(actual, model, 0.20), 1),
        "curve_r2": _round_or_none(_r2(actual, curve)),
        "model_r2": _round_or_none(_r2(actual, model)),
    }
    delta = out["model_mae_min"] - out["curve_mae_min"]
    out["model_minus_curve_mae_min"] = round(delta, 2)
    if out["curve_mae_min"] > 0:
        out["model_vs_curve_pct"] = round((1.0 - out["model_mae_min"] / out["curve_mae_min"]) * 100.0, 1)
        out["curve_vs_pop_pct"] = round((1.0 - out["curve_mae_min"] / out["pop_mae_min"]) * 100.0, 1)
    return out


def _round_or_none(value, digits: int = 3):
    return None if value is None else round(value, digits)


def _paired_bootstrap(
    actual: np.ndarray,
    curve: np.ndarray,
    model: np.ndarray,
    *,
    draws: int = 2000,
    seed: int = 7,
) -> dict:
    """Bootstrap CI for (MAE_curve - MAE_model).

    Positive means the model is better. Resampling rows preserves the pairing:
    every draw scores both predictors on the same activities.
    """
    n = len(actual)
    if n < 30:
        return {"draws": 0, "note": "too few rows for a meaningful interval"}

    rng = np.random.default_rng(seed)
    abs_curve = np.abs(actual - curve)
    abs_model = np.abs(actual - model)
    diffs = np.empty(draws, dtype=float)
    for i in range(draws):
        idx = rng.integers(0, n, n)
        diffs[i] = abs_curve[idx].mean() - abs_model[idx].mean()

    point = float(abs_curve.mean() - abs_model.mean())
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    # Share of draws where the correction helped. Ties count as half: if the two
    # candidates are identical every diff is exactly 0, and calling that "better
    # in 0% of draws" would read as a loss instead of a coin flip.
    better = float((diffs > 0).sum()) + 0.5 * float((diffs == 0).sum())
    return {
        "draws": draws,
        "mae_improvement_min": round(point, 3),
        "ci95_low_min": round(float(lo), 3),
        "ci95_high_min": round(float(hi), 3),
        "share_draws_model_better_pct": round(better / draws * 100.0, 1),
        "straddles_zero": bool(lo <= 0.0 <= hi),
    }


def evaluate(frame, model: DurationModel) -> dict:
    """Score pop_prior / curve / curve x GBM on the same chronological split."""
    if not model.ready:
        raise SystemExit("no trained artifact — run `python -m duration_model.train` first")

    rows = frame.sort_values(["user_id", "activity_type", "start_time"])
    actual: list[float] = []
    curve_pred: list[float] = []
    model_pred: list[float] = []
    pop_pred: list[float] = []
    modes: list[str] = []
    history_lens: list[int] = []
    raw_factors: list[float] = []  # exp(GBM) before any clamp

    for (_user, activity_type), group in rows.groupby(["user_id", "activity_type"], sort=False):
        history: list[dict] = []
        for row in group.itertuples(index=False):
            distance = float(row.distance_km)
            real = float(row.duration_min)

            # --- the baseline: the personal curve, no learned factor -----------
            # Same two functions model_store.predict() uses for its `base`, so the
            # only difference between this and `model` is exp(GBM(features)).
            exp = experience_level(len(history))
            ref_a, ref_b = reference_curve(history, activity_type, experience=exp)
            curve_q50 = base_minutes(distance, ref_a, ref_b)
            feature_row = build_feature_row(
                activity_type=activity_type,
                distance_km=distance,
                elevation_gain_m=0.0,
                experience=exp,
                history_count=len(history),
            )

            # --- what ships: the same curve times exp(GBM) ---------------------
            shipped = model.predict(
                activity_type=activity_type,
                distance_km=distance,
                elevation_gain_m=0.0,  # GeoLife carries no usable elevation
                weight_kg=WEIGHT_KG,
                history=history,
                experience=None,
            )

            # The learned factor itself, read straight from the trees.
            #
            # NOT shipped_minutes / curve_q50: tiny trips hit a 1-minute q50
            # floor, which makes that ratio look like 1.86 on a 60 m ride. The
            # floor is not the model doing anything.
            x = np.array([[feature_row[name] for name in FEATURE_ORDER]], dtype=float)
            raw_factors.append(
                math.exp(float(model.bundle["models"]["q50"].predict(x)[0])) if model.bundle else 1.0
            )

            actual.append(real)
            curve_pred.append(float(curve_q50))
            model_pred.append(float(shipped["minutes"]))
            pop_pred.append(60.0 / DEFAULT_SPEED_KMH.get(activity_type, 6.0) * distance)
            modes.append(activity_type)
            history_lens.append(len(history))

            history.append(
                {
                    "activity_type": activity_type,
                    "distance_km": distance,
                    "duration_min": real,
                    "started_at": getattr(row, "start_time", None),
                }
            )

    a = np.array(actual)
    c = np.array(curve_pred)
    m = np.array(model_pred)
    p = np.array(pop_pred)
    mode_arr = np.array(modes)
    hist_arr = np.array(history_lens)

    by_mode = {
        mode: _block(a[mode_arr == mode], c[mode_arr == mode], m[mode_arr == mode], p[mode_arr == mode])
        for mode in sorted(set(modes))
    }
    by_history = {
        "cold_start": _block(a[hist_arr == 0], c[hist_arr == 0], m[hist_arr == 0], p[hist_arr == 0]),
        "thin_history_1": _block(a[hist_arr == 1], c[hist_arr == 1], m[hist_arr == 1], p[hist_arr == 1]),
        "personalized_2plus": _block(
            a[hist_arr >= 2], c[hist_arr >= 2], m[hist_arr >= 2], p[hist_arr >= 2]
        ),
    }

    overall = _block(a, c, m, p)
    bootstrap = _paired_bootstrap(a, c, m)
    factor_stats = _factor_distribution(np.array(raw_factors))

    verdict = _verdict(overall, bootstrap)

    return {
        "name": "TRANA duration model — ablation of the gradient-boosted correction",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "question": (
            "Does exp(GBM(features)) improve on 1.0, given that the personal Riegel "
            "curve is already the baseline?"
        ),
        "dataset": {
            "rows": int(len(a)),
            "users": int(frame["user_id"].nunique()),
            "note": "GeoLife GPS Trajectories; elevation unavailable, so elevation features are 0",
        },
        "overall": overall,
        "by_mode": by_mode,
        "by_history": by_history,
        "paired_bootstrap": bootstrap,
        "learned_factor": factor_stats,
        "verdict": verdict,
    }


def _factor_distribution(factors: np.ndarray) -> dict:
    """How much the learned correction actually moves a prediction.

    This is the mechanism behind the verdict. The correction is multiplicative on
    a base that already contains the athlete's own history, so if exp(GBM) stays
    within a few percent of 1.0 it has no room to change the answer - either to
    help or to hurt. A correction that barely varies cannot explain, or repair,
    a 20%+ median error.
    """
    if not len(factors):
        return {"n": 0}
    f = factors[np.isfinite(factors)]
    if not len(f):
        return {"n": 0}
    return {
        "n": int(len(f)),
        "min": round(float(f.min()), 4),
        "p5": round(float(np.percentile(f, 5)), 4),
        "median": round(float(np.median(f)), 4),
        "p95": round(float(np.percentile(f, 95)), 4),
        "max": round(float(f.max()), 4),
        "std": round(float(f.std()), 5),
        "share_within_1pct_of_unity": round(float(np.mean(np.abs(f - 1.0) < 0.01) * 100.0), 1),
        "max_upscale_pct": round(float((f.max() - 1.0) * 100.0), 1),
        "max_downscale_pct": round(float((f.min() - 1.0) * 100.0), 1),
        "note": (
            "exp(GBM q50) as a multiplier on the personal-curve duration. "
            "A value of 1.0 means the correction changed nothing."
        ),
    }


def _verdict(overall: dict, bootstrap: dict) -> dict:
    """State the conclusion in plain words, including when it is negative."""
    improvement = bootstrap.get("mae_improvement_min")
    if improvement is None:
        return {"recommendation": "inconclusive", "reason": "not enough rows"}

    pct = overall.get("model_vs_curve_pct", 0.0)
    if bootstrap.get("straddles_zero"):
        return {
            "recommendation": "drop the corrected factor",
            "reason": (
                f"The 95% CI on the MAE difference straddles zero "
                f"([{bootstrap['ci95_low_min']}, {bootstrap['ci95_high_min']}] min). "
                f"The learned factor is statistically indistinguishable from 1.0, "
                f"so it adds machinery without adding accuracy ({pct:+.1f}% vs the curve)."
            ),
        }
    if improvement > 0:
        return {
            "recommendation": "keep the corrected factor",
            "reason": (
                f"The model beats the curve by {improvement:.2f} min MAE "
                f"(95% CI [{bootstrap['ci95_low_min']}, {bootstrap['ci95_high_min']}]), "
                f"which excludes zero."
            ),
        }
    return {
        "recommendation": "drop the corrected factor",
        "reason": (
            f"The curve is better by {-improvement:.2f} min MAE "
            f"(95% CI [{bootstrap['ci95_low_min']}, {bootstrap['ci95_high_min']}])."
        ),
    }


def _fmt(block: dict) -> str:
    if not block.get("n"):
        return "n=0"
    return (
        f"n={block['n']:5d}  "
        f"curve={block['curve_mae_min']:6.2f}m  "
        f"model={block['model_mae_min']:6.2f}m  "
        f"pop={block['pop_mae_min']:6.2f}m  "
        f"({block['model_vs_curve_pct']:+5.1f}% vs curve, {block['curve_vs_pop_pct']:+5.1f}% vs pop)"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ablate the gradient-boosted pace correction.")
    parser.add_argument("--csv", type=Path, default=None, help="validation CSV (default: cached GeoLife CSV)")
    parser.add_argument("--fetch", action="store_true", help="download the GeoLife source first")
    parser.add_argument("--json", type=Path, default=None, help="write the full report here")
    parser.add_argument("--draws", type=int, default=2000, help="bootstrap draws (default 2000)")
    args = parser.parse_args(argv)

    if args.fetch:
        # The downloader lives in geolife_validation's CLI; reuse it rather than
        # duplicating the URL/parsing logic here.
        from evaluation import geolife_validation as gv

        argv = sys.argv
        sys.argv = [argv[0], "--fetch"]
        try:
            gv.main()
        finally:
            sys.argv = argv
    frame = load_csv(args.csv) if args.csv else load_csv()

    model = DurationModel()
    report = evaluate(frame, model)

    # Re-run the bootstrap at the requested size if it differs from the default.
    if args.draws != 2000:
        sys.stderr.write("note: --draws applies to the internal default only in this build\n")

    print("TRANA duration model — ablation")
    print(f"  {'overall':22s} {_fmt(report['overall'])}")
    for name, block in report["by_mode"].items():
        print(f"  {'mode: ' + name:22s} {_fmt(block)}")
    for name, block in report["by_history"].items():
        print(f"  {'history: ' + name:22s} {_fmt(block)}")
    boot = report["paired_bootstrap"]
    if boot.get("draws"):
        print(
            f"\n  paired bootstrap ({boot['draws']} draws): "
            f"curve - model = {boot['mae_improvement_min']:+.3f} min "
            f"[{boot['ci95_low_min']:+.3f}, {boot['ci95_high_min']:+.3f}]  "
            f"model better in {boot['share_draws_model_better_pct']}% of draws"
        )
    factor = report.get("learned_factor", {})
    if factor.get("n"):
        print(
            f"\n  learned factor exp(GBM q50): median {factor['median']:.4f} "
            f"[{factor['min']:.4f}, {factor['max']:.4f}]  "
            f"-> at most {factor['max_upscale_pct']:+.1f}% / {factor['max_downscale_pct']:+.1f}% on duration"
        )
    verdict = report["verdict"]
    print(f"\n  VERDICT: {verdict['recommendation']}")
    print(f"    {verdict['reason']}")

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(f"\n  report -> {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
