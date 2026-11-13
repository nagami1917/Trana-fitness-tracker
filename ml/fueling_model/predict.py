"""Physiology-based fueling recommendations.

The duration model answers *how long*. This module answers *how much fuel*,
using ACSM metabolic equations and the carbohydrate/electrolyte guidance used
in sports nutrition (ACSM/AND joint position stand, ISSN carbohydrate intake
guidelines). It is deliberately transparent: every number can be traced to a
formula, which matters for a health-facing product.

    calories = MET × body mass (kg) × hours
    MET      = modality & speed dependent (≈ 1.03 × km/h when running)
    carbs/h  = f(duration band, intensity)   → 0 … 90 g
    sodium/h = f(sweat profile, heat, duration)
    fluid/h  = f(sweat profile, heat)
"""

from __future__ import annotations

from dataclasses import dataclass, field

SWEAT_PROFILES = {
    # (sodium mg/h, fluid ml/h) at a neutral 22 °C
    "low": (350, 450),
    "normal": (550, 650),
    "high": (800, 900),
}

INTENSITY_BY_MET = (
    (5.0, "light"),
    (8.0, "moderate"),
    (11.0, "vigorous"),
    (99.0, "very_vigorous"),
)


@dataclass
class FuelingInput:
    activity_type: str
    duration_min: float
    weight_kg: float
    elevation_per_km: float = 0.0
    avg_speed_kmh: float | None = None
    sweat_profile: str = "normal"
    temperature_c: float = 22.0
    daily_carb_target_g: float | None = None
    energy_calibration_factor: float = 1.0
    notes: list[str] = field(default_factory=list)


def estimate_met(activity_type: str, speed_kmh: float, elevation_per_km: float = 0.0) -> float:
    # Vertical ascent work against gravity: VAM (m/h) = elev/km * km/h.
    vam_m_per_h = max(0.0, elevation_per_km) * max(0.0, speed_kmh)
    climb_coef = 0.009 if activity_type == "ride" else 0.011
    climb_bonus = min(10.0, vam_m_per_h * climb_coef)
    if activity_type == "run":
        met = speed_kmh * 1.03
    elif activity_type == "ride":
        met = 3.2 + speed_kmh * 0.29
    elif activity_type == "walk":
        met = 2.0 + speed_kmh * 0.45
    else:  # hike
        met = 3.6 + speed_kmh * 0.60
    return float(max(1.6, met + climb_bonus))


def intensity_label(met: float) -> str:
    for ceiling, label in INTENSITY_BY_MET:
        if met < ceiling:
            return label
    return "very_vigorous"


def _carb_rate_g_per_h(duration_min: float, met: float) -> float:
    """Carbs burned per hour that the gut can usefully be topped up with."""
    if duration_min < 60:
        return 0.0
    if duration_min < 90:
        base = 30.0
    elif duration_min < 150:
        base = 60.0
    else:
        base = 85.0
    # High intensity shifts fuel toward carbohydrate; easy sessions need less.
    if met >= 11:
        base *= 1.08
    elif met < 6:
        base *= 0.75
    return round(min(90.0, base), 0)


