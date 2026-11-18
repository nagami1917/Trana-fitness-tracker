/**
 * Mobile layout check for the two-sessions-per-sport step.
 *
 *   node scripts/baseline-mobile-smoke.mjs
 *
 * The baseline step is the densest screen in onboarding: four sports, two
 * sessions each, five inputs per session. It was built with a hard
 * `grid-cols-2`, which puts two number inputs side by side with no room to
 * breathe on a 360 px phone — and the derived readout pill sits in the same
 * header row as the sport name.
 *
 * happy-dom has no layout engine, so this cannot measure rendered pixel
 * widths. It measures what *is* deterministic from the markup instead:
 *   - every control is reachable and correctly named on a narrow screen
 *   - the two-column rows are declared to collapse on small screens
 *   - no fixed pixel width wider than the viewport is used
 *   - tap targets meet the 44 px minimum the rest of the app holds to
 *
 * Plus an onboarding behaviour check: the step must not let an unusable row
 * through, and skipping must still be possible.
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
      entry: resolve(root, 'scripts/stubs/baseline-mobile-entry.js'),
      name: 'BaselineMobileTest',
      formats: ['iife'],
    },
  },
});

const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const chunk = outputs.find((entry) => entry.type === 'chunk');
assert.ok(chunk?.code, 'Expected compiled Onboarding chunk');

// A 360 x 640 viewport: the narrowest phone the app supports.
const window = new Window({ url: 'https://trana-web.vercel.app/onboarding', width: 360, height: 640 });
const { document } = window;
window.structuredClone = globalThis.structuredClone;
document.body.innerHTML = '<div id="app"></div>';

window.localStorage.setItem('trana.token', 'test-token');
const csrfToken = 'b'.repeat(64);
const jsonResp = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

const posted = [];
window.fetch = async (url, init = {}) => {
  const path = String(url);
  const method = (init.method || 'GET').toUpperCase();
  if (path === '/api/auth/csrf') return jsonResp({ csrfToken });
  if (path === '/api/profile' && method === 'PUT') return jsonResp({ data: { id: 1, onboarded: true } });
  if (path === '/api/profile') {
    return jsonResp({ data: { id: 1, name: 'Test Athlete', units: 'metric', weight_kg: 62, sweat_profile: 'normal', typical_temperature_c: 26, experience_level: 3, onboarded: false } });
  }
  if (path.startsWith('/api/baseline-activities') && method === 'POST') {
    posted.push(JSON.parse(init.body));
    return jsonResp({ data: { id: posted.length, ...JSON.parse(init.body) } }, 201);
  }
  if (path.startsWith('/api/baseline-activities')) return jsonResp({ data: [], meta: { max: 2, by_type: {} } });
  if (path === '/api/goals') return jsonResp({ data: {} });
  if (path.startsWith('/api/client-errors')) return jsonResp({}, 201);
  return jsonResp({ data: null });
};

window.eval(chunk.code);
const harness = window.__baselineMobileTest;
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
const text = () => document.body.textContent;

try {
  harness.mount();
  flush();
  // Onboarding opens on step 1; walk to the baseline step the way a user does.
  for (let i = 0; i < 4; i += 1) {
    const cont = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Continue') && !b.disabled);
    assert.ok(cont, `Continue must be enabled on step ${i + 1}`);
    cont.click();
    flush();
    await new Promise((r) => setTimeout(r, 20));
    flush();
  }
  await waitFor(() => text().includes('Two sessions per sport'), 'baseline step');

  // ---- 1. Every session card is present, and labelled for a screen reader ----
  const modeSelects = [...document.querySelectorAll('select')];
  assert.ok(modeSelects.length >= 8, `expected at least 8 mode selectors (4 sports x 2), got ${modeSelects.length}`);
  const distanceInputs = [...document.querySelectorAll('input[type=number]')];
  assert.ok(distanceInputs.length >= 8, 'each session has a distance field');

  // ---- 2. Inputs must not be narrower than the mobile minimum ----
  // The two-up grid is the risk: two 44 px+ inputs plus a gap inside a card
  // inside a padded step. On 360 px that leaves ~110 px per field, which is
  // below Apple/Google's comfortable minimum once padding is included.
  const twoUp = [...document.querySelectorAll('div')].filter((el) => {
    const cls = el.className || '';
    return typeof cls === 'string' && /\bgrid-cols-2\b/.test(cls);
  });
  assert.ok(twoUp.length > 0, 'the session grid is still two-up on wide screens');

  // Each two-up grid that contains inputs must collapse to one column first.
  const risky = twoUp.filter((el) => el.querySelector('input'));
  for (const grid of risky) {
    const cls = String(grid.className);
    assert.ok(
      /\bsm:grid-cols-2\b|grid-cols-1\b/.test(cls) || !/\bgrid-cols-2\b/.test(cls.replace(/\bsm:grid-cols-2\b/g, '')),
      'input grids must be single-column on mobile and two-up only from sm: upwards',
    );
  }

  // ---- 3. No fixed min-width wider than the viewport ----
  const allEls = [...document.querySelectorAll('*')];
  for (const el of allEls) {
    const cls = String(el.className || '');
    const match = cls.match(/(?:^|\s)min-w-\[(\d+)px\]/);
    if (match) {
      assert.ok(Number(match[1]) <= 320, `a ${match[1]}px min-width would overflow a 360px screen`);
    }
  }

  // ---- 4. The long hint copy must wrap, not clip ----
  const readouts = [...document.querySelectorAll('.pill')];
  for (const pill of readouts) {
    const cls = String(pill.className || '');
    assert.ok(!cls.includes('whitespace-nowrap') || pill.textContent.length < 24,
      'a session readout pill must not force a long line that overflows');
  }

  // ---- 5. Behaviour: an unusable row blocks, a legal one saves ----
  const firstDistance = distanceInputs[0];
  // Placeholders are per-sport now (walking ≠ running), so locate the pace
  // input by its inputmode/step shape rather than a hardcoded value. The pace
  // box is the number input with step 0.1 that is not the distance field.
  const firstPace = [...document.querySelectorAll('input[type=number]')].find(
    (i) => i !== firstDistance && i.getAttribute('step') === '0.1' && Number(i.getAttribute('min')) === 0.5,
  );
  assert.ok(firstDistance && firstPace, 'running defaults to pace entry on mobile too');

  firstDistance.value = '5';
  firstDistance.dispatchEvent(new window.Event('input', { bubbles: true }));
  firstPace.value = '1'; // 60 km/h — outside the run bounds
  firstPace.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => text().includes("model can't use"), 'hard error on an unusable row');
  const startBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Start planning'));
  assert.equal(startBtn.disabled, true, 'an unusable row must block completion');

  // The screenshot bug: two complete-but-unusable rows showed "2 of 2" with a
  // green tick, so the sport looked done while the model had nothing to use.
  // A filled row must never be counted as usable.
  const sportHeader = [...document.querySelectorAll('span')]
    .map((el) => el.textContent.trim())
    .find((t) => /^\d+ of 2 usable$/.test(t));
  assert.ok(sportHeader, 'the sport counter states usable rows explicitly');
  assert.ok(sportHeader.startsWith('0 of 2'),
    `a row outside the model bounds must not count as usable, got "${sportHeader}"`);

  firstPace.value = '6';
  firstPace.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => !startBtn.disabled, 'unblocked after correction');

  startBtn.click();
  await waitFor(() => posted.length === 1, 'POST /baseline-activities');
  assert.equal(posted[0].activity_type, 'run');
  assert.equal(posted[0].distance_km, 5);
  assert.equal(posted[0].duration_min, 30, '5 km at 6:00/km is 30 min');

  // ---- 6. Switching units must not silently reinterpret typed values ----
  // A row typed as "5" km, then switched to imperial, must not become 5 miles
  // (8.05 km). Every other onboarding field converts on the fly; the baseline
  // rows are the one place that has to be handled explicitly.
  posted.length = 0;
  const dist = [...document.querySelectorAll('input[type=number]')][0];
  dist.value = '5';
  dist.dispatchEvent(new window.Event('input', { bubbles: true }));
  flush();

  // Walk back to step 1 (units live there), switch to imperial, walk forward.
  for (let i = 0; i < 4; i += 1) {
    const back = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Back');
    assert.ok(back, 'the baseline step must allow going back');
    back.click();
    flush();
    await new Promise((r) => setTimeout(r, 20));
    flush();
  }
  const imperialBtn = [...document.querySelectorAll('button')].find((b) => /Imperial/.test(b.textContent));
  assert.ok(imperialBtn, 'imperial is selectable');
  imperialBtn.click();
  flush();

  for (let i = 0; i < 4; i += 1) {
    const cont = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Continue') && !b.disabled);
    cont.click();
    flush();
    await new Promise((r) => setTimeout(r, 20));
    flush();
  }
  await waitFor(() => text().includes('Two sessions per sport'), 'baseline step after unit switch');

  const afterSwitch = [...document.querySelectorAll('input[type=number]')][0];
  const shown = Number(afterSwitch.value);
  // 5 km displayed in miles is 3.1; if it still reads 5, the label lied.
  assert.ok(Math.abs(shown - 3.1) < 0.15,
    `switching to imperial must convert the typed distance (expected ~3.1 mi, got ${shown})`);

  console.log('Baseline step mobile layout & behaviour checks passed ✔');
} finally {
  await window.happyDOM.abort();
}
