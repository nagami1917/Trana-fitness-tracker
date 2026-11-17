/**
 * Verification smoke suite for TRANA end-user improvements:
 *   1. Metric <-> Imperial unit conversions & formatters (lib/units.js, lib/format.js)
 *   2. Open-Meteo Weather forecast lookup (services/weatherService.js)
 *   3. Offline Activity Sync Queue (lib/offlineQueue.js)
 *   4. Dark Outdoor OLED Theme persistence (lib/theme.js)
 *   5. Public /preview calculator SSR render (pages/Preview/Preview.svelte)
 *   6. Blocked-cookie session diagnostics (lib/sessionDiagnostics.js)
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

// 2. Weather Forecast Service
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

// 3. Offline Queue
const { get } = await import('svelte/store');
localStorage.removeItem('trana:pending_activities:v1');
localStorage.setItem('trana.token', 'test-token');
const csrfToken = 'a'.repeat(64);
globalThis.fetch = async (url) => {
  if (String(url) === '/api/auth/me') {
    return new Response(JSON.stringify({ user: { id: 1, username: 'offline_test' } }), { status: 200 });
  }
  throw new Error(`Unexpected session bootstrap request: ${url}`);
};
const { api } = await import('../src/services/client.js');
await api.auth.user();
assert.equal(api.auth.hasSession(), true, 'The queue smoke should model an API-validated cookie session.');
const offlineQueue = await import('../src/lib/offlineQueue.js');
const q1 = offlineQueue.queueActivitySave({ activity_type: 'run', distance_km: 5, duration_min: 30, started_at: '2026-11-10T06:00:00Z' });
const q2 = offlineQueue.queueActivitySave({ activity_type: 'ride', distance_km: 15, duration_min: 40, started_at: '2026-11-10T07:00:00Z' });
assert.equal(get(offlineQueue.pendingActivities).length, 2);

let postAttempt = 0;
globalThis.fetch = async (url, init) => {
  if (String(url) === '/api/auth/csrf') {
    return new Response(JSON.stringify({ csrfToken }), { status: 200 });
  }
  if (String(url).includes('/api/activities') && init?.method === 'POST') {
    assert.equal(init.headers['X-CSRF-TOKEN'], csrfToken);
    assert.equal(init.credentials, 'include');
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
    assert.equal(init.headers['X-CSRF-TOKEN'], csrfToken);
    assert.equal(init.credentials, 'include');
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

// 4. Dark Outdoor Theme
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

// 6. Blocked-cookie session diagnostics
{
  const { detectBlockedCookieStorage, cookieBlockedGuidance } = await import(
    resolve(root, 'src/lib/sessionDiagnostics.js')
  );

  // Happy DOM keeps cookies: a probe is written and read back, so storage is
  // reported as working. This is the control case.
  assert.equal(detectBlockedCookieStorage(), false, 'working cookie jar must not report blocked');

  // The probe must not leak into the jar.
  assert.ok(
    !String(win.document.cookie).includes('trana_probe'),
    'the diagnostic probe cookie must be cleaned up',
  );

  // A browser that silently drops the write must be reported as blocked.
  // Happy DOM defines `cookie` on the document instance, so the stub goes
  // there; `delete` restores the original accessor.
  let writes = 0;
  Object.defineProperty(win.document, 'cookie', {
    configurable: true,
    get: () => '',
    set: () => {
      writes += 1;
    },
  });
  try {
    assert.equal(detectBlockedCookieStorage(), true, 'a dropped cookie write is a blocked jar');
    assert.ok(writes >= 1, 'the detector must actually attempt a write');
  } finally {
    delete win.document.cookie;
  }

  // Headless/SSR has no document: never claim the browser is at fault.
  const savedDoc = globalThis.document;
  delete globalThis.document;
  try {
    assert.equal(detectBlockedCookieStorage(), false, 'no document must report blocked=false');
  } finally {
    globalThis.document = savedDoc;
  }

  // Guidance must name the browser the user is actually holding.
  assert.match(cookieBlockedGuidance('Mozilla/5.0 Chrome/157 Mobile Brave/157'), /lion icon/i);
  assert.match(cookieBlockedGuidance('Mozilla/5.0 (iPhone) Version/17 Safari/604.1'), /Prevent Cross-Site Tracking/);
  assert.match(cookieBlockedGuidance('Mozilla/5.0 Firefox/148.0'), /Enhanced Tracking Protection/);
  assert.match(cookieBlockedGuidance(''), /Allow cookies for this site/);

  console.log('✔ Blocked-cookie session diagnostics');
}

// 5. SSR Render check for Preview.svelte
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
      { find: /^maplibre-gl\/dist\/maplibre-gl\.css$/, replacement: resolve(here, 'stubs/empty.css') },
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
