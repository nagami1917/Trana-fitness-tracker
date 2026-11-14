/** Exercise the Laravel facade, HttpOnly-cookie session model, CSRF header, and outage handling. */
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { get } from 'svelte/store';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};
const calls = [];
let replies = [];
const reply = (path, status, data) => ({ path, status, data });
const page = (rows, current = 1, last = 1) => ({ data: rows, meta: { current_page: current, last_page: last } });
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url, ...init });
  if (url === '/models/model_card.json') return new Response('{}');
  const next = replies.shift();
  assert.ok(next, `unexpected request: ${url}`);
  assert.equal(url, next.path);
  if (next.error) throw new Error(next.error);
  return new Response(typeof next.data === 'string' ? next.data : JSON.stringify(next.data), { status: next.status });
};

process.env.VITE_API_BASE_URL = '';
const vite = await createServer({
  root,
  configFile: false,
  envFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false },
});
try {
  const { api, onUnauthorized } = await vite.ssrLoadModule('/src/services/client.js');
  assert.equal(api.mode, 'live');
  replies = [reply('/api/health', 200, { status: 'ok' })];
  await api.health();
  replies = [reply('/api/auth/me', 401, { message: 'Unauthenticated.' })];
  assert.equal(await api.auth.user(), null);

  const csrf = 'c'.repeat(64);
  replies = [
    reply('/api/auth/csrf', 200, { csrfToken: csrf }),
    reply('/api/auth/register', 202, { email: 'athlete@gmail.com', expires_in: 300 }),
  ];
  await api.auth.register({
    name: 'Athlete', username: 'runner_1', email: 'athlete@gmail.com',
    password: 'Runner-pass-123', password_confirmation: 'Runner-pass-123',
  });
  assert.equal(calls.at(-1).method, 'POST');
  assert.equal(calls.at(-1).headers['X-CSRF-TOKEN'], csrf);
  assert.equal(calls.at(-1).credentials, 'include');
  assert.equal(memory.has('trana.token'), false, 'Signup must not store an auth token.');

  replies = [reply('/api/auth/email/verify', 200, { message: 'Verified.' })];
  await api.auth.verifyEmail({ email: 'athlete@gmail.com', code: '123456' });
  assert.deepEqual(JSON.parse(calls.at(-1).body), { email: 'athlete@gmail.com', code: '123456' });

  const user = { id: 1, name: 'Athlete', username: 'runner_1', email: 'athlete@gmail.com', role: 'athlete' };
  replies = [reply('/api/auth/login', 200, { user, csrfToken: 'd'.repeat(64) })];
  assert.equal((await api.auth.login('runner_1', 'Runner-pass-123')).username, 'runner_1');
  assert.equal(calls.at(-1).method, 'POST');
  assert.deepEqual(JSON.parse(calls.at(-1).body), { identifier: 'runner_1', password: 'Runner-pass-123' });
  assert.equal(calls.at(-1).headers['X-CSRF-TOKEN'], csrf);
  assert.equal(calls.at(-1).credentials, 'include');
  assert.equal(calls.at(-1).headers.Authorization, undefined, 'Browser auth must use the HttpOnly cookie.');
  assert.equal(memory.has('trana.token'), false, 'The auth token must never enter localStorage.');
  assert.equal(api.auth.hasSession(), true);

  replies = [reply('/api/account/delete-code', 202, { message: 'A confirmation code was sent.' })];
  await api.account.requestDeleteCode();
  assert.equal(calls.at(-1).method, 'POST');
  assert.equal(calls.at(-1).headers.Authorization, undefined);

  replies = [reply('/api/account', 200, { message: 'Account deleted.' })];
  await api.account.delete('012345');
  assert.equal(calls.at(-1).method, 'DELETE');
  assert.deepEqual(JSON.parse(calls.at(-1).body), { code: '012345', confirmation: 'DELETE' });

  replies = [reply('/api/profile', 200, { data: { name: 'Athlete' } })];
  assert.deepEqual(await api.profile.get(), { name: 'Athlete' });
  assert.equal(calls.at(-1).headers.Authorization, undefined);
  assert.equal(calls.at(-1).credentials, 'include');

  replies = [
    reply('/api/activities?limit=500&page=1', 200, page([{ id: 2 }], 1, 2)),
    reply('/api/activities?limit=500&page=2', 200, page([{ id: 1 }], 2, 2)),
  ];
  assert.deepEqual(await api.activities.list(), [{ id: 2 }, { id: 1 }]);
  replies = [reply('/api/predictions?limit=100&page=1', 200, { data: [] })];
  await assert.rejects(api.predictions.list(), /outdated or returned an invalid list/);

  // Network errors and server errors must not end a valid cookie session.
  replies = [{ path: '/api/auth/me', error: 'network down' }];
  await assert.rejects(api.auth.user(), /Could not reach/);
  assert.equal(api.auth.hasSession(), true);
  replies = [reply('/api/auth/me', 503, { message: 'Database unavailable' })];
  await assert.rejects(api.auth.user(), /Database unavailable/);
  assert.equal(api.auth.hasSession(), true);

  let expired = 0;
  const unsubscribe = onUnauthorized(() => { expired += 1; });
  replies = [reply('/api/goals', 401, { message: 'Unauthenticated.' })];
  await assert.rejects(api.goals.get(), /Unauthenticated/);
  assert.equal(api.auth.hasSession(), false);
  assert.equal(expired, 1);
  unsubscribe();

  replies = [reply('/api/health', 200, '<html>not the API</html>')];
  await assert.rejects(api.health(), /unexpected response/);

  const stores = await vite.ssrLoadModule('/src/stores/index.js');
  replies = [
    reply('/api/health', 200, { status: 'ok' }),
    { path: '/api/auth/me', error: 'network down' },
  ];
  await stores.bootstrap();
  assert.match(get(stores.bootError), /Could not reach/);
  assert.equal(get(stores.session), null);
  assert.equal(memory.has('trana.token'), false);

  replies = [
    reply('/api/health', 200, { status: 'ok' }),
    reply('/api/auth/me', 200, { user }),
    reply('/api/profile', 200, { data: { name: 'Athlete', onboarded: true } }),
    reply('/api/activities?limit=500&page=1', 200, page([{ id: 1 }])),
    reply('/api/predictions?limit=100&page=1', 200, page([])),
    reply('/api/goals', 200, { data: { daily_calories: 2400 } }),
  ];
  await stores.bootstrap();
  assert.equal(get(stores.bootError), null);
  assert.equal(get(stores.session).name, 'Athlete');
  assert.equal(get(stores.activities).length, 1);

  replies = [reply('/api/goals', 401, { message: 'Unauthenticated.' })];
  await assert.rejects(api.goals.get(), /Unauthenticated/);
  assert.equal(get(stores.session), null);
  assert.deepEqual(get(stores.activities), []);

  replies = [
    reply('/api/auth/csrf', 200, { csrfToken: 'e'.repeat(64) }),
    reply('/api/auth/login', 200, { user, csrfToken: 'f'.repeat(64) }),
    { path: '/api/auth/logout', error: 'network down' },
  ];
  await api.auth.login('runner_1', 'Runner-pass-123');
  await stores.logout();
  assert.equal(api.auth.hasSession(), false);
  assert.match(get(stores.toast).message, /could not be revoked/);
  assert.equal(replies.length, 0);
  console.log('HttpOnly-cookie auth, CSRF, pagination, retry and session checks passed');
} finally {
  await vite.close();
}
