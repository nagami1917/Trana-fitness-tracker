/**
 * Verification smoke suite for TRANA end-user improvements:
 *   1. Metric <-> Imperial unit conversions & formatters (lib/units.js, lib/format.js)
 *   2. GPX & TCX parser + GPX 1.1 exporter (lib/gpx.js)
 *   3. DEM Elevation profile & offline fallback (services/elevationService.js)
 *   4. Open-Meteo Weather forecast lookup (services/weatherService.js)
 *   5. Offline Activity Sync Queue (lib/offlineQueue.js)
 *   6. Dark Outdoor OLED Theme persistence (lib/theme.js)
 *   7. Public /preview calculator SSR render (pages/Preview/Preview.svelte)
 *
 *   node scripts/improvements-smoke.mjs
 */

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// Set up Happy DOM globals (required for DOMParser, localStorage, documentElement)
const win = new Window({ url: 'https://trana-web.vercel.app/' });
globalThis.window = win;
globalThis.document = win.document;
globalThis.DOMParser = win.DOMParser;
globalThis.localStorage = win.localStorage;
if (!globalThis.Blob) globalThis.Blob = win.Blob;

// 1. Units & Formatters
const units = await import('../src/lib/units.js');
const fmt = await import('../src/lib/format.js');

assert.ok(Math.abs(units.toDisplayDistance(10, 'imperial') - 6.2137) < 0.01);
assert.ok(Math.abs(units.fromDisplayDistance(6.2137119, 'imperial') - 10) < 0.01);
assert.equal(units.toDisplayDistance(5.2, 'metric'), 5.2);
assert.ok(Math.abs(units.toDisplayElevation(100, 'imperial') - 328.08) < 0.1);
assert.ok(Math.abs(units.toDisplayWeight(70, 'imperial') - 154.32) < 0.1);
assert.equal(units.toDisplayTemp(25, 'imperial'), 77);
assert.equal(units.fromDisplayTemp(77, 'imperial'), 25);

assert.equal(fmt.formatDistance(1.27), '1.27'); // default metric contract preserved
assert.equal(fmt.pace(5.0), '5:00 /km');
assert.equal(fmt.pace(5.0, 'imperial'), '8:03 /mi');
assert.equal(fmt.speed(20, 'metric'), '20.0 km/h');
assert.equal(fmt.speed(20, 'imperial'), '12.4 mph');
assert.equal(fmt.ml(500, 'metric'), '500 ml');
assert.equal(fmt.ml(500, 'imperial'), '17 fl oz');
console.log('✔ units & unit-aware formatters');

// 2. GPX / TCX Parser & Exporter
const gpxMod = await import('../src/lib/gpx.js');

const sampleGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Garmin">
  <trk>
    <name>Morning Canal Loop</name>
    <type>running</type>
    <trkseg>
      <trkpt lat="14.6760" lon="121.0350"><ele>20</ele><time>2026-11-09T06:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>142</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
      <trkpt lat="14.6805" lon="121.0350"><ele>32</ele><time>2026-11-09T06:03:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>152</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
      <trkpt lat="14.6850" lon="121.0350"><ele>45</ele><time>2026-11-09T06:06:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>156</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const parsedGpx = gpxMod.parseActivityFile(sampleGpx, 'morning.gpx');
assert.equal(parsedGpx.activityType, 'run');
assert.equal(parsedGpx.name, 'Morning Canal Loop');
assert.ok(parsedGpx.distanceKm > 0.9 && parsedGpx.distanceKm < 1.1, `Expected ~1.0 km, got ${parsedGpx.distanceKm}`);
assert.equal(parsedGpx.durationMin, 6);
assert.equal(parsedGpx.elevationGainM, 25);
assert.equal(parsedGpx.avgHeartRate, 150);
assert.equal(parsedGpx.route.length, 3);
assert.equal(parsedGpx.routeGeojson.type, 'FeatureCollection');
assert.equal(parsedGpx.routeGeojson.features[0]?.geometry?.type, 'LineString');

const sampleTcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase>
  <Activities>
    <Activity Sport="Biking">
      <Id>2026-11-09T07:00:00Z</Id>
      <Lap>
        <Track>
          <Trackpoint><Time>2026-11-09T07:00:00Z</Time><Position><LatitudeDegrees>14.676</LatitudeDegrees><LongitudeDegrees>121.035</LongitudeDegrees></Position><AltitudeMeters>30</AltitudeMeters><HeartRateBpm><Value>135</Value></HeartRateBpm></Trackpoint>
          <Trackpoint><Time>2026-11-09T07:10:00Z</Time><Position><LatitudeDegrees>14.700</LatitudeDegrees><LongitudeDegrees>121.035</LongitudeDegrees></Position><AltitudeMeters>60</AltitudeMeters><HeartRateBpm><Value>145</Value></HeartRateBpm></Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

