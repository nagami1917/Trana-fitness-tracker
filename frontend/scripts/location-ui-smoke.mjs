/** Exercise the real Svelte input in a DOM, with device and network requests mocked. */
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
  build: {
    write: false,
    minify: false,
    lib: { entry: resolve(root, 'scripts/stubs/location-ui-entry.js'), name: 'LocationTest', formats: ['iife'] },
  },
});
const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const code = outputs.find((entry) => entry.type === 'chunk').code;
const window = new Window({ url: 'http://localhost/' });
const { document } = window;
document.body.innerHTML = '<div id="app"></div>';
window.locationTestSaves = [];
let deviceCalls = 0;
let fetchCalls = 0;
let positionSuccess;
let positionError;
let finishLookup;
let lookupSignal;
let savedProfile = {
  id: 1, name: 'Test Athlete', email: 'athlete@example.test', city: 'Original City',
  weight_kg: 72, height_cm: null, birth_year: null, sex: 'other',
  sweat_profile: 'normal', experience_level: 3, typical_temperature_c: 24, units: 'metric',
  daily_calorie_goal: 2450, daily_distance_goal_km: 12, daily_active_min_goal: 80,
  weekly_calorie_goal: 13000, weekly_distance_goal_km: 45, daily_carb_goal_g: 370,
  onboarded: true, total_activities: 0,
};
const patches = [];
const csrfToken = 'c'.repeat(64);
const apiResponse = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
Object.defineProperty(window.navigator, 'geolocation', {
  value: { getCurrentPosition(success, error) { deviceCalls++; positionSuccess = success; positionError = error; } },
});
window.fetch = (url, options = {}) => {
  if (String(url).startsWith('/api/')) {
    const path = String(url).split('?')[0];
    if (path === '/api/auth/csrf') return Promise.resolve(apiResponse({ csrfToken }));
    if (path === '/api/profile') {
      if (options.method === 'PUT') {
        assert.equal(options.headers['X-CSRF-TOKEN'], csrfToken);
        const patch = JSON.parse(options.body);
        assert.ok(!('latitude' in patch) && !('longitude' in patch));
        patches.push(patch);
        savedProfile = { ...savedProfile, ...patch };
      }
      return Promise.resolve(apiResponse({ data: savedProfile }));
    }
    if (path === '/api/activities' || path === '/api/predictions') {
      return Promise.resolve(apiResponse({ data: [], meta: { current_page: 1, last_page: 1 } }));
    }
    if (path === '/api/goals') return Promise.resolve(apiResponse({ data: {} }));
    throw new Error(`Unexpected mocked API request: ${url}`);
  }
  assert.ok(String(url).startsWith('https://api.bigdatacloud.net/'));
  fetchCalls++;
  lookupSignal = options.signal;
  return new Promise((resolve) => { finishLookup = resolve; });
};
window.eval(code);
const city = () => document.querySelector('#test-city');
const status = () => document.querySelector('#test-city-status').textContent;
const save = () => document.querySelector('#save');
const button = (text) => [...document.querySelectorAll('button')].find((item) => item.textContent.includes(text));
const flush = () => window.flushLocationTest();
const waitFor = async (condition) => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    flush();
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for the location control');
};
const click = (element) => { assert.ok(element); element.click(); flush(); };
const position = () => ({ coords: { latitude: 12.34, longitude: 56.78 } });
const response = (result) => ({ ok: true, json: async () => result });

