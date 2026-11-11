/**
 * PlanActivity save flow — the button must reflect what the API actually did.
 *
 *   node scripts/plan-save-ui-smoke.mjs
 *
 * Two cases, both against the real component in a headless DOM:
 *   1. the API accepts the plan  → the button flips to "Saved", the confirmation
 *      banner appears and the plan shows up under "Saved plans";
 *   2. the API rejects it (503) → the failure stays on screen with the server's
 *      reason and the button offers a retry. A toast alone is not enough: it
 *      disappears after a few seconds and the save looks like it never worked.
 */
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const bundle = await build({
  root,
  configFile: false,
  envFile: false,
  logLevel: 'silent',
  plugins: [svelte()],
  resolve: {
    alias: [
      { find: /^leaflet\/dist\/leaflet\.css$/, replacement: resolve(here, 'stubs/empty.css') },
      { find: /^leaflet$/, replacement: resolve(here, 'stubs/leaflet.js') },
    ],
  },
  build: {
    write: false,
    minify: false,
    lib: { entry: resolve(here, 'stubs/plan-save-entry.js'), name: 'PlanTest', formats: ['iife'] },
  },
});
const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const code = outputs.find((entry) => entry.type === 'chunk').code;

const window = new Window({ url: 'http://localhost/plan' });
const { document } = window;
document.body.innerHTML = '<div id="app"></div>';

const durationModel = readFileSync(resolve(root, 'public/models/duration_model.json'), 'utf8');
const modelCard = readFileSync(resolve(root, 'public/models/model_card.json'), 'utf8');

const fixtureUser = { id: 1, name: 'Test Athlete', email: 'athlete@example.test' };
const fixtureProfile = {
  ...fixtureUser,
  weight_kg: 68, height_cm: 170, birth_year: 1995, sex: 'other',
  sweat_profile: 'normal', experience_level: 2, typical_temperature_c: 26, units: 'metric',
  city: 'Quezon City', onboarded: true, total_activities: 1,
  daily_calorie_goal: 2700, daily_distance_goal_km: 10, daily_active_min_goal: 90,
  weekly_calorie_goal: 15000, weekly_distance_goal_km: 45, daily_carb_goal_g: 360,
};
const fixtureActivities = [
  {
    id: 1, activity_type: 'run', distance_km: 3.8, duration_min: 30, calories: 320,
    elevation_gain_m: 20, started_at: new Date(Date.now() - 86400000).toISOString(),
    route: null, notes: null,
  },
];
const fixtureGoals = {
  daily_calories: 2700, daily_distance_km: 10, daily_active_min: 90,
  weekly_calories: 15000, weekly_distance_km: 45, carb_target_g: 360,
};

let savedPlans = [];
let saveFails = false;
const requests = [];
const apiResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});
const page = (data) => ({ data, meta: { current_page: 1, last_page: 1 } });

