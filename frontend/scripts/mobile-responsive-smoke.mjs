/**
 * Mobile responsiveness & layout verification across all recent additions
 * (AppShell mobile nav + live badge + menu links, MascotGuide, Dashboard,
 * TrackActivityPrompt, PlanActivity, Track, Activities, Goals, maps & CSS).
 *
 *   node scripts/mobile-responsive-smoke.mjs
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelJson = readFileSync(resolve(root, 'public/models/duration_model.json'), 'utf8');

// 1. Verify production CSS exists & includes mobile safeguards (build runs before smoke in CI/checks; rebuilds only if absent).
const distAssetsDir = resolve(root, 'dist/assets');
let cssFiles = [];
try {
  cssFiles = readdirSync(distAssetsDir).filter((f) => f.endsWith('.css'));
} catch {
  cssFiles = [];
}
if (cssFiles.length > 0) {
  const cssBundle = cssFiles.map((f) => readFileSync(resolve(distAssetsDir, f), 'utf8')).join('\n');
  assert.match(cssBundle, /overflow-x:\s*clip/, 'Global stylesheet must clip horizontal overflow without breaking sticky');
  assert.match(cssBundle, /safe-area-inset-bottom/, 'Stylesheet must include mobile safe-area inset utilities');
  assert.match(cssBundle, /touch-action:\s*manipulation/, 'Buttons must use touch-manipulation on mobile');
}

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
      { find: /^maplibre-gl\/dist\/maplibre-gl\.css$/, replacement: resolve(root, 'scripts/stubs/empty.css') },
      { find: 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', replacement: resolve(root, 'scripts/stubs/empty-url.js') },
      { find: /^maplibre-gl$/, replacement: resolve(root, 'scripts/stubs/maplibre-gl-interactive.js') },
      { find: /^chart\.js\/auto$/, replacement: resolve(root, 'scripts/stubs/chart.js') },
    ],
  },
  build: {
    write: false,
    minify: false,
    lib: {
      entry: resolve(root, 'scripts/stubs/mascot-tour-entry.js'),
      name: 'MobileResponsiveTest',
      formats: ['iife'],
    },
  },
});

const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const chunk = outputs.find((entry) => entry.type === 'chunk');
assert.ok(chunk?.code, 'Expected compiled MobileResponsiveTest bundle');

const window = new Window({ url: 'https://trana-web.vercel.app/' });
const { document } = window;
window.innerWidth = 360;
window.innerHeight = 640;
window.structuredClone = globalThis.structuredClone;
if (!window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
document.body.innerHTML = '<div id="app"></div>';

const geoWatchers = new Map();
let nextWatch = 1;
const geoStub = {
  getCurrentPosition(ok) {
    setTimeout(() => ok?.({ coords: { latitude: 14.676, longitude: 121.0437, accuracy: 8 }, timestamp: Date.now() }), 0);
  },
  watchPosition(ok) {
    const id = nextWatch++;
    geoWatchers.set(id, ok);
    return id;
  },
  clearWatch(id) {
    geoWatchers.delete(id);
  },
};
Object.defineProperty(window.navigator, 'geolocation', { value: geoStub, configurable: true });
if (typeof globalThis.navigator !== 'undefined') {
  Object.defineProperty(globalThis.navigator, 'geolocation', { value: geoStub, configurable: true });
} else {
  globalThis.navigator = { geolocation: geoStub };
}

window.localStorage.setItem('trana.token', 'mobile-test-token');
window.localStorage.setItem('trana:tour_seen:201', 'completed');

const jsonResp = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

const samplePlan = {
  id: 9,
  activity_type: 'run',
  distance_km: 5.4,
  elevation_gain_m: 35,
  route: [
    [14.676, 121.035],
    [14.674, 121.042],
    [14.671, 121.051],
  ],
  planned_for: '2026-11-10T10:30:00Z',
  status: 'planned',
  duration: { minutes: 31, low: 27, high: 36 },
  fueling: {
    intensity: 'moderate',
    met: 8.5,
    calories: { total: 330 },
    carbs: { perHourG: 30, totalG: 16 },
    sodium: { perHourMg: 520 },
    fluid: { perHourMl: 600 },
  },
  created_at: '2026-11-10T08:00:00Z',
};

window.fetch = async (url) => {
  const path = String(url).split('?')[0];
  if (path === '/models/duration_model.json') {
    return { ok: true, status: 200, text: async () => modelJson, json: async () => JSON.parse(modelJson) };
  }
  if (path === '/models/model_card.json') {
    return jsonResp({ version: 'test', training_source: 'synthetic', corpus_rows: 10, metrics: { mape_pct: 8 } });
  }
  if (path === '/api/health') return jsonResp({ status: 'ok' });
  if (path === '/api/auth/me') {
    return jsonResp({
      user: { id: 201, name: 'Mobile Tester', email: 'mobile@example.test', role: 'athlete', email_verified_at: '2026-11-10T00:00:00Z' },
    });
  }
  if (path === '/api/profile') {
    return jsonResp({
      data: {
        id: 201,
        name: 'Mobile Tester',
        email: 'mobile@example.test',
        weight_kg: 60,
        sweat_profile: 'normal',
        typical_temperature_c: 26,
        experience_level: 3,
        units: 'metric',
        city: 'Quezon City, PH',
        onboarded: true,
        total_activities: 2,
      },
    });
  }
  if (path === '/api/activities') {
    return jsonResp({
      data: [
        { id: 1, activity_type: 'run', distance_km: 5, duration_min: 30, calories: 320, elevation_gain_m: 30, started_at: '2026-11-10T06:00:00Z' },
      ],
      meta: { current_page: 1, last_page: 1 },
    });
  }
  if (path === '/api/predictions') {
    return jsonResp({ data: [samplePlan], meta: { current_page: 1, last_page: 1 } });
  }
  if (path === '/api/goals') {
    return jsonResp({ data: { daily_calories: 2400, daily_distance_km: 10, daily_active_min: 60, weekly_calories: 12000, weekly_distance_km: 40 } });
  }
  if (path === '/api/goals/history') return jsonResp({ data: [] });
  if (path === '/api/notifications') return jsonResp({ data: [], meta: { unread: 0 } });
  if (path === '/api/daily-sessions/today') {
    return jsonResp({ data: { calories_burned: 0, calories_eaten: 0, water_ml: 0, foods: [] } });
  }
  if (path === '/api/energy/calibration') return jsonResp({}, 404);
  if (path.includes('/api/client-errors')) return jsonResp({}, 201);
  return jsonResp({ elements: [] });
};

window.eval(chunk.code);
const harness = window.__mascotTourTest;

const waitFor = async (condition, label) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    harness.flush();
    const res = condition();
    if (res) return res;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

try {
  await harness.mountApp();
  await waitFor(() => document.querySelector('[data-tour="dashboard-overview"]'), 'Dashboard mount');

  // A. Mobile AppShell header, notifications width constraint, mobile bottom nav & account menu routes
  const tagline = [...document.querySelectorAll('header span')].find((el) => el.textContent?.trim() === 'fuel your next move');
  assert.ok(tagline?.className.includes('min-[420px]:block'), 'Tagline should collapse on <420px phones to preserve top bar room');

  document.querySelector('button[aria-label="Notifications"]').click();
  harness.flush();
  const notifPanel = document.querySelector('button[aria-label="Close notifications"]')?.previousElementSibling;
  assert.ok(notifPanel?.className.includes('calc(100vw-1.5rem)'), 'Notification dropdown must constrain width on narrow mobile viewports');
  document.querySelector('button[aria-label="Close notifications"]').click();
  harness.flush();

  document.querySelector('button[aria-label="Account menu"]').click();
  harness.flush();
  const menuText = document.querySelector('button[aria-label="Close menu"]')?.previousElementSibling?.textContent ?? '';
  assert.match(menuText, /Plan Activity/);
  assert.match(menuText, /Settings/);
  document.querySelector('button[aria-label="Close menu"]').click();
  harness.flush();

  const mobileNav = document.querySelector('nav.fixed');
  assert.ok(mobileNav?.className.includes('env(safe-area-inset-bottom)'), 'Mobile bottom nav should respect safe-area inset');

  // B. Dashboard mobile StatCard & TrackActivityPrompt card padding/class
  const statValue = document.querySelector('.stat-value');
  assert.ok(statValue?.className.includes('!text-lg'), 'StatCard values should use compact mobile typography');

  // C. PlanActivity mobile controls, "When" input, map prompt clearance, & Saved plans row wrap
  harness.navigate('/plan');
  await waitFor(() => document.querySelector('input[aria-label="When"]'), 'PlanActivity mount');
  const whenInput = document.querySelector('input[aria-label="When"]');
  assert.ok(whenInput.value.length >= 16, 'When input remains prefilled on mobile');
  assert.ok(whenInput.parentElement.className.includes('min-w-0'), 'When grid item must allow shrinking on narrow screens');

  const tranaPrompt = [...document.querySelectorAll('div')].find((el) =>
    el.textContent?.includes('Tap Start, then tap End on the map') && el.className.includes('pointer-events-none'),
  );
  assert.ok(tranaPrompt?.className.includes('right-16'), 'Map prompt banner must leave clearance for right-hand MapControls on mobile');

  const deletePlanBtn = document.querySelector('button[aria-label^="Delete saved plan "]');
  assert.ok(deletePlanBtn, 'Saved plan delete trigger should exist');
  deletePlanBtn.click();
  harness.flush();
  const confirmBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete');
  assert.ok(confirmBtn, 'Inline Delete confirmation button should render');
  const savedPlanRow = confirmBtn.closest('div')?.parentElement;
  assert.ok(savedPlanRow?.className.includes('flex-wrap'), 'Saved plan row should wrap delete confirmation cleanly on narrow mobile');

  // D. Track Activity mobile controls, path switcher, live status dot in mobile bottom nav, and Dashboard live sync
  harness.navigate('/track');
  await waitFor(() => document.querySelector('[data-tour="track-controls-header"]'), 'Track mount');
  const pathGroup = document.querySelector('[aria-label="Route path source"]');
  assert.ok(pathGroup?.className.includes('w-full'), 'Path switcher bar should expand cleanly across mobile width');

  const startBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Start activity'));
  assert.ok(startBtn?.className.includes('w-full'), 'Start activity button should be full-width thumb-friendly on mobile');
  startBtn.click();
  harness.flush();

  await waitFor(
    () => document.querySelector('nav.fixed [aria-label="Tracking live"]'),
    'Mobile bottom nav should display live pulse dot on Track tab while tracking',
  );

  const controlsContainer = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('End & save'))?.parentElement;
  assert.ok(controlsContainer?.className.includes('grid-cols-2'), 'Active tracking buttons should form 2-col grid on mobile');

  harness.navigate('/');
  await waitFor(() => document.body.textContent.includes('In progress'), 'Dashboard live sync card');
  const promptDiscard = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Discard'));
  assert.ok(promptDiscard?.parentElement?.className.includes('grid-cols-2'), 'Dashboard live prompt actions should arrange cleanly on mobile');
  promptDiscard.click();
  harness.flush();

  // E. Activities & Goals scroll margin + mobile strip
  harness.navigate('/activities');
  await waitFor(() => document.querySelector('[data-tour="activities-header"]'), 'Activities mount');
  assert.ok(document.querySelector('[data-tour="activities-header"]').className.includes('scroll-mt-20'));

  harness.navigate('/goals');
  await waitFor(() => document.querySelector('[data-tour="goals-header"]'), 'Goals mount');
  assert.ok(document.querySelector('[data-tour="goals-header"]').className.includes('scroll-mt-20'));

  console.log('Mobile responsiveness checks passed ✔');
} finally {
  await harness.destroy();
  await window.happyDOM.abort();
}
