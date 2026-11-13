/**
 * Race-Week Training Block & 48-Hour Carb-Loading Planner.
 */

const DAY_MS = 86400 * 1000;

function toLocalMidnightMs(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return new Date(y, m - 1, d).getTime();
}

function isoDateOffset(raceDateStr, offsetDays) {
  const base = toLocalMidnightMs(raceDateStr);
  if (!Number.isFinite(base)) return null;
  const dt = new Date(base + offsetDays * DAY_MS);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * Given a race event + athlete body weight, compute:
 *  - countdown days
 *  - multi-week taper schedule leading up to race day
 *  - 48-hour carb-loading targets (8–10 g/kg/day)
 */
export function buildRacePrepPlan(raceEvent, weightKg = 60, now = new Date()) {
  if (!raceEvent?.race_date) return null;
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const raceMidnight = toLocalMidnightMs(raceEvent.race_date);
  if (!Number.isFinite(raceMidnight)) return null;

  const daysUntil = Math.round((raceMidnight - todayMidnight) / DAY_MS);
  const peakWeeklyKm = Math.max(raceEvent.distance_km * 1.8, raceEvent.activity_type === 'ride' ? 80 : 30);
  const weeksOut = Math.max(1, Math.min(8, Math.ceil(Math.max(1, daysUntil) / 7)));

  const weeklyPlan = [];
  for (let w = weeksOut; w >= 1; w -= 1) {
    let phase = 'Build';
    let factor = 0.85;
    if (w === 1) {
      phase = 'Race Week Taper';
      factor = 0.45;
    } else if (w === 2) {
      phase = 'Taper';
      factor = 0.68;
    } else if (w === 3) {
      phase = 'Peak';
      factor = 1.0;
    } else {
      factor = Math.max(0.65, 1.0 - (w - 3) * 0.08);
    }
    const targetKm = Math.round(peakWeeklyKm * factor);
    const longKm = Math.round(Math.min(raceEvent.distance_km * 0.9, targetKm * 0.36) * 10) / 10;
    weeklyPlan.push({
      weeksOut: w,
      label: w === 1 ? 'Race Week' : `${w}w out`,
      phase,
      targetKm,
      longKm,
    });
  }

  const wKg = Math.max(35, Number(weightKg) || 60);
  const carbLoadDays = raceEvent.carb_loading_enabled !== false
    ? [
        {
          date: isoDateOffset(raceEvent.race_date, -2),
          dayLabel: '2 days out',
          carbsG: Math.round(wKg * 8),
          perKg: 8,
          guidance: 'Shift meals toward white rice, pasta, oats, bananas & sports drink; trim heavy fibre/fat.',
        },
        {
          date: isoDateOffset(raceEvent.race_date, -1),
          dayLabel: 'Day before race',
          carbsG: Math.round(wKg * 9.5),
          perKg: 9.5,
          guidance: 'Low-residue carbs every 3–4h + extra 500 ml electrolyte drink before dinner.',
        },
      ]
    : [];

  const inCarbLoadWindow = daysUntil >= 0 && daysUntil <= 2 && raceEvent.carb_loading_enabled !== false;

  return {
    daysUntil,
    inCarbLoadWindow,
    carbLoadDays,
    weeklyPlan,
    raceDayBreakfastCarbsG: Math.round(wKg * 1.5),
  };
}
