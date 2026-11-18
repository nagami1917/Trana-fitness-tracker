/**
 * A tracked session must teach the next plan.
 *
 *   node scripts/track-feeds-plan-smoke.mjs
 *
 * The loop the product promises:
 *
 *   Track a ride -> it is saved as an activity -> the next plan for that sport
 *   is estimated from how fast you actually rode -> the fueling suggestion
 *   follows from that duration.
 *
 * Two things have to hold, and neither was covered by a test:
 *
 * 1. upsertActivity() puts the saved session into the `activities` store, and
 *    PlanActivity feeds that store to predictDuration() as history.
 * 2. The model actually uses it: one tracked ride replaces the generic
 *    population pace with the athlete's measured speed.
 */

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { get } from 'svelte/store';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Compile one module to ESM and import it from a data URL. */
async function loadModule(entry) {
  const bundle = await build({
    root,
    configFile: false,
    envFile: false,
    logLevel: 'silent',
    plugins: [svelte()],
    build: { write: false, minify: false, lib: { entry: resolve(root, entry), name: 'T', formats: ['es'] } },
  });
  const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
  const chunk = outputs.find((e) => e.type === 'chunk');
  assert.ok(chunk?.code, `expected ${entry} to compile`);
  return import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);
}

const stores = await loadModule('src/stores/index.js');
const duration = await loadModule('src/lib/ml/duration.js');
const { recommendFueling } = await loadModule('src/lib/ml/fueling.js');

const model = JSON.parse(readFileSync(resolve(root, 'public/models/duration_model.json'), 'utf8'));

const plan = (history) => duration.predictDuration({
  model,
  activityType: 'ride',
  distanceKm: 52,
  elevationGainM: 130,
  experienceLevel: 1,
  history,
});

const fuelFor = (minutes) => recommendFueling({
  activityType: 'ride',
  durationMin: minutes,
  weightKg: 60,
  elevationPerKm: 130 / 52,
  avgSpeedKmh: 52 / (minutes / 60),
  sweatProfile: 'normal',
  temperatureC: 22,
  dailyCarbTargetG: null,
  energyCalibrationFactor: 1,
  maxHr: null,
  restingHr: null,
  acwr: null,
  carbLoading: false,
  fuelItems: [],
});

// 1. Start empty, as a new athlete would.
stores.activities.set([]);
const before = plan(get(stores.activities));

// 2. A tracked ride is saved. This is exactly what liveTracker calls after a
//    successful POST /activities.
const trackedRide = {
  id: 1,
  activity_type: 'ride',
  distance_km: 40,
  duration_min: 110,          // 21.8 km/h — faster than the 20 km/h prior
  elevation_gain_m: 150,
  started_at: '2026-11-16T07:00:00Z',
  source: 'gps',
};
stores.upsertActivity(trackedRide);

const history = get(stores.activities);
assert.equal(history.length, 1, 'the tracked session must be in the store');
assert.equal(history[0].id, 1, 'and it must be the one we saved');

const after = plan(history);

// 3. The estimate must now come from the athlete's own ride.
assert.equal(before.historyCount, 0, 'with no sessions the estimate is generic');
assert.equal(after.historyCount, 1, 'the tracked ride must reach the pace curve');
assert.ok(after.minutes < before.minutes,
  `a faster tracked ride must shorten the estimate: ${after.minutes} vs ${before.minutes}`);

// 4. The predicted speed must reflect what was actually ridden, not the prior.
const ridden = trackedRide.distance_km / (trackedRide.duration_min / 60);
assert.ok(Math.abs(after.speedKmh - ridden) < 3,
  `estimate should track the measured ${ridden.toFixed(1)} km/h, got ${after.speedKmh}`);
// The generic prior is DEFAULT_SPEED_KMH.ride (20) adjusted by experience:
// 20 * (1 + 0.085 * (1 - 3)) = 16.6 km/h at level 1.
const priorSpeed = 20 * (1 + 0.085 * (1 - 3));
assert.ok(Math.abs(before.speedKmh - priorSpeed) < 1,
  `the generic prior should be ${priorSpeed.toFixed(1)} km/h, got ${before.speedKmh}`);

// 5. A second ride of the same sport must be used too (two points = a curve).
stores.upsertActivity({
  id: 2, activity_type: 'ride', distance_km: 30, duration_min: 85,
  elevation_gain_m: 60, started_at: '2026-11-17T07:00:00Z', source: 'gps',
});
const two = plan(get(stores.activities));
assert.equal(two.historyCount, 2, 'both rides must be fitted');

// 6. Cross-sport isolation: a run must not inherit cycling history.
const run = duration.predictDuration({
  model, activityType: 'run', distanceKm: 10, elevationGainM: 50,
  experienceLevel: 1, history: get(stores.activities),
});
assert.equal(run.historyCount, 0, 'rides must not personalise a run');

// 7. The fueling suggestion follows the duration, so a faster estimate means
//    less fuel — same formulas, shorter session.
const fuelBefore = fuelFor(before.minutes);
const fuelAfter = fuelFor(after.minutes);
assert.ok(fuelAfter.carbs.totalG < fuelBefore.carbs.totalG,
  `a faster session needs fewer carbs: ${fuelAfter.carbs.totalG}g vs ${fuelBefore.carbs.totalG}g`);
assert.ok(fuelAfter.fluid.totalMl < fuelBefore.fluid.totalMl,
  'a faster session needs less fluid');

console.log('Tracked sessions feed the next plan ✔');
console.log(`  generic:              ${before.minutes} min @ ${before.speedKmh} km/h · ${fuelBefore.carbs.totalG} g carbs`);
console.log(`  after a tracked ride: ${after.minutes} min @ ${after.speedKmh} km/h · ${fuelAfter.carbs.totalG} g carbs`);