const parsedTcx = gpxMod.parseActivityFile(sampleTcx, 'ride.tcx');
assert.equal(parsedTcx.activityType, 'ride');
assert.equal(parsedTcx.durationMin, 10);
assert.equal(parsedTcx.elevationGainM, 30);
assert.equal(parsedTcx.avgHeartRate, 140);

const exportedXml = gpxMod.exportGpx({
  name: 'Test Export',
  activityType: 'run',
  startedAt: '2026-11-09T06:00:00Z',
  route: [[14.676, 121.035], [14.685, 121.035]],
  elevationProfile: [{ eleM: 20 }, { eleM: 45 }],
});
assert.match(exportedXml, /<gpx version="1\.1"/);
assert.match(exportedXml, /<ele>45\.0<\/ele>/);
assert.throws(() => gpxMod.parseActivityFile('<not-valid', 'bad.gpx'));
console.log('✔ GPX/TCX import & GPX 1.1 export');

// 3. DEM Elevation Service (live API + cache + offline fallback)
let fetchCalls = 0;
globalThis.fetch = async (url) => {
  fetchCalls += 1;
  if (String(url).includes('api.open-meteo.com/v1/elevation')) {
    return new Response(JSON.stringify({ elevation: [10, 42, 38, 95] }), { status: 200 });
  }
  if (String(url).includes('api.open-meteo.com/v1/forecast')) {
    return new Response(
      JSON.stringify({
        hourly: {
          time: ['2026-11-10T06:00', '2026-11-10T07:00', '2026-11-10T08:00'],
          temperature_2m: [24.5, 29.2, 31.8],
          apparent_temperature: [26.0, 32.1, 35.0],
          precipitation_probability: [10, 65, 20],
          weather_code: [1, 61, 2],
          wind_speed_10m: [8, 12, 10],
        },
      }),
      { status: 200 },
    );
  }
  throw new Error(`Unexpected fetch URL: ${url}`);
};

const eleSvc = await import('../src/services/elevationService.js');
const routeCoords = [[14.67, 121.03], [14.68, 121.03], [14.69, 121.03], [14.70, 121.03]];
const eleRes1 = await eleSvc.fetchRouteElevation(routeCoords, 'run');
assert.equal(eleRes1.source, 'dem');
assert.equal(eleRes1.profile.length, 4);
assert.ok(eleRes1.gainM >= 80, `Expected >= 80 m gain, got ${eleRes1.gainM}`);
const prevCalls = fetchCalls;
const eleRes2 = await eleSvc.fetchRouteElevation(routeCoords, 'run');
assert.equal(fetchCalls, prevCalls, 'Second call for same route should hit cache');
assert.equal(eleRes2.gainM, eleRes1.gainM);

// Offline elevation fallback test
globalThis.fetch = async () => { throw new Error('offline'); };
const offlineEle = await eleSvc.fetchRouteElevation([[14.50, 121.00], [14.55, 121.05]], 'hike');
assert.equal(offlineEle.source, 'estimate');
assert.ok(offlineEle.gainM > 0);
console.log('✔ DEM elevation service + cache + fallback');

// 4. Weather Forecast Service
const futureTarget = new Date(Date.now() + 2 * 3600 * 1000);
const targetHour = futureTarget.getHours();
const pad = (n) => String(n).padStart(2, '0');
const dateStr = `${futureTarget.getFullYear()}-${pad(futureTarget.getMonth() + 1)}-${pad(futureTarget.getDate())}`;
const mockHours = [...Array(24)].map((_, h) => `${dateStr}T${pad(h)}:00`);
const mockTemps = [...Array(24)].map((_, h) => (h === targetHour ? 29.2 : 24));
const mockFeels = [...Array(24)].map((_, h) => (h === targetHour ? 32.1 : 25));
const mockHumidity = [...Array(24)].map((_, h) => (h === targetHour ? 78 : 60));

globalThis.fetch = async (url) => {
  if (String(url).includes('api.open-meteo.com/v1/forecast')) {
    return new Response(
      JSON.stringify({
        hourly: {
          time: mockHours,
          temperature_2m: mockTemps,
          apparent_temperature: mockFeels,
          relative_humidity_2m: mockHumidity,
        },
      }),
      { status: 200 },
    );
  }
  throw new Error(`Unexpected weather URL: ${url}`);
};
const weatherSvc = await import('../src/services/weatherService.js');
const wx = await weatherSvc.fetchRouteWeather(14.676, 121.035, futureTarget.toISOString());
assert.ok(wx, 'Expected forecast object');
assert.equal(wx.tempC, 29);
assert.equal(wx.feelsLikeC, 32);
assert.equal(wx.humidityPct, 78);
assert.equal(wx.hourLabel, `${pad(targetHour)}:00`);
const farFuture = new Date(Date.now() + 30 * 86400 * 1000).toISOString();
assert.equal(await weatherSvc.fetchRouteWeather(14.676, 121.035, farFuture), null);
console.log('✔ Open-Meteo hourly weather forecast');

