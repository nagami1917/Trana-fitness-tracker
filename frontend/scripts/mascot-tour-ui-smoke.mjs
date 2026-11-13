/**
 * End-to-end UI check for the TRANA Cat Mascot onboarding/welcome tour.
 *
 *   node scripts/mascot-tour-ui-smoke.mjs
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
      name: 'MascotTourTest',
      formats: ['iife'],
    },
  },
});

const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const chunk = outputs.find((entry) => entry.type === 'chunk');
assert.ok(chunk?.code, 'Expected compiled MascotTour test chunk');

const window = new Window({ url: 'https://trana-web.vercel.app/' });
const { document } = window;
window.structuredClone = globalThis.structuredClone;
if (!window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
document.body.innerHTML = '<div id="app"></div>';

// Minimal geolocation stub (never fails or throws in HappyDOM)
const geoStub = {
  getCurrentPosition(_ok, err) {
    setTimeout(() => err?.({ code: 2, message: 'unavailable' }), 0);
  },
  watchPosition() {
    return 1;
  },
  clearWatch() {},
};
Object.defineProperty(window.navigator, 'geolocation', { value: geoStub, configurable: true });
if (typeof globalThis.navigator !== 'undefined') {
  Object.defineProperty(globalThis.navigator, 'geolocation', { value: geoStub, configurable: true });
} else {
  globalThis.navigator = { geolocation: geoStub };
}

let activeAccount = {
  user: {
    id: 101,
    name: 'Mina Cruz',
    email: 'mina@example.test',
    role: 'athlete',
    email_verified_at: '2026-11-10T00:00:00Z',
  },
  profile: {
    id: 101,
    name: 'Mina Cruz',
    email: 'mina@example.test',
    weight_kg: 58,
    sweat_profile: 'normal',
    typical_temperature_c: 26,
    experience_level: 2,
    units: 'metric',
    city: 'Quezon City, PH',
    onboarded: true,
    total_activities: 0,
    daily_calorie_goal: 2400,
    daily_distance_goal_km: 10,
    daily_active_min_goal: 60,
  },
  activities: [],
  plans: [],
};

window.localStorage.setItem('trana.token', 'tour-test-token');
const jsonResp = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

window.fetch = async (url, init = {}) => {
  const path = String(url).split('?')[0];
  const method = (init.method || 'GET').toUpperCase();

  if (path === '/models/duration_model.json') {
    return { ok: true, status: 200, text: async () => modelJson, json: async () => JSON.parse(modelJson) };
  }
  if (path === '/models/model_card.json') {
    return jsonResp({ version: 'test', training_source: 'synthetic', corpus_rows: 10, metrics: { mape_pct: 8 } });
  }
  if (path === '/api/health') return jsonResp({ status: 'ok' });
  if (path === '/api/auth/me') return jsonResp({ user: activeAccount.user });
  if (path === '/api/profile' && method === 'GET') return jsonResp({ data: activeAccount.profile });
  if (path === '/api/profile' && method === 'PUT') {
    const patch = JSON.parse(init.body || '{}');
    activeAccount.profile = {
      ...activeAccount.profile,
      ...patch,
      onboarded: patch.onboarded ?? activeAccount.profile.onboarded,
    };
    return jsonResp({ data: activeAccount.profile });
  }
  if (path === '/api/activities') {
    return jsonResp({ data: activeAccount.activities, meta: { current_page: 1, last_page: 1 } });
  }
  if (path === '/api/predictions') {
    return jsonResp({ data: activeAccount.plans, meta: { current_page: 1, last_page: 1 } });
  }
  if (path === '/api/goals') {
    return jsonResp({
      data: {
        daily_calories: 2400,
        daily_distance_km: 10,
        daily_active_min: 60,
        weekly_calories: 12000,
        weekly_distance_km: 40,
      },
    });
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

const waitFor = async (condition, label = 'condition') => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    harness.flush();
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const findButton = (label) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(label));

try {
  // 1. Fresh user (0 activities, 0 plans, never seen tour) lands in AppShell -> tour auto-opens!
  await harness.mountApp();
  await waitFor(() => document.querySelector('[role="dialog"]'), 'welcome tour auto-start');

  let dialog = document.querySelector('[role="dialog"]');
  assert.match(dialog.textContent, /Hi Mina! I’m your TRANA cat guide/);
  assert.ok(dialog.querySelector('img[src="/mascot-cat.png"]'), 'Cat mascot image should render in guide');

  // 2. Step through all 7 tour stops and verify page navigation + target selectors
  findButton('Show me around').click();
  await waitFor(() => document.querySelector('#mascot-tour-title')?.textContent.includes('Your daily command center'), 'Dashboard step');
  assert.equal(harness.getRoute(), '/');
  assert.ok(document.querySelector('[data-tour="dashboard-overview"]'), 'Dashboard overview target should exist');

  findButton('Next').click();
  await waitFor(() => harness.getRoute() === '/plan' && document.querySelector('#mascot-tour-title')?.textContent.includes('Build routes & predict fueling'), 'Plan Activity step');
  assert.ok(document.querySelector('[data-tour="plan-activity-card"]'), 'Plan Activity card target should exist');

  findButton('Next').click();
  await waitFor(() => harness.getRoute() === '/track' && document.querySelector('#mascot-tour-title')?.textContent.includes('Record live GPS workouts'), 'Track Activity step');
  assert.ok(document.querySelector('[data-tour="track-controls-header"]'), 'Track Activity header target should exist');

  findButton('Next').click();
  await waitFor(() => harness.getRoute() === '/activities' && document.querySelector('#mascot-tour-title')?.textContent.includes('Logbook & progress trends'), 'Activities step');
  assert.ok(document.querySelector('[data-tour="activities-header"]'), 'Activities header target should exist');

  findButton('Next').click();
  await waitFor(() => harness.getRoute() === '/goals' && document.querySelector('#mascot-tour-title')?.textContent.includes('Targets & nutrition calculator'), 'Goals step');
  assert.ok(document.querySelector('[data-tour="goals-header"]'), 'Goals header target should exist');

  findButton('Next').click();
  await waitFor(() => harness.getRoute() === '/' && document.querySelector('#mascot-tour-title')?.textContent.includes('You’re ready for your first move'), 'Completion step');
  assert.ok(document.querySelector('[data-tour="tour-replay"]'), 'Top bar Guide replay button target should exist');

  // Verify Back button returns to previous step and Next returns to completion
  findButton('Back').click();
  await waitFor(() => harness.getRoute() === '/goals', 'Back to Goals step');
  findButton('Next').click();
  await waitFor(() => harness.getRoute() === '/' && document.querySelector('#mascot-tour-title')?.textContent.includes('You’re ready for your first move'), 'Forward back to completion step');

  // Complete tour -> persists seen state & closes dialog
  findButton('Start exploring').click();
  await waitFor(() => !document.querySelector('[role="dialog"]'), 'tour closes on completion');
  assert.equal(window.localStorage.getItem('trana:tour_seen:101'), 'completed');

  // 3. Re-bootstrapping same user does NOT re-open the tour automatically
  await harness.rebootstrap();
  await new Promise((resolve) => setTimeout(resolve, 40));
  harness.flush();
  assert.equal(document.querySelector('[role="dialog"]'), null, 'Completed tour must not auto-open again');

  // 4. Replay via top-bar Guide button & verify keyboard navigation (ArrowRight, ArrowLeft, Escape)
  const guideBtn = document.querySelector('[data-tour="tour-replay"]');
  assert.ok(guideBtn, 'Guide button should be visible in AppShell header');
  guideBtn.click();
  await waitFor(() => document.querySelector('[role="dialog"]'), 'Guide button reopens tour');

  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
  await waitFor(() => document.querySelector('#mascot-tour-title')?.textContent.includes('Your daily command center'), 'ArrowRight advances step');

  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
  await waitFor(() => document.querySelector('#mascot-tour-title')?.textContent.includes('Hi Mina!'), 'ArrowLeft moves back');

  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  await waitFor(() => !document.querySelector('[role="dialog"]'), 'Escape closes guide');

  // 5. Existing user with past activities does NOT auto-open tour
  activeAccount = {
    user: {
      id: 102,
      name: 'Veteran Runner',
      email: 'vet@example.test',
      role: 'athlete',
      email_verified_at: '2026-10-01T00:00:00Z',
    },
    profile: {
      ...activeAccount.profile,
      id: 102,
      name: 'Veteran Runner',
      email: 'vet@example.test',
      onboarded: true,
      total_activities: 3,
    },
    activities: [
      { id: 1, activity_type: 'run', distance_km: 5, duration_min: 30, calories: 300, elevation_gain_m: 20, started_at: new Date().toISOString() },
    ],
    plans: [],
  };
  await harness.rebootstrap();
  await new Promise((resolve) => setTimeout(resolve, 40));
  harness.flush();
  assert.equal(document.querySelector('[role="dialog"]'), null, 'Experienced user should not auto-see welcome tour');

  // Account menu "Tour with mascot" opens tour for any user
  document.querySelector('[aria-label="Account menu"]').click();
  await waitFor(() => findButton('Tour with mascot'), 'Account menu tour button');
  findButton('Tour with mascot').click();
  await waitFor(() => document.querySelector('[role="dialog"]'), 'Account menu opens mascot tour');
  findButton('Skip tour').click();
  await waitFor(() => !document.querySelector('[role="dialog"]'), 'Skip tour closes dialog');
  assert.equal(window.localStorage.getItem('trana:tour_seen:102'), 'skipped');

  // 6. New user completing Onboarding -> lands on /plan -> queued tour auto-opens!
  activeAccount = {
    user: {
      id: 103,
      name: 'Sam Reyes',
      email: 'sam@gmail.com',
      role: 'athlete',
      email_verified_at: '2026-11-10T00:00:00Z',
    },
    profile: {
      ...activeAccount.profile,
      id: 103,
      name: 'Sam Reyes',
      email: 'sam@gmail.com',
      onboarded: false,
      total_activities: 0,
    },
    activities: [],
    plans: [],
  };
  await harness.rebootstrap();
  await waitFor(() => harness.getRoute() === '/onboarding', 'Redirect un-onboarded user to /onboarding');

  // Step through Onboarding wizard to "Start planning"
  findButton('Continue').click();
  await waitFor(() => document.body.textContent.includes('How do you train?'), 'Onboarding step 2');
  findButton('Continue').click();
  await waitFor(() => document.body.textContent.includes('How much do you sweat?'), 'Onboarding step 3');
  findButton('Start planning').click();

  await waitFor(() => harness.getRoute() === '/plan' && document.querySelector('[role="dialog"]'), 'Post-onboarding tour auto-opens on /plan');
  assert.match(document.querySelector('#mascot-tour-title').textContent, /Hi Sam!/);

  // Jump to last step via dot and click "Plan first workout"
  document.querySelector('[aria-label^="Go to step 7:"]').click();
  await waitFor(() => document.querySelector('#mascot-tour-title')?.textContent.includes('You’re ready for your first move'), 'Jumped to final step via step dot');
  findButton('Plan first workout').click();
  await waitFor(() => !document.querySelector('[role="dialog"]') && harness.getRoute() === '/plan', 'Plan first workout closes tour & opens /plan');
  assert.equal(window.localStorage.getItem('trana:tour_seen:103'), 'completed');

  // 7. Mobile viewport (360x640) ergonomics: centered modal scrollable wrapper,
  //    scrollIntoView block:'start', safe-area bottom docking, and dockTop flip!
  window.innerWidth = 360;
  window.innerHeight = 640;
  window.dispatchEvent(new window.Event('resize'));
  document.querySelector('[data-tour="tour-replay"]').click();
  await waitFor(() => document.querySelector('[role="dialog"]'), 'Mobile replay opens welcome modal');

  const mobileWelcomeDialog = document.querySelector('[role="dialog"]');
  assert.ok(mobileWelcomeDialog.parentElement.className.includes('overflow-y-auto'), 'Centered modal container must scroll on short mobile viewports');
  assert.ok(findButton('Show me around').className.includes('w-full'), 'Centered modal CTA should span full width on narrow mobile');

  let recordedScrollOpt = null;
  const origElGetRect = window.Element.prototype.getBoundingClientRect;
  const origScrollIntoView = window.Element.prototype.scrollIntoView;
  try {
    window.Element.prototype.scrollIntoView = function (opts) {
      if (this.getAttribute?.('data-tour')) recordedScrollOpt = opts;
      return origScrollIntoView?.call(this, opts);
    };
    window.Element.prototype.getBoundingClientRect = function () {
      if (this.getAttribute?.('data-tour') === 'dashboard-overview') {
        return { top: 220, left: 12, right: 348, bottom: 480, width: 336, height: 260 };
      }
      return origElGetRect?.call(this) ?? { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    };

    findButton('Show me around').click();
    await waitFor(
      () => document.querySelector('#mascot-tour-title')?.textContent.includes('Your daily command center'),
      'Mobile Dashboard tour step',
    );
    await waitFor(() => recordedScrollOpt !== null, 'Mobile scrollIntoView invoked');
    assert.equal(recordedScrollOpt.block, 'start', 'Mobile tour target scroll should align to start under sticky header');

    const floatingWrapper = document.querySelector('[role="dialog"]')?.parentElement;
    assert.ok(floatingWrapper.className.includes('top-[4.25rem]'), 'Mobile tour card should flip to top dock when target extends behind bottom area');
    assert.ok(document.querySelector('[role="dialog"]').className.includes('max-h-[calc(100dvh-9.5rem)]'), 'Floating tour card should constrain max height on small screens');
  } finally {
    window.Element.prototype.getBoundingClientRect = origElGetRect;
    window.Element.prototype.scrollIntoView = origScrollIntoView;
  }

  console.log('TRANA cat mascot welcome tour UI checks passed ✔');
} finally {
  await harness.destroy();
  await window.happyDOM.abort();
}
