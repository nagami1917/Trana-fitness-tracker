/**
 * End-to-end UI check for Calendar -> Plan Activity "When" auto-fill and saving.
 *
 *   node scripts/plan-when-ui-smoke.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelJson = readFileSync(resolve(root, 'public/models/duration_model.json'), 'utf8');

const bundle = await build({
  root,
  configFile: false,
  envFile: false,
  logLevel: 'silent',
  plugins: [svelte()],
  resolve: {
    alias: [
      { find: /^maplibre-gl\/dist\/maplibre-gl\.css$/, replacement: resolve(root, 'scripts/stubs/empty.css') },
      { find: 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', replacement: resolve(root, 'scripts/stubs/empty-url.js') },
      { find: /^maplibre-gl$/, replacement: resolve(root, 'scripts/stubs/maplibre-gl-interactive.js') },
    ],
  },
  build: {
    write: false,
    minify: false,
    lib: {
      entry: resolve(root, 'scripts/stubs/plan-when-entry.js'),
      name: 'PlanWhenTest',
      formats: ['iife'],
    },
  },
});

const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const chunk = outputs.find((entry) => entry.type === 'chunk');
assert.ok(chunk?.code, 'Expected compiled PlanWhen test chunk');

const window = new Window({ url: 'https://trana-web.vercel.app/calendar' });
const { document } = window;
window.structuredClone = globalThis.structuredClone;
document.body.innerHTML = '<div id="app"></div>';

const postedPayloads = [];
let savedPlans = [];

window.localStorage.setItem('trana.token', 'test-token');
const csrfToken = '8'.repeat(64);
const jsonResp = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

window.fetch = async (url, init = {}) => {
  const path = String(url);
  const method = (init.method || 'GET').toUpperCase();
  if (path === '/models/duration_model.json') {
    return { ok: true, status: 200, text: async () => modelJson, json: async () => JSON.parse(modelJson) };
  }
  if (path === '/api/auth/csrf') return jsonResp({ csrfToken });
  if (path === '/api/profile') {
    return jsonResp({
      data: {
        id: 1,
        name: 'Test Athlete',
        email: 'athlete@example.test',
        weight_kg: 62,
        sweat_profile: 'normal',
        typical_temperature_c: 26,
      },
    });
  }
  if (path.startsWith('/api/activities')) return jsonResp({ data: [], meta: { current_page: 1, last_page: 1 } });
  if (path === '/api/goals') return jsonResp({ data: {} });
  if (path.startsWith('/api/predictions?')) {
    return jsonResp({ data: savedPlans, meta: { current_page: 1, last_page: 1 } });
  }
  if (path === '/api/predictions' && method === 'POST') {
    assert.equal(init.headers['X-CSRF-TOKEN'], csrfToken);
    assert.equal(init.credentials, 'include');
    const body = JSON.parse(init.body);
    postedPayloads.push(body);
    const created = {
      id: 40 + postedPayloads.length,
      activity_type: body.activity_type,
      distance_km: body.distance_km,
      elevation_gain_m: body.elevation_gain_m,
      route: body.route,
      planned_for: body.planned_for,
      status: 'planned',
      duration: { minutes: 14, hours: 0.23, low: 12, high: 16, confidence: 0.85 },
      fueling: {
        intensity: 'moderate',
        met: 8.5,
        calories: { total: 140 },
        carbs: { perHourG: 30, totalG: 7 },
        sodium: { perHourMg: 500 },
        fluid: { perHourMl: 600 },
      },
      created_at: new Date().toISOString(),
    };
    savedPlans = [created, ...savedPlans];
    return jsonResp({ data: created }, 201);
  }
  if (path.includes('/api/client-errors')) return jsonResp({}, 201);
  return jsonResp({ elements: [] });
};

window.eval(chunk.code);
const harness = window.__planWhenTest;

const waitFor = async (condition, label = 'plan-when condition') => {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    harness.flush();
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  const btns = [...document.querySelectorAll('button')].map((b) => b.textContent.trim());
  throw new Error(`Timed out waiting for ${label}. Buttons: ${JSON.stringify(btns)}`);
};

const buttonsWithText = (text) =>
  [...document.querySelectorAll('button')].filter((b) => b.textContent.includes(text));

const assertMatchesCurrentMinute = (localStr) => {
  assert.match(localStr, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, `Expected YYYY-MM-DDTHH:mm, got "${localStr}"`);
  const parsed = new Date(localStr);
  const diffMs = Math.abs(Date.now() - parsed.getTime());
  assert.ok(diffMs < 120_000, `Expected "${localStr}" to match current local date & time (diff=${diffMs}ms)`);
};

try {
  // 1. Unit checks on toDatetimeLocal helper.
  assert.equal(harness.toDatetimeLocal('not-a-date'), '');
  const sample = new Date(2026, 10, 5, 7, 4); // Nov 5, 2026 07:04 local
  assert.equal(harness.toDatetimeLocal(sample), '2026-11-05T07:04');

  // 2. Mount Calendar EmptyState -> click "Plan a workout" -> navigates to /plan with current "When".
  await harness.mountCalendar();
  const emptyPlanBtn = buttonsWithText('Plan a workout').find((b) => b.className.includes('btn-primary'));
  assert.ok(emptyPlanBtn, 'Expected EmptyState "Plan a workout" button on Calendar');
  emptyPlanBtn.click();
  harness.flush();
  assert.equal(harness.getRoute(), '/plan');

  await harness.mountPlan();
  const whenInput = () => document.querySelector('input[type="datetime-local"][aria-label="When"]');
  assert.ok(whenInput(), 'Expected When datetime-local input');
  assertMatchesCurrentMinute(whenInput().value);

  // 3. Mount Calendar week grid (with an activity this week) -> click any day's "+" button -> navigates to /plan with current "When".
  window.history.replaceState({}, '', '/calendar');
  await harness.mountCalendar({
    initialActivities: [
      {
        id: 1,
        activity_type: 'run',
        distance_km: 5,
        duration_min: 30,
        started_at: new Date().toISOString(),
      },
    ],
  });
  const dayPlusBtns = document.querySelectorAll('button[aria-label="Plan a workout"]');
  assert.equal(dayPlusBtns.length, 7, 'Expected 7 day-card "+" buttons on Calendar');
  dayPlusBtns[4].click(); // e.g., Friday day card
  harness.flush();
  assert.equal(harness.getRoute(), '/plan');

  await harness.mountPlan();
  assertMatchesCurrentMinute(whenInput().value);

  // 4. Switch to Straight-line mode, plot 2 points, wait for prediction, save without touching When -> sends valid current ISO timestamp.
  buttonsWithText('Straight line')[0].click();
  harness.flush();
  const map = harness.getLatestMap();
  assert.ok(map, 'Expected PlanActivity map instance');
  map.emit('click', { lngLat: { lat: 14.676, lng: 121.035 } });
  map.emit('click', { lngLat: { lat: 14.682, lng: 121.045 } });
  await waitFor(() => buttonsWithText('Save this plan').length === 1, 'initial Save this plan button');

  buttonsWithText('Save this plan')[0].click();
  await waitFor(
    () => postedPayloads.length === 1 && buttonsWithText('Saved').length === 1,
    'first save completion',
  );
  assert.ok(postedPayloads[0].planned_for, 'Expected planned_for to be sent automatically when saving');
  const sentDiff = Math.abs(Date.now() - new Date(postedPayloads[0].planned_for).getTime());
  assert.ok(sentDiff < 120_000, `Expected sent planned_for "${postedPayloads[0].planned_for}" to match now`);

  // 5. Start over keeps "When" populated with current local date, month, and time.
  buttonsWithText('Start over')[0].click();
  harness.flush();
  assertMatchesCurrentMinute(whenInput().value);

  // 6. Manual user edit to "When" is preserved on save instead of being overwritten with now.
  const customWhen = '2027-01-15T06:30';
  whenInput().value = customWhen;
  whenInput().dispatchEvent(new window.Event('input', { bubbles: true }));
  harness.flush();

  map.emit('click', { lngLat: { lat: 14.676, lng: 121.035 } });
  map.emit('click', { lngLat: { lat: 14.682, lng: 121.045 } });
  await waitFor(() => buttonsWithText('Save this plan').length === 1, 'second Save this plan button');

  buttonsWithText('Save this plan')[0].click();
  await waitFor(
    () => postedPayloads.length === 2 && buttonsWithText('Saved').length === 1,
    'second save completion',
  );
  assert.equal(postedPayloads[1].planned_for, new Date(customWhen).toISOString());

  // 7. Calendar displays the saved plan with its auto-filled planned_for time on Today's week.
  await harness.mountCalendar({ initialPlans: [savedPlans[1]] });
  assert.match(document.body.textContent, /1\.27 km/);

  await harness.destroy();
  console.log('Calendar -> Plan Activity "When" auto-fill & save checks passed ✔');
} finally {
  await window.happyDOM.abort();
}
