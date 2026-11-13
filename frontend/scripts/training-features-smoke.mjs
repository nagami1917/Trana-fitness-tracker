/**
 * End-to-end verification of TRANA's 10 new training, analytics, GPS, .FIT,
 * fueling kit, race-planning, and notification utilities.
 *
 *   node scripts/training-features-smoke.mjs
 */

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Build a minimal valid binary Garmin .FIT file containing file_id + session + 2 GPS records. */
function buildSyntheticFitBuffer() {
  const bytes = [];
  const pushU16 = (v) => { bytes.push(v & 0xff, (v >> 8) & 0xff); };
  const pushU32 = (v) => { bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff); };
  const pushI32 = (v) => pushU32(v >>> 0);

  const records = [];
  const rec = (arr) => arr.forEach((b) => records.push(b & 0xff));
  const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];

  // Local message 0 -> global 18 (session): sport(0,enum), total_elapsed_time(7,u32), total_distance(9,u32), total_calories(11,u16), avg_hr(16,u8)
  rec([0x40, 0x00, 0x00, ...u16(18), 5]);
  rec([0, 1, 0, 7, 4, 0x86, 9, 4, 0x86, 11, 2, 0x84, 16, 1, 2]);
  // Session data: sport=1 (run), 1800s*1000=1800000, dist=5000m*100=500000, kcal=340, avg_hr=158
  rec([0x00, 1, ...u32(1_800_000), ...u32(500_000), ...u16(340), 158]);

  // Local message 1 -> global 20 (record): timestamp(253,u32), lat(0,s32), lng(1,s32), alt(2,u16), hr(3,u8)
  rec([0x41, 0x00, 0x00, ...u16(20), 5]);
  rec([253, 4, 0x86, 0, 4, 0x85, 1, 4, 0x85, 2, 2, 0x84, 3, 1, 2]);

  const toSemi = (deg) => Math.round((deg * (2 ** 31)) / 180) >>> 0;
  // Record 1 & Record 2 (~1.1 km apart in Manila)
  rec([0x01, ...u32(1_150_000_000), ...u32(toSemi(14.676)), ...u32(toSemi(121.0437)), ...u16((50 + 500) * 5), 152]);
  rec([0x01, ...u32(1_150_000_360), ...u32(toSemi(14.686)), ...u32(toSemi(121.0437)), ...u16((75 + 500) * 5), 164]);

  // 14-byte FIT header + records + 2-byte CRC
  const dataSize = records.length;
  bytes.push(14, 0x20);
  pushU16(2132);
  pushU32(dataSize);
  bytes.push(0x2e, 0x46, 0x49, 0x54); // ".FIT"
  pushU16(0); // header CRC skipped by parser
  records.forEach((b) => bytes.push(b));
  pushI32(0); // trailing CRC (2 bytes needed, extra ignored)
  return new Uint8Array(bytes.slice(0, 14 + dataSize + 2)).buffer;
}

const vite = await createServer({
  root,
  configFile: false,
  envFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false },
});

try {
  const { parseActivityFile } = await vite.ssrLoadModule('/src/lib/gpx.js');
  const { computeGpsSplits, gradeCostFactor, interpolateRoutePosition } = await vite.ssrLoadModule('/src/lib/route/splits.js');
  const { computeGhostPacerState, distanceFromPolylineMeters } = await vite.ssrLoadModule('/src/lib/route/ghostPacer.js');
  const { computeTrainingLoad } = await vite.ssrLoadModule('/src/lib/analytics/trainingLoad.js');
  const { buildHrZones, computeAerobicEfficiency } = await vite.ssrLoadModule('/src/lib/analytics/heartRate.js');
  const { computeDistancePRs, detectNewPRs, buildRiegelCurve } = await vite.ssrLoadModule('/src/lib/analytics/records.js');
  const { buildRacePrepPlan } = await vite.ssrLoadModule('/src/lib/analytics/racePlanner.js');
  const { recommendFueling, buildFuelingKit } = await vite.ssrLoadModule('/src/lib/ml/fueling.js');

  // 1. Binary .FIT parsing through unified parseActivityFile
  const fitParsed = parseActivityFile(buildSyntheticFitBuffer(), 'garmin-run.fit');
  assert.equal(fitParsed.source, 'fit');
  assert.equal(fitParsed.activityType, 'run');
  assert.equal(fitParsed.route.length, 2);
  assert.equal(fitParsed.avgHeartRate, 158);
  assert.ok(fitParsed.distanceKm >= 4.9, 'FIT session distance preserved');

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

  // 3. Ghost Pacer + Off-Route Detector
  const planned = [[14.676, 121.0437], [14.685, 121.0437]]; // ~1.0 km north
  const ghost = computeGhostPacerState({
    plannedPath: planned,
    targetDurationMin: 10,
    elapsedSec: 300, // halfway
    coveredDistanceKm: 0.6, // ahead of 0.5 km ghost
    currentPosition: [14.681, 121.0445], // ~85m east of polyline
    offRouteThresholdM: 45,
  });
  assert.equal(ghost.active, true);
  assert.ok(ghost.deltaDistanceM > 50, 'Athlete is ahead of ghost pacer');
  assert.equal(ghost.offRoute, true, '85m deviation must trigger off-route alert');
  assert.ok(distanceFromPolylineMeters([14.681, 121.0437], planned) < 5);

  // 4. Training Load (ACWR) & Readiness
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

  // 5. Heart Rate Zones & Aerobic Efficiency
  const zones = buildHrZones({ maxHr: 190, restingHr: 50 });
  assert.equal(zones.length, 5);
  assert.equal(zones[4].max, 190);
  const ef = computeAerobicEfficiency([
    { id: 1, activity_type: 'run', distance_km: 10, duration_min: 60, avg_heart_rate: 160, started_at: '2026-10-15T06:00:00Z' },
    { id: 2, activity_type: 'run', distance_km: 10, duration_min: 54, avg_heart_rate: 155, started_at: '2026-11-05T06:00:00Z' },
  ], zones);
  assert.equal(ef.series.length, 2);
  assert.ok(ef.series[1].efficiencyIndex > ef.series[0].efficiencyIndex);

  // 6. Distance PRs & Riegel Curve
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

  // 7. Race-Week Planner & Carb-Loading
  const racePlan = buildRacePrepPlan(
    { title: 'Marathon', activity_type: 'run', distance_km: 42.2, race_date: '2026-11-12', carb_loading_enabled: true },
    65,
    new Date('2026-11-10T08:00:00'),
  );
  assert.equal(racePlan.inCarbLoadWindow, true);
  assert.equal(racePlan.carbLoadDays.length, 2);

  // 8. Fueling Engine Kit + HRR + ACWR + Carb Loading
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
