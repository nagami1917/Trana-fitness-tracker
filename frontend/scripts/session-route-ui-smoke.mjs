/**
 * Session detail route-map UI test.
 *
 * Proves the "accomplished routes" section on /track/session:
 *   - draws a finished activity's GPS track on the map,
 *   - lists every activity of the day with distance/time/calories,
 *   - switches the map when another trackable activity is picked,
 *   - falls back to a clear "no GPS track" state,
 *   - falls back to "no activity on this day" when only food was logged,
 *   - accepts a legacy `route` array as well as `route_geojson`.
 *
 *   node scripts/session-route-ui-smoke.mjs
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
      entry: resolve(root, 'scripts/stubs/session-route-entry.js'),
      name: 'SessionRouteTest',
      formats: ['iife'],
    },
  },
});

const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const chunk = outputs.find((entry) => entry.type === 'chunk');
assert.ok(chunk?.code, 'Expected compiled session-detail test chunk');

const window = new Window({ url: 'https://trana-web.vercel.app/track/session?id=7' });
const { document } = window;
window.structuredClone = globalThis.structuredClone;
document.body.innerHTML = '<div id="app"></div>';
document.title = 'TRANA';
window.localStorage.setItem('trana.token', 'test-token');

// Load the compiled component bundle into the happy-dom window.
window.eval(chunk.code);

const test = window.__sessionDetailTest;
assert.ok(test, 'Expected the test harness to register itself');
const maplibre = await import(resolve(root, 'scripts/stubs/maplibre-gl-interactive.js'));

/** Maps created by the bundled stub, mirrored onto a global (see the stub). */
const maps = () => (Array.isArray(window.__tranaCreatedMaps) ? window.__tranaCreatedMaps : []);
const resetMaps = () => { window.__tranaCreatedMaps = []; };

/**
 * Put a stub map into the "style is loaded" state the components wait for.
 * TranaMap only self-marks ready when it is following, so tests that pass
 * following={false} must do this themselves.
 */
const readyMap = (map) => {
  map.style._loaded = true;
  map.emit('style.load');
  map.emit('load');
  test.flush();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const text = () => document.body.textContent.replace(/\s+/g, ' ');
const clickNode = (node) => {
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  test.flush();
};

// GeoJSON LineString coordinates are [lng, lat].
const geoRoute = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'LineString',
    coordinates: [
      [121.035, 14.676],
      [121.042, 14.674],
      [121.051, 14.671],
    ],
  },
};

const sessionPayload = {
  data: {
    id: 7,
    session_date: '2026-11-13',
    calories_burned: 310,
    calories_eaten: 105,
    water_ml: 500,
    net_calories: -205,
    foods: [],
    foods_count: 0,
    activities: [
      {
        id: 41,
        activity_type: 'run',
        distance_km: 1.56,
        duration_min: 3.7,
        calories: 92,
        started_at: '2026-11-13T09:25:24+08:00',
        source: 'gps',
        has_route: true,
        route_geojson: geoRoute,
        route: null,
      },
      {
        id: 42,
        activity_type: 'ride',
        distance_km: 12.4,
        duration_min: 41,
        calories: 218,
        started_at: '2026-11-13T16:10:00+08:00',
        source: 'gps',
        has_route: true,
        route_geojson: null,
        // No GeoJSON on this one: proves the legacy `route` fallback works.
        route: [
          [14.68, 121.04],
          [14.69, 121.05],
          [14.7, 121.06],
        ],
      },
      {
        id: 43,
        activity_type: 'walk',
        distance_km: 0.8,
        duration_min: 9,
        calories: 41,
        started_at: '2026-11-13T19:02:00+08:00',
        source: 'manual',
        has_route: false,
        route_geojson: null,
        route: null,
      },
    ],
  },
};

const allChecks = [];
function check(name, fn) {
  try {
    fn();
    allChecks.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    allChecks.push({ name, ok: false, error });
    console.log(`FAIL  ${name}\n   ${String(error.message).split('\n')[0]}`);
  }
}

// ── 1. A day with finished routes ───────────────────────────────────────────
resetMaps();
test.mount(sessionPayload);
await sleep(30);

check('renders the accomplished-routes section', () => {
  const body = text();
  assert.ok(body.includes('Accomplished'), `body was: ${body.slice(0, 240)}`);
  assert.ok(/Routes you finished \(3\)|Route you finished/.test(body), 'missing the routes heading');
});

