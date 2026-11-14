/** Exercise the Laravel facade and outage/session handling with a stubbed HTTP boundary. */
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

// Even without any environment setting, all calls go to the real /api path.
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
  assert.equal(await api.auth.user(), null);

  replies = [reply('/api/auth/login', 202, { message: 'If an account exists, a code is on its way.' })];
  await api.auth.requestLoginCode('runner@example.test');
  assert.equal(calls.at(-1).method, 'POST');
  assert.deepEqual(JSON.parse(calls.at(-1).body), { email: 'runner@example.test' });
  assert.equal(memory.has('trana.token'), false, 'Requesting a code must not create a session.');

  replies = [reply('/api/auth/otp/verify', 200, { token: 'test-token', user: { id: 1, name: 'Athlete' } })];
  assert.equal((await api.auth.verifyOtp({ email: 'runner@example.test', code: '012345' })).name, 'Athlete');
  assert.equal(calls.at(-1).method, 'POST');
  assert.deepEqual(JSON.parse(calls.at(-1).body), { email: 'runner@example.test', code: '012345' });
  assert.equal(memory.get('trana.token'), 'test-token');

  replies = [reply('/api/account/delete-code', 202, { message: 'A confirmation code was sent.' })];
  await api.account.requestDeleteCode();
  assert.equal(calls.at(-1).method, 'POST');
  assert.equal(calls.at(-1).headers.Authorization, 'Bearer test-token');

  replies = [reply('/api/account', 200, { message: 'Account deleted.' })];
  await api.account.delete('012345');
  assert.equal(calls.at(-1).method, 'DELETE');
  assert.deepEqual(JSON.parse(calls.at(-1).body), { code: '012345', confirmation: 'DELETE' });

  replies = [reply('/api/profile', 200, { data: { name: 'Athlete' } })];
  assert.deepEqual(await api.profile.get(), { name: 'Athlete' });
  assert.equal(calls.at(-1).headers.Authorization, 'Bearer test-token');

  replies = [
    reply('/api/activities?limit=500&page=1', 200, page([{ id: 2 }], 1, 2)),
    reply('/api/activities?limit=500&page=2', 200, page([{ id: 1 }], 2, 2)),
  ];
  assert.deepEqual(await api.activities.list(), [{ id: 2 }, { id: 1 }]);
  replies = [reply('/api/predictions?limit=100&page=1', 200, { data: [] })];
  await assert.rejects(api.predictions.list(), /outdated or returned an invalid list/);

  // Network errors and server errors must not discard a valid saved token.
  replies = [{ path: '/api/auth/me', error: 'network down' }];
  await assert.rejects(api.auth.user(), /Could not reach/);
  assert.equal(memory.get('trana.token'), 'test-token');
  replies = [reply('/api/auth/me', 503, { message: 'Database unavailable' })];
  await assert.rejects(api.auth.user(), /Database unavailable/);
  assert.equal(memory.get('trana.token'), 'test-token');

  let expired = 0;
  const unsubscribe = onUnauthorized(() => { expired += 1; });
  replies = [reply('/api/auth/me', 401, { message: 'Unauthenticated.' })];
  assert.equal(await api.auth.user(), null);
  assert.equal(memory.has('trana.token'), false);
  assert.equal(expired, 1);
  unsubscribe();

  // HTML from a misconfigured proxy is not mistaken for a successful API.
  replies = [reply('/api/health', 200, '<html>not the API</html>')];
  await assert.rejects(api.health(), /unexpected response/);

  const stores = await vite.ssrLoadModule('/src/stores/index.js');
  memory.set('trana.token', 'test-token');
  replies = [
    reply('/api/health', 200, { status: 'ok' }),
    { path: '/api/auth/me', error: 'network down' },
  ];
  await stores.bootstrap();
  assert.match(get(stores.bootError), /Could not reach/);
  assert.equal(get(stores.session), null);
  assert.equal(memory.get('trana.token'), 'test-token');

  replies = [
    reply('/api/health', 200, { status: 'ok' }),
    reply('/api/auth/me', 200, { user: { id: 1, name: 'Athlete' } }),
    reply('/api/profile', 200, { data: { name: 'Athlete', onboarded: true } }),
    reply('/api/activities?limit=500&page=1', 200, page([{ id: 1 }])),
    reply('/api/predictions?limit=100&page=1', 200, page([])),
    reply('/api/goals', 200, { data: { daily_calories: 2400 } }),
  ];
  await stores.bootstrap();
  assert.equal(get(stores.bootError), null);
  assert.equal(get(stores.session).name, 'Athlete');
  assert.deepEqual(get(stores.activities), [{ id: 1 }]);

  // An expired token on any authenticated data call clears account state.
  replies = [reply('/api/goals', 401, { message: 'Unauthenticated.' })];
  await assert.rejects(api.goals.get(), /Unauthenticated/);
  assert.equal(get(stores.session), null);
  assert.deepEqual(get(stores.activities), []);
  assert.equal(memory.has('trana.token'), false);

  memory.set('trana.token', 'logout-token');
  replies = [{ path: '/api/auth/logout', error: 'network down' }];
  await stores.logout();
  assert.equal(memory.has('trana.token'), false);
  assert.match(get(stores.toast).message, /could not be revoked/);
  assert.equal(replies.length, 0);
  console.log('Live API, pagination, retry and session checks passed');
} finally {
  await vite.close();
}
