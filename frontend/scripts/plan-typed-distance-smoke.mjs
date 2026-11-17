/**
 * Typed-distance planning test — the reason the map was removed.
 *
 *   node scripts/plan-typed-distance-smoke.mjs
 *
 * Proves a typed distance alone produces a full fueling estimate, with no map:
 * 1. The Distance field is editable (it used to be `disabled` / "Add route on map").
 * 2. Typing a distance runs the real model and shows duration, calories, carbs.
 * 3. Climb is optional (starts empty = 0, hint says "Leave 0 if it's flat") and
 *    raising it to 900 m visibly changes the estimate.
 * 4. No Leaflet/MapLibre container or canvas is mounted anywhere.
 * 5. Saving posts distance_km and no route key.
 */

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
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
      entry: resolve(root, 'scripts/stubs/saved-plans-entry.js'),
      name: 'PlanTypedDistanceTest',
      formats: ['iife'],
    },
  },
});

const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const chunk = outputs.find((entry) => entry.type === 'chunk');
assert.ok(chunk?.code, 'Expected compiled PlanActivity chunk');

const window = new Window({ url: 'https://trana-web.vercel.app/plan' });
const { document } = window;
window.structuredClone = globalThis.structuredClone;
document.body.innerHTML = '<div id="app"></div>';

const postedPredictions = [];
window.localStorage.setItem('trana.token', 'test-token');
const csrfToken = '7'.repeat(64);
const jsonResp = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

window.fetch = async (url, init = {}) => {
  const path = String(url);
  const method = (init.method || 'GET').toUpperCase();
  if (path.startsWith('/models/')) {
    return jsonResp({ version: 'test', training_source: 'synthetic', metrics: {} });
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
        experience_level: 2,
        units: 'metric',
        onboarded: true,
      },
    });
  }
  if (path.startsWith('/api/activities')) return jsonResp({ data: [], meta: { current_page: 1, last_page: 1 } });
  if (path === '/api/goals') return jsonResp({ data: {} });
  if (path.startsWith('/api/fuel-items')) return jsonResp({ data: [] });
  if (path.startsWith('/api/race-events')) return jsonResp({ data: [] });
  if (path.startsWith('/api/predictions?')) {
    return jsonResp({ data: [], meta: { current_page: 1, last_page: 1 } });
  }
  if (path === '/api/predictions' && method === 'POST') {
    const payload = JSON.parse(init.body);
    postedPredictions.push(payload);
    assert.equal(init.headers['X-CSRF-TOKEN'], csrfToken);
    return jsonResp({
      data: {
        ...payload,
        id: 1,
        created_at: new Date().toISOString(),
        status: 'planned',
        duration: { minutes: 60, hours: 1, low: 55, high: 66, confidence: 0.8 },
        fueling: {
          intensity: 'moderate',
          met: 8.5,
          calories: { total: 600 },
          carbs: { perHourG: 30, totalG: 30 },
          sodium: { perHourMg: 500 },
          fluid: { perHourMl: 600 },
        },
      },
    }, 201);
  }
  if (path.startsWith('/api/client-errors')) return jsonResp({}, 201);
  return jsonResp({ elements: [] });
};

window.eval(chunk.code);
const harness = window.__savedPlansTest;

const flush = () => harness.flush();
const waitFor = async (condition, label) => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    flush();
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const text = () => document.body.textContent.replace(/\s+/g, ' ');
const distanceInput = () => document.querySelector('input[aria-label="Distance"]');
const climbInput = () => document.querySelector('input[aria-label="Elevation gain"]');
const typeInto = (el, value) => {
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  flush();
};

try {
  harness.mount([]);

  // 1. Distance is typeable — nothing measures it from a map any more.
  assert.ok(distanceInput(), 'Distance input must exist');
  assert.equal(distanceInput().disabled, false, 'Distance must be editable');
  assert.equal(climbInput().value, '', 'Climb starts empty, i.e. 0');
  assert.match(text(), /Leave 0 if it's flat/);
  assert.match(text(), /Enter a distance to see your fueling plan/);

  // 2. No map of any kind.
  assert.equal(document.querySelector('.leaflet-container'), null, 'no Leaflet container');
  assert.equal(document.querySelector('.maplibregl-map'), null, 'no MapLibre map');
  assert.equal(document.querySelector('canvas'), null, 'no map canvas');

  // 3. Typing a distance alone produces a full estimate.
  typeInto(distanceInput(), '10');
  await waitFor(() => /Save this plan/.test(text()), 'prediction from typed distance');
  const flat = text();
  assert.match(flat, /10\.00 km run/, 'header reflects the typed distance');
  assert.doesNotMatch(flat, /Enter a distance to see your fueling plan/);
  assert.match(flat, /kcal/, 'calories estimated');

  // 4. Climb is optional, but it must actually change the numbers.
  typeInto(climbInput(), '900');
  await waitFor(() => /900 m gain/.test(text()), 'climb reflected in the header');
  assert.notEqual(text(), flat, 'climbing 900 m must change the estimate');

  // 5. Saving sends the typed distance and never a route.
  [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Save this plan')).click();
  await waitFor(() => postedPredictions.length === 1, 'POST /api/predictions');
  const sent = postedPredictions[0];
  assert.equal(sent.distance_km, 10);
  assert.equal(sent.elevation_gain_m, 900);
  assert.equal(sent.activity_type, 'run');
  assert.equal('route' in sent, false, 'no route key may be posted');
  assert.ok(sent.planned_for, 'planned_for is sent');

  console.log('Typed-distance planning (no map) checks passed ✔');
} finally {
  await window.happyDOM.abort();
}
