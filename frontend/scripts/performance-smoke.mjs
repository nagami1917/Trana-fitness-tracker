/**
 * Performance & bundle regression checks for TRANA's production build, boot
 * waterfall elimination, parallel pagination, SWR boot cache, and O(N) charts.
 *
 *   node scripts/performance-smoke.mjs
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get } from 'svelte/store';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 1. Static asset & production bundle split checks (when dist exists).
assert.equal(existsSync(resolve(root, 'public/mascot.png')), false, 'Unused 850KB mascot.png must remain removed');
assert.ok(statSync(resolve(root, 'public/favicon.png')).size < 25 * 1024, 'favicon.png must stay lightweight (<25KB)');
assert.ok(statSync(resolve(root, 'public/mascot-cat.png')).size < 160 * 1024, 'mascot-cat.png must stay optimized (<160KB)');

const distAssetsDir = resolve(root, 'dist/assets');
if (existsSync(distAssetsDir)) {
  const files = readdirSync(distAssetsDir);
  const entryJs = files.find((f) => /^index-.*\.js$/.test(f));
  assert.ok(entryJs, 'Expected Vite entry JS chunk');
  const entrySize = statSync(resolve(distAssetsDir, entryJs)).size;
  assert.ok(entrySize < 250 * 1024, `Entry JS chunk (${entrySize}B) should stay code-split under 250KB`);

  assert.ok(files.some((f) => /^PlanActivity-.*\.js$/.test(f)), 'PlanActivity must be a lazy route chunk');
  assert.ok(files.some((f) => /^Track-.*\.js$/.test(f)), 'Track must be a lazy route chunk');
  assert.ok(files.some((f) => /^Dashboard-.*\.js$/.test(f)), 'Dashboard must be a lazy route chunk');
  assert.ok(files.some((f) => /^Login-.*\.js$/.test(f)), 'Login must be a lazy route chunk');
  assert.ok(files.some((f) => /^vendor-maplibre-.*\.js$/.test(f)), 'MapLibre must be isolated in vendor-maplibre chunk');
  assert.ok(files.some((f) => /^vendor-leaflet-.*\.js$/.test(f)), 'Leaflet must be isolated in vendor-leaflet chunk');
  assert.ok(files.some((f) => /^vendor-charts-.*\.js$/.test(f)), 'Chart.js must be isolated in vendor-charts chunk');

  const sw = readFileSync(resolve(root, 'dist/sw.js'), 'utf8');
  assert.doesNotMatch(sw, /vendor-maplibre/, 'SW install precache must defer heavy vendor-maplibre chunk');
  assert.doesNotMatch(sw, /duration_model\.json/, 'SW install precache must defer duration_model.json to runtime caching');
}

// 2. Boot waterfall, parallel listAll pagination, SWR cache & O(N) store checks.
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};

let pendingResolvers = [];
let seenRequests = [];
globalThis.fetch = (url) => {
  seenRequests.push(String(url));
  return new Promise((resolve) => {
    pendingResolvers.push({ url: String(url), resolve });
  });
};

process.env.VITE_API_BASE_URL = '';
const vite = await createServer({
  root,
  configFile: false,
  envFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false },
});

try {
  const { api } = await vite.ssrLoadModule('/src/services/client.js');
  const stores = await vite.ssrLoadModule('/src/stores/index.js');

  // A. Signed-out bootstrap resolves immediately with 0 blocking HTTP calls.
  await stores.bootstrap();
  assert.equal(get(stores.booting), false, 'Signed-out visitor must not block on /api/health');
  assert.equal(get(stores.ready), true);
  assert.equal(seenRequests.length, 0);

  // B. Parallel listAll() pagination: page 1 -> pages 2 & 3 issued concurrently.
  storage.set('trana.token', 'tok-123');
  const listPromise = api.activities.list();
  assert.equal(seenRequests.at(-1), '/api/activities?limit=500&page=1');
  pendingResolvers.shift().resolve(
    new Response(JSON.stringify({ data: [{ id: 1 }], meta: { current_page: 1, last_page: 3 } }), { status: 200 }),
  );
  await new Promise((r) => setTimeout(r, 0));
  const concurrentUrls = pendingResolvers.map((p) => p.url);
  assert.deepEqual(
    concurrentUrls,
    ['/api/activities?limit=500&page=2', '/api/activities?limit=500&page=3'],
    'Pages 2..N must fetch in parallel via Promise.all',
  );
  pendingResolvers.shift().resolve(
    new Response(JSON.stringify({ data: [{ id: 2 }], meta: { current_page: 2, last_page: 3 } }), { status: 200 }),
  );
  pendingResolvers.shift().resolve(
    new Response(JSON.stringify({ data: [{ id: 3 }], meta: { current_page: 3, last_page: 3 } }), { status: 200 }),
  );
  assert.deepEqual(await listPromise, [{ id: 1 }, { id: 2 }, { id: 3 }]);

  // C. SWR boot cache hydrates synchronously while /api/health & /api/auth/me run concurrently.
  seenRequests = [];
  pendingResolvers = [];
  storage.set(
    'trana:boot_cache:v1',
    JSON.stringify({
      ts: Date.now(),
      session: { id: 9, name: 'Cached Runner', email_verified_at: '2026-11-01T00:00:00Z' },
      profile: { id: 9, weight_kg: 60, onboarded: true },
      activities: [
        { id: 10, activity_type: 'run', distance_km: 5, duration_min: 28, calories: 310, started_at: new Date().toISOString() },
      ],
      plans: [],
      goals: { daily_calories: 2400 },
    }),
  );

  const bootPromise = stores.bootstrap();
  assert.equal(get(stores.booting), false, 'Cached snapshot must unblock initial render immediately');
  assert.equal(get(stores.session)?.name, 'Cached Runner');
  assert.deepEqual(
    pendingResolvers.map((p) => p.url),
    ['/api/health', '/api/auth/me'],
    'Health and auth/me must fire concurrently without a serial RTT waterfall',
  );

  pendingResolvers.shift().resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
  pendingResolvers.shift().resolve(
    new Response(JSON.stringify({ user: { id: 9, name: 'Fresh Runner', email_verified_at: '2026-11-01T00:00:00Z' } }), { status: 200 }),
  );
  await new Promise((r) => setTimeout(r, 0));
  for (const item of pendingResolvers) {
    let body = {};
    if (item.url.startsWith('/api/activities')) body = { data: [], meta: { current_page: 1, last_page: 1 } };
    else if (item.url.startsWith('/api/predictions')) body = { data: [], meta: { current_page: 1, last_page: 1 } };
    else if (item.url === '/api/profile') body = { data: { id: 9, weight_kg: 60, onboarded: true } };
    else if (item.url === '/api/goals') body = { data: { daily_calories: 2600 } };
    item.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }
  await bootPromise;
  assert.equal(get(stores.session)?.name, 'Fresh Runner');
  assert.equal(get(stores.goals)?.daily_calories, 2600);

  // D. Indexed chartSeries & weekdayLoad compute exact totals.
  const nowIso = new Date().toISOString();
  const yesterdayIso = new Date(Date.now() - 86400000).toISOString();
  stores.activities.set([
    { id: 1, activity_type: 'run', distance_km: 6, duration_min: 30, calories: 350, elevation_gain_m: 20, started_at: nowIso },
    { id: 2, activity_type: 'ride', distance_km: 14, duration_min: 40, calories: 400, elevation_gain_m: 80, started_at: yesterdayIso },
  ]);
  const series = get(stores.chartSeries);
  assert.equal(series['7D'].length, 7);
  assert.equal(series['1M'].length, 30);
  assert.equal(series['3M'].length, 13);
  assert.equal(series['1M'].at(-1).calories, 350);
  assert.equal(series['1M'].at(-2).calories, 400);
  assert.equal(get(stores.weekdayLoad).reduce((s, d) => s + d.count, 0), 2);

  console.log('Performance, code-splitting, SWR cache & parallel API checks passed ✔');
} finally {
  await vite.close();
}