try {
  flush();
  assert.equal(city().value, 'Original City');
  assert.equal(deviceCalls, 0, 'Mounting must not request a location');
  assert.equal(fetchCalls, 0);
  assert.match(document.querySelector('#test-city-notice').textContent, /coordinates and IP/);

  // Editing while device permission is pending cancels it before any network request.
  const locationButton = button('Use current location');
  locationButton.focus();
  click(locationButton);
  assert.equal(document.activeElement, locationButton, 'Starting detection keeps keyboard focus');
  assert.equal(save().disabled, true);
  city().value = 'Manual City';
  city().dispatchEvent(new window.Event('input', { bubbles: true }));
  flush();
  assert.equal(save().disabled, false);
  assert.match(status(), /cancelled/);
  positionSuccess(position());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetchCalls, 0);
  assert.equal(city().value, 'Manual City');

  // Explicit cancellation aborts a pending lookup and ignores a late response.
  click(button('Use current location'));
  positionSuccess(position());
  await waitFor(() => fetchCalls === 1);
  assert.equal(save().disabled, true);
  const cancelButton = button('Cancel detection');
  cancelButton.focus();
  click(cancelButton);
  assert.equal(document.activeElement, cancelButton, 'Cancelling keeps keyboard focus');
  assert.equal(lookupSignal.aborted, true);
  assert.equal(save().disabled, false);
  finishLookup(response({ city: 'Stale City', principalSubdivision: 'Stale Region' }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  flush();
  assert.equal(city().value, 'Manual City');

  // A successful lookup updates the parent's editable value, but does not save.
  click(button('Use current location'));
  positionSuccess(position());
  await waitFor(() => fetchCalls === 2);
  finishLookup(response({ city: 'Test City', principalSubdivision: 'Test Region', lookupSource: 'reverseGeocoding' }));
  await waitFor(() => city().value === 'Test City, Test Region');
  assert.equal(document.querySelector('#bound-city').textContent, 'Test City, Test Region');
  assert.deepEqual(window.locationTestSaves, []);
  click(save());
  assert.deepEqual(window.locationTestSaves, ['Test City, Test Region']);

  // Denial keeps the value and does not call the provider.
  click(button('Use current location'));
  positionError({ code: 1 });
  await waitFor(() => status().includes('permission was denied'));
  assert.equal(city().value, 'Test City, Test Region');
  assert.equal(fetchCalls, 2);
  assert.equal(save().disabled, false);

  // Destroying the component ignores a late geolocation callback.
  click(button('Use current location'));
  await window.destroyLocationTest();
  positionSuccess(position());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetchCalls, 2);

  // Exercise the actual save flows with a fake API. Nullable profile fields must
  // stay null when only the location is changed.
  const mountPage = async (name) => {
    await window.mountLocationTestPage(name, savedProfile);
    flush();
  };
  const detectForPage = async (selector, expected) => {
    const previousCalls = fetchCalls;
    click(button('Use current location'));
    positionSuccess(position());
    await waitFor(() => fetchCalls === previousCalls + 1);
    finishLookup(response({ city: expected, principalSubdivision: 'Test Region', lookupSource: 'reverseGeocoding' }));
    await waitFor(() => document.querySelector(selector)?.value === `${expected}, Test Region`);
  };
  const assertPreserved = () => {
    assert.equal(savedProfile.weight_kg, 72);
    assert.equal(savedProfile.height_cm, null);
    assert.equal(savedProfile.birth_year, null);
  };

  await mountPage('Profile');
  await waitFor(() => document.querySelector('#profile-city')?.value === 'Original City');
  await detectForPage('#profile-city', 'Profile City');
  assert.equal(patches.length, 0, 'Detection alone must not write the profile');
  click(button('Save profile'));
  assert.equal(button('Use current location').disabled, true, 'Do not start detection during a profile save');
  await waitFor(() => patches.length === 1 && button('Save profile')?.disabled === false);
  assert.equal(savedProfile.city, 'Profile City, Test Region');
  assertPreserved();

  await mountPage('Settings');
  await waitFor(() => document.querySelector('#settings-city')?.value === 'Profile City, Test Region');
  await detectForPage('#settings-city', 'Settings City');
  assert.equal(patches.length, 1);
  click(button('Save changes'));
  assert.equal(button('Use current location').disabled, true, 'Do not start detection during a settings save');
  await waitFor(() => patches.length === 2 && button('Save changes')?.disabled === false);
  assert.equal(savedProfile.city, 'Settings City, Test Region');
  assertPreserved();

  savedProfile = { ...savedProfile, city: '', onboarded: false };
  await mountPage('Onboarding');
  await waitFor(() => !!document.querySelector('#onboarding-city'));
  const callsBeforeCancel = fetchCalls;
  click(button('Use current location'));
  positionSuccess(position());
  await waitFor(() => !!button('Cancel detection'));
  assert.equal(button('Continue').disabled, true);
  assert.equal(button('Skip for now').disabled, true);
  await waitFor(() => fetchCalls === callsBeforeCancel + 1);
  click(button('Cancel detection'));
  assert.equal(button('Continue').disabled, false);
  finishLookup(response({ city: 'Stale City' }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await detectForPage('#onboarding-city', 'Onboarding City');
  assert.equal(patches.length, 2);
  click(button('Continue'));
  click(button('Continue'));
  click(button('Start planning'));
  await waitFor(() => patches.length === 3 && window.location.pathname === '/plan');
  assert.equal(savedProfile.city, 'Onboarding City, Test Region');
  assert.equal(savedProfile.onboarded, true);
  assertPreserved();
  await window.destroyLocationTest();
  console.log('Location input, cancellation and onboarding/profile/settings save-flow checks passed');
} finally {
  await window.happyDOM.abort();
}