def recommend(inp: FuelingInput) -> dict:
    duration_h = max(inp.duration_min, 1.0) / 60.0
    speed = inp.avg_speed_kmh or {
        "run": 9.0,
        "ride": 21.0,
        "walk": 4.8,
        "hike": 3.8,
    }.get(inp.activity_type, 5.0)

    met = estimate_met(inp.activity_type, speed, inp.elevation_per_km)
    cal_factor = min(2.0, max(0.5, float(inp.energy_calibration_factor or 1.0)))
    calories_total = met * inp.weight_kg * duration_h * cal_factor
    intensity = intensity_label(met)

    # --- carbohydrates ----------------------------------------------------
    carb_per_h = _carb_rate_g_per_h(inp.duration_min, met)
    carbs_total = carb_per_h * duration_h
    # Body-mass benchmark for the 24 h around a session: 6–10 g/kg/day hard work.
    daily_target = inp.daily_carb_target_g or round(inp.weight_kg * (6.0 if met < 8 else 8.0), 0)

    # --- sodium & fluid ---------------------------------------------------
    sodium_base, fluid_base = SWEAT_PROFILES.get(inp.sweat_profile, SWEAT_PROFILES["normal"])
    heat_factor = 1.0 + max(0.0, inp.temperature_c - 22.0) * 0.025
    # Sweat sodium concentration rises slightly on long efforts (>90 min).
    duration_factor = 1.0 + max(0.0, inp.duration_min - 90.0) / 600.0
    sodium_per_h = sodium_base * heat_factor * duration_factor
    fluid_per_h = fluid_base * heat_factor

    sodium_total = sodium_per_h * duration_h
    fluid_total = fluid_per_h * duration_h

    # --- practical plan ---------------------------------------------------
    timeline = _timeline(inp, carb_per_h, sodium_per_h, fluid_per_h, met)
    if inp.duration_min < 60:
        notes = [
            "Under 60 minutes: water is enough — no gels or sports drink needed.",
            "A normal meal 2–3 h before covers the energy cost of this session.",
        ]
    else:
        notes = [
            f"Target {int(carb_per_h)} g of carbohydrate per hour — roughly "
            f"{_gel_equivalent(carb_per_h)}.",
            f"Sip {int(fluid_per_h)} ml per hour; add {int(sodium_per_h)} mg sodium per hour.",
        ]
        if inp.duration_min > 120:
            notes.append("Practise this intake on training days — the gut adapts to 60–90 g/h.")
        if inp.temperature_c >= 28:
            notes.append("Warm conditions: add ~200–300 ml/h of fluid and 150 mg/h of sodium.")

    return {
        "intensity": intensity,
        "met": round(met, 2),
        "calories": {
            "total": int(round(calories_total)),
            "per_hour": int(round(met * inp.weight_kg * cal_factor)),
            "from_carbs_pct": 60 if met >= 9 else 45,
        },
        "carbs": {
            "per_hour_g": int(carb_per_h),
            "total_g": int(round(carbs_total)),
            "daily_target_g": int(daily_target),
            "pre_session_g": int(round(inp.weight_kg * 1.0)),
        },
        "sodium": {"per_hour_mg": int(round(sodium_per_h)), "total_mg": int(round(sodium_total))},
        "fluid": {"per_hour_ml": int(round(fluid_per_h)), "total_ml": int(round(fluid_total))},
        "timeline": timeline,
        "notes": notes,
    }


def _gel_equivalent(carb_per_h: float) -> str:
    gels = carb_per_h / 25.0
    if carb_per_h <= 0:
        return "nothing extra"
    if gels < 1.6:
        return "1 gel or 500 ml of sports drink"
    if gels < 2.6:
        return "2 gels, 1 banana + 1 gel, or 750 ml of sports drink"
    return "3 gels, or a mix of chews + a bottle of sports drink"


def _timeline(inp: FuelingInput, carb_per_h: float, sodium_per_h: float, fluid_per_h: float, met: float) -> list[dict]:
    items: list[dict] = [
        {
            "window": "3 h before",
            "label": "Pre-activity meal",
            "detail": f"{int(round(inp.weight_kg * 1.2))} g carbs, low fibre, moderate protein",
            "carbs_g": int(round(inp.weight_kg * 1.2)),
            "icon": "meal",
        }
    ]
    if inp.duration_min >= 60:
        items.append(
            {
                "window": "30 min before",
                "label": "Top-up snack",
                "detail": "20–30 g easy carbs if the last meal was early",
                "carbs_g": 25,
                "icon": "snack",
            }
        )
    if carb_per_h > 0:
        every = 45 if carb_per_h >= 60 else 60
        items.append(
            {
                "window": "During",
                "label": f"Every {every} min",
                "detail": f"{int(carb_per_h * every / 60)} g carbs + {int(fluid_per_h * every / 60)} ml fluid",
                "carbs_g": int(round(carb_per_h * every / 60)),
                "icon": "during",
            }
        )
    items.append(
        {
            "window": "Within 30 min after",
            "label": "Recovery",
            "detail": f"{int(round(inp.weight_kg * 0.4))} g carbs + {int(round(inp.weight_kg * 0.25))} g protein",
            "carbs_g": int(round(inp.weight_kg * 0.4)),
            "icon": "recovery",
        }
    )
    return items
