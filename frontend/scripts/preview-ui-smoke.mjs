/** Check that the interactive preview returns visitors to the landing page, not login. */
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
  resolve: {
    alias: [
      {
        find: '../../lib/router.js',
        replacement: resolve(root, 'scripts/stubs/router-preview.js'),
      },
    ],
  },
  build: {
    write: false,
    minify: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
    lib: {
      entry: resolve(root, 'scripts/stubs/preview-ui-entry.js'),
      name: 'PreviewTest',
      formats: ['iife'],
    },
  },
});

const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const chunk = outputs.find((entry) => entry.type === 'chunk');
assert.ok(chunk?.code, 'Expected compiled interactive preview test chunk');

const window = new Window({ url: 'https://trana-web.vercel.app/preview' });
window.document.body.innerHTML = '<div id="app"></div>';
window.fetch = async () => ({ ok: false, json: async () => null });
window.eval(chunk.code);

try {
  window.flushPreviewTest();
  const { document } = window;
  const backHome = document.querySelector('a[href="/"]');
  assert.ok(backHome, 'Preview should include a link back to the home page');
  assert.equal(backHome.textContent.replace(/\s+/g, ' ').trim(), 'Back to home');
  assert.equal(document.body.textContent.includes('Back to sign in'), false, 'Preview should not misdirect visitors to login');

  backHome.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  assert.equal(window.__previewNavigation, '/', 'Back to home should navigate to the landing route');

  const createAccount = Array.from(document.querySelectorAll('button'))
    .find((button) => button.textContent.includes('Create free account'));
  assert.ok(createAccount, 'Preview should retain the account creation action');
  createAccount.click();
  assert.equal(window.__previewNavigation, '/register', 'Create free account should open registration');

  console.log('Preview back-to-home and account-creation checks passed');
} finally {
  await window.destroyPreviewTest();
  await window.happyDOM.abort();
}
