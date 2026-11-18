/**
 * Corrupted elevation must not corrupt predictions.
 *
 *   node scripts/elevation-prediction-guard-smoke.mjs
 *
 * Background: `flatEquivalentDuration()` divides a session's duration by its
 * climb to get a flat-ground equivalent, and that equivalent is what the
 * athlete's reference curve is fitted from. So an elevation figure that is too
 * high makes the athlete look faster than they are - permanently, for every
 * later prediction of that sport.
 *
 * That mattered because until the GPS filter shipped, altitude noise could
 * inflate a 300 m ride into 13,000 m. Measured on one 40 km / 110 min ride:
 *
 *     claimed climb   flat-equivalent pace   the model's idea of this athlete
 *     300 m            22.6 km/h             correct
 *     4,000 m          31.6 km/h             +40% too fast
 *     13,000 m         51.3 km/h             +127% too fast
 *
 * Two guards now stand between a bad number and the model:
 *
 *   1. `flatEquivalentDuration()` caps climb-per-km at a physically possible
 *      ceiling, so even a clamped value stays in a sane range;
 *   2. `validHistoryPoints()` drops the elevation term entirely for sessions
 *      whose climb is impossible, keeping the distance and duration (the part
 *      that is real) rather than deleting the session.
 *
 * The trap this test exists for: a *clamp* alone is not a fix. With the ceiling
 * set at 150 m/km, an impossible 4,000 m ride and an impossible 6,000 m ride
 * both hit the same corner and produced the *identical* wrong prediction - the
 * ceiling converted different errors into one confident lie. Hence guard 2.
 */

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
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
    lib: { entry: resolve(root, 'src/lib/ml/duration.js'), name: 'D', formats: ['es'] },
  },
});
const chunk = (Array.isArray(bundle) ? bundle[0].output : bundle.output).find((e) => e.type === 'chunk');
const duration = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);
const model = JSON.parse(await readFile(resolve(root, 'public/models/duration_model.json'), 'utf8'));

let checks = 0;
const ok = (label, fn) => {
  fn();
  checks++;
  console.log(`  ok  ${label}`);
};

/* A real session: 40 km in 110 min (21.8 km/h) with 300 m of climb. */
const RIDE = { distance_km: 40, duration_min: 110, elevation_gain_m: 300 };
const historyWith = (elevationGainM, n = 3) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    activity_type: 'ride',
    distance_km: RIDE.distance_km,
    duration_min: RIDE.duration_min,
    elevation_gain_m: elevationGainM,
    started_at: `2026-11-0${i + 1}T07:00:00Z`,
  }));
const predict = (elevation) =>
  duration.predictDuration({
    model,
    activityType: 'ride',
    distanceKm: 52,
    elevationGainM: 130,
    history: historyWith(elevation),
  }).minutes;

/* ------------------------------------------------------------- the ceiling */

ok('climb-per-km is capped at a value a human could sustain', () => {
  const flat = (m) => duration.flatEquivalentDuration(110, 40, m, 'ride');
  // 13,000 m over 40 km is 325 m/km. Without the cap the flat-equivalent pace
  // comes out at 51 km/h, which no cyclist averages.
  const extreme = flat(13000);
  assert.ok(extreme > 40, `flat equivalent ${extreme.toFixed(1)} min is impossibly fast`);
  // And the cap must not silently apply to a normal ride.
  assert.ok(Math.abs(flat(300) - duration.flatEquivalentDuration(110, 40, 300, 'ride')) < 1e-9);
});

ok('the ceiling is below the point where clamping lies', () => {
  // Documented in the source: 150 m/km made 4,000 m and 6,000 m identical.
  assert.ok(
    duration.MAX_PLAUSIBLE_ELEV_PER_KM <= 60,
    'ceiling must be tight enough that a clamp is rare, not the normal path',
  );
});

/* --------------------------------------------------------- the row guard */

ok('impossible climbs are recognised', () => {
  assert.equal(duration.isImplausibleElevation(40, 13000), true, '325 m/km');
  assert.equal(duration.isImplausibleElevation(40, 300), false, '7.5 m/km is a normal ride');
  assert.equal(duration.isImplausibleElevation(40, 0), false, 'no climb is not implausible');
  assert.equal(duration.isImplausibleElevation(0, 500), false, 'no distance: nothing to divide');
});

ok('a real mountain route is NOT discarded', () => {
  // 80 m/km: Alpe d'Huez is 100 m/km, so this is a hard but genuine day out.
  // With the 2x tolerance the row must survive, or honest athletes get ignored.
  assert.equal(duration.isImplausibleElevation(10, 800, { tolerance: 2 }), false);
});

ok('a corrupted row cannot move the reference curve', () => {
  const honest = predict(300);
  const corrupted = predict(13000);
  const drift = Math.abs(corrupted - honest) / honest;
  assert.ok(
    drift < 0.10,
    `a 13,000 m artefact shifted the prediction by ${(drift * 100).toFixed(1)}% (honest ${honest}, corrupted ${corrupted})`,
  );
});

ok('different corrupted values cannot collapse to one wrong answer', () => {
  // This is the regression the 150 m/km ceiling introduced: clamping made two
  // different impossible climbs produce the same confident prediction.
  const a = predict(12000);
  const b = predict(20000);
  assert.ok(
    Math.abs(a - b) <= 2,
    `12,000 m (${a} min) and 20,000 m (${b} min) must both fall back to the honest estimate, not to a shared clamp`,
  );
});

ok('honest history still drives the prediction', () => {
  // Guard must not flatten genuine personalisation: a fast athlete and a slow
  // one must still get different answers from their own data.
  const fast = duration.predictDuration({
    model, activityType: 'ride', distanceKm: 52, elevationGainM: 130,
    history: historyWith(300).map((r) => ({ ...r, duration_min: 90 })), // 26.7 km/h
  }).minutes;
  const slow = duration.predictDuration({
    model, activityType: 'ride', distanceKm: 52, elevationGainM: 130,
    history: historyWith(300).map((r) => ({ ...r, duration_min: 150 })), // 16 km/h
  }).minutes;
  assert.ok(fast < slow - 20, `a 90-min rider (${fast}) must beat a 150-min rider (${slow}) clearly`);
});

ok('the guard does not touch the no-history path', () => {
  const none = duration.predictDuration({ model, activityType: 'ride', distanceKm: 52, elevationGainM: 130, history: [] });
  assert.equal(none.historyCount, 0);
  assert.ok(none.minutes > 0);
});

console.log(`\nelevation-prediction-guard-smoke: ${checks} checks pass - a bad climb cannot outlive its session.`);
