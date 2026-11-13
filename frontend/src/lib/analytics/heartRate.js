/**
 * Heart-rate zone builder (Karvonen HRR / %MaxHR) & Aerobic Efficiency Index.
 */

const DEFAULT_ZONE_DEFS = [
  { zone: 1, name: 'Recovery', pctLow: 0.50, pctHigh: 0.60, color: '#0ea5e9' },
  { zone: 2, name: 'Aerobic', pctLow: 0.60, pctHigh: 0.70, color: '#10b981' },
  { zone: 3, name: 'Tempo', pctLow: 0.70, pctHigh: 0.80, color: '#f59e0b' },
  { zone: 4, name: 'Threshold', pctLow: 0.80, pctHigh: 0.90, color: '#ec4899' },
  { zone: 5, name: 'VO2 Max', pctLow: 0.90, pctHigh: 1.00, color: '#ef4444' },
];

export function estimateMaxHr(birthYear) {
  if (!birthYear || !Number.isFinite(Number(birthYear))) return 190;
  const age = Math.max(12, Math.min(95, new Date().getFullYear() - Number(birthYear)));
  // Tanaka formula (208 - 0.7 * age)
  return Math.round(208 - 0.7 * age);
}

/**
 * Compute 5 HR zones using Karvonen Heart Rate Reserve when resting HR is present,
 * or %MaxHR when only max HR is available.
 */
export function buildHrZones({ maxHr, restingHr, birthYear, customZones } = {}) {
  if (Array.isArray(customZones) && customZones.length === 5) {
    return customZones.map((z, idx) => ({
      zone: Number(z.zone) || idx + 1,
      name: z.name || DEFAULT_ZONE_DEFS[idx].name,
      min: Number(z.min),
      max: Number(z.max),
      color: DEFAULT_ZONE_DEFS[idx].color,
    }));
  }

  const max = Math.max(120, Math.min(230, Number(maxHr) || estimateMaxHr(birthYear)));
  const rest = restingHr != null && Number.isFinite(Number(restingHr)) ? Math.max(32, Math.min(110, Number(restingHr))) : null;
  const reserve = rest != null ? Math.max(30, max - rest) : null;

  return DEFAULT_ZONE_DEFS.map((def, idx) => {
    const low = reserve != null ? Math.round(rest + reserve * def.pctLow) : Math.round(max * def.pctLow);
    const high = idx === 4
      ? max
      : reserve != null
        ? Math.round(rest + reserve * def.pctHigh)
        : Math.round(max * def.pctHigh);
    return {
      zone: def.zone,
      name: def.name,
      min: idx === 0 ? low : low + 1,
      max: high,
      color: def.color,
    };
  });
}

export function classifyHrZone(hr, zones = []) {
  const bpm = Number(hr);
  if (!Number.isFinite(bpm) || bpm <= 0 || !Array.isArray(zones) || zones.length === 0) return null;
  for (const z of zones) {
    if (bpm <= z.max) return z;
  }
  return zones.at(-1);
}

/**
 * Compute Aerobic Efficiency Index = speed (meters/min) / avg_heart_rate.
 * Rising EF at a steady effort indicates improving aerobic fitness.
 */
export function computeAerobicEfficiency(activities = [], zones = []) {
  const rows = (Array.isArray(activities) ? activities : [])
    .filter((a) => Number(a?.avg_heart_rate) >= 60 && Number(a?.distance_km) > 0 && Number(a?.duration_min) > 0)
    .map((a) => {
      const speedMPerMin = (Number(a.distance_km) * 1000) / Number(a.duration_min);
      const hr = Number(a.avg_heart_rate);
      const efficiencyIndex = Math.round((speedMPerMin / hr) * 1000) / 1000;
      const zone = classifyHrZone(hr, zones);
      return {
        id: a.id,
        date: a.started_at,
        label: a.started_at
          ? new Date(a.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : '',
        activityType: a.activity_type,
        avgHr: hr,
        efficiencyIndex,
        zone: zone?.zone ?? null,
        zoneName: zone?.name ?? null,
      };
    })
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .slice(-14);

  let deltaPct = null;
  if (rows.length >= 4) {
    const half = Math.floor(rows.length / 2);
    const earlyAvg = rows.slice(0, half).reduce((s, r) => s + r.efficiencyIndex, 0) / half;
    const recentAvg = rows.slice(-half).reduce((s, r) => s + r.efficiencyIndex, 0) / (rows.length - (rows.length - half));
    if (earlyAvg > 0) {
      deltaPct = Math.round(((recentAvg - earlyAvg) / earlyAvg) * 1000) / 10;
    }
  }

  return {
    series: rows,
    latest: rows.at(-1) ?? null,
    deltaPct,
  };
}