check('lists every activity of the day', () => {
  const body = text();
  assert.ok(body.includes('Run'), 'missing Run');
  assert.ok(body.includes('Ride'), 'missing Ride');
  assert.ok(body.includes('Walk'), 'missing Walk');
});

check('shows distance + duration + calories per activity', () => {
  const body = text();
  assert.ok(/1\.56 km/.test(body), 'missing run distance');
  assert.ok(/12\.40 km/.test(body), 'missing ride distance');
  assert.ok(/41 min/.test(body), 'missing ride duration');
  assert.ok(/92 kcal/.test(body), 'missing run calories');
});

check('creates exactly one map for the day', () => {
  assert.equal(maps().length, 1, `got ${maps().length}`);
});

check('maps the GeoJSON track as [lng,lat] → line coordinates', () => {
  const map = maps()[0];
  readyMap(map);
  const source = map.getSource('trana-activity-route');
  assert.ok(source, 'activity-route source was not added');
  const features = source.data?.features ?? [];
  assert.equal(features.length, 2, `expected 2 line segments, got ${features.length}`);
  const first = features[0].geometry.coordinates;
  // GeoJSON [lng, lat] must stay that way for MapLibre.
  assert.deepEqual(first[0], [121.035, 14.676]);
  assert.deepEqual(first[1], [121.042, 14.674]);
});

check('draws start and finish markers for the active route', () => {
  const map = maps()[0];
  readyMap(map);
  // ActivityMarker adds one marker per position it is given; start + finish.
  assert.ok(map.markers.length >= 2, `expected ≥2 markers, got ${map.markers.length}`);
});

check('marks the activity without a track as "No track"', () => {
  assert.ok(text().includes('No track'), 'missing No track badge');
});

// ── 2. Switching to another activity's route ────────────────────────────────
check('switching activity swaps the drawn track', () => {
  const map = maps()[0];
  // Activity rows are the buttons that carry a distance figure; map controls and
  // links are not part of the list.
  const rows = [...document.querySelectorAll('button')]
    .filter((b) => !b.disabled && /\d+(\.\d+)?\s*(km|m)\b/.test(b.textContent));
  assert.equal(rows.length, 2, `expected 2 switchable activity rows, got ${rows.length}`);
  clickNode(rows[1]);
  test.flush();
  test.flush();

  // Re-read the source: setData() swaps the stub's source object.
  const source = map.getSource('trana-activity-route');
  assert.ok(source, 'source disappeared after switching');
  const features = source.data?.features ?? [];
  assert.equal(features.length, 2, `expected 2 segments for the ride, got ${features.length}`);
  // The legacy route array is [lat, lng]; must be flipped for MapLibre.
  assert.deepEqual(features[0].geometry.coordinates[0], [121.04, 14.68]);
  assert.ok(text().includes('Viewing'), 'active row not marked as Viewing');
});

await test.destroy();

// ── 3. A day with activities but no GPS tracks ──────────────────────────────
resetMaps();
test.mount({
  data: {
    ...sessionPayload.data,
    activities: [
      {
        id: 44,
        activity_type: 'walk',
        distance_km: 0.8,
        duration_min: 9,
        calories: 41,
        started_at: '2026-11-13T19:02:00+08:00',
        source: 'manual',
        has_route: false,
        route_geojson: null,
        route: null,
      },
    ],
  },
});
await sleep(30);

check('shows the manual-only fallback instead of an empty map', () => {
  const body = text();
  assert.ok(body.includes('No GPS track recorded'), `body was: ${body.slice(0, 240)}`);
  assert.equal(maps().length, 0, 'a map was created with no track');
  assert.ok(body.includes('Walk'), 'the manual activity is still listed');
});

await test.destroy();

// ── 4. A day with only food logged ──────────────────────────────────────────
test.mount({
  data: { ...sessionPayload.data, activities: [], foods: [], foods_count: 1 },
});
await sleep(30);

check('shows "no activity on this day" when only food was logged', () => {
  assert.ok(text().includes('No activity on this day'), `body was: ${text().slice(0, 240)}`);
  assert.equal(maps().length, 0);
});

await test.destroy();

const failed = allChecks.filter((c) => !c.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} of ${allChecks.length} checks failed`);
  process.exit(1);
}
console.log(`\nSession route map checks passed (${allChecks.length})`);
