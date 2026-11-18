/**
 * Past-session entry: the reciprocal-unit trap and the Settings editor.
 *
 *   node scripts/baseline-sessions-smoke.mjs
 *
 * The bug this locks down: the baseline form asked every sport for
 * "pace (min/km)". A cyclist reading that types their speed by reflex —
 * 20.2 meant as km/h is 2.97 km/h as pace. That value sits *inside* the
 * model's accepted window (ride: 1.5–65 km/h), so nothing rejected it, and
 * the fitted pace curve was ~7x too slow:
 *
 *     as typed  : a 20 km ride predicted 392 min
 *     as intended: a 20 km ride predicted  58 min
 *
 * Checks:
 *  1. Cycling defaults to "Distance + speed", running/walking/hiking to pace.
 *  2. A speed typed as a pace raises a warning; the unit is named.
 *  3. Hard bounds still block outright (the model would discard the row).
 *  4. Payloads are always metric + minutes, whichever way it was typed.
 *  5. Editing a saved session round-trips through fromApiRow.
 *  6. The same distance+duration gives the same payload in both unit systems.
 *  7. The Settings editor is reachable and mounts.
 */

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── 1. Pure logic, loaded straight through vite so we get the real module ──
const logic = await (async () => {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root,
    configFile: false,
    envFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
  });
  try {
    return await vite.ssrLoadModule('/src/lib/baselineSession.js');
  } finally {
    await vite.close();
  }
})();

const {
  DEFAULT_ENTRY_UNIT,
  SPEED_BOUNDS_KMH,
  TYPICAL_SPEED_KMH,
  blankRow,
  hardError,
  softWarning,
  rowSpeedKmh,
  rowMinutes,
  toPayload,
  fromApiRow,
  modeOptions,
  derivedReadout,
  convertRows,
  exampleFor,
  rowUsable,
  unusableReason,
  sessionUsability,
} = logic;

// 0. Placeholders must not contradict the form's own rules.
// The old form showed pace 6.0 for every sport, which is 10 km/h — outside
// walking's typical 3-8 band, so following the hint produced a rejected row.
for (const sport of ['run', 'ride', 'walk', 'hike']) {
  const [lo, hi] = TYPICAL_SPEED_KMH[sport];
  const distance = Number(exampleFor(sport, 'distance'));
  assert.ok(distance > 0, `${sport}: a distance example exists`);

  // Build the example row in whichever mode that sport defaults to.
  const mode = DEFAULT_ENTRY_UNIT[sport];
  const example = {
    ...blankRow(sport),
    distance: String(distance),
    [mode === 'speed' ? 'speed' : 'pace']: exampleFor(sport, mode === 'speed' ? 'speed' : 'pace'),
  };
  const speed = rowSpeedKmh(example, 'metric');
  assert.ok(speed >= lo && speed <= hi,
    `${sport}: the placeholder must sit inside its own typical band ${lo}-${hi} km/h, got ${speed.toFixed(1)}`);
  assert.equal(hardError(example, 'metric'), '', `${sport}: following the placeholder must never be blocked`);
}

// 0b. "2 of 2" must mean USABLE, not merely filled in.
// This is the screenshot case: two complete rows that the model discards.
const unusableWalks = [
  { activity_type: 'walk', distance_km: 10, duration_min: 15, elevation_gain_m: 20 },
  { activity_type: 'walk', distance_km: 6, duration_min: 11.4, elevation_gain_m: 10 },
];
const walkUsage = sessionUsability(unusableWalks, 'walk');
assert.equal(walkUsage.usableCount, 0, 'both walks are outside the model bounds');
assert.equal(walkUsage.rejectedCount, 2, 'both are reported as rejected, not as usable');
assert.match(walkUsage.note, /not usable/, 'the athlete is told they cannot be used');
assert.match(walkUsage.note, /Past sessions/, 'and where to fix them');

// The same rows while planning a ride: real data, wrong sport.
const rideUsage = sessionUsability(unusableWalks, 'ride');
assert.equal(rideUsage.usableCount, 0, 'a walk can never inform a ride');
assert.equal(rideUsage.otherSportCount, 2);
assert.match(rideUsage.note, /none for cycling/, 'the reason is the sport, not the pace');

