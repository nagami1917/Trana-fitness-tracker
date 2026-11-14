/**
 * End-to-end UI check for live Track Activity -> Dashboard status & result updates.
 *
 *   node scripts/dashboard-track-ui-smoke.mjs
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
      entry: resolve(root, 'scripts/stubs/dashboard-track-entry.js'),
      name: 'DashboardTrackTest',
      formats: ['iife'],
    },
  },
});

const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const chunk = outputs.find((entry) => entry.type === 'chunk');
assert.ok(chunk?.code, 'Expected compiled DashboardTrack test chunk');

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

let timeOffsetMs = 0;
const realDateNow = Date.now.bind(Date);
const realWindowDateNow = window.Date.now.bind(window.Date);
const fakeNow = () => realDateNow() + timeOffsetMs;
Date.now = fakeNow;
window.Date.now = fakeNow;

// Geolocation mock shared across Track & Dashboard
const geoWatchers = new Map();
let nextWatchId = 1;
let latestFix = {
  coords: { latitude: 14.676, longitude: 121.0437, altitude: 32, speed: 3.1, accuracy: 6, heading: 45 },
  timestamp: Date.now(),
};

const geoMock = {
  getCurrentPosition(success) {
    setTimeout(() => success({ ...latestFix, timestamp: Date.now() }), 0);
  },
  watchPosition(success, error) {
    const id = nextWatchId++;
    geoWatchers.set(id, { success, error });
    return id;
  },
  clearWatch(id) {
    geoWatchers.delete(id);
  },
};

Object.defineProperty(window.navigator, 'geolocation', {
  value: geoMock,
  configurable: true,
});
if (typeof globalThis.navigator !== 'undefined') {
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: geoMock,
    configurable: true,
  });
} else {
  globalThis.navigator = { geolocation: geoMock };
}

function emitGpsFix(latitude, longitude, { altitude = 35, speed = 3.2, accuracy = 6, heading = 45 } = {}) {
  latestFix = {
    coords: { latitude, longitude, altitude, speed, accuracy, heading },
    timestamp: Date.now(),
  };
  for (const watcher of geoWatchers.values()) {
    watcher.success(latestFix);
  }
}

let savedActivities = [];
let dailySession = { id: 12, session_date: '2026-11-13', calories_burned: 0, calories_eaten: 0, water_ml: 0, net_calories: 0, foods: [] };
const postedActivities = [];
const savedDailyPayloads = [];
const csrfToken = 'e'.repeat(64);

window.localStorage.setItem('trana.token', 'test-token');
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
        id: 7,
        name: 'Test Athlete',
        email: 'athlete@example.test',
        weight_kg: 62,
        sweat_profile: 'normal',
        typical_temperature_c: 26,
        city: 'Quezon City, PH',
      },
    });
  }
  if (path.startsWith('/api/activities') && method === 'POST') {
    assert.equal(init.headers['X-CSRF-TOKEN'], csrfToken);
    assert.equal(init.credentials, 'include');
    const body = JSON.parse(init.body);
    postedActivities.push(body);
    const created = { id: 100 + postedActivities.length, ...body };
    savedActivities = [created, ...savedActivities];
    return jsonResp({ data: created }, 201);
  }
  if (path.startsWith('/api/activities')) {
    return jsonResp({ data: savedActivities, meta: { current_page: 1, last_page: 1 } });
  }
  if (path.startsWith('/api/predictions')) {
    return jsonResp({ data: [], meta: { current_page: 1, last_page: 1 } });
  }
  if (path === '/api/goals') {
    return jsonResp({ data: { daily_calories: 2400, daily_distance_km: 10, daily_active_min: 60 } });
  }
  if (path === '/api/daily-sessions/today' && method === 'POST') {
    assert.equal(init.headers['X-CSRF-TOKEN'], csrfToken);
    assert.equal(init.credentials, 'include');
    const body = JSON.parse(init.body);
    savedDailyPayloads.push(body);
    dailySession = { ...dailySession, ...body };
    return jsonResp({ data: dailySession }, 200);
  }
  if (path === '/api/daily-sessions/today') {
    return jsonResp({ data: dailySession }, 200);
  }
  if (path.includes('/api/client-errors')) return jsonResp({}, 201);
  return jsonResp({ elements: [] });
};

window.eval(chunk.code);
const harness = window.__dashboardTrackTest;

const waitFor = async (condition, label = 'dashboard-track condition') => {
  const deadline = realDateNow() + 4000;
  while (realDateNow() < deadline) {
    harness.flush();
    const result = condition();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

const buttonsWithText = (text) =>
  [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes(text));

try {
  // 1. Idle Dashboard shows ready prompt pointing to /track
  harness.seedStores([]);
  await harness.mountDashboard();
  assert.match(document.body.textContent, /Track Activity/);
  assert.match(document.body.textContent, /Ready/);
  assert.match(document.body.textContent, /No route saved yet/);
  assert.match(document.body.textContent, /Route preview only; the estimate uses the distance and elevation you entered/);

  // When there is no recorded route, clearly label the plan-route fallback.
  harness.seedStores([], [{
    id: 20,
    activity_type: 'run',
    distance_km: 2,
    duration: { minutes: 15 },
    fueling: {
      calories: { total: 120 },
      carbs: { perHourG: 0 },
      sodium: { perHourMg: 500 },
      fluid: { perHourMl: 400 },
    },
    created_at: new Date().toISOString(),
    route: [[14.676, 121.0437], [14.682, 121.049]],
  }]);
  await harness.mountDashboard();
  assert.match(document.body.textContent, /Saved plan route/);

  // Reset to a clean dashboard before testing the live tracking flow.
  harness.seedStores([]);
  await harness.mountDashboard();
  const startNavBtn = buttonsWithText('Start in Track Activity')[0];
  assert.ok(startNavBtn, 'Dashboard idle state should render Start in Track Activity button');
  startNavBtn.click();
  harness.flush();
  assert.equal(harness.getRoute(), '/track');

  // 2. Start an activity in Track Activity and capture GPS points
  await harness.mountTrack();
  const rideBtn = buttonsWithText('Ride')[0];
  assert.ok(rideBtn, 'Ride sport chip should render on Track Activity');
  rideBtn.click();
  harness.flush();

  const startBtn = buttonsWithText('Start activity')[0];
  assert.ok(startBtn, 'Start activity button should render on Track Activity');
  startBtn.click();
  harness.flush();

  await waitFor(() => harness.liveTracker.points.length >= 1 && geoWatchers.size >= 1, 'initial GPS point & watcher');
  timeOffsetMs += 180_000;
  emitGpsFix(14.682, 121.049);
  await waitFor(() => harness.liveTracker.points.length >= 2, 'second GPS point');
  assert.ok(harness.liveTracker.distanceKm > 0.7, 'Expected recorded distance > 0.7 km');

  // 3. Switch to Dashboard while tracking -> session stays alive and updates Dashboard!
  await harness.mountDashboard();
  assert.equal(harness.liveTracker.tracking, true, 'Live tracking must persist when leaving Track Activity');
  assert.match(document.body.textContent, /Track Activity · Bike ride/);
  assert.match(document.body.textContent, /In progress/);
  assert.match(document.body.textContent, /Live map · 2 GPS pts/);
  assert.ok(window.sessionStorage.getItem('trana:live_tracker:7'), 'Active tracking snapshot must persist in sessionStorage');

  // Emit a 3rd GPS coordinate while viewing Dashboard and confirm live map + km update
  timeOffsetMs += 180_000;
  emitGpsFix(14.688, 121.055);
  await waitFor(
    () => document.body.textContent.includes('Live map · 3 GPS pts'),
    'Dashboard live map update after 3rd GPS point',
  );
  const activeMaps = harness.getLeafletMaps().filter((m) => !m.removed);
  const trackPromptMap = activeMaps[0];
  const polylineLayer = trackPromptMap?.layers
    ?.flatMap((g) => g.children)
    ?.find((c) => c.kind === 'polyline' && !c.removed);
  assert.ok(polylineLayer && polylineLayer.data.length === 3, 'Leaflet Dashboard map should draw all 3 recorded GPS coordinates');

  // 4. Pause & Resume directly from Dashboard prompt
  buttonsWithText('Pause')[0].click();
  await waitFor(() => document.body.textContent.includes('Paused'), 'Paused status on Dashboard');
  assert.equal(harness.liveTracker.paused, true);

  buttonsWithText('Resume')[0].click();
  await waitFor(() => document.body.textContent.includes('In progress'), 'Resumed In progress status on Dashboard');
  assert.equal(harness.liveTracker.paused, false);

  // 5. Short-duration End & save (< 1:00) pauses and warns clearly on Dashboard
  // First verify the short-session guard in a fresh quick session before saving the full ride
  await harness.mountTrack();
  buttonsWithText('Discard')[0].click();
  await waitFor(() => !harness.liveTracker.tracking, 'discard before short-session check');
  latestFix = {
    coords: { latitude: 14.676, longitude: 121.0437, altitude: 32, speed: 3.1, accuracy: 6, heading: 45 },
    timestamp: Date.now(),
  };
  buttonsWithText('Start activity')[0].click();
  harness.flush();
  await waitFor(() => harness.liveTracker.points.length >= 1 && geoWatchers.size >= 1, 'short-session initial GPS point');
  await harness.mountDashboard();
  buttonsWithText('End & save')[0].click();
  await waitFor(
    () => document.body.textContent.includes('Record at least 0.05 km (50 m) and 1:00 to save'),
    'short-session guard message on Dashboard',
  );
  assert.equal(harness.liveTracker.paused, true);

  // 6. Resume, add real GPS movement across > 2 min, and End & save -> updates Dashboard to Completed & saved!
  buttonsWithText('Resume')[0].click();
  timeOffsetMs += 90_000;
  emitGpsFix(14.680, 121.046);
  timeOffsetMs += 90_000;
  emitGpsFix(14.686, 121.051);
  await waitFor(
    () => harness.liveTracker.points.length >= 3 && harness.liveTracker.durationMin >= 2,
    '3 GPS points & duration >= 2 min',
  );

  buttonsWithText('End & save')[0].click();
  await waitFor(() => postedActivities.length === 1, 'POST /api/activities');

  const payload = postedActivities[0];
  assert.equal(payload.source, 'gps');
  assert.equal(payload.activity_type, 'ride');
  assert.ok(payload.distance_km > 1, 'Saved GPS distance_km should exceed 1 km');
  assert.ok(payload.duration_min >= 2, 'Saved duration_min should be >= 2 min');
  assert.ok(Array.isArray(payload.route) && payload.route.length >= 3, 'Saved activity must record GPS route');
  assert.equal(payload.route_geojson?.type, 'FeatureCollection');
  assert.ok(savedDailyPayloads.length === 1 && savedDailyPayloads[0].calories_burned > 0, 'Daily session calories_burned must update');

  await waitFor(
    () => document.body.textContent.includes('Completed & saved') && document.body.textContent.includes('Recorded map'),
    'Dashboard Completed & saved card',
  );
  assert.match(document.body.textContent, /Saved to Activities and Today's Summary/);
  assert.ok(harness.getActivities().length === 1, 'Global activities store refreshed on Dashboard');
  assert.match(document.body.textContent, /Latest recorded route/, 'Quick Plan route preview should switch to the newly saved GPS route');

  // 7. Discard flow -> Dashboard records Discarded status and Dismiss restores latest saved GPS activity
  await harness.mountTrack();
  buttonsWithText('Start activity')[0].click();
  harness.flush();
  await waitFor(() => harness.liveTracker.points.length >= 1, 'second session first GPS point');

  await harness.mountDashboard();
  buttonsWithText('Discard')[0].click();
  await waitFor(() => document.body.textContent.includes('Discarded'), 'Discarded status on Dashboard');
  assert.match(document.body.textContent, /Tracking discarded — not saved to your activity history/);

  buttonsWithText('Dismiss')[0].click();
  await waitFor(() => document.body.textContent.includes('Completed & saved'), 'Fallback to latest saved GPS activity');

  // 8. Sign out cleans up storage & live state
  harness.signOutSession();
  assert.equal(window.sessionStorage.getItem('trana:live_tracker:7'), null);
  assert.equal(harness.liveTracker.tracking, false);

  console.log('Dashboard <-> Track Activity live & result update checks passed ✔');
} finally {
  Date.now = realDateNow;
  window.Date.now = realWindowDateNow;
  await harness.destroy();
}
