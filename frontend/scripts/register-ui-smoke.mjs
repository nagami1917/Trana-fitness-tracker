/** Exercise passwordless Gmail registration and code confirmation with a mocked API. */
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
    lib: { entry: resolve(root, 'scripts/stubs/register-ui-entry.js'), name: 'RegisterTest', formats: ['iife'] },
  },
});
const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const codeBundle = outputs.find((entry) => entry.type === 'chunk').code;
const window = new Window({ url: 'http://localhost/register' });
const { document } = window;
document.body.innerHTML = '<div id="app"></div>';
const requests = [];
let rejectOtp = true;
const user = { id: 7, name: 'Test Athlete', email: 'athlete@gmail.com', email_verified_at: '2026-11-10T00:00:00Z' };
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(data),
});
window.fetch = async (url, options = {}) => {
  const path = String(url).split('?')[0];
  requests.push({ url: String(url), method: options.method, body: options.body && JSON.parse(options.body) });
  if (path === '/api/auth/register') return response({ message: 'A six-digit code was sent to your email.' }, 202);
  if (path === '/api/auth/otp/verify') return rejectOtp
    ? response({ message: 'That code is invalid or expired. Request a fresh one and try again.' }, 422)
    : response({ token: 'register-fixture-token', user });
  if (path === '/api/profile') return response({ data: { ...user, onboarded: false } });
  if (path === '/api/activities' || path === '/api/predictions') {
    return response({ data: [], meta: { current_page: 1, last_page: 1 } });
  }
  if (path === '/api/goals') return response({ data: {} });
  throw new Error(`Unexpected mocked API request: ${url}`);
};
window.eval(codeBundle);
const flush = () => window.flushRegisterTest();
const waitFor = async (condition) => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    flush();
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for the registration OTP flow');
};
const fill = (element, value) => {
  assert.ok(element, 'Expected a form field to exist');
  element.value = value;
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
  flush();
};
const click = (element) => { assert.ok(element); element.click(); flush(); };

try {
  flush();
  assert.equal(document.querySelector('#password'), null, 'Registration must not ask for a TRANA or Gmail password.');
  assert.match(document.body.textContent, /No password to create/);
  assert.match(document.body.textContent, /never asks for your Google password/i);

  fill(document.querySelector('#name'), 'Test Athlete');
  fill(document.querySelector('#email'), 'athlete@example.com');
  click(document.querySelector('button[type="submit"]'));
  await waitFor(() => document.body.textContent.includes('Sign-up is limited to Gmail addresses'));
  assert.equal(requests.length, 0, 'Invalid domains must be stopped before an API request.');

  fill(document.querySelector('#email'), user.email);
  click(document.querySelector('button[type="submit"]'));
  await waitFor(() => document.querySelector('#otp-code'));
  const registrationRequests = requests.filter((request) => request.url === '/api/auth/register');
  assert.equal(registrationRequests.length, 1);
  assert.equal(registrationRequests[0].method, 'POST');
  assert.deepEqual(registrationRequests[0].body, { name: 'Test Athlete', email: user.email });
  assert.equal(window.localStorage.getItem('trana.token'), null, 'A token must wait for code verification.');

  const otpInput = document.querySelector('#otp-code');
  assert.equal(otpInput.type, 'text');
  assert.equal(otpInput.autocomplete, 'one-time-code');
  assert.equal(otpInput.maxLength, 6);
  fill(otpInput, '004281');
  click(document.querySelector('form button[type="submit"]'));
  await waitFor(() => document.body.textContent.includes('That code is invalid or expired'));
  assert.equal(window.localStorage.getItem('trana.token'), null);

  rejectOtp = false;
  click(document.querySelector('form button[type="submit"]'));
  await waitFor(() => window.location.pathname === '/');
  const verifyRequests = requests.filter((request) => request.url === '/api/auth/otp/verify');
  assert.equal(verifyRequests.length, 2);
  for (const request of verifyRequests) {
    assert.deepEqual(request.body, { email: user.email, code: '004281' });
  }
  assert.equal(window.localStorage.getItem('trana.token'), 'register-fixture-token');
  console.log('Gmail-only passwordless registration, OTP retry and verified-session checks passed');
} finally {
  await window.destroyRegisterTest();
  await window.happyDOM.abort();
}