// Two valid rides must report complete and produce no note.
const goodRides = [
  { activity_type: 'ride', distance_km: 60, duration_min: 180, elevation_gain_m: 200 },
  { activity_type: 'ride', distance_km: 40, duration_min: 120, elevation_gain_m: 100 },
];
const good = sessionUsability(goodRides, 'ride');
assert.equal(good.usableCount, 2, 'two normal rides are usable');
assert.equal(good.note, '', 'nothing to warn about when the model has enough data');

// One usable session is not enough to fit a curve.
const one = sessionUsability([goodRides[0]], 'ride');
assert.equal(one.usableCount, 1);
assert.match(one.note, /needs 2/, 'one session is still blended with a generic pace');

// 0c. rowUsable mirrors the model's own filter, per sport.
assert.equal(rowUsable({ activity_type: 'walk', distance: 10, duration_min: 15, mode: 'time' }, 'metric'), false,
  '40 km/h walk is discarded by the model');
assert.equal(rowUsable({ activity_type: 'walk', distance: 10, duration_min: 90, mode: 'time' }, 'metric'), true,
  '6.7 km/h walk is kept');
assert.match(unusableReason({ activity_type: 'walk', distance: 10, duration_min: 15, mode: 'time' }, 'metric'),
  /outside what the model accepts for walking/);

// 1. Each sport is asked for in the unit it is actually thought about in.
assert.equal(DEFAULT_ENTRY_UNIT.ride, 'speed', 'cycling should be speed-first');
assert.equal(DEFAULT_ENTRY_UNIT.run, 'pace');
const rideModes = modeOptions('ride').map((m) => m.id);
assert.equal(rideModes[0], 'speed', 'speed is the first option for a ride');
assert.ok(rideModes.includes('pace') && rideModes.includes('time'));
const runModes = modeOptions('run').map((m) => m.id);
assert.equal(runModes[0], 'pace', 'pace stays first for a run');
assert.ok(runModes.includes('speed'), 'a runner can still choose speed');

// 2. THE BUG: the exact values from the screenshot, read as pace.
const misread = { ...blankRow('ride'), mode: 'pace', distance: '32', pace: '20.2' };
const misreadSpeed = rowSpeedKmh(misread, 'metric');
assert.ok(Math.abs(misreadSpeed - 2.97) < 0.01, `expected ~2.97 km/h, got ${misreadSpeed}`);
assert.equal(hardError(misread, 'metric'), '', 'inside the hard bounds, so it is not blocked');
const warn = softWarning(misread, 'metric');
assert.match(warn, /3\.0 km\/h is unusual for cycling/, 'a 3 km/h ride must be flagged');
assert.match(warn, /switch to .Distance \+ speed./i, 'the warning names the fix');

// The same session typed as speed is clean.
const asSpeed = { ...blankRow('ride'), mode: 'speed', distance: '32', speed: '20.2' };
assert.equal(softWarning(asSpeed, 'metric'), '', 'a normal cycling speed must not warn');
assert.ok(Math.abs(rowSpeedKmh(asSpeed, 'metric') - 20.2) < 0.01);

