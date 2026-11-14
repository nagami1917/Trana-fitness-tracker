/** Verify the /register route opens the shared auth page in Create account mode. */
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
window.document.body.innerHTML = '<div id="app"></div>';
window.fetch = async () => { throw new Error('The register page should not call the API before submit.'); };
window.eval(codeBundle);

try {
  window.flushRegisterTest();
  const { document } = window;
  assert.match(document.body.textContent, /Create your account/);
  assert.ok(document.querySelector('#full-name'));
  assert.ok(document.querySelector('#username'));
  assert.ok(document.querySelector('#signup-email'));
  assert.ok(document.querySelector('#signup-password'));
  assert.ok(document.querySelector('#signup-confirm'));
  assert.equal(document.querySelector('button[role="tab"][aria-selected="true"]')?.textContent.trim(), 'Create account');
  assert.match(document.body.textContent, /3–20 letters, numbers, or underscores/);
  assert.match(document.body.textContent, /one letter and one number/);
  console.log('Registration route, fields and account-tab checks passed');
} finally {
  await window.destroyRegisterTest();
  await window.happyDOM.abort();
}
