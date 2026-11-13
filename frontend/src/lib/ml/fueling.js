/**
 * Fueling recommendation engine — JavaScript mirror of
 * `ml/fueling_model/predict.py`.
 *
 *   calories = MET × body mass (kg) × hours
 *   carbs/h  = f(duration band, intensity)      → 0 … 90 g
 *   sodium/h = f(sweat profile, heat, duration)
 *   fluid/h  = f(sweat profile, heat)
 */

export const SWEAT_PROFILES = {
  low: { sodium: 350, fluid: 450 },
  normal: { sodium: 550, fluid: 650 },
  high: { sodium: 800, fluid: 900 },
};

export const DEFAULT_KIT_ITEMS = [
  { id: 'default-drink', name: 'Sports Drink Mix', category: 'drink', carbs_g: 28, sodium_mg: 320, fluid_ml: 500, calories: 112, serving_label: '500 ml bottle', is_active: true },
  { id: 'default-gel', name: 'Energy Gel', category: 'gel', carbs_g: 25, sodium_mg: 55, fluid_ml: 0, calories: 100, serving_label: 'gel packet', is_active: true },
  { id: 'default-chew', name: 'Energy Chews', category: 'chew', carbs_g: 24, sodium_mg: 70, fluid_ml: 0, calories: 96, serving_label: 'pouch', is_active: true },
  { id: 'default-salt', name: 'Electrolyte Cap', category: 'salt', carbs_g: 0, sodium_mg: 215, fluid_ml: 0, calories: 0, serving_label: 'capsule', is_active: true },
  { id: 'default-banana', name: 'Ripe Banana', category: 'food', carbs_g: 27, sodium_mg: 1, fluid_ml: 0, calories: 105, serving_label: 'medium banana', is_active: true },
];

const FALLBACK_SPEED = { run: 9.0, ride: 21.0, walk: 4.8, hike: 3.8 };

export function estimateMet(activityType, speedKmh, elevationPerKm = 0) {
  // Vertical ascent work against gravity: VAM (m/h) = elev/km * km/h.
  const vamMPerH = Math.max(0, elevationPerKm) * Math.max(0, speedKmh);
  const climbCoef = activityType === 'ride' ? 0.009 : 0.011;
  const climb = Math.min(10.0, vamMPerH * climbCoef);
  let met;
  if (activityType === 'run') met = speedKmh * 1.03;
  else if (activityType === 'ride') met = 3.2 + speedKmh * 0.29;
  else if (activityType === 'walk') met = 2.0 + speedKmh * 0.45;
  else met = 3.6 + speedKmh * 0.6;
  return Math.max(1.6, met + climb);
}

function hrAdjustedMet(met, targetHr, maxHr, restingHr) {
  if (!targetHr || targetHr <= 30) return met;
  const ceilHr = Number(maxHr) || 190;
  const floorHr = Number(restingHr) || 55;
  const reserve = Math.max(30, ceilHr - floorHr);
  const hrr = Math.max(0, Math.min(1.05, (Number(targetHr) - floorHr) / reserve));
  if (hrr >= 0.85) return Math.max(met, 11.2);
  if (hrr >= 0.72) return Math.max(met, 8.5);
  if (hrr < 0.55) return Math.min(met, 4.8);
  return met;
}

export function intensityLabel(met) {
  if (met < 5) return 'light';
  if (met < 8) return 'moderate';
  if (met < 11) return 'vigorous';
  return 'very_vigorous';
}

export const INTENSITY_COPY = {
  light: { label: 'Light', tone: 'bg-emerald-100 text-emerald-700' },
  moderate: { label: 'Moderate', tone: 'bg-sky-100 text-sky-700' },
  vigorous: { label: 'Vigorous', tone: 'bg-amber-100 text-amber-700' },
  very_vigorous: { label: 'Very hard', tone: 'bg-rose-100 text-rose-700' },
};

function carbRatePerHour(durationMin, met) {
  if (durationMin < 60) return 0;
  let base;
  if (durationMin < 90) base = 30;
  else if (durationMin < 150) base = 60;
  else base = 85;
  if (met >= 11) base *= 1.08;
  else if (met < 6) base *= 0.75;
  return Math.round(Math.min(90, base));
}

export function gelEquivalent(carbPerHour) {
  const gels = carbPerHour / 25;
  if (carbPerHour <= 0) return 'nothing extra';
  if (gels < 1.6) return '1 gel or 500 ml of sports drink';
  if (gels < 2.6) return '2 gels, a banana + 1 gel, or 750 ml of sports drink';
  return '3 gels, or a mix of chews + a bottle of sports drink';
}

/**
 * Pack concrete bottles, gels, chews, and salt tabs for a planned session.
 */
