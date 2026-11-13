/**
 * Distance Personal Records (PRs) + Riegel Race Time Predictor Curve.
 */

export const PR_BENCHMARKS = [
  { key: 'run_1k', sport: 'run', label: '1K Run', distanceKm: 1.0 },
  { key: 'run_5k', sport: 'run', label: '5K Run', distanceKm: 5.0 },
  { key: 'run_10k', sport: 'run', label: '10K Run', distanceKm: 10.0 },
  { key: 'run_hm', sport: 'run', label: 'Half Marathon', distanceKm: 21.097 },
  { key: 'run_fm', sport: 'run', label: 'Marathon', distanceKm: 42.195 },
  { key: 'ride_20k', sport: 'ride', label: '20K Ride', distanceKm: 20.0 },
  { key: 'ride_50k', sport: 'ride', label: '50K Ride', distanceKm: 50.0 },
];

const RIEGEL_DISTANCES_KM = [1, 3, 5, 10, 15, 21.1, 30, 42.2];

/**
 * Estimate best time for each standard distance across an athlete's history.
 * Uses exact session totals when within tolerance, or proportional split interpolation
 * for longer efforts (>= targetKm * 0.98) so a 10K effort can set a 5K PR too.
 */
export function computeDistancePRs(activities = []) {
  const bests = new Map();

  for (const a of Array.isArray(activities) ? activities : []) {
    const dist = Number(a?.distance_km);
    const dur = Number(a?.duration_min);
    if (!Number.isFinite(dist) || !Number.isFinite(dur) || dist <= 0 || dur <= 0) continue;

    for (const bench of PR_BENCHMARKS) {
      if (a.activity_type !== bench.sport) continue;
      if (dist < bench.distanceKm * 0.97) continue;

      // Exact effort wins cleanly; longer effort estimates target time at sustained session pace
      const estDurationMin = dist <= bench.distanceKm * 1.04
        ? dur * (bench.distanceKm / dist)
        : (dur / dist) * bench.distanceKm;

      const current = bests.get(bench.key);
      if (!current || estDurationMin < current.minutes) {
        bests.set(bench.key, {
          ...bench,
          minutes: Math.round(estDurationMin * 100) / 100,
          paceMinPerKm: Math.round((estDurationMin / bench.distanceKm) * 100) / 100,
          activityId: a.id,
          startedAt: a.started_at,
          exact: dist <= bench.distanceKm * 1.05,
        });
      }
    }
  }

  return PR_BENCHMARKS
    .map((b) => bests.get(b.key) ?? null)
    .filter(Boolean);
}

/** Check if saving `newActivity` breaks any PR compared to `priorActivities`. */
export function detectNewPRs(newActivity, priorActivities = []) {
  if (!newActivity) return [];
  const before = new Map(computeDistancePRs(priorActivities).map((r) => [r.key, r.minutes]));
  const after = computeDistancePRs([...(priorActivities || []), newActivity]);
  return after.filter((rec) => {
    const prev = before.get(rec.key);
    return prev === undefined || rec.minutes < prev - 0.02;
  });
}

/**
 * Fit a Riegel endurance curve T2 = T1 * (D2 / D1)^1.06 anchored on the athlete's
 * strongest recent run >= 3 km (or sensible default if none logged yet).
 */
export function buildRiegelCurve(activities = [], sport = 'run') {
  const candidates = (Array.isArray(activities) ? activities : [])
    .filter((a) => a.activity_type === sport && Number(a.distance_km) >= 3 && Number(a.duration_min) > 0);

  let anchor = null;
  for (const a of candidates) {
    // Score equivalent 10K capability using Riegel exponent 1.06
    const eq10k = Number(a.duration_min) * (10 / Number(a.distance_km)) ** 1.06;
    if (!anchor || eq10k < anchor.eq10k) {
      anchor = {
        distanceKm: Number(a.distance_km),
        minutes: Number(a.duration_min),
        eq10k,
      };
    }
  }

  if (!anchor) return { anchor: null, points: [] };

  const exponent = sport === 'ride' ? 1.04 : 1.06;
  const distances = sport === 'ride' ? [10, 20, 40, 60, 80, 100] : RIEGEL_DISTANCES_KM;
  return {
    anchor,
    points: distances.map((d) => ({
      distanceKm: d,
      label: d === 21.1 ? 'Half' : d === 42.2 ? 'Marathon' : `${d} km`,
      minutes: Math.round(anchor.minutes * (d / anchor.distanceKm) ** exponent * 10) / 10,
    })),
  };
}
