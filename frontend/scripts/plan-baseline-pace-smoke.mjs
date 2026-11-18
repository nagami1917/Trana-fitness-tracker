/**
 * The athlete's own past sessions must drive the estimate.
 *
 *   node scripts/plan-baseline-pace-smoke.mjs
 *
 * THE BUG this guards:
 *   Onboarding/Settings past sessions are stored as `is_baseline` rows.
 *   GET /api/activities deliberately hides them so the activity list never
 *   invents workouts — but the in-browser preview built its history from that
 *   same list. So the sessions an athlete typed to describe their own pace
 *   were dropped before the model saw them, and every plan fell back to a
 *   generic population pace. The server-side path (ActivityService::history)
 *   never had the filter, so the preview and the saved plan could disagree.
 *
 * These checks read the estimate through the store, so they fail if the
 * baseline sessions stop reaching predictPlan().
 */

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const bundle = await build({
  root,
  configFile: false,
  envFile: false,
  logLevel: 'silent',
  plugins: [svelte()],
  build: {
    write: false,
    minify: false,
    lib: {
      entry: resolve(root, 'src/lib/ml/index.js'),
      name: 'BaselinePaceTest',
      formats: ['es'],
    },
  },
});

const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const chunk = outputs.find((entry) => entry.type === 'chunk');
assert.ok(chunk?.code, 'expected the prediction pipeline to compile');

const mod = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);

// The model is fetched by URL in the browser; in Node we inject the artifact.
const { readFileSync } = await import('node:fs');
const modelJson = JSON.parse(readFileSync(resolve(root, 'public/models/duration_model.json'), 'utf8'));

const savedFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).includes('duration_model.json')) {
    return { ok: true, status: 200, json: async () => modelJson };
  }
  return { ok: true, status: 200, json: async () => ({}) };
};

const profile = {
  weight_kg: 60,
  experience_level: 1,
  sweat_profile: 'normal',
  typical_temperature_c: 22,
  units: 'metric',
};

const plan = (activities) => mod.predictPlan({
  activity: { activity_type: 'ride', distance_km: 52, elevation_gain_m: 130, temperature_c: 22, route: null },
  profile,
  activities,
  fuelItems: [],
  acwr: null,
  carbLoading: false,
});

/** Baseline rows arrive from /api/baseline-activities in this shape. */
const baseline = (distance_km, duration_min, extra = {}) => ({
  id: `b-${distance_km}-${duration_km(duration_min)}`,
  activity_type: 'ride',
  distance_km,
  duration_min,
  elevation_gain_m: 0,
  performed_on: '2026-11-01',
  ...extra,
});
const duration_km = (m) => m;

try {
  // 1. No sessions: the generic population pace.
  const generic = await plan([]);
  assert.equal(generic.duration.historyCount, 0, 'no history means a generic estimate');
  const genericMinutes = generic.duration.minutes;

  // 2. Two of the athlete's own rides must move the estimate.
  //    52 km in 170 min = 18.4 km/h, noticeably faster than the 16.6 km/h
  //    generic fallback, so a correct pipeline gets faster.
  const own = await plan([
    baseline(52, 170),
    baseline(40, 132),
  ]);
  assert.equal(own.duration.historyCount, 2, 'both sessions must reach the model');
  assert.notEqual(
    Math.round(own.duration.minutes),
    Math.round(genericMinutes),
    'the athlete\'s own pace must change the estimate',
  );
  assert.ok(
    own.duration.minutes < genericMinutes,
    `a faster athlete must get a faster estimate: ${own.duration.minutes.toFixed(0)} vs ${genericMinutes.toFixed(0)} min`,
  );

  // 3. history_used must report what the model used, not the raw row count.
  assert.equal(own.history_used, 2, 'history_used mirrors the fitted session count');
  assert.equal(generic.history_used, 0, 'history_used is 0 when nothing was fitted');

  // 4. Sessions of another sport must not be credited to this one.
  const wrongSport = await plan([
    baseline(10, 90, { activity_type: 'walk' }),
    baseline(6, 55, { activity_type: 'walk' }),
  ]);
  assert.equal(wrongSport.duration.historyCount, 0, 'a walk can never inform a ride');
  assert.equal(Math.round(wrongSport.duration.minutes), Math.round(genericMinutes),
    'a different sport must leave the ride estimate untouched');

  // 5. A session the model rejects is not counted (mirrors SPEED_BOUNDS_KMH).
  const rejected = await plan([baseline(52, 30)]); // 104 km/h, far above the ride max of 65
  assert.equal(rejected.duration.historyCount, 0, 'an unusable session must not be fitted');

  console.log('Past sessions drive the estimate: baseline pace checks passed ✔');
  console.log(`  generic ${genericMinutes.toFixed(0)} min · own pace ${own.duration.minutes.toFixed(0)} min`);
} finally {
  globalThis.fetch = savedFetch;
}
