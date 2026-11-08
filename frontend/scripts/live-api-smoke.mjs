/** Exercise the Laravel API facade in same-origin mode without a real server. */
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, ...init });
  const response = url.endsWith('/auth/login')
    ? { token: 'test-token', user: { id: 1, name: 'Athlete' } }
    : url.endsWith('/profile')
      ? { data: { name: 'Athlete' } }
      : { message: 'Signed out.' };
  return { ok: true, text: async () => JSON.stringify(response) };
};
process.env.VITE_API_BASE_URL = '/';
const vite = await createServer({
  root,
  configFile: false,
  envFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false },
});
try {
  const { api, isLive } = await vite.ssrLoadModule('/src/services/client.js');
  assert.equal(isLive, true);
  assert.equal(api.mode, 'live');
  assert.equal((await api.auth.login({ email: 'runner@example.test', password: 'example' })).name, 'Athlete');
  assert.equal(calls[0].url, '/api/auth/login');
  assert.equal(calls[0].method, 'POST');
  assert.equal(memory.get('trana.token'), 'test-token');
  assert.deepEqual(await api.profile.get(), { name: 'Athlete' });
  assert.equal(calls[1].url, '/api/profile');
  assert.equal(calls[1].headers.Authorization, 'Bearer test-token');
  await api.auth.logout();
  assert.equal(calls[2].url, '/api/auth/logout');
  assert.equal(memory.has('trana.token'), false);
  console.log('Same-origin Laravel API facade checks passed');
} finally {
  await vite.close();
}
