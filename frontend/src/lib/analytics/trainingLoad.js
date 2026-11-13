/**
 * Acute:Chronic Workload Ratio (ACWR) & Training Readiness estimator.
 *
 * Uses a 7-day Acute load vs 28-day Chronic weekly average.
 * Optimal progression sweet spot: ACWR 0.80 – 1.30.
 */

const DAY_MS = 86400 * 1000;

export function sessionTrainingLoad(activity) {
  const minutes = Math.max(0, Number(activity?.duration_min) || 0);
  if (minutes <= 0) return 0;

  const hr = Number(activity?.avg_heart_rate);
  if (Number.isFinite(hr) && hr >= 60) {
    const intensity = Math.max(0.5, Math.min(2.4, (hr - 50) / 80));
    return minutes * intensity;
  }

  const dist = Math.max(0, Number(activity?.distance_km) || 0);
  const speed = dist / (minutes / 60);
  const type = activity?.activity_type || 'run';
  let factor;
  if (type === 'run') factor = Math.min(2.2, Math.max(0.7, speed / 8.5));
  else if (type === 'ride') factor = Math.min(2.0, Math.max(0.6, speed / 20));
  else if (type === 'hike') factor = 0.95;
  else factor = 0.65;
  return minutes * factor;
}

export const READINESS_COPY = {
  building_base: {
    label: 'Building Base',
    tone: 'bg-sky-50 text-sky-700 border-sky-200',
    advice: 'Keep logging steady sessions to calibrate your 28-day baseline.',
  },
  tapered: {
    label: 'Fresh / Tapered',
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    advice: 'Fatigue is low — great window for a quality workout or race effort.',
  },
  optimal: {
    label: 'Optimal Load',
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    advice: 'Workload sits in the 0.8–1.3 sweet spot — steady gains with low injury risk.',
  },
  building: {
    label: 'Heavy Build',
    tone: 'bg-amber-50 text-amber-700 border-amber-200',
    advice: 'Training load is ramping up fast. Prioritise sleep and post-session carbs.',
  },
  overreaching: {
    label: 'Overreaching',
    tone: 'bg-red-50 text-red-700 border-red-200',
    advice: 'Acute strain exceeds your 28-day base. Boost recovery carbs +20% and schedule an easy day.',
  },
};

export function computeTrainingLoad(activities = [], now = new Date()) {
  const endMs = now.getTime();
  const dailyMap = new Map();

  const dayKey = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  for (const a of Array.isArray(activities) ? activities : []) {
    const ts = Date.parse(a?.started_at);
    if (!Number.isFinite(ts) || ts > endMs) continue;
    const key = dayKey(ts);
    dailyMap.set(key, (dailyMap.get(key) || 0) + sessionTrainingLoad(a));
  }

  // Build 42-day daily array so rolling 28d chronic + 7d acute work across the last 14 days
  const days = [];
  for (let offset = 41; offset >= 0; offset -= 1) {
    const d = new Date(endMs - offset * DAY_MS);
    const key = dayKey(d.getTime());
    days.push({
      date: key,
      label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      load: dailyMap.get(key) || 0,
    });
  }

  const series = [];
  for (let i = 27; i < days.length; i += 1) {
    let acute7 = 0;
    for (let j = i - 6; j <= i; j += 1) acute7 += days[j].load;
    let chronic28 = 0;
    for (let j = i - 27; j <= i; j += 1) chronic28 += days[j].load;
    const chronicWeeklyAvg = chronic28 / 4;
    const ratio = chronicWeeklyAvg >= 20 ? Math.round((acute7 / chronicWeeklyAvg) * 100) / 100 : null;
    series.push({
      date: days[i].date,
      label: days[i].label,
      acute7: Math.round(acute7),
      chronicWeeklyAvg: Math.round(chronicWeeklyAvg),
      acwr: ratio,
    });
  }

  const latest = series.at(-1) ?? { acute7: 0, chronicWeeklyAvg: 0, acwr: null };
  const acwr = latest.acwr;
  let status = 'building_base';
  if (acwr !== null) {
    if (acwr < 0.8) status = 'tapered';
    else if (acwr <= 1.3) status = 'optimal';
    else if (acwr <= 1.5) status = 'building';
    else status = 'overreaching';
  }

  return {
    acute7: latest.acute7,
    chronicWeeklyAvg: latest.chronicWeeklyAvg,
    acwr,
    status,
    meta: READINESS_COPY[status],
    recoveryBonusCarbsPct: acwr !== null && acwr >= 1.3 ? 20 : 0,
    series,
  };
}
