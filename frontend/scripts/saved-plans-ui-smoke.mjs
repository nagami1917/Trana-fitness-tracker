/**
 * Saved plans delete & list expansion UI test on PlanActivity.svelte.
 *
 *   node scripts/saved-plans-ui-smoke.mjs
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
      name: 'SavedPlansTest',
      formats: ['iife'],
    },
  },
});

const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const chunk = outputs.find((entry) => entry.type === 'chunk');
assert.ok(chunk?.code, 'Expected compiled SavedPlans test chunk');

const window = new Window({ url: 'https://trana-web.vercel.app/plan' });
const { document } = window;
window.structuredClone = globalThis.structuredClone;
document.body.innerHTML = '<div id="app"></div>';

const makePlan = (id, distanceKm, hasRoute = true) => ({
  id,
  activity_type: 'run',
  distance_km: distanceKm,
  elevation_gain_m: 20,
  route: hasRoute
    ? [
        [14.676, 121.035],
        [14.674, 121.042],
        [14.671, 121.051],
      ]
    : null,
  planned_for: null,
  status: 'planned',
  duration: { minutes: Math.round(distanceKm * 6), hours: 0.5, low: 10, high: 20, confidence: 0.8 },
  fueling: {
    intensity: 'moderate',
    met: 8.5,
    calories: { total: 220 },
    carbs: { perHourG: 30, totalG: 15 },
    sodium: { perHourMg: 500 },
    fluid: { perHourMl: 600 },
  },
  created_at: '2026-11-12T08:00:00Z',
});

let serverPlans = [
  makePlan(1, 0.93),
  makePlan(2, 5.2),
  makePlan(3, 1.86),
  makePlan(4, 1.89),
  makePlan(5, 3.4, false),
];
let failNextDelete = false;
const deletedIds = [];

window.localStorage.setItem('trana.token', 'test-token');
const csrfToken = '9'.repeat(64);
const jsonResp = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

window.fetch = async (url, init = {}) => {
  const path = String(url);
  const method = (init.method || 'GET').toUpperCase();
  if (path.startsWith('/models/')) return jsonResp({}, 404);
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
    return jsonResp({ data: serverPlans, meta: { current_page: 1, last_page: 1 } });
  }
  const delMatch = path.match(/^\/api\/predictions\/(\d+)$/);
  if (delMatch && method === 'DELETE') {
    assert.equal(init.headers['X-CSRF-TOKEN'], csrfToken);
    assert.equal(init.credentials, 'include');
    if (failNextDelete) {
      failNextDelete = false;
      return jsonResp({ message: 'Server busy' }, 500);
    }
    const id = Number(delMatch[1]);
    deletedIds.push(id);
    serverPlans = serverPlans.filter((p) => p.id !== id);
    return jsonResp({ deleted: true });
  }
  if (path.includes('/api/client-errors')) return jsonResp({}, 201);
  return jsonResp({ elements: [] });
};

window.eval(chunk.code);
const harness = window.__savedPlansTest;

const waitFor = async (condition) => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    harness.flush();
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for saved-plans condition');
};

const buttonsWithText = (text) =>
  [...document.querySelectorAll('button')].filter((b) => b.textContent.includes(text));

try {
  harness.mount([...serverPlans]);

  // 1. Shows 4 plans initially + "5" total badge + "Show all (5)" toggle.
  assert.equal(document.querySelectorAll('button[aria-label^="Delete saved plan "]').length, 4);
  assert.ok(buttonsWithText('Show all (5)').length === 1, 'Expected Show all (5) toggle when > 4 plans exist');

  // 2. Expanding shows all 5 plans, including older ones.
  buttonsWithText('Show all (5)')[0].click();
  harness.flush();
  assert.equal(document.querySelectorAll('button[aria-label^="Delete saved plan "]').length, 5);
  assert.ok(buttonsWithText('Show recent (4)').length === 1);

  // 3. Clicking Trash opens inline Delete / Cancel without deleting prematurely; Cancel closes it.
  const trash2 = document.querySelector('button[aria-label="Delete saved plan 5.2 km run"]');
  assert.ok(trash2, 'Expected delete button for 5.2 km run');
  trash2.click();
  harness.flush();
  assert.equal(deletedIds.length, 0);
  const cancelBtn = buttonsWithText('Cancel').find((b) => b.closest('div')?.parentElement?.textContent.includes('5.2 km'));
  assert.ok(cancelBtn, 'Expected inline Cancel button');
  cancelBtn.click();
  harness.flush();
  assert.equal(deletedIds.length, 0);

  // 4. Load 5.2 km run into the active preview, then delete it -> clears stale preview too.
  const loadBtn = buttonsWithText('5.2 km run')[0];
  loadBtn.click();
  harness.flush();
  assert.match(document.body.textContent, /Plan #2 saved/);

  document.querySelector('button[aria-label="Delete saved plan 5.2 km run"]').click();
  harness.flush();
  const confirmBtn = [...document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'Delete',
  );
  assert.ok(confirmBtn, 'Expected inline Delete confirmation button');
  confirmBtn.click();

  await waitFor(() => deletedIds.includes(2) && harness.getPlans().length === 4);
  assert.deepEqual(deletedIds, [2]);
  assert.doesNotMatch(document.body.textContent, /Plan #2 saved/);
  assert.match(document.body.textContent, /Add a route on the map to start predicting/);
  assert.equal(harness.getToast()?.message, 'Saved plan deleted.');
  assert.equal(buttonsWithText('Show all').length, 0);

  // 5. Failed delete surfaces an error toast, keeps the row intact, and allows retry.
  failNextDelete = true;
  document.querySelector('button[aria-label="Delete saved plan 0.93 km run"]').click();
  harness.flush();
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete').click();
  await waitFor(() => harness.getToast()?.tone === 'error');
  assert.equal(harness.getPlans().length, 4);
  assert.match(harness.getToast()?.message, /Server busy/);

  // Retrying the open Delete button succeeds once the server recovers.
  [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete').click();
  await waitFor(() => !harness.getPlans().some((p) => p.id === 1));

  // 6. Deleting remaining plans hides the Saved plans card completely.
  for (const id of [3, 4, 5]) {
    const btn = document.querySelector('button[aria-label^="Delete saved plan "]');
    assert.ok(btn, `Expected remaining delete button before deleting plan ${id}`);
    btn.click();
    harness.flush();
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Delete').click();
    await waitFor(() => !harness.getPlans().some((p) => p.id === id));
  }
  assert.equal(harness.getPlans().length, 0);
  assert.doesNotMatch(document.body.textContent, /Saved plans/);

  await harness.destroy();
  console.log('Saved plans delete & expand UI checks passed ✔');
} finally {
  await window.happyDOM.abort();
}
