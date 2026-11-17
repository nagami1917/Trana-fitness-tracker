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
const cssBundle = outputs
  .filter((entry) => entry.type === 'asset' && entry.fileName.endsWith('.css'))
  .map((entry) => String(entry.source))
  .join('\n');
const window = new Window({ url: 'http://localhost/login?google=account_not_found' });
const { document } = window;
window.innerWidth = 360;
window.innerHeight = 640;
document.head.innerHTML = `<style>${cssBundle}</style>`;
document.body.innerHTML = '<div id="app"></div>';
window.alert = () => {};
const requests = [];
const csrf = 'a'.repeat(64);
const user = { id: 1, name: 'Test Athlete', username: 'test_athlete', email: 'athlete@gmail.com', role: 'athlete' };
let accountVerified = false;
let mailerBroken = false;
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
  if (path === '/api/auth/email/verify') {
    accountVerified = true;
    return response({ message: 'Account verified.', verified: true });
  }
  if (path === '/api/auth/login') {
    if (!accountVerified) {
      return response({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your Gmail address before logging in.',
        email: user.email,
        // The API reports expires_in: 0 when the verification email could not
        // be delivered at all (no working mail transport).
        expires_in: mailerBroken ? 0 : 300,
        resend_after: 0,
      }, 403);
    }
    if (body.password !== 'Strong-pass-123') return response({ message: 'Invalid credentials.' }, 401);
    return response({ user, csrfToken: 'b'.repeat(64) });
  }
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
  assert.equal(window.innerWidth, 360, 'Auth smoke test should run at a narrow mobile viewport width.');
  assert.match(cssBundle, /min-height:100dvh/, 'Login page should use the dynamic mobile viewport height when supported.');
  assert.match(cssBundle, /\.password-wrap[^}]*min-width:44px;min-height:44px/, 'Password visibility control should have a mobile-friendly tap target.');
  assert.match(cssBundle, /@media\(max-width:520px\)[\s\S]*?\.forgot[^}]*min-height:44px/, 'Forgot-password action should have a mobile-friendly tap target.');
  assert.match(document.body.textContent, /Welcome back/i);
  assert.match(document.body.textContent, /Create account/i);
  assert.match(document.body.textContent, /No TRANA account is linked to that Google address/);
  assert.equal(window.location.search, '', 'Google callback status should be removed from the address bar.');
  assert.equal(document.querySelector('.google-button')?.getAttribute('href'), '/api/auth/google/redirect?intent=login');
  assert.equal(document.querySelector('.google-button')?.textContent.trim(), 'Log in with Google');
  assert.ok(document.querySelector('#identifier'));
  assert.equal(document.querySelector('#login-password')?.maxLength, 72);

  click(document.querySelector('button[role="tab"][aria-selected="false"]'));
  assert.equal(document.querySelector('.google-button')?.textContent.trim(), 'Sign in with Google');
  assert.equal(document.querySelector('.google-button')?.getAttribute('href'), '/api/auth/google/redirect?intent=signup');
  assert.ok(document.querySelector('#full-name'));
  assert.ok(document.querySelector('#username'));
  assert.equal(document.querySelector('#username')?.hasAttribute('pattern'), false, 'Username should not be blocked by native pattern validation.');
  assert.ok(document.querySelector('#signup-email'));

  setInput('#full-name', 'Test Athlete');
  setInput('#username', 'test_athlete');
  setInput('#signup-email', 'athlete@gmail.com');
  setInput('#signup-password', 'Strong-pass-123');
  setInput('#signup-confirm', 'Strong-pass-123');
  submit(document.querySelector('form'));
  await waitFor(() => document.querySelectorAll('.otp-row input').length === 6, 'the email verification screen');

  const backToLogin = [...document.querySelectorAll('.resend-row button')]
    .find((button) => button.textContent.includes('Back to log in'));
  click(backToLogin);
  assert.equal(document.querySelector('.google-button')?.textContent.trim(), 'Log in with Google');
  assert.equal(document.querySelector('.google-button')?.getAttribute('href'), '/api/auth/google/redirect?intent=login');
  /* ---- mailer down: never strand the user on a code screen ---- */
  // expires_in: 0 means the API could not deliver the code at all. Advancing
  // to a code screen would be a dead end, so the login screen must say so and
  // point at Google, which verifies the address without sending any mail.
  mailerBroken = true;
  setInput('#identifier', 'athlete@gmail.com');
  setInput('#login-password', 'Strong-pass-123');
  submit(document.querySelector('form'));
  await waitFor(
    () => /could not email a verification code/i.test(document.body.textContent),
    'mailer-down guidance on the login screen',
  );
  assert.equal(
    document.querySelectorAll('.otp-row input').length, 0,
    'a code screen must never be shown when the code could not be sent',
  );
  assert.match(document.body.textContent, /Log in with Google/);
  assert.ok(document.querySelector('.google-button'), 'Google must stay reachable');
  mailerBroken = false;

  // Still signed out and still unverified: drive the "code was sent" path from
  // a fresh page load so this scenario reuses exactly one login request.
  window.location.href = 'http://localhost/login';
  await window.flushLoginTest();
  await waitFor(() => document.querySelector('#identifier'), 'login form after reload');
  setInput('#identifier', 'athlete@gmail.com');
  setInput('#login-password', 'Strong-pass-123');
  submit(document.querySelector('form'));
  await waitFor(() => document.querySelectorAll('.otp-row input').length === 6, 'unverified-login email verification screen');
  assert.match(document.body.textContent, /Please verify your Gmail address before logging in\./);
  // The dead-end screen must still offer the Google route, because that is the
  // only way to verify an address when TRANA's mailer cannot deliver.
  const verifyGoogle = document.querySelector('.verify-google .google-button');
  assert.ok(verifyGoogle, 'the verification screen must offer a Google alternative');
  assert.match(verifyGoogle.textContent, /Verify with Google instead/);
  assert.equal(verifyGoogle.getAttribute('href'), '/api/auth/google/redirect?intent=login');

  const verificationDigits = [...document.querySelectorAll('.otp-row input')];
  for (const [index, digit] of [...'135790'].entries()) {
    verificationDigits[index].value = digit;
    verificationDigits[index].dispatchEvent(new window.Event('input', { bubbles: true }));
    flush();
  }
  await waitFor(() => document.body.textContent.includes('Welcome back'), 'successful email verification');

  setInput('#identifier', 'athlete@gmail.com');
  setInput('#login-password', 'Wrong-pass-123');
  submit(document.querySelector('form'));
  await waitFor(() => document.querySelector('[role="alert"]')?.textContent.includes('Invalid credentials.'), 'generic invalid-login feedback');

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
  const loginRequests = requests.filter((request) => request.url === '/api/auth/login');
  // 1: unverified with a dead mailer, 2: unverified with a working one,
  // 3: wrong password, 4: successful login.
  assert.deepEqual(loginRequests.map((request) => request.body), [
    { identifier: 'athlete@gmail.com', password: 'Strong-pass-123' },
    { identifier: 'athlete@gmail.com', password: 'Strong-pass-123' },
    { identifier: 'athlete@gmail.com', password: 'Wrong-pass-123' },
    { identifier: 'athlete@gmail.com', password: 'Strong-pass-123' },
  ]);
  for (const request of requests.filter((item) => item.method !== 'GET')) {
    assert.equal(request.headers['X-CSRF-TOKEN'], csrf, `${request.url} should include a CSRF header`);
    assert.equal(request.credentials, 'include', `${request.url} should include same-site cookies`);
  }
  assert.equal(window.localStorage.getItem('trana.token'), null, 'Auth tokens must never be stored in localStorage.');
  assert.equal(requests.some((request) => JSON.stringify(request.body || {}).includes('google')), false);
  console.log('Mobile auth sizing, mode-specific Google labels, signup, OTP verification, login and cookie/CSRF UI checks passed');
} finally {
  await window.destroyLoginTest();
  await window.happyDOM.abort();
}