// 3. Hard bounds still block what the model would silently discard.
// 20 km in 1400 min = 0.86 km/h: duration is legal, only speed is not, so this
// is genuinely the speed guard firing rather than the duration limit.
const tooSlow = { ...blankRow('ride'), mode: 'time', distance: '20', duration_min: '1400' };
assert.match(hardError(tooSlow, 'metric'), /model can't use/, '0.86 km/h is rejected as unusable');
assert.equal(softWarning(tooSlow, 'metric'), '', 'a blocked row does not also get a nudge');
const tooFast = { ...blankRow('run'), mode: 'speed', distance: '10', speed: '44' };
assert.match(hardError(tooFast, 'metric'), /model can't use/);
// A genuinely unusual-but-legal athlete is warned, not blocked.
const fastRunner = { ...blankRow('run'), mode: 'speed', distance: '10', speed: '24' };
assert.equal(hardError(fastRunner, 'metric'), '', '24 km/h is legal for a runner');
assert.match(softWarning(fastRunner, 'metric'), /unusual for running/);

// 4. Payload is metric + minutes regardless of entry unit.
const speedPayload = toPayload(asSpeed, 'metric');
assert.equal(speedPayload.distance_km, 32);
assert.ok(Math.abs(speedPayload.duration_min - (32 / 20.2) * 60) < 0.02,
  `duration should be ${((32 / 20.2) * 60).toFixed(2)} min, got ${speedPayload.duration_min}`);

const pacePayload = toPayload({ ...blankRow('run'), mode: 'pace', distance: '10', pace: '6' }, 'metric');
assert.equal(pacePayload.distance_km, 10);
assert.equal(pacePayload.duration_min, 60, '10 km at 6 min/km is 60 min');

const timePayload = toPayload({ ...blankRow('run'), mode: 'time', distance: '5', duration_min: '30' }, 'metric');
assert.equal(timePayload.duration_min, 30);

// 5. Editing round-trips: an API row becomes an editable row that re-posts the same numbers.
const apiRow = { id: 9, activity_type: 'ride', distance_km: 32, duration_min: 95.05, elevation_gain_m: 132 };
const editable = fromApiRow(apiRow, 'metric');
assert.equal(editable.mode, 'speed', 'a ride opens in speed mode');
const roundTrip = toPayload(editable, 'metric');
assert.equal(roundTrip.distance_km, 32);
assert.ok(Math.abs(roundTrip.duration_min - 95.05) < 0.2,
  `round-trip must preserve duration, got ${roundTrip.duration_min}`);

// 6. Imperial: typing miles must convert to the same kilometres the model sees.
const imperialRow = { ...blankRow('run'), mode: 'pace', distance: '6.2137', pace: '9.6561' };
const imperialPayload = toPayload(imperialRow, 'imperial');
assert.ok(Math.abs(imperialPayload.distance_km - 10) < 0.01,
  `6.2137 mi should be ~10 km, got ${imperialPayload.distance_km}`);
assert.ok(Math.abs(imperialPayload.duration_min - 60) < 0.1,
  `~60 min expected, got ${imperialPayload.duration_min}`);
// The derived readout must speak the athlete's unit back to them.
assert.match(derivedReadout(imperialRow, 'imperial'), /mi/);

// 7. Switching units converts what was typed instead of reinterpreting it.
//    A 5 km run must stay 5 km when shown in miles (3.1), not become 5 miles.
const kmRun = { ...blankRow('run'), mode: 'pace', distance: '5', pace: '6' };
const beforeKm = toPayload(kmRun, 'metric');
const miles = convertRows([kmRun], 'metric', 'imperial')[0];
assert.ok(Math.abs(Number(miles.distance) - 3.11) < 0.05,
  `5 km is ~3.11 mi, got ${miles.distance}`);
// Pace in minutes per mile is longer than per km (1 mi = 1.609 km).
assert.ok(Math.abs(Number(miles.pace) - 6 * 1.609344) < 0.02,
  `6:00/km is ~9:39/mi, got ${miles.pace}`);
const afterKm = toPayload(miles, 'imperial');
assert.ok(Math.abs(afterKm.distance_km - beforeKm.distance_km) < 0.01,
  `the same session must survive the round trip: ${beforeKm.distance_km} -> ${afterKm.distance_km}`);
assert.ok(Math.abs(afterKm.duration_min - beforeKm.duration_min) < 0.1,
  `duration must not drift: ${beforeKm.duration_min} -> ${afterKm.duration_min}`);

// Speed scales like distance (mph = km/h x 0.621), not like pace.
const rideSpeed = { ...blankRow('ride'), mode: 'speed', distance: '32', speed: '20.2' };
const rideMiles = convertRows([rideSpeed], 'metric', 'imperial')[0];
assert.ok(Math.abs(Number(rideMiles.speed) - 12.6) < 0.1, `20.2 km/h is 12.6 mph, got ${rideMiles.speed}`);
assert.ok(Math.abs(toPayload(rideMiles, 'imperial').distance_km - 32) < 0.2,
  'the ride still saves as 32 km');

// Time mode has no unit-dependent field beyond distance.
const timed = { ...blankRow('run'), mode: 'time', distance: '10', duration_min: '50' };
const timedMiles = convertRows([timed], 'metric', 'imperial')[0];
assert.equal(timedMiles.duration_min, '50', 'duration is unit-independent');
assert.ok(Math.abs(toPayload(timedMiles, 'imperial').distance_km - 10) < 0.2);

// Same-unit conversion is a no-op.
assert.deepEqual(convertRows([kmRun], 'metric', 'metric'), [kmRun]);

// ── 2. The Settings editor actually mounts and loads ──
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
      entry: resolve(root, 'scripts/stubs/past-sessions-entry.js'),
      name: 'PastSessionsTest',
      formats: ['iife'],
    },
  },
});

