/**
 * Typed distance without drawing a route.
 *
 *   node scripts/plan-typed-distance-smoke.mjs
 *
 * The Route planner map still exists; this proves it is no longer the only way
 * to get a prediction. Typing a distance must produce the same duration +
 * fueling card the map produces.
 *
 * 1. The Distance field is editable (it used to be `disabled` → "Add route on map").
 * 2. A typed distance alone yields a prediction: duration, calories, carbs,
 *    electrolytes, fluid — with no route drawn.
 * 3. The map is still mounted and functional (not a regression).
 * 4. Typing does not reset to 0 on the next tick.
 * 5. Saving posts distance_km with route: null.
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
  resolve: {
    alias: [
      { find: /^leaflet\/dist\/leaflet\.css$/, replacement: resolve(root, 'scripts/stubs/empty.css') },
      { find: /^leaflet$/, replacement: resolve(root, 'scripts/stubs/leaflet-interactive.js') },
      { find: /^@maplibre\/maplibre-gl-leaflet$/, replacement: resolve(root, 'scripts/stubs/maplibre-gl-leaflet.js') },
      { find: /^maplibre-gl\/dist\/maplibre-gl\.css$/, replacement: resolve(root, 'scripts/stubs/empty.css') },
      { find: 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', replacement: resolve(root, 'scripts/stubs/empty-url.js') },
      { find: /^maplibre-gl$/, replacement: resolve(root, 'scripts/stubs/maplibre-gl-interactive.js') },
    ],
  },
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

const posted = [];
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
  if (path.startsWith('/models/')) return jsonResp({ version: 'test', training_source: 'synthetic', metrics: {} });
  if (path === '/api/auth/csrf') return jsonResp({ csrfToken });
  if (path === '/api/profile') {
    return jsonResp({ data: { id: 1, name: 'Test Athlete', weight_kg: 62, sweat_profile: 'normal',
      typical_temperature_c: 26, experience_level: 2, units: 'metric', onboarded: true } });
  }
  if (path.startsWith('/api/activities')) return jsonResp({ data: [], meta: { current_page: 1, last_page: 1 } });
  if (path === '/api/goals') return jsonResp({ data: {} });
  if (path.startsWith('/api/fuel-items')) return jsonResp({ data: [] });
  if (path.startsWith('/api/race-events')) return jsonResp({ data: [] });
  if (path.startsWith('/api/predictions?')) return jsonResp({ data: [], meta: { current_page: 1, last_page: 1 } });
  if (path === '/api/predictions' && method === 'POST') {
    posted.push(JSON.parse(init.body));
    return jsonResp({ data: { ...JSON.parse(init.body), id: 1, created_at: new Date().toISOString(),
      status: 'planned', duration: { minutes: 60, hours: 1, low: 55, high: 66, confidence: 0.8 },
      fueling: { intensity: 'moderate', met: 8.5, calories: { total: 600 }, carbs: { perHourG: 30, totalG: 30 },
        sodium: { perHourMg: 500 }, fluid: { perHourMl: 600 } } } }, 201);
  }
  if (path.includes('open-meteo.com')) return jsonResp({ hourly: { time: [], temperature_2m: [] } });
  if (path.startsWith('/api/client-errors')) return jsonResp({}, 201);
  return jsonResp({ elements: [] });
};

window.eval(chunk.code);
const harness = window.__savedPlansTest;
const flush = () => harness.flush();
const waitFor = async (cond, label) => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    flush();
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`Timed out waiting for ${label}`);
};
const text = () => document.body.textContent.replace(/\s+/g, ' ');
const distanceInput = () => document.querySelector('input[aria-label="Distance"]');
const typeInto = (el, value) => {
  el.value = value;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  flush();
};

try {
  harness.mount([]);

  // 1. Editable, and the map still exists on this branch.
  const input = distanceInput();
  assert.ok(input, 'Distance input must exist');
  assert.equal(input.disabled, false, 'Distance must be editable');
  assert.equal(input.readOnly, false, 'Distance must be typeable before a route exists');
  assert.equal(input.placeholder, 'e.g. 10');
  // The map stubs register instances on a global; the DOM class is stub-dependent.
  assert.ok(window.__tranaCreatedMaps?.length >= 1 || globalThis.__tranaCreatedMaps?.length >= 1,
    'Route planner map must still be mounted');
  assert.match(text(), /Enter a distance to start predicting/);

  // 2. Typing a distance alone produces the full prediction card.
  typeInto(input, '1.33');
  await waitFor(() => /Save this plan/.test(text()), 'prediction from typed distance');
  assert.match(text(), /1\.33 km run/, 'header shows the typed distance');
  assert.match(text(), /Predicted duration/i, 'duration card rendered');
  assert.match(text(), /Calories/i);
  assert.match(text(), /Carbs/i);
  assert.match(text(), /Electrolytes/i);
  assert.match(text(), /Fluid/i);

  // 3. It must survive the next reactive tick — not be reset to 0.
  await new Promise((r) => setTimeout(r, 400));
  flush();
  assert.equal(distanceInput().value, '1.33', 'Typed distance must persist, not be zeroed');
  assert.match(text(), /1\.33 km run/);

  // 4. No "Track this route" — there is no route to follow.
  assert.ok(!/Track this route/.test(text()), 'No route-following affordance without a route');

  // 5. Save posts the typed distance and a null route.
  [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Save this plan')).click();
  await waitFor(() => posted.length === 1, 'POST /api/predictions');
  assert.equal(posted[0].distance_km, 1.33, 'typed distance is what is saved');
  assert.equal(posted[0].route, null, 'route is null when nothing was drawn');

  console.log('Typed-distance planning (map kept) checks passed ✔');
} finally {
  await window.happyDOM.abort();
}
