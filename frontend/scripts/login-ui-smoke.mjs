/** Exercise signup verification, password login, and HttpOnly-cookie client behavior. */
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
const codeBundle = outputs.find((entry) => entry.type === 'chunk').code;
const window = new Window({ url: 'http://localhost/login' });
const { document } = window;
document.body.innerHTML = '<div id="app"></div>';
window.alert = () => {};
const requests = [];
const csrf = 'a'.repeat(64);
const user = { id: 1, name: 'Test Athlete', username: 'test_athlete', email: 'athlete@gmail.com', role: 'athlete' };
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(data),
});
window.fetch = async (url, options = {}) => {
  const path = String(url).split('?')[0];
  const body = options.body && JSON.parse(options.body);
  requests.push({ url: String(url), method: options.method || 'GET', body, headers: options.headers, credentials: options.credentials });
  if (path === '/api/auth/csrf') return response({ csrfToken: csrf });
  if (path === '/api/auth/register') return response({ email: 'athlete@gmail.com', expires_in: 300 }, 202);
  if (path === '/api/auth/email/verify') return response({ message: 'Account verified.', verified: true });
  if (path === '/api/auth/login') return response({ user, csrfToken: 'b'.repeat(64) });
  if (path === '/api/profile') return response({ data: { ...user, onboarded: true } });
  if (path === '/api/activities' || path === '/api/predictions') {
    return response({ data: [], meta: { current_page: 1, last_page: 1 } });
  }
  if (path === '/api/goals') return response({ data: {} });
  throw new Error(`Unexpected mocked API request: ${url}`);
};
window.eval(codeBundle);
const flush = () => window.flushLoginTest();
const waitFor = async (condition, description) => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    flush();
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${description}`);
};
const click = (element) => { assert.ok(element); element.click(); flush(); };
const setInput = (selector, value) => {
  const input = document.querySelector(selector);
  assert.ok(input, `missing input ${selector}`);
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  flush();
  return input;
};
const submit = (form) => {
  assert.ok(form);
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  flush();
};

try {
  flush();
  assert.match(document.body.textContent, /Welcome back/i);
  assert.match(document.body.textContent, /Create account/i);
  assert.ok(document.querySelector('#identifier'));
  assert.equal(document.querySelector('#login-password')?.maxLength, 72);

  click(document.querySelector('button[role="tab"][aria-selected="false"]'));
  assert.ok(document.querySelector('#full-name'));
  assert.ok(document.querySelector('#username'));
  assert.ok(document.querySelector('#signup-email'));

  setInput('#full-name', 'Test Athlete');
  setInput('#username', 'test_athlete');
  setInput('#signup-email', 'athlete@gmail.com');
  setInput('#signup-password', 'Strong-pass-123');
  setInput('#signup-confirm', 'Strong-pass-123');
  submit(document.querySelector('form'));
  await waitFor(() => document.querySelectorAll('.otp-row input').length === 6, 'the email verification screen');

  const verificationDigits = [...document.querySelectorAll('.otp-row input')];
  for (const [index, digit] of [...'135790'].entries()) {
    verificationDigits[index].value = digit;
    verificationDigits[index].dispatchEvent(new window.Event('input', { bubbles: true }));
    flush();
  }
  await waitFor(() => document.body.textContent.includes('Welcome back'), 'successful email verification');

  setInput('#identifier', 'test_athlete');
  setInput('#login-password', 'Strong-pass-123');
  submit(document.querySelector('form'));
  await waitFor(() => window.location.pathname === '/', 'the signed-in dashboard route');

  const registerRequest = requests.find((request) => request.url === '/api/auth/register');
  assert.deepEqual(registerRequest.body, {
    name: 'Test Athlete',
    username: 'test_athlete',
    email: 'athlete@gmail.com',
    password: 'Strong-pass-123',
    password_confirmation: 'Strong-pass-123',
  });
  assert.deepEqual(requests.find((request) => request.url === '/api/auth/email/verify').body, {
    email: 'athlete@gmail.com', code: '135790',
  });
  const loginRequest = requests.find((request) => request.url === '/api/auth/login');
  assert.deepEqual(loginRequest.body, { identifier: 'test_athlete', password: 'Strong-pass-123' });
  for (const request of requests.filter((item) => item.method !== 'GET')) {
    assert.equal(request.headers['X-CSRF-TOKEN'], csrf, `${request.url} should include a CSRF header`);
    assert.equal(request.credentials, 'include', `${request.url} should include same-site cookies`);
  }
  assert.equal(window.localStorage.getItem('trana.token'), null, 'Auth tokens must never be stored in localStorage.');
  assert.equal(requests.some((request) => JSON.stringify(request.body || {}).includes('google')), false);
  console.log('Gmail/password signup, OTP verification, login and cookie/CSRF UI checks passed');
} finally {
  await window.destroyLoginTest();
  await window.happyDOM.abort();
}
