/**
 * Track Activity & Daily Session smoke test.
 *
 *   node scripts/track-smoke.mjs
 *
 * Covers regressions caught on /track:
 * - mapConfig street-tile fallback & array line-dasharray
 * - mapService geometry normalization for both {latitude, longitude} objects and [lat, lng] pairs
 * - gpsService numeric Unix-ms timestamp normalization + validateTrackPoint acceptance
 * - dailySessionService URL wiring, query params, envelope preservation, and timezone-safe date formatting
 */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const store = new Map([['trana.token', 'test-token']]);
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = { location: { pathname: '/track', search: '' }, addEventListener() {}, scrollTo() {} };

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
  if (String(url).includes('/daily-sessions/today')) {
    return new Response(JSON.stringify({ data: { id: 7, session_date: '2026-11-11', calories_burned: 220, calories_eaten: 0, water_ml: 500, net_calories: -220, foods: [] } }), { status: 200 });
  }
  if (String(url).includes('/daily-sessions/7/foods')) {
    return new Response(JSON.stringify({ data: { id: 19, food_name: 'Banana', calories: 105 }, session: { id: 7, calories_eaten: 105, foods: [{ id: 19 }] } }), { status: 201 });
  }
  if (String(url).includes('/daily-sessions')) {
    return new Response(JSON.stringify({ data: [{ id: 7, session_date: '2026-11-11', foods_count: 1 }] }), { status: 200 });
  }
  if (String(url).endsWith('/activities')) {
    return new Response(JSON.stringify({ data: { id: 42, calories: 250, distance_km: 3.1 } }), { status: 201 });
  }
  return new Response(JSON.stringify({ data: { id: 42 } }), { status: 200 });
};

process.env.VITE_API_BASE_URL = '';

const { createServer } = await import('vite');
const vite = await createServer({
  root,
  configFile: false,
  envFile: false,
  logLevel: 'error',
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
  resolve: {
    alias: [
      { find: /^maplibre-gl\/dist\/maplibre-gl\.css$/, replacement: resolve(here, 'stubs/empty.css') },
      { find: /^maplibre-gl$/, replacement: resolve(here, 'stubs/maplibre-gl.js') },
    ],
  },
  ssr: { noExternal: true },
  server: { middlewareMode: true, hmr: false },
});

try {
  const { MAP_STYLE, HAS_CUSTOM_STYLE, PLANNED_ROUTE_DASH } = await vite.ssrLoadModule('/src/config/mapConfig.js');
  assert.equal(HAS_CUSTOM_STYLE, false);
  assert.equal(typeof MAP_STYLE, 'object');
  assert.ok(MAP_STYLE.sources?.osm?.tiles?.[0]?.includes('openstreetmap.org'));
  assert.ok(Array.isArray(PLANNED_ROUTE_DASH), 'PLANNED_ROUTE_DASH must be a MapLibre array');

  const { toLatLng, segmentsToGeoJSON, haversineKm, elevationGainM, panTo, isStyleInitialized } = await vite.ssrLoadModule('/src/services/mapService.js');
  assert.deepEqual(toLatLng({ latitude: 14.676, longitude: 121.0437 }), [14.676, 121.0437]);
  assert.deepEqual(toLatLng([14.68, 121.05]), [14.68, 121.05]);

  // Regression guard: MapLibre easeTo runs Object.assign({ offset: [0, 0] }, options)
  // and calls Point.convert(options.offset), which throws if `offset: undefined` is present.
  let seenEaseOptions = null;
  const fakeMap = {
    style: { _loaded: true },
    getZoom: () => 14,
    isStyleLoaded: () => false, // e.g., background OSM tile streaming while style is already loaded
    easeTo(opts) {
      const merged = Object.assign({ offset: [0, 0], duration: 500 }, opts);
      assert.ok(Array.isArray(merged.offset) || (merged.offset && merged.offset.x !== undefined), 'offset must never be overwritten with undefined');
      seenEaseOptions = merged;
    },
  };
  assert.equal(isStyleInitialized(fakeMap), true, 'style._loaded takes precedence over tile-loading state');
  assert.equal(isStyleInitialized({ style: { _loaded: false }, isStyleLoaded: () => true }), false, 'unfinished style is never considered initialized');
  panTo(fakeMap, [14.676, 121.0437], { zoom: 15 });
  assert.equal('offset' in seenEaseOptions, true);
  assert.deepEqual(seenEaseOptions.offset, [0, 0]);
  assert.equal(seenEaseOptions.zoom, 15);

  const geo = segmentsToGeoJSON([
    { latitude: 14.676, longitude: 121.0437, speedKmh: 9.5 },
    { latitude: 14.68, longitude: 121.05, speedKmh: 10.2 },
  ]);
  assert.equal(geo.features.length, 1);
  assert.deepEqual(geo.features[0].geometry.coordinates, [
    [121.0437, 14.676],
    [121.05, 14.68],
  ]);
  assert.ok(haversineKm([14.676, 121.0437], [14.686, 121.0537]) > 1);
  assert.equal(elevationGainM([{ altitudeM: 10 }, { altitudeM: 24 }, { altitudeM: 19 }, { altitudeM: 29 }]), 24);

  const { trackPoint } = await vite.ssrLoadModule('/src/services/gpsService.js');
  const { validateTrackPoint, activityApi } = await vite.ssrLoadModule('/src/services/activityService.js');
  const sample = trackPoint({ latitude: 14.676, longitude: 121.0437, altitude: 32, speed: 3.0, accuracy: 8 }, 1762872400000);
  assert.equal(typeof sample.timestamp, 'string');
  assert.deepEqual(validateTrackPoint(sample), []);
  assert.deepEqual(validateTrackPoint({ latitude: 14.676, longitude: 121.0437, timestamp: 1762872400000 }), []);

  // Verify activityApi paths never double-prefix /api/api/... and create returns data once
  const created = await activityApi.create({ activity_type: 'run', distance_km: 3.1, duration_min: 18, started_at: new Date().toISOString() });
  assert.equal(created.id, 42);
  assert.equal(created.calories, 250);
  await activityApi.get(42);
  await activityApi.routes.list();
  assert.ok(calls.some((c) => c.url === '/api/activities'));
  assert.ok(calls.some((c) => c.url === '/api/activities/42'));
  assert.ok(calls.some((c) => c.url === '/api/routes'));

  // Verify dailySessionApi envelope contracts and query forwarding
  const { dailySessionApi, formatSessionDate } = await vite.ssrLoadModule('/src/services/dailySessionService.js');
  const today = await dailySessionApi.today();
  assert.equal(today.data.id, 7);

  const list = await dailySessionApi.list({ limit: 30, from: '2026-11-01' });
  assert.equal(list.data[0].foods_count, 1);
  assert.ok(calls.some((c) => c.url === '/api/daily-sessions?limit=30&from=2026-11-01'));

  const added = await dailySessionApi.addFood(7, { meal_type: 'snack', food_name: 'Banana', calories: 105 });
  assert.equal(added.session.calories_eaten, 105);

  const formatted = formatSessionDate('2026-11-11', { year: 'numeric', month: '2-digit', day: '2-digit' });
  assert.ok(formatted.includes('11') && formatted.includes('2026'));

  console.log('track & daily session checks passed ✔');
} finally {
  await vite.close();
}