const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const chunk = outputs.find((entry) => entry.type === 'chunk');
assert.ok(chunk?.code, 'Expected compiled PastSessions chunk');

const window = new Window({ url: 'https://trana-web.vercel.app/settings?tab=sessions' });
const { document } = window;
window.structuredClone = globalThis.structuredClone;
document.body.innerHTML = '<div id="app"></div>';

window.localStorage.setItem('trana.token', 'test-token');
const csrfToken = 'a'.repeat(64);
const jsonResp = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

const created = [];
const updated = [];
const removed = [];
const savedRows = [
  { id: 1, activity_type: 'ride', distance_km: 32, duration_min: 95.05, elevation_gain_m: 132, speed_kmh: 20.19, performed_on: '2026-11-08' },
  { id: 2, activity_type: 'ride', distance_km: 15, duration_min: 44.17, elevation_gain_m: 123, speed_kmh: 20.38, performed_on: '2026-11-05' },
];

window.fetch = async (url, init = {}) => {
  const path = String(url);
  const method = (init.method || 'GET').toUpperCase();
  if (path === '/api/auth/csrf') return jsonResp({ csrfToken });
  if (path.startsWith('/api/baseline-activities') && method === 'GET') {
    return jsonResp({ data: savedRows, meta: { max: 2, by_type: {} } });
  }
  if (path.startsWith('/api/baseline-activities') && method === 'POST') {
    created.push(JSON.parse(init.body));
    return jsonResp({ data: { id: 99, ...JSON.parse(init.body) } }, 201);
  }
  if (path.startsWith('/api/baseline-activities') && method === 'PATCH') {
    updated.push(JSON.parse(init.body));
    return jsonResp({ data: { id: 1, ...JSON.parse(init.body) } });
  }
  if (path.startsWith('/api/baseline-activities') && method === 'DELETE') {
    removed.push(path);
    return jsonResp({ meta: {} });
  }
  if (path.startsWith('/api/client-errors')) return jsonResp({}, 201);
  return jsonResp({ data: {} });
};

window.eval(chunk.code);
const harness = window.__pastSessionsTest;
const flush = () => harness.flush();
const waitFor = async (cond, label) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    flush();
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`Timed out waiting for ${label}`);
};
const text = () => document.body.textContent.replace(/\s+/g, ' ');

try {
  harness.mount();
  // Wait for the rows themselves, not just the heading: the heading renders
  // before the fetch resolves, which would make the assertions race.
  await waitFor(() => /32 km · 95 min/.test(text()), 'past sessions to load');

  // Both saved rides render, with their derived speed.
  assert.match(text(), /32 km · 95 min/, 'saved ride renders its distance and duration');
  assert.match(text(), /20\.19 km\/h/, 'the stored speed is shown, not just the raw inputs');
  assert.match(text(), /Your own pace is used for this sport/, 'a complete sport says so');

  // Sports with no rows offer an add button and admit the generic fallback.
  assert.match(text(), /Generic average — add a session to personalise this sport/, 'empty sports are honest about it');
  const addRun = [...document.querySelectorAll('button')]
    .find((b) => b.textContent.includes('Add past running session'));
  assert.ok(addRun, 'a run session can be added from Settings');

  // Editing a ride opens in speed mode with the value pre-filled from history.
  const editBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit');
  assert.ok(editBtn, 'an existing session can be edited');
  editBtn.click();
  flush();
  const speedInput = [...document.querySelectorAll('input')]
    .find((el) => el.getAttribute('type') === 'number');
  assert.ok(speedInput, 'the editor renders number inputs');

  const saveBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Save session'));
  assert.ok(saveBtn, 'the editor offers a save button');
  saveBtn.click();
  await waitFor(() => updated.length === 1, 'PATCH /baseline-activities');
  assert.equal(updated[0].activity_type, 'ride');
  assert.ok(updated[0].distance_km > 31 && updated[0].distance_km < 33,
    `edit must post the session's distance in km, got ${updated[0].distance_km}`);
  assert.equal(updated[0].performed_period !== undefined, true, 'period is included');

  console.log('Past sessions: unit trap, warnings and Settings editor checks passed ✔');
} finally {
  await window.happyDOM.abort();
}