export function buildFuelingKit({
  durationMin = 60,
  carbsTotalG = 0,
  sodiumTotalMg = 0,
  fluidTotalMl = 0,
  items = [],
} = {}) {
  const customActive = (Array.isArray(items) ? items : []).filter((i) => i && i.is_active !== false);
  const pool = customActive.length > 0 ? customActive : DEFAULT_KIT_ITEMS;
  const drinks = pool.filter((i) => i.category === 'drink' && Number(i.fluid_ml) > 0);
  const carbItems = pool.filter((i) => ['gel', 'chew', 'food'].includes(i.category) && Number(i.carbs_g) > 0);
  const salts = pool.filter((i) => i.category === 'salt' && Number(i.sodium_mg) > 0);

  const packed = [];
  let coveredCarbs = 0;
  let coveredSodium = 0;
  let coveredFluid = 0;

  if (fluidTotalMl > 150 && drinks.length > 0) {
    const drink = drinks.reduce((best, d) => (Number(d.fluid_ml) > Number(best.fluid_ml) ? d : best), drinks[0]);
    const perUnitMl = Math.max(100, Number(drink.fluid_ml) || 500);
    const qty = Math.max(1, Math.round(fluidTotalMl / perUnitMl));
    const carbs = Math.round(qty * (Number(drink.carbs_g) || 0));
    const sodium = Math.round(qty * (Number(drink.sodium_mg) || 0));
    const fluid = Math.round(qty * perUnitMl);
    packed.push({
      id: drink.id,
      name: drink.name,
      category: 'drink',
      quantity: qty,
      servingLabel: drink.serving_label || `${Math.round(perUnitMl)} ml bottle`,
      carbsG: carbs,
      sodiumMg: sodium,
      fluidMl: fluid,
    });
    coveredCarbs += carbs;
    coveredSodium += sodium;
    coveredFluid += fluid;
  }

  const remCarbs = Math.max(0, carbsTotalG - coveredCarbs);
  if (remCarbs >= 12 && carbItems.length > 0) {
    const carbItem = carbItems[0];
    const perUnitC = Math.max(5, Number(carbItem.carbs_g) || 25);
    const qty = Math.max(1, Math.ceil((remCarbs - 4) / perUnitC));
    const carbs = Math.round(qty * perUnitC);
    const sodium = Math.round(qty * (Number(carbItem.sodium_mg) || 0));
    const fluid = Math.round(qty * (Number(carbItem.fluid_ml) || 0));
    packed.push({
      id: carbItem.id,
      name: carbItem.name,
      category: carbItem.category || 'gel',
      quantity: qty,
      servingLabel: carbItem.serving_label || 'serving',
      carbsG: carbs,
      sodiumMg: sodium,
      fluidMl: fluid,
    });
    coveredCarbs += carbs;
    coveredSodium += sodium;
    coveredFluid += fluid;
  }

  const remSodium = Math.max(0, sodiumTotalMg - coveredSodium);
  if (remSodium >= 140 && salts.length > 0) {
    const salt = salts[0];
    const perUnitS = Math.max(50, Number(salt.sodium_mg) || 200);
    const qty = Math.max(1, Math.round(remSodium / perUnitS));
    const sodium = Math.round(qty * perUnitS);
    packed.push({
      id: salt.id,
      name: salt.name,
      category: 'salt',
      quantity: qty,
      servingLabel: salt.serving_label || 'capsule',
      carbsG: 0,
      sodiumMg: sodium,
      fluidMl: 0,
    });
    coveredSodium += sodium;
  }

  const carbServings = packed
    .filter((p) => ['gel', 'chew', 'food'].includes(p.category))
    .reduce((sum, p) => sum + p.quantity, 0);
  const feedEveryMin = carbServings > 0 && durationMin >= 45 ? Math.round(durationMin / carbServings) : null;
  const sipEveryMin = fluidTotalMl >= 300 ? 15 : 20;

  return {
    items: packed,
    totals: {
      carbsG: Math.round(coveredCarbs),
      sodiumMg: Math.round(coveredSodium),
      fluidMl: Math.round(coveredFluid),
    },
    cadence: {
      feedEveryMin,
      sipEveryMin,
      sipMl: Math.round((fluidTotalMl / Math.max(1, durationMin)) * sipEveryMin),
    },
  };
}

/**
 * @returns full fueling plan: calories, carbs, sodium, fluid, timeline, kit, notes.
 */
