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
const fixtureUser = { id: 1, name: 'Test Athlete', email: 'athlete@example.test' };
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
const page = (data) => ({ data, meta: { current_page: 1, last_page: 1 } });
globalThis.fetch = async (url) => {
  let body;
  if (url === '/api/auth/login') body = { token: 'test-token', user: fixtureUser };
  else if (url === '/api/profile') body = { data: fixtureProfile };
  else if (url.startsWith('/api/activities?')) body = page(fixtureActivities);
  else if (url.startsWith('/api/predictions?')) body = page([]);
  else if (url === '/api/goals') body = { data: fixtureGoals };
  else throw new Error(`Unexpected test request: ${url}`);
  return new Response(JSON.stringify(body), { status: 200 });
};
globalThis.window = { location: { pathname: '/', search: '' }, addEventListener() {}, scrollTo() {} };

// Always render against explicit HTTP test fixtures, never a browser demo backend.
process.env.VITE_API_BASE_URL = '';

const { createServer } = await import('vite');
const { svelte } = await import('@sveltejs/vite-plugin-svelte');
const { render } = await import('svelte/server');

const vite = await createServer({
  root,
  configFile: false,
  envFile: false,
  logLevel: 'error',
  appType: 'custom',
  plugins: [svelte({ compilerOptions: { generate: 'server', dev: false } })],
  resolve: {
    alias: [
      // Leaflet and Chart.js touch `window` at import time; neither is needed for
      // template rendering, so swap them for inert stand-ins.
      { find: /^leaflet\/dist\/leaflet\.css$/, replacement: resolve(here, 'stubs/empty.css') },
      { find: /^leaflet$/, replacement: resolve(here, 'stubs/leaflet.js') },
      { find: /^chart\.js\/auto$/, replacement: resolve(here, 'stubs/chart.js') },
    ],
  },
  ssr: { noExternal: true },
  server: { middlewareMode: true, hmr: false },
});

let failures = 0;

try {
  const stores = await vite.ssrLoadModule('/src/stores/index.js');
  await stores.login({ email: fixtureUser.email, password: 'fixture-only' });
  stores.modelCard.set({ training_source: 'synthetic', version: 'test', corpus_rows: 10,
    metrics: { r2: 0.9, mape_pct: 10, mae_min: 2, interval_coverage_pct: 80, test_rows: 2 },
    feature_importance: {} });

  const routes = [
    ['/', 'Dashboard'],
    ['/plan', 'PlanActivity'],
    ['/activities', 'Activities'],
    ['/analytics', 'Analytics'],
    ['/fueling', 'Fueling'],
    ['/goals', 'Goals'],
    ['/profile', 'Profile'],
    ['/settings', 'Settings'],
    ['/nope', 'NotFound'],
  ];

  for (const [path, name] of routes) {
    const file = `/src/pages/${name}/${name}.svelte`;
    try {
      const mod = await vite.ssrLoadModule(file);
      const html = render(mod.default).body;
      if (['Profile', 'Settings'].includes(name)) {
        assert.match(html, /Use current location/);
        assert.match(html, /coordinates and IP/);
        assert.ok(html.indexOf('coordinates and IP') < html.indexOf('Use current location'));
      }
      if (name === 'Dashboard') assert.match(html, /Test City/);
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text.length) throw new Error('rendered no text');
      const suspicious = ['NaN', 'undefined', 'Infinity', '[object Object]'].filter((bad) => text.includes(bad));
      if (suspicious.length) throw new Error(`rendered suspicious tokens: ${suspicious.join(', ')}`);
      console.log(`✔ ${path.padEnd(12)} ${name.padEnd(11)} ${String(text.length).padStart(5)} chars`);
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
    console.log(`✔ /            App         ${String(html.length).padStart(5)} chars`);
  } catch (error) {
    failures += 1;
    console.error(`✘ App: ${error.message}`);
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
      if (name === 'Login') {
        assert.match(html, /type="password"/);
        assert.match(html, /aria-label="Show password"/);
        assert.match(html, /aria-controls="password"/);
      }
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
