/** Error-monitor smoke: dedupe, payload shape, rejection/5xx capture, session cap. */
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
    lib: { entry: resolve(root, 'scripts/stubs/error-monitor-entry.js'), name: 'ErrMonTest', formats: ['iife'] },
  },
});
const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const code = outputs.find((entry) => entry.type === 'chunk').code;

const window = new Window({ url: 'http://localhost/analytics' });
window.eval(code);

// 1. Identical fault twice inside the dedupe window → one report.
window.__fireError('chart exploded', '  at draw (a.js:1:1)');
window.__fireError('chart exploded', '  at draw (a.js:1:1)');
assert.equal(window.__requests.length, 1, 'identical faults are deduplicated');

// 2. A different fault is a new group → reported.
window.__fireError('map failed', '  at tile (m.js:2:2)');
assert.equal(window.__requests.length, 2, 'distinct faults are reported');

// 3. Unhandled promise rejections are captured.
window.__fireRejection(new window.Error('promise broke'));
assert.equal(window.__requests.length, 3, 'rejections are reported');

// 4. HTTP 5xx mirrors from the API client.
window.__report5xx('HTTP 500 POST /api/activities', 'Something went wrong on our side.');
assert.equal(window.__requests.length, 4, 'server-failure mirrors are reported');

// 5. Payload shape: server contract fields, no page contents.
const first = window.__requests[0];
assert.equal(first.kind, 'client');
assert.equal(first.message, 'chart exploded');
assert.equal(first.route, '/analytics');
assert.equal(first.app_version, 'dev');
assert.ok(first.stack.includes('a.js'));

// 6. Window listener wiring: a real dispatched 'error' event flows through.
window.dispatchEvent(new window.Event('error'));
assert.equal(window.__requests.length, 5, 'window error listener is wired');

// 7. Session cap (stub installs with maxPerSession: 8): unique faults keep
// flowing until the cap, then everything is dropped silently.
window.__fireError('cap-1', '  at one (c.js:1:1)');
window.__fireError('cap-2', '  at two (c.js:2:2)');
assert.equal(window.__requests.length, 7, 'cap not yet reached');
window.__fireError('cap-3', '  at three (c.js:3:3)');
window.__fireError('cap-4', '  at four (c.js:4:4)');
assert.equal(window.__requests.length, 8, 'session cap stops the flood');

console.log('error-monitor smoke: ok (dedupe, shape, wiring, cap)');
