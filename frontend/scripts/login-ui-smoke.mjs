/** Exercise password visibility and sign-in with a mocked API, without real credentials. */
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
    lib: { entry: resolve(root, 'scripts/stubs/login-ui-entry.js'), name: 'LoginTest', formats: ['iife'] },
  },
});
const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const code = outputs.find((entry) => entry.type === 'chunk').code;
const window = new Window({ url: 'http://localhost/login' });
const { document } = window;
document.body.innerHTML = '<div id="app"></div>';
const requests = [];
let rejectLogin = true;
const user = { id: 1, name: 'Test Athlete', email: 'athlete@example.test' };
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(data),
});
window.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), method: options.method, body: options.body && JSON.parse(options.body) });
  const path = String(url).split('?')[0];
  if (path === '/api/auth/login') return rejectLogin
    ? response({ message: 'Invalid credentials' }, 401)
    : response({ token: 'fixture-token', user });
  if (path === '/api/profile') return response({ data: { ...user, onboarded: true } });
  if (path === '/api/activities' || path === '/api/predictions') {
    return response({ data: [], meta: { current_page: 1, last_page: 1 } });
  }
  if (path === '/api/goals') return response({ data: {} });
  throw new Error(`Unexpected mocked API request: ${url}`);
};
window.eval(code);
const flush = () => window.flushLoginTest();
const input = document.querySelector('#password');
const toggle = () => document.querySelector('[aria-controls="password"]');
const waitFor = async (condition) => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    flush();
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for the login form');
};
const fill = (element, value) => {
  element.value = value;
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
  flush();
};
const click = (element) => { assert.ok(element); element.click(); flush(); };

try {
  flush();
  assert.equal(input.type, 'password');
  assert.equal(input.autocomplete, 'current-password');
  assert.equal(toggle().type, 'button');
  assert.equal(toggle().getAttribute('aria-label'), 'Show password');
  assert.match(toggle().textContent, /Show/);
  fill(document.querySelector('#email'), user.email);
  fill(input, 'FixturePassword1');

  // Toggling keeps the entered value and never submits the form.
  const control = toggle();
  control.focus();
  click(control);
  assert.equal(document.activeElement, control);
  assert.equal(input.type, 'text');
  assert.equal(input.value, 'FixturePassword1');
  assert.equal(toggle().getAttribute('aria-label'), 'Hide password');
  assert.match(toggle().textContent, /Hide/);
  assert.equal(requests.length, 0);
  click(toggle());
  assert.equal(input.type, 'password');
  assert.equal(input.value, 'FixturePassword1');
  assert.equal(toggle().getAttribute('aria-label'), 'Show password');
  assert.equal(requests.length, 0);

  // Failed sign-in leaves the password and toggle usable for correction.
  click(toggle());
  click(document.querySelector('button[type="submit"]'));
  await waitFor(() => document.body.textContent.includes('Invalid credentials'));
  assert.equal(input.type, 'text');
  assert.equal(input.value, 'FixturePassword1');
  click(toggle());
  assert.equal(input.type, 'password');

  // A successful submission sends exactly the entered value regardless of visibility.
  rejectLogin = false;
  click(document.querySelector('button[type="submit"]'));
  await waitFor(() => window.location.pathname === '/');
  const loginRequests = requests.filter((request) => request.url === '/api/auth/login');
  assert.equal(loginRequests.length, 2);
  for (const request of loginRequests) {
    assert.equal(request.method, 'POST');
    assert.deepEqual(request.body, { email: user.email, password: 'FixturePassword1' });
  }
  assert.equal(window.localStorage.getItem('trana.token'), 'fixture-token');
  console.log('Login password visibility, accessibility and mocked sign-in checks passed');
} finally {
  await window.destroyLoginTest();
  await window.happyDOM.abort();
}