window.fetch = async (url, options = {}) => {
  const path = String(url).split('?')[0];
  requests.push({ path, method: options.method || 'GET', body: options.body });
  if (path === '/models/duration_model.json') return apiResponse(JSON.parse(durationModel));
  if (path === '/models/model_card.json') return apiResponse(JSON.parse(modelCard));
  if (path === '/api/profile') return apiResponse({ data: fixtureProfile });
  if (path === '/api/activities') return apiResponse(page(fixtureActivities));
  if (path === '/api/goals') return apiResponse({ data: fixtureGoals });
  if (path === '/api/predictions') {
    if ((options.method || 'GET') === 'POST') {
      if (saveFails) {
        // What the API answers when the prediction service is down.
        return apiResponse({
          message: 'The prediction service is unavailable, so this plan cannot be saved yet.',
          hint: 'A local preview may be available, but saving requires the prediction service.',
        }, 503);
      }
      const payload = JSON.parse(options.body);
      const created = {
        id: 7,
        activity_type: payload.activity_type,
        distance_km: payload.distance_km,
        elevation_gain_m: payload.elevation_gain_m,
        route: payload.route,
        planned_for: payload.planned_for,
        status: 'planned',
        duration: { minutes: 34, hours: 0.57, low: 31, high: 39, paceMinPerKm: 18.1, speedKmh: 3.3 },
        fueling: {
          intensity: 'light', met: 4.48,
          calories: { total: 154, perHour: 269 },
          carbs: { totalG: 0, perHourG: 0, dailyTargetG: 360 },
          sodium: { perHourMg: 220, totalMg: 220 },
          fluid: { perHourMl: 283, totalMl: 283 },
          timeline: [],
          notes: [],
        },
        history_used: 1,
        profile: { weight_kg: 68 },
        model: { version: 'test' },
        created_at: new Date().toISOString(),
      };
      savedPlans = [created, ...savedPlans];
      return apiResponse({ data: created }, 201);
    }
    return apiResponse(page(savedPlans));
  }
  if (path === '/api/notifications') return apiResponse({ data: [], meta: { unread: 0 } });
  throw new Error(`Unexpected mocked API request: ${url}`);
};

window.eval(code);
const flush = () => window.flushPlanTest();
const waitFor = async (condition, label = 'condition') => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    flush();
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
};
const settle = async () => {
  await new Promise((r) => setTimeout(r, 400));
  flush();
};
const buttonText = () => {
  const button = [...document.querySelectorAll('button')].find((b) => /Save this plan|Saved|Saving|Try saving again/.test(b.textContent));
  return button ? button.textContent.trim() : null;
};
const clickSave = () => {
  const button = [...document.querySelectorAll('button')].find((b) => /Save this plan|Try saving again/.test(b.textContent));
  assert.ok(button, 'the save button is missing');
  button.click();
};

try {
  window.seedPlanTest({
    profile: fixtureProfile,
    activities: fixtureActivities,
    goals: fixtureGoals,
    plans: [],
  });
  window.mountPlanTest();
  flush();

  // --- case 1: the API accepts the plan -------------------------------
  await waitFor(() => /Predicted duration/.test(document.body.textContent), 'the on-device preview');
  assert.equal(buttonText(), 'Save this plan');

  clickSave();
  await waitFor(() => /Saved/.test(buttonText() || ''), 'the saved state');
  await settle();

  assert.equal(buttonText(), 'Saved', 'the button must stay in the saved state');
  assert.match(document.body.textContent, /Plan #7 saved/, 'the confirmation banner is missing');
  assert.match(document.body.textContent, /Saved plans/, 'the saved plan is not listed');
  assert.equal(requests.filter((r) => r.path === '/api/predictions' && r.method === 'POST').length, 1);

  // --- case 2: the API rejects the plan -------------------------------
  await window.destroyPlanTest();
  savedPlans = [];
  saveFails = true;
  window.seedPlanTest({
    profile: fixtureProfile,
    activities: fixtureActivities,
    goals: fixtureGoals,
    plans: [],
  });
  window.mountPlanTest();
  flush();

  await waitFor(() => /Predicted duration/.test(document.body.textContent), 'the on-device preview');
  clickSave();
  await waitFor(() => /Try saving again/.test(buttonText() || ''), 'the retry state');
  await settle();

  assert.equal(buttonText(), 'Try saving again', 'the button must offer a retry after a failed save');
  assert.match(
    document.body.textContent,
    /The prediction service is unavailable, so this plan cannot be saved yet\./,
    'the server reason must stay on screen',
  );
  assert.doesNotMatch(document.body.textContent, /Plan #\d+ saved/, 'a failed save must not claim success');
  assert.doesNotMatch(document.body.textContent, /Saved plans/, 'a failed save must not list a plan');

  console.log('PlanActivity save flow checks passed (saved state + visible failure)');
} finally {
  await window.destroyPlanTest();
  await window.happyDOM.abort();
}
