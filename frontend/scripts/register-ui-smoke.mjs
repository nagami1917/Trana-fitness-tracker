/** Exercise Google-only registration/sign-in with mocked Identity Services and API. */
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
  define: { 'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify('test-google-client-id') },
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
const googleInitializations = [];
let nonceCount = 0;
let rejectCredential = true;
const user = { id: 7, name: 'Test Athlete', email: 'athlete@club.example.org', email_verified_at: '2026-11-10T00:00:00Z' };
const response = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(data),
});
window.google = {
  accounts: {
    id: {
      initialize: (options) => googleInitializations.push(options),
      renderButton: (element, options) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.googleButton = 'true';
        button.textContent = options.text === 'signup_with' ? 'Sign up with Google' : options.text;
        button.addEventListener('click', () => {
          googleInitializations.at(-1).callback({ credential: 'google-id-token-fixture' });
        });
        element.appendChild(button);
      },
    },
  },
};
window.fetch = async (url, options = {}) => {
  const path = String(url).split('?')[0];
  const body = options.body && JSON.parse(options.body);
  requests.push({ url: String(url), method: options.method, body });
  if (path === '/api/auth/google/nonce') return response({ nonce: `register-test-nonce-${++nonceCount}` });
  if (path === '/api/auth/google') {
    return rejectCredential
      ? response({
        message: 'Google sign-in could not be verified. Please try again.',
        errors: { credential: ['Google sign-in could not be verified. Please try again.'] },
      }, 422)
      : response({ token: 'google-register-token', user });
  }
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
  throw new Error('Timed out waiting for the Google account creation flow');
};
const click = (element) => { assert.ok(element); element.click(); flush(); };

try {
  flush();
  assert.equal(document.querySelector('#password'), null, 'Registration must not ask for a TRANA or Google password.');
  assert.equal(document.querySelector('#email'), null, 'Registration must not collect an email outside the Google prompt.');
  assert.equal(document.querySelector('#otp-code'), null, 'Registration must not request an emailed code.');
  assert.match(document.body.textContent, /Create your account with Google/i);
  assert.match(document.body.textContent, /no TRANA password/i);
  assert.match(document.body.textContent, /never asks for or stores it/i);

  await waitFor(() => document.querySelector('[data-google-button]'));
  assert.equal(googleInitializations[0].client_id, 'test-google-client-id');
  assert.equal(googleInitializations[0].nonce, 'register-test-nonce-1');
  click(document.querySelector('[data-google-button]'));
  await waitFor(() => document.body.textContent.includes('Google sign-in could not be verified'));
  assert.equal(window.localStorage.getItem('trana.token'), null);
  await waitFor(() => document.querySelector('[data-google-button]') && nonceCount === 2);

  rejectCredential = false;
  click(document.querySelector('[data-google-button]'));
  await waitFor(() => window.location.pathname === '/onboarding');
  const googleRequests = requests.filter((request) => request.url === '/api/auth/google');
  assert.equal(googleRequests.length, 2);
  for (const request of googleRequests) {
    assert.equal(request.method, 'POST');
    assert.deepEqual(request.body, { credential: 'google-id-token-fixture' });
  }
  assert.equal(window.localStorage.getItem('trana.token'), 'google-register-token');
  assert.equal(requests.filter((request) => request.url === '/api/auth/google/nonce').length, 2);
  assert.equal(requests.some((request) => JSON.stringify(request.body || {}).includes('password')), false);
  console.log('Google-only account creation, workspace email, nonce retry and session checks passed');
} finally {
  await window.destroyRegisterTest();
  await window.happyDOM.abort();
}
