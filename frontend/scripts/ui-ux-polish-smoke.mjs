/**
 * Regression & acceptance checks for all 7 UI/UX polish items:
 * 1. Grouped sidebar IA, 5-slot mobile nav + More drawer, 3-tab Settings hub
 * 2. Tiered cards & compact collapsed past-history TrackActivityPrompt banner
 * 3. Semantic CSS tokens, WCAG AA ink-400 contrast (>= 4.5:1), dark basemap CSS
 * 4. tabular-nums enforcement across telemetry
 * 5. Onboarding Step 1 Metric/Imperial toggle + Step 2 3 quick-select presets
 * 6. Accessible Modal (role="dialog", aria-modal, focus trap & restore) + Toaster Undo
 * 7. Mascot & emoji restraint on Dashboard / AppShell
 *
 *   node scripts/ui-ux-polish-smoke.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function luminance(hex) {
  const clean = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(clean.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA, hexB) {
  const l1 = luminance(hexA);
  const l2 = luminance(hexB);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// --- Static CSS / token / source checks ---
const tailwindCfg = readFileSync(resolve(root, 'tailwind.config.js'), 'utf8');
const ink400Match = tailwindCfg.match(/ink:\s*\{[\s\S]*?400:\s*'(#[\da-fA-F]{6})'/);
assert.ok(ink400Match, 'Expected ink[400] hex color in tailwind.config.js');
const ratio = contrastRatio(ink400Match[1], '#ffffff');
assert.ok(ratio >= 4.5, `Expected ink[400] (${ink400Match[1]}) WCAG AA >= 4.5:1 on white, got ${ratio.toFixed(2)}`);

const appCss = readFileSync(resolve(root, 'src/app.css'), 'utf8');
for (const token of ['--bg-surface', '--bg-subtle', '--text-primary', '--text-muted', '--border-hairline', '.card-flat', 'tabular-nums', '.leaflet-tile-pane']) {
  assert.ok(appCss.includes(token), `app.css missing expected token/rule: ${token}`);
}

const dashSource = readFileSync(resolve(root, 'src/pages/Dashboard/Dashboard.svelte'), 'utf8');
assert.ok(!dashSource.includes('/mascot-cat.png'), 'Dashboard should not render decorative mascot images');
assert.ok(!dashSource.includes('🎉') && !dashSource.includes('💗'), 'Dashboard should not contain literal greeting/subtitle emojis');

// --- Compiled Happy-DOM UI checks ---
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
      entry: resolve(root, 'scripts/stubs/ui-ux-polish-entry.js'),
      name: 'UiUxPolishTest',
      formats: ['iife'],
    },
  },
});

const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const chunk = outputs.find((entry) => entry.type === 'chunk');
assert.ok(chunk?.code, 'Expected compiled UiUxPolishTest chunk');

const window = new Window({ url: 'https://trana-web.vercel.app/' });
const { document } = window;
window.structuredClone = globalThis.structuredClone;
document.body.innerHTML = '<div id="app"></div>';
window.localStorage.setItem('trana.token', 'test-token');
window.fetch = async (url) => {
  const path = String(url);
  if (path.includes('/api/notifications')) {
    return { ok: true, status: 200, text: async () => JSON.stringify({ items: [], unread: 0 }), json: async () => ({ items: [], unread: 0 }) };
  }
  return { ok: true, status: 200, text: async () => JSON.stringify({ data: null }), json: async () => ({ data: null }) };
};

window.eval(chunk.code);
const harness = window.__polishTest;

// 1. Settings 3-tab hub
await harness.mountView('Settings');
const tabs = [...document.querySelectorAll('[role="tab"]')].map((el) => el.textContent.trim());
assert.deepEqual(tabs, ['Athlete Bio', 'Units & Appearance', 'Devices & Data']);
assert.ok(document.querySelector('#settings-city'), 'Athlete Bio tab must render #settings-city by default');
document.querySelectorAll('[role="tab"]')[1].click();
harness.flush();
assert.match(document.body.textContent, /Dark Outdoor \(OLED\)/);
document.querySelectorAll('[role="tab"]')[2].click();
harness.flush();
assert.match(document.body.textContent, /Wearable energy calibration/);

// 2. Onboarding Step 1 unit switch + Step 2 3 quick presets
await harness.mountView('Onboarding');
assert.match(document.body.textContent, /Body mass \(kg\)/);
const imperialBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Imperial (mi, lb)'));
assert.ok(imperialBtn, 'Onboarding Step 1 should expose Imperial toggle');
imperialBtn.click();
harness.flush();
assert.match(document.body.textContent, /Body mass \(lb\)/);

const continueBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Continue'));
continueBtn.click();
harness.flush();
assert.match(document.body.textContent, /Stay Active · 3x\/wk/);
assert.match(document.body.textContent, /5K \/ 10K Runner/);
assert.match(document.body.textContent, /Endurance \/ Half\+/);

const enduranceBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Endurance / Half+'));
enduranceBtn.click();
harness.flush();
const inputsStep2 = [...document.querySelectorAll('input[type="number"]')].map((i) => Number(i.value));
assert.equal(inputsStep2[0], 2900, 'Endurance preset should auto-fill 2900 kcal');

// 3. AppShell grouped IA & mobile 5-slot More drawer
await harness.mountView('AppShell');
assert.match(document.body.textContent, /Train/);
assert.match(document.body.textContent, /Progress/);
assert.match(document.body.textContent, /Account/);
const moreBtn = [...document.querySelectorAll('nav button')].find((b) => b.textContent.includes('More'));
assert.ok(moreBtn, 'Mobile nav should include More button');
moreBtn.click();
harness.flush();
assert.match(document.body.textContent, /Insights & Account/);

// 4. Compact collapsed past-history TrackActivityPrompt banner
harness.setActivities([
  {
    id: 99,
    source: 'gps',
    activity_type: 'run',
    distance_km: 5.4,
    duration_min: 30,
    calories: 340,
    started_at: '2026-11-09T07:00:00Z',
    route: [
      [14.676, 121.043],
      [14.68, 121.05],
    ],
  },
]);
await harness.mountView('TrackActivityPrompt');
assert.match(document.body.textContent, /Last GPS Track/);
assert.ok(!document.querySelector('.leaflet-container'), 'Past GPS activity should collapse to compact banner without map until expanded');
const expandBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Map preview'));
assert.ok(expandBtn, 'Compact past-history banner should provide Map preview toggle');
expandBtn.click();
harness.flush();
assert.ok(document.querySelector('.leaflet-container'), 'Clicking Map preview should expand map');

// 5. Modal accessibility (role="dialog", aria-modal, aria-labelledby, focus & restore)
await harness.mountView('ModalHarness');
const opener = document.querySelector('#modal-opener');
opener.focus();
opener.click();
harness.flush();
await new Promise((r) => setTimeout(r, 20));
const dialog = document.querySelector('[role="dialog"]');
assert.ok(dialog, 'Modal must have role="dialog"');
assert.equal(dialog.getAttribute('aria-modal'), 'true');
assert.ok(dialog.getAttribute('aria-labelledby'), 'Modal must link title via aria-labelledby');
document.querySelector('#modal-close-inside').click();
harness.flush();
await new Promise((r) => setTimeout(r, 20));
assert.equal(document.activeElement?.id, 'modal-opener', 'Closing modal must restore focus to opener');

// 6. Toaster Undo action
await harness.mountView('Toaster');
let undone = false;
harness.notify('+250 ml water logged', {
  tone: 'success',
  onUndo: () => {
    undone = true;
  },
});
harness.flush();
const undoBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Undo'));
assert.ok(undoBtn, 'Toaster should render Undo button when onUndo callback is provided');
undoBtn.click();
await new Promise((r) => setTimeout(r, 10));
assert.equal(undone, true, 'Clicking Toaster Undo should invoke onUndo callback');

console.log('All 7 UI/UX polish checks passed ✔');
