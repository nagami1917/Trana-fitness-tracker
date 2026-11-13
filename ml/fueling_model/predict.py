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

import math
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

DEFAULT_KIT_ITEMS = [
    {"id": "default-drink", "name": "Sports Drink Mix", "category": "drink", "carbs_g": 28, "sodium_mg": 320, "fluid_ml": 500, "serving_label": "500 ml bottle"},
    {"id": "default-gel", "name": "Energy Gel", "category": "gel", "carbs_g": 25, "sodium_mg": 55, "fluid_ml": 0, "serving_label": "gel packet"},
    {"id": "default-salt", "name": "Electrolyte Cap", "category": "salt", "carbs_g": 0, "sodium_mg": 215, "fluid_ml": 0, "serving_label": "capsule"},
]


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
    target_hr: float | None = None
    max_hr: float | None = None
    resting_hr: float | None = None
    acwr: float | None = None
    carb_loading: bool = False
    fuel_items: list[dict] = field(default_factory=list)
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


def _hr_adjusted_met(met: float, target_hr: float | None, max_hr: float | None, resting_hr: float | None) -> float:
    if not target_hr or target_hr <= 30:
        return met
    ceil_hr = float(max_hr or 190.0)
    floor_hr = float(resting_hr or 55.0)
    reserve = max(30.0, ceil_hr - floor_hr)
    hrr = max(0.0, min(1.05, (float(target_hr) - floor_hr) / reserve))
    if hrr >= 0.85:
        return max(met, 11.2)
    if hrr >= 0.72:
        return max(met, 8.5)
    if hrr < 0.55:
        return min(met, 4.8)
    return met


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


def build_fueling_kit(
    duration_min: float,
    carbs_total_g: float,
    sodium_total_mg: float,
    fluid_total_ml: float,
    items: list[dict] | None = None,
) -> dict:
    """Pack concrete bottles, gels, chews, and salt tabs for a planned session."""
    pool = [i for i in (items or []) if i.get("is_active", True)] or list(DEFAULT_KIT_ITEMS)
    drinks = [i for i in pool if i.get("category") == "drink" and float(i.get("fluid_ml") or 0) > 0]
    carb_items = [i for i in pool if i.get("category") in ("gel", "chew", "food") and float(i.get("carbs_g") or 0) > 0]
    salts = [i for i in pool if i.get("category") == "salt" and float(i.get("sodium_mg") or 0) > 0]

    packed = []
    covered_carbs = 0.0
    covered_sodium = 0.0
    covered_fluid = 0.0

    # 1. Cover fluid (and passive drink carbs/sodium) using primary drink item
    if fluid_total_ml > 150 and drinks:
        drink = max(drinks, key=lambda d: float(d.get("fluid_ml") or 0))
        per_unit_ml = max(100.0, float(drink.get("fluid_ml") or 500))
        # Use whole or 0.5 bottles, at least 1 if >= 250 ml needed
        qty = max(1, int(round(fluid_total_ml / per_unit_ml)))
        packed.append({
            "name": drink["name"],
            "category": "drink",
            "quantity": qty,
            "serving_label": drink.get("serving_label") or f"{int(per_unit_ml)} ml bottle",
            "carbs_g": round(qty * float(drink.get("carbs_g") or 0)),
            "sodium_mg": round(qty * float(drink.get("sodium_mg") or 0)),
            "fluid_ml": round(qty * per_unit_ml),
        })
        covered_carbs += qty * float(drink.get("carbs_g") or 0)
        covered_sodium += qty * float(drink.get("sodium_mg") or 0)
        covered_fluid += qty * per_unit_ml

    # 2. Cover remaining carbs with gels/chews/food
    rem_carbs = max(0.0, carbs_total_g - covered_carbs)
    if rem_carbs >= 12 and carb_items:
        carb_item = carb_items[0]
        per_unit_c = max(5.0, float(carb_item.get("carbs_g") or 25))
        qty = max(1, int(math.ceil((rem_carbs - 4.0) / per_unit_c)))
        packed.append({
            "name": carb_item["name"],
            "category": carb_item.get("category", "gel"),
            "quantity": qty,
            "serving_label": carb_item.get("serving_label") or "serving",
            "carbs_g": round(qty * per_unit_c),
            "sodium_mg": round(qty * float(carb_item.get("sodium_mg") or 0)),
            "fluid_ml": round(qty * float(carb_item.get("fluid_ml") or 0)),
        })
        covered_carbs += qty * per_unit_c
        covered_sodium += qty * float(carb_item.get("sodium_mg") or 0)
        covered_fluid += qty * float(carb_item.get("fluid_ml") or 0)

    # 3. Top up sodium deficit with salt capsules if needed
    rem_sodium = max(0.0, sodium_total_mg - covered_sodium)
    if rem_sodium >= 140 and salts:
        salt = salts[0]
        per_unit_s = max(50.0, float(salt.get("sodium_mg") or 200))
        qty = max(1, int(round(rem_sodium / per_unit_s)))
        packed.append({
            "name": salt["name"],
            "category": "salt",
            "quantity": qty,
            "serving_label": salt.get("serving_label") or "capsule",
            "carbs_g": 0,
            "sodium_mg": round(qty * per_unit_s),
            "fluid_ml": 0,
        })
        covered_sodium += qty * per_unit_s

    carb_servings = sum(p["quantity"] for p in packed if p["category"] in ("gel", "chew", "food"))
    feed_every_min = int(round(duration_min / carb_servings)) if carb_servings > 0 and duration_min >= 45 else None
    sip_every_min = 15 if fluid_total_ml >= 300 else 20

    return {
        "items": packed,
        "totals": {
            "carbs_g": int(round(covered_carbs)),
            "sodium_mg": int(round(covered_sodium)),
            "fluid_ml": int(round(covered_fluid)),
        },
        "cadence": {
            "feed_every_min": feed_every_min,
            "sip_every_min": sip_every_min,
            "sip_ml": int(round((fluid_total_ml / max(1.0, duration_min)) * sip_every_min)),
        },
    }


