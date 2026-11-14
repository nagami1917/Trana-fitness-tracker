/**
 * Server-side render smoke test.
 *
 *   node scripts/render-smoke.mjs
 *
 * Renders every screen through Svelte's SSR compiler with a populated store.
 * onMount effects (charts, maps) are skipped, but all template logic, derived
 * values and store reads run for real — this catches the class of bug that a
 * build cannot: undefined values, bad guards, broken `$derived` chains.
 */

import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// --- browser stubs ---------------------------------------------------------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const fixtureUser = { id: 1, name: 'Test Athlete', email: 'athlete@example.test', role: 'admin' };
const fixtureProfile = {
  ...fixtureUser, weight_kg: 60, height_cm: 168, birth_year: 1998, sex: 'other',
  sweat_profile: 'normal', experience_level: 2, typical_temperature_c: 26, units: 'metric',
  city: 'Test City', onboarded: true, total_activities: 3,
  daily_calorie_goal: 2400, daily_distance_goal_km: 10, daily_active_min_goal: 60,
  weekly_calorie_goal: 12000, weekly_distance_goal_km: 40, daily_carb_goal_g: 360,
};
const fixtureActivities = [
  { id: 1, activity_type: 'run', distance_km: 5, duration_min: 30, calories: 300, elevation_gain_m: 20, started_at: new Date().toISOString(), route: null, notes: null },
  { id: 2, activity_type: 'ride', distance_km: 20, duration_min: 60, calories: 500, elevation_gain_m: 80, started_at: new Date(Date.now() - 86400000).toISOString(), route: null, notes: null },
  { id: 3, activity_type: 'walk', distance_km: 3, duration_min: 40, calories: 120, elevation_gain_m: 10, started_at: new Date(Date.now() - 172800000).toISOString(), route: null, notes: null },
];
const fixtureGoals = { daily_calories: 2400, daily_distance_km: 10, daily_active_min: 60, weekly_calories: 12000, weekly_distance_km: 40, carb_target_g: 360 };
const fixturePlans = [
  {
    id: 11,
    activity_type: 'run',
    distance_km: 1.89,
    elevation_gain_m: 45,
    route: [[14.67634, 121.035], [14.67086, 121.05165]],
    planned_for: null,
    status: 'planned',
    duration: { minutes: 34, hours: 0.57, low: 30, high: 38, confidence: 0.8 },
    fueling: {
      intensity: 'moderate',
      met: 8.5,
      calories: { total: 260 },
      carbs: { perHourG: 0, totalG: 0 },
      sodium: { perHourMg: 500 },
      fluid: { perHourMl: 600 },
    },
    created_at: new Date().toISOString(),
  },
];
const page = (data) => ({ data, meta: { current_page: 1, last_page: 1 } });
globalThis.fetch = async (url) => {
  let body;
  if (url === '/api/auth/google') body = { token: 'test-token', user: fixtureUser };
  else if (url === '/api/profile') body = { data: fixtureProfile };
  else if (url.startsWith('/api/activities?')) body = page(fixtureActivities);
  else if (url.startsWith('/api/predictions?')) body = page(fixturePlans);
  else if (url === '/api/goals') body = { data: fixtureGoals };
  else if (url.startsWith('/api/admin/dashboard')) {
    body = { data: {
      users: { total: 2, new_7d: 2, suspended: 0, admins: 1 },
      content: { activities: 3, predictions: 0, goals: 0 },
      errors: { open_groups: 0, groups_24h: 0, total_groups: 0 },
    } };
  } else if (url.startsWith('/api/admin/users')) {
    body = page([{ id: 2, name: 'Other Athlete', email: 'other@example.test', role: 'athlete', suspended_at: null, created_at: '2026-11-01T00:00:00Z', activities_count: 1 }]);
  } else if (url.startsWith('/api/admin/errors')) {
    body = page([]);
  } else if (url.startsWith('/api/admin/model')) {
    body = { data: { version: 'test', training_source: 'synthetic', corpus_rows: 10, metrics: { r2: 0.9, mae_min: 2, mape_pct: 10, interval_coverage_pct: 80 }, feature_importance: { distance_km: 0.5 } } };
  } else throw new Error(`Unexpected test request: ${url}`);
  return new Response(JSON.stringify(body), { status: 200 });
};
globalThis.window = { location: { pathname: '/', search: '' }, addEventListener() {}, scrollTo() {} };

