/**
 * Does the plan actually read back what the athlete logged?
 *
 *   node scripts/intake-history-smoke.mjs
 *
 * Until item 1, fueling advice was formula-only: the same 52 km ride produced
 * the same "85 g/h" whether you had fuelled at 40 g/h or 90 g/h on every past
 * session. Nothing in the app ever read the intake numbers back.
 *
 * `intakeHistory()` + `intakeComparisonNote()` close that loop: past sessions of
 * the same sport become the reference the new plan is measured against.
 *
 * The subtle bug this pins: a session with no logged intake is NOT a session
 * where the athlete ate nothing. Rows without numbers must be excluded, or the
 * average silently drops toward zero and the advice becomes "you fuel far less
 * than you should" - from missing data, not from behaviour.
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
    lib: { entry: resolve(root, 'src/lib/ml/fueling.js'), name: 'F', formats: ['es'] },
  },
});
const chunk = (Array.isArray(bundle) ? bundle[0].output : bundle.output).find((e) => e.type === 'chunk');
const { intakeHistory, intakeComparisonNote } = await import(
  `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`
);

let checks = 0;
const ok = (label, fn) => {
  fn();
  checks++;
  console.log(`  ok  ${label}`);
};

const ride = (over) => ({
  id: Math.random(),
  activity_type: 'ride',
  distance_km: 40,
  duration_min: 120,
  elevation_gain_m: 100,
  started_at: '2026-11-01T07:00:00Z',
  ...over,
});

/* ------------------------------------------------------------- the cases */

ok('two logged rides average into per-hour rates', () => {
  const m = intakeHistory(
    [
      ride({ id: 1, duration_min: 120, carbs_g: 100, fluid_ml: 900 }), // 50 g/h, 450 ml/h
      ride({ id: 2, duration_min: 90, carbs_g: 70, fluid_ml: 650 }), //   46.7 g/h, 433 ml/h
    ],
    'ride',
  );
  assert.equal(m.sessions, 2);
  assert.equal(Math.round(m.carbPerHourG), 49);
  assert.equal(Math.round(m.fluidPerHourMl), 443);
  assert.equal(m.minutes, 210, 'total minutes the rates are derived from');
});

ok('a session with no intake is excluded, not counted as zero', () => {
  const withGap = intakeHistory(
    [
      ride({ id: 1, duration_min: 120, carbs_g: 100, fluid_ml: 900 }),
      ride({ id: 2, duration_min: 60, carbs_g: null, fluid_ml: null }), // no numbers logged
    ],
    'ride',
  );
  assert.equal(withGap.sessions, 1, 'only the logged session may count');
  assert.equal(
    Math.round(withGap.carbPerHourG),
    50,
    'the unlogged hour must not drag the average down toward 33 g/h',
  );
});

ok('all rows unlogged returns null, not a zero rate', () => {
  const m = intakeHistory([ride({ carbs_g: null, fluid_ml: null })], 'ride');
  assert.equal(m, null, 'no data must mean no claim - never 0 g/h');
  // The helper's contract is '' for "nothing to say"; index.js maps that to
  // null before it reaches the plan, so the card renders nothing.
  assert.equal(intakeComparisonNote(m, 85), '', 'and no note is emitted');
});

ok('another sport never leaks into the comparison', () => {
  const m = intakeHistory(
    [
      ride({ id: 1, duration_min: 120, carbs_g: 100, fluid_ml: 900 }),
      { ...ride({ id: 2, duration_min: 30, carbs_g: 10 }), activity_type: 'run' },
    ],
    'ride',
  );
  assert.equal(m.sessions, 1, 'the run must be ignored when planning a ride');
  assert.equal(Math.round(m.carbPerHourG), 50);
});

ok('rows with zero duration or distance cannot produce a rate', () => {
  const m = intakeHistory([ride({ duration_min: 0, carbs_g: 100 }), ride({ distance_km: 0, carbs_g: 100 })], 'ride');
  assert.equal(m, null, 'dividing by zero duration would be Infinity g/h');
});

ok('the note states the gap against the plan, in numbers', () => {
  const m = intakeHistory(
    [
      ride({ id: 1, duration_min: 120, carbs_g: 100, fluid_ml: 900 }),
      ride({ id: 2, duration_min: 90, carbs_g: 70, fluid_ml: 650 }),
    ],
    'ride',
  );
  const note = intakeComparisonNote(m, 85);
  assert.ok(note, 'a note is produced when there is data');
  assert.match(note, /\b2 sessions\b/, 'says how much evidence this rests on');
  assert.match(note, /49 g carbs\/h/, 'quotes the measured carb rate');
  assert.match(note, /443 ml fluid\/h/, 'quotes the measured fluid rate');
  assert.match(note, /85 g\/h/, "quotes this plan's target");
  assert.match(note, /about 36 g\/h more/, 'states the size of the gap and its direction');
});

ok('a single session reads "Last session", not "Last 1 sessions"', () => {
  const note = intakeComparisonNote(intakeHistory([ride({ carbs_g: 100, fluid_ml: 900 })], 'ride'), 85);
  assert.match(note, /^Last session you logged/, 'singular reads naturally');
  assert.ok(!/1 sessions/.test(note), 'no plural bug');
});

ok('fuelling above target reads as a warning, not a shortfall', () => {
  // 120 min at 120 g = 60 g/h, plan 50 g/h: the athlete over-fuelled.
  const note = intakeComparisonNote(intakeHistory([ride({ carbs_g: 120 })], 'ride'), 50);
  assert.match(note, /headroom/i, 'over-fuelling is described as headroom, not a deficit');
  assert.ok(!/Practise the higher rate/.test(note), 'no "practise the higher rate" advice when already there');
});

ok('matching target does not invent a gap', () => {
  const note = intakeComparisonNote(intakeHistory([ride({ carbs_g: 170 })], 'ride'), 85); // 85 g/h exactly
  assert.ok(note, 'still worth stating');
  assert.match(note, /matches this plan/i, 'a match is stated as a match');
  assert.ok(!/about 0 g\/h/.test(note), 'a zero gap must not be announced as a gap');
});

console.log(`\nintake-history-smoke: ${checks} checks pass - past intake now feeds the next plan.`);
