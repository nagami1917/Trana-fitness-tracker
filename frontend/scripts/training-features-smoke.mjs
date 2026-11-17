/**
 * End-to-end verification of TRANA's training, analytics, GPS splits, fueling
 * kit, race-planning, and notification utilities.
 *
 *   node scripts/training-features-smoke.mjs
 */

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const vite = await createServer({
  root,
  configFile: false,
  envFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false },
});

try {
  const { computeGpsSplits, gradeCostFactor, interpolateRoutePosition } = await vite.ssrLoadModule('/src/lib/route/splits.js');
  const { computeTrainingLoad } = await vite.ssrLoadModule('/src/lib/analytics/trainingLoad.js');
  const { buildHrZones, computeAerobicEfficiency } = await vite.ssrLoadModule('/src/lib/analytics/heartRate.js');
  const { computeDistancePRs, detectNewPRs, buildRiegelCurve } = await vite.ssrLoadModule('/src/lib/analytics/records.js');
  const { buildRacePrepPlan } = await vite.ssrLoadModule('/src/lib/analytics/racePlanner.js');
  const { recommendFueling, buildFuelingKit } = await vite.ssrLoadModule('/src/lib/ml/fueling.js');

  // 2. GPS Splits + Minetti GAP + Route Interpolation
  assert.ok(gradeCostFactor(0.1) > 1.5, 'Uphill grade must raise Minetti metabolic cost');
  const splits = computeGpsSplits({
    points: [
      [14.676, 121.0437, 20],
      [14.685, 121.0437, 45],
      [14.695, 121.0437, 45],
    ],
    totalDurationMin: 12,
    totalDistanceKm: 2.1,
    unit: 'metric',
  });
  assert.ok(splits.length >= 2);
  assert.ok(splits[0].gapMinPerKm < splits[0].paceMinPerKm, 'Uphill split GAP must be faster than actual pace');
  const mid = interpolateRoutePosition([[14.0, 121.0], [14.2, 121.0]], 0.5);
  assert.ok(Math.abs(mid[0] - 14.1) < 0.001);

  // 2. Training Load (ACWR) & Readiness
  const now = new Date('2026-11-10T12:00:00Z');
  const acts = [
    { id: 1, activity_type: 'run', distance_km: 10, duration_min: 60, started_at: '2026-10-20T06:00:00Z' },
    { id: 2, activity_type: 'run', distance_km: 10, duration_min: 60, started_at: '2026-10-27T06:00:00Z' },
    { id: 3, activity_type: 'run', distance_km: 15, duration_min: 95, started_at: '2026-11-08T06:00:00Z' },
    { id: 4, activity_type: 'run', distance_km: 18, duration_min: 115, started_at: '2026-11-09T06:00:00Z' },
  ];
  const load = computeTrainingLoad(acts, now);
  assert.ok(load.acwr > 1.3, 'Heavy acute spike should flag ACWR > 1.3');
  assert.equal(load.recoveryBonusCarbsPct, 20);

  // 3. Heart Rate Zones & Aerobic Efficiency
  const zones = buildHrZones({ maxHr: 190, restingHr: 50 });
  assert.equal(zones.length, 5);
  assert.equal(zones[4].max, 190);
  const ef = computeAerobicEfficiency([
    { id: 1, activity_type: 'run', distance_km: 10, duration_min: 60, avg_heart_rate: 160, started_at: '2026-10-15T06:00:00Z' },
    { id: 2, activity_type: 'run', distance_km: 10, duration_min: 54, avg_heart_rate: 155, started_at: '2026-11-05T06:00:00Z' },
  ], zones);
  assert.equal(ef.series.length, 2);
  assert.ok(ef.series[1].efficiencyIndex > ef.series[0].efficiencyIndex);

  // 4. Distance PRs & Riegel Curve
  const prs = computeDistancePRs([
    { id: 1, activity_type: 'run', distance_km: 5, duration_min: 24, started_at: '2026-11-01T06:00:00Z' },
    { id: 2, activity_type: 'run', distance_km: 10, duration_min: 52, started_at: '2026-11-02T06:00:00Z' },
  ]);
  assert.ok(prs.some((r) => r.key === 'run_5k' && Math.abs(r.minutes - 24) < 0.1));
  const broken = detectNewPRs(
    { id: 3, activity_type: 'run', distance_km: 5, duration_min: 22.5, started_at: '2026-11-08T06:00:00Z' },
    [{ id: 1, activity_type: 'run', distance_km: 5, duration_min: 24, started_at: '2026-11-01T06:00:00Z' }],
  );
  assert.ok(broken.some((r) => r.key === 'run_5k'));
  const riegel = buildRiegelCurve([{ id: 1, activity_type: 'run', distance_km: 10, duration_min: 50 }], 'run');
  assert.ok(riegel.points.length >= 6);

  // 5. Race-Week Planner & Carb-Loading
  const racePlan = buildRacePrepPlan(
    { title: 'Marathon', activity_type: 'run', distance_km: 42.2, race_date: '2026-11-12', carb_loading_enabled: true },
    65,
    new Date('2026-11-10T08:00:00'),
  );
  assert.equal(racePlan.inCarbLoadWindow, true);
  assert.equal(racePlan.carbLoadDays.length, 2);

  // 6. Fueling Engine Kit + HRR + ACWR + Carb Loading
  const kit = buildFuelingKit({ durationMin: 120, carbsTotalG: 110, sodiumTotalMg: 900, fluidTotalMl: 1200 });
  assert.ok(kit.items.length >= 1);
  assert.ok(kit.cadence.sipEveryMin > 0);
  const fuelPlan = recommendFueling({
    activityType: 'run',
    durationMin: 110,
    weightKg: 65,
    acwr: 1.45,
    carbLoading: true,
    targetHr: 175,
    maxHr: 190,
    restingHr: 50,
  });
  assert.equal(fuelPlan.carbs.dailyTargetG, Math.round(65 * 9));
  assert.ok(fuelPlan.kit.items.length >= 1);
  assert.ok(fuelPlan.notes.some((n) => /ACWR/i.test(n)));
  assert.ok(fuelPlan.notes.some((n) => /carb loading/i.test(n)));

  console.log('Training features smoke checks passed ✔');
} finally {
  await vite.close();
}