def recommend(inp: FuelingInput) -> dict:
    duration_h = max(inp.duration_min, 1.0) / 60.0
    speed = inp.avg_speed_kmh or {
        "run": 9.0,
        "ride": 21.0,
        "walk": 4.8,
        "hike": 3.8,
    }.get(inp.activity_type, 5.0)

    met = _hr_adjusted_met(
        estimate_met(inp.activity_type, speed, inp.elevation_per_km),
        inp.target_hr,
        inp.max_hr,
        inp.resting_hr,
    )
    cal_factor = min(2.0, max(0.5, float(inp.energy_calibration_factor or 1.0)))
    calories_total = met * inp.weight_kg * duration_h * cal_factor
    intensity = intensity_label(met)

    # --- carbohydrates ----------------------------------------------------
    carb_per_h = _carb_rate_g_per_h(inp.duration_min, met)
    carbs_total = carb_per_h * duration_h
    # Body-mass benchmark for the 24 h around a session: 6–10 g/kg/day hard work.
    if inp.carb_loading:
        daily_target = round(inp.weight_kg * 9.0, 0)
    else:
        daily_target = inp.daily_carb_target_g or round(inp.weight_kg * (6.0 if met < 8 else 8.0), 0)

    recovery_multiplier = 1.2 if (inp.acwr is not None and inp.acwr >= 1.3) else 1.0

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
    timeline = _timeline(inp, carb_per_h, sodium_per_h, fluid_per_h, met, recovery_multiplier)
    kit = build_fueling_kit(inp.duration_min, carbs_total, sodium_total, fluid_total, inp.fuel_items)
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
    if inp.carb_loading:
        notes.append(f"Race-week carb loading active: target {int(daily_target)} g carbs/day (9 g/kg) with low-fibre meals.")
    if recovery_multiplier > 1.0:
        notes.append("Elevated training load (ACWR >= 1.3): post-session recovery carbs boosted by 20%.")

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
        "kit": kit,
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


def _timeline(
    inp: FuelingInput,
    carb_per_h: float,
    sodium_per_h: float,
    fluid_per_h: float,
    met: float,
    recovery_multiplier: float = 1.0,
) -> list[dict]:
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
    rec_carbs = int(round(inp.weight_kg * 0.4 * recovery_multiplier))
    rec_protein = int(round(inp.weight_kg * (0.30 if recovery_multiplier > 1.0 else 0.25)))
    items.append(
        {
            "window": "Within 30 min after",
            "label": "Recovery",
            "detail": f"{rec_carbs} g carbs + {rec_protein} g protein",
            "carbs_g": rec_carbs,
            "icon": "recovery",
        }
    )
    return items
