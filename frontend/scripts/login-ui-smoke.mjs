/** Exercise passwordless email-code sign-in with a mocked API boundary. */
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
const requests = [];
let rejectOtp = true;
const user = { id: 1, name: 'Test Athlete', email: 'athlete@gmail.com', email_verified_at: '2026-11-10T00:00:00Z' };
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(data),
});
window.fetch = async (url, options = {}) => {
  const path = String(url).split('?')[0];
  requests.push({ url: String(url), method: options.method, body: options.body && JSON.parse(options.body) });
  if (path === '/api/auth/login') return response({ message: 'If that email has a TRANA account, a six-digit sign-in code is on its way.' }, 202);
  if (path === '/api/auth/otp/verify') return rejectOtp
    ? response({ message: 'That code is invalid or expired. Request a fresh one and try again.' }, 422)
    : response({ token: 'fixture-token', user });
  if (path === '/api/profile') return response({ data: { ...user, onboarded: true } });
  if (path === '/api/activities' || path === '/api/predictions') {
    return response({ data: [], meta: { current_page: 1, last_page: 1 } });
  }
  if (path === '/api/goals') return response({ data: {} });
  throw new Error(`Unexpected mocked API request: ${url}`);
};
window.eval(codeBundle);
const flush = () => window.flushLoginTest();
const waitFor = async (condition) => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    flush();
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for the email-code sign-in flow');
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
  assert.equal(document.querySelector('#password'), null, 'The passwordless sign-in form must not ask for a password.');
  assert.match(document.body.textContent, /No password needed/);
  assert.match(document.body.textContent, /never asks for your Google password/i);

  fill(document.querySelector('#email'), user.email);
  click(document.querySelector('button[type="submit"]'));
  await waitFor(() => document.querySelector('#otp-code'));

  const loginRequests = requests.filter((request) => request.url === '/api/auth/login');
  assert.equal(loginRequests.length, 1);
  assert.equal(loginRequests[0].method, 'POST');
  assert.deepEqual(loginRequests[0].body, { email: user.email });
  assert.equal(window.localStorage.getItem('trana.token'), null, 'No session is created until the OTP is verified.');

  const otpInput = document.querySelector('#otp-code');
  assert.equal(otpInput.type, 'text', 'OTP must remain text so leading zeroes are preserved.');
  assert.equal(otpInput.inputMode, 'numeric');
  assert.equal(otpInput.autocomplete, 'one-time-code');
  assert.equal(otpInput.maxLength, 6);
  assert.equal(otpInput.pattern, '[0-9][0-9][0-9][0-9][0-9][0-9]');
  fill(otpInput, '012345');

  click(document.querySelector('form button[type="submit"]'));
  await waitFor(() => document.body.textContent.includes('That code is invalid or expired'));
  assert.equal(window.localStorage.getItem('trana.token'), null);
  assert.equal(otpInput.value, '012345', 'A rejected code stays available for correction.');

  rejectOtp = false;
  click(document.querySelector('form button[type="submit"]'));
  await waitFor(() => window.location.pathname === '/');

  const otpRequests = requests.filter((request) => request.url === '/api/auth/otp/verify');
  assert.equal(otpRequests.length, 2);
  for (const request of otpRequests) {
    assert.equal(request.method, 'POST');
    assert.deepEqual(request.body, { email: user.email, code: '012345' });
  }
  assert.equal(window.localStorage.getItem('trana.token'), 'fixture-token');
  assert.equal(requests.some((request) => JSON.stringify(request.body || {}).includes('password')), false);
  console.log('Passwordless OTP sign-in, leading-zero input, retry and session checks passed');
} finally {
  await window.destroyLoginTest();
  await window.happyDOM.abort();
}