// Always render against explicit HTTP test fixtures, never a browser demo backend.
process.env.VITE_API_BASE_URL = '';

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
      // Leaflet, MapLibre GL, and Chart.js touch `window` at import time; neither is needed for
      // template rendering, so swap them for inert stand-ins.
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

const { render } = await vite.ssrLoadModule('svelte/server');

let failures = 0;

try {
  const stores = await vite.ssrLoadModule('/src/stores/index.js');
  await stores.googleSignInAndContinue('fixture-google-id-token');
  stores.modelCard.set({ training_source: 'synthetic', version: 'test', corpus_rows: 10,
    metrics: { r2: 0.9, mape_pct: 10, mae_min: 2, interval_coverage_pct: 80, test_rows: 2 },
    feature_importance: {} });

  const routes = [
    ['/', 'Dashboard'],
    ['/plan', 'PlanActivity'],
    ['/track', 'Track'],
    ['/track/history', 'Track', 'History'],
    ['/track/session', 'Track', 'SessionDetail'],
    ['/calendar', 'Calendar'],
    ['/activities', 'Activities'],
    ['/analytics', 'Analytics'],
    ['/fueling', 'Fueling'],
    ['/goals', 'Goals'],
    ['/profile', 'Profile'],
    ['/settings', 'Settings'],
    ['/admin', 'Admin'],
    ['/nope', 'NotFound'],
  ];

  for (const [path, folder, component] of routes) {
    const name = component ?? folder;
    const file = `/src/pages/${folder}/${name}.svelte`;
    try {
      const mod = await vite.ssrLoadModule(file);
      const html = render(mod.default).body;
      if (['Profile', 'Settings'].includes(name)) {
        assert.match(html, /Use current location/);
        assert.match(html, /coordinates and IP/);
        assert.ok(html.indexOf('coordinates and IP') < html.indexOf('Use current location'));
      }
      if (name === 'Dashboard') {
        assert.match(html, /Test City/);
        assert.match(html, /Track Activity/);
        assert.match(html, /Quick Plan/);
      }
      if (name === 'PlanActivity') {
        assert.match(html, /Route planner/);
        assert.match(html, /Follow roads/);
        assert.match(html, /Straight lines/);
        assert.match(html, /Search street, park, or stop/);
        assert.match(html, /Add a route on the map to start predicting/);
        assert.doesNotMatch(html, /PREDICTED DURATION/);
      }
      if (name === 'Track') {
        assert.match(html, /Track Activity/);
        assert.match(html, /Free GPS/);
        assert.match(html, /Create path/);
        assert.match(html, /From Plan Activity/);
        assert.doesNotMatch(html, /From Activities/);
        assert.match(html, /Start activity/);
        assert.match(html, /View History/);
      }
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text.length) throw new Error('rendered no text');
      const suspicious = ['NaN', 'undefined', 'Infinity', '[object Object]'].filter((bad) => text.includes(bad));
      if (suspicious.length) throw new Error(`rendered suspicious tokens: ${suspicious.join(', ')}`);
      console.log(`✔ ${path.padEnd(14)} ${name.padEnd(13)} ${String(text.length).padStart(5)} chars`);
      if (process.env.DUMP === name) console.log(`\n--- ${name} ---\n${text.slice(0, 1600)}\n`);
    } catch (error) {
      failures += 1;
      console.error(`✘ ${path} (${name}): ${error.message}`);
      if (process.env.VERBOSE) console.error(error.stack);
    }
  }

  // The dashboard should offer a way to add a city when none is saved.
  try {
    const mod = await vite.ssrLoadModule('/src/pages/Dashboard/Dashboard.svelte');
    stores.profile.set({ ...fixtureProfile, city: null });
    assert.match(render(mod.default).body, /Add city \/ region/);
    stores.profile.set(fixtureProfile);
  } catch (error) {
    failures += 1;
    stores.profile.set(fixtureProfile);
    console.error(`✘ Dashboard without a city: ${error.message}`);
  }

  // Missing optional birth years must not render a calculated age.
  try {
    const mod = await vite.ssrLoadModule('/src/pages/Profile/Profile.svelte');
    stores.profile.set({ ...fixtureProfile, birth_year: null, age: 999 });
    assert.doesNotMatch(render(mod.default).body, /999 years/);
    stores.profile.set(fixtureProfile);
  } catch (error) {
    failures += 1;
    stores.profile.set(fixtureProfile);
    console.error(`✘ Profile without a birth year: ${error.message}`);
  }

  // SessionCard links to /track/session?id=<id> (query param, matching SessionDetail)
  try {
    const mod = await vite.ssrLoadModule('/src/components/activity/SessionCard.svelte');
    const html = render(mod.default, {
      props: {
        session: {
          id: 99,
          session_date: '2026-11-11',
          calories_burned: 400,
          calories_eaten: 600,
          water_ml: 750,
          net_calories: 200,
          foods_count: 2,
        },
      },
    }).body;
    assert.match(html, /href="\/track\/session\?id=99"/);
    assert.match(html, /2 foods/);
  } catch (error) {
    failures += 1;
    console.error(`✘ SessionCard: ${error.message}`);
  }

  // Live pace/speed stay hidden while the first 50 m are within GPS startup noise.
  try {
    const mod = await vite.ssrLoadModule('/src/components/activity/ActivityStats.svelte');
    const early = render(mod.default, {
      props: {
        distanceKm: 0.02,
        durationMin: 10 / 60,
        durationSec: 10,
        avgSpeedKmh: 0,
        avgPaceMinKm: 0,
        elevationGainM: 0,
        calories: 0,
      },
    }).body;
    assert.match(early, /Pace and speed appear after 50 m of reliable GPS movement/);

    const moving = render(mod.default, {
      props: {
        distanceKm: 0.1,
        durationMin: 2,
        durationSec: 120,
        avgSpeedKmh: 3,
        avgPaceMinKm: 20,
        elevationGainM: 0,
        calories: 20,
      },
    }).body;
    assert.doesNotMatch(moving, /Pace and speed appear after 50 m of reliable GPS movement/);
    console.log('✔ Track metrics wait for reliable GPS distance before showing pace/speed');
  } catch (error) {
    failures += 1;
    console.error(`✘ Track metric GPS warmup: ${error.message}`);
  }

  // App shell + auth gate
  try {
    const mod = await vite.ssrLoadModule('/src/App.svelte');
    stores.booting.set(false);
    stores.bootError.set('Test connection failure');
    const unavailable = render(mod.default).body;
    assert.match(unavailable, /TRANA is unavailable/);
    assert.match(unavailable, /Try again/);
    stores.bootError.set(null);
    const html = render(mod.default).body;
    assert.doesNotMatch(html, /Plan an activity/);
    console.log(`✔ /            App         ${String(html.length).padStart(5)} chars`);
  } catch (error) {
    failures += 1;
    console.error(`✘ App: ${error.message}`);
  }

  // AppShell renders the Guide replay button cleanly without auto-opening a modal on SSR
  try {
    const mod = await vite.ssrLoadModule('/src/components/common/AppShell.svelte');
    const html = render(mod.default).body;
    assert.match(html, /Open cat mascot guide/);
    assert.doesNotMatch(html, /role="dialog"/);
  } catch (error) {
    failures += 1;
    console.error(`✘ AppShell: ${error.message}`);
  }

  // Onboarding wizard
  try {
    const mod = await vite.ssrLoadModule('/src/pages/Onboarding/Onboarding.svelte');
    const html = render(mod.default).body;
    assert.match(html, /Use current location/);
    assert.match(html, /coordinates and IP/);
    assert.ok(html.indexOf('coordinates and IP') < html.indexOf('Use current location'));
    console.log(`✔ /onboarding  Onboarding  ${String(html.length).padStart(5)} chars`);
  } catch (error) {
    failures += 1;
    console.error(`✘ Onboarding: ${error.message}`);
  }

  // Login + register screens (signed out)
  stores.session.set(null);
  for (const name of ['Login', 'Register']) {
    try {
      const mod = await vite.ssrLoadModule(`/src/pages/${name}/${name}.svelte`);
      const html = render(mod.default).body;
      assert.doesNotMatch(html, /Explore with demo data|demo@trana\.app/);
      assert.doesNotMatch(html, /type="password"/);
      assert.doesNotMatch(html, /six-digit code|email-code sign-in/i);
      assert.match(html, /Google/i);
      assert.match(html, /Google handles your password/i);
      console.log(`✔ /${name.toLowerCase().padEnd(9)} ${name.padEnd(11)} ${String(html.length).padStart(5)} chars`);
    } catch (error) {
      failures += 1;
      console.error(`✘ ${name}: ${error.message}`);
    }
  }
} finally {
  await vite.close();
}

if (failures) {
  console.error(`\n${failures} screen(s) failed to render`);
  process.exit(1);
}
console.log('\nall screens rendered ✔');