// 5. Offline Queue
const { get } = await import('svelte/store');
localStorage.removeItem('trana:pending_activities:v1');
localStorage.setItem('trana.token', 'test-token');
const offlineQueue = await import('../src/lib/offlineQueue.js');
const q1 = offlineQueue.queueActivitySave({ activity_type: 'run', distance_km: 5, duration_min: 30, started_at: '2026-11-10T06:00:00Z' });
const q2 = offlineQueue.queueActivitySave({ activity_type: 'ride', distance_km: 15, duration_min: 40, started_at: '2026-11-10T07:00:00Z' });
assert.equal(get(offlineQueue.pendingActivities).length, 2);

let postAttempt = 0;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/api/activities') && init?.method === 'POST') {
    postAttempt += 1;
    if (postAttempt === 1) {
      return new Response(JSON.stringify({ data: { id: 101, ...JSON.parse(init.body) } }), { status: 201 });
    }
    throw new Error('network down');
  }
  throw new Error(`Unexpected queue fetch: ${url}`);
};

const flush1 = await offlineQueue.flushPendingActivities({ silent: true });
assert.equal(flush1.synced, 1);
assert.equal(flush1.remaining, 1);
assert.equal(get(offlineQueue.pendingActivities).length, 1, 'Failed item must remain queued');

globalThis.fetch = async (url, init) => {
  if (String(url).includes('/api/activities') && init?.method === 'POST') {
    return new Response(JSON.stringify({ data: { id: 102, ...JSON.parse(init.body) } }), { status: 201 });
  }
  throw new Error(`Unexpected queue fetch: ${url}`);
};
const flush2 = await offlineQueue.flushPendingActivities({ silent: true });
assert.equal(flush2.synced, 1);
assert.equal(flush2.remaining, 0);
assert.equal(get(offlineQueue.pendingActivities).length, 0);
assert.ok(q1.localId && q2.localId);
console.log('✔ Offline activity sync queue');

// 6. Dark Outdoor Theme
const meta = document.createElement('meta');
meta.setAttribute('name', 'theme-color');
meta.setAttribute('content', '#db2777');
document.head.appendChild(meta);
const themeMod = await import('../src/lib/theme.js');
themeMod.setTheme('dark');
assert.equal(document.documentElement.classList.contains('theme-dark'), true);
assert.equal(localStorage.getItem('trana:theme'), 'dark');
assert.equal(meta.getAttribute('content'), '#0f131d');
themeMod.toggleTheme();
assert.equal(document.documentElement.classList.contains('theme-dark'), false);
assert.equal(localStorage.getItem('trana:theme'), 'light');
assert.equal(meta.getAttribute('content'), '#db2777');
console.log('✔ Outdoor high-contrast dark theme toggle & persistence');

// 7. SSR Render check for Preview.svelte
const { createServer } = await import('vite');
const { svelte } = await import('@sveltejs/vite-plugin-svelte');

const vite = await createServer({
  root,
  configFile: false,
  envFile: false,
  logLevel: 'error',
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
  plugins: [svelte({ compilerOptions: { generate: 'server', dev: false } })],
  resolve: {
    alias: [
      { find: /^leaflet\/dist\/leaflet\.css$/, replacement: resolve(here, 'stubs/empty.css') },
      { find: /^leaflet$/, replacement: resolve(here, 'stubs/leaflet.js') },
      { find: /^maplibre-gl\/dist\/maplibre-gl\.css$/, replacement: resolve(here, 'stubs/empty.css') },
      { find: 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', replacement: resolve(here, 'stubs/empty-url.js') },
      { find: /^maplibre-gl$/, replacement: resolve(here, 'stubs/maplibre-gl.js') },
      { find: /^chart\.js\/auto$/, replacement: resolve(here, 'stubs/chart.js') },
    ],
  },
  ssr: { noExternal: true },
  server: { middlewareMode: true, hmr: false },
});

try {
  const { render } = await vite.ssrLoadModule('svelte/server');
  const mod = await vite.ssrLoadModule('/src/pages/Preview/Preview.svelte');
  const { body } = render(mod.default, { props: {} });
  assert.ok(body.includes('duration &amp; fueling engine') || body.includes('Interactive preview'));
  console.log('✔ Preview.svelte SSR render');
} finally {
  await vite.close();
}

console.log('\nAll improvement smoke checks passed ✔');