export function recommendFueling({
  activityType,
  durationMin,
  weightKg,
  elevationPerKm = 0,
  avgSpeedKmh,
  sweatProfile = 'normal',
  temperatureC = 22,
  dailyCarbTargetG,
  energyCalibrationFactor = 1,
  targetHr = null,
  maxHr = null,
  restingHr = null,
  acwr = null,
  carbLoading = false,
  fuelItems = [],
}) {
  const hours = Math.max(durationMin, 1) / 60;
  const speed = avgSpeedKmh || FALLBACK_SPEED[activityType] || 5;
  const met = hrAdjustedMet(estimateMet(activityType, speed, elevationPerKm), targetHr, maxHr, restingHr);
  const calFactor = Math.min(2.0, Math.max(0.5, Number(energyCalibrationFactor) || 1.0));
  const caloriesTotal = met * weightKg * hours * calFactor;
  const intensity = intensityLabel(met);

  const carbPerHour = carbRatePerHour(durationMin, met);
  const carbsTotal = carbPerHour * hours;
  const dailyTarget = carbLoading
    ? Math.round(weightKg * 9)
    : dailyCarbTargetG || Math.round(weightKg * (met < 8 ? 6 : 8));
  const recoveryMultiplier = acwr !== null && acwr >= 1.3 ? 1.2 : 1.0;

  const profile = SWEAT_PROFILES[sweatProfile] || SWEAT_PROFILES.normal;
  const heat = 1 + Math.max(0, temperatureC - 22) * 0.025;
  const durationFactor = 1 + Math.max(0, durationMin - 90) / 600;
  const sodiumPerHour = profile.sodium * heat * durationFactor;
  const fluidPerHour = profile.fluid * heat;
  const sodiumTotal = sodiumPerHour * hours;
  const fluidTotal = fluidPerHour * hours;

  const notes = [];
  if (durationMin < 60) {
    notes.push('Under 60 minutes: water is enough — no gels or sports drink needed.');
    notes.push('A normal meal 2–3 h before covers the energy cost of this session.');
  } else {
    notes.push(
      `Target ${Math.round(carbPerHour)} g of carbohydrate per hour — roughly ${gelEquivalent(carbPerHour)}.`,
    );
    notes.push(
      `Sip ${Math.round(fluidPerHour)} ml per hour; add ${Math.round(sodiumPerHour)} mg sodium per hour.`,
    );
    if (durationMin > 120) notes.push('Practise this intake on training days — the gut adapts to 60–90 g/h.');
    if (temperatureC >= 28)
      notes.push('Warm conditions: add ~200–300 ml/h of fluid and 150 mg/h of sodium.');
  }
  if (carbLoading) {
    notes.push(`Race-week carb loading active: aim for ${Math.round(dailyTarget)} g carbs/day (9 g/kg) with low-fibre meals.`);
  }
  if (recoveryMultiplier > 1) {
    notes.push('Elevated training load (ACWR >= 1.3): post-session recovery carbs boosted by 20%.');
  }

  return {
    intensity,
    met: Math.round(met * 100) / 100,
    calories: {
      total: Math.round(caloriesTotal),
      perHour: Math.round(met * weightKg * calFactor),
      fromCarbsPct: met >= 9 ? 60 : 45,
    },
    carbs: {
      perHourG: carbPerHour,
      totalG: Math.round(carbsTotal),
      dailyTargetG: Math.round(dailyTarget),
      preSessionG: Math.round(weightKg * 1.0),
    },
    sodium: { perHourMg: Math.round(sodiumPerHour), totalMg: Math.round(sodiumTotal) },
    fluid: { perHourMl: Math.round(fluidPerHour), totalMl: Math.round(fluidTotal) },
    timeline: buildTimeline({ weightKg, durationMin, carbPerHour, fluidPerHour, recoveryMultiplier }),
    kit: buildFuelingKit({ durationMin, carbsTotalG: carbsTotal, sodiumTotalMg: sodiumTotal, fluidTotalMl: fluidTotal, items: fuelItems }),
    notes,
  };
}

function buildTimeline({ weightKg, durationMin, carbPerHour, fluidPerHour, recoveryMultiplier = 1 }) {
  const items = [
    {
      window: '3 h before',
      label: 'Pre-activity meal',
      detail: `${Math.round(weightKg * 1.2)} g carbs, low fibre, moderate protein`,
      carbsG: Math.round(weightKg * 1.2),
      icon: 'meal',
    },
  ];
  if (durationMin >= 60) {
    items.push({
      window: '30 min before',
      label: 'Top-up snack',
      detail: '20–30 g easy carbs if the last meal was early',
      carbsG: 25,
      icon: 'snack',
    });
  }
  if (carbPerHour > 0) {
    const every = carbPerHour >= 60 ? 45 : 60;
    items.push({
      window: 'During',
      label: `Every ${every} min`,
      detail: `${Math.round((carbPerHour * every) / 60)} g carbs + ${Math.round((fluidPerHour * every) / 60)} ml fluid`,
      carbsG: Math.round((carbPerHour * every) / 60),
      icon: 'during',
    });
  }
  const recCarbs = Math.round(weightKg * 0.4 * recoveryMultiplier);
  const recProtein = Math.round(weightKg * (recoveryMultiplier > 1 ? 0.3 : 0.25));
  items.push({
    window: 'Within 30 min after',
    label: 'Recovery',
    detail: `${recCarbs} g carbs + ${recProtein} g protein`,
    carbsG: recCarbs,
    icon: 'recovery',
  });
  return items;
}
