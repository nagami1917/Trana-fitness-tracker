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

const FALLBACK_SPEED = { run: 9.0, ride: 21.0, walk: 4.8, hike: 3.8 };

export function estimateMet(activityType, speedKmh, elevationPerKm = 0) {
  const climb = Math.min(2.6, Math.max(0, elevationPerKm) * 0.045);
  let met;
  if (activityType === 'run') met = speedKmh * 1.03;
  else if (activityType === 'ride') met = 3.2 + speedKmh * 0.29;
  else if (activityType === 'walk') met = 2.0 + speedKmh * 0.45;
  else met = 3.6 + speedKmh * 0.6;
  return Math.max(1.6, met + climb);
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
 * @returns full fueling plan: calories, carbs, sodium, fluid, timeline, notes.
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
}) {
  const hours = Math.max(durationMin, 1) / 60;
  const speed = avgSpeedKmh || FALLBACK_SPEED[activityType] || 5;
  const met = estimateMet(activityType, speed, elevationPerKm);
  const caloriesTotal = met * weightKg * hours;
  const intensity = intensityLabel(met);

  const carbPerHour = carbRatePerHour(durationMin, met);
  const carbsTotal = carbPerHour * hours;
  const dailyTarget = dailyCarbTargetG || Math.round(weightKg * (met < 8 ? 6 : 8));

  const profile = SWEAT_PROFILES[sweatProfile] || SWEAT_PROFILES.normal;
  const heat = 1 + Math.max(0, temperatureC - 22) * 0.025;
  const durationFactor = 1 + Math.max(0, durationMin - 90) / 600;
  const sodiumPerHour = profile.sodium * heat * durationFactor;
  const fluidPerHour = profile.fluid * heat;

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

  return {
    intensity,
    met: Math.round(met * 100) / 100,
    calories: {
      total: Math.round(caloriesTotal),
      perHour: Math.round(met * weightKg),
      fromCarbsPct: met >= 9 ? 60 : 45,
    },
    carbs: {
      perHourG: carbPerHour,
      totalG: Math.round(carbsTotal),
      dailyTargetG: Math.round(dailyTarget),
      preSessionG: Math.round(weightKg * 1.0),
    },
    sodium: { perHourMg: Math.round(sodiumPerHour), totalMg: Math.round(sodiumPerHour * hours) },
    fluid: { perHourMl: Math.round(fluidPerHour), totalMl: Math.round(fluidPerHour * hours) },
    timeline: buildTimeline({ weightKg, durationMin, carbPerHour, sodiumPerHour, fluidPerHour }),
    notes,
  };
}

function buildTimeline({ weightKg, durationMin, carbPerHour, fluidPerHour }) {
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
  items.push({
    window: 'Within 30 min after',
    label: 'Recovery',
    detail: `${Math.round(weightKg * 0.4)} g carbs + ${Math.round(weightKg * 0.25)} g protein`,
    carbsG: Math.round(weightKg * 0.4),
    icon: 'recovery',
  });
  return items;
}
