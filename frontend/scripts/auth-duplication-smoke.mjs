/**
 * Is there a second, divergent sign-in / log-in?
 *
 *   node scripts/auth-duplication-smoke.mjs
 *
 * The concern: the landing page opens auth in a modal, /login and /register are
 * full pages, and the tabs inside the form switch between logging in and
 * creating an account. That is three ways in. This harness mounts every entry
 * point and compares the rendered text, so any real divergence in copy, Google
 * intent, or field set shows up as a diff rather than a guess.
 */

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
    lib: { entry: resolve(root, 'scripts/stubs/auth-comparison-entry.js'), name: 'AuthCompare', formats: ['iife'] },
  },
});
const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const code = outputs.find((e) => e.type === 'chunk').code;

const window = new Window({ url: 'https://trana-web.vercel.app/login' });
const { document } = window;
document.body.innerHTML = '';
window.fetch = async () => { throw new Error('auth must not call the API before submit'); };
window.eval(code);

const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** Everything that makes an auth screen what it is. */
function describe(target) {
  const inputIds = [...target.querySelectorAll('input')].map((i) => i.id || i.type).sort();
  const google = target.querySelector('.google-button');
  return {
    heading: norm(target.querySelector('h1')?.textContent ?? ''),
    subtitle: norm(target.querySelector('.subtitle')?.textContent ?? ''),
    tabs: [...target.querySelectorAll('[role=tab]')].map((t) => norm(t.textContent)),
    activeTab: norm(target.querySelector('[role=tab][aria-selected=true]')?.textContent ?? ''),
    googleLabel: norm(google?.textContent ?? ''),
    googleHref: google?.getAttribute('href') ?? '',
    divider: norm(target.querySelector('.auth-divider')?.textContent ?? ''),
    submit: norm(target.querySelector('.primary-button')?.textContent ?? ''),
    inputs: inputIds,
    text: norm(target.textContent),
  };
}

try {
  window.destroyAuth();

  // ---- A. /login page ----
  const loginTarget = window.mountAuth('login');
  const loginPage = describe(loginTarget);
  window.destroyAuth();

  // ---- B. /register page (the wrapper) ----
  const registerTarget = window.mountAuth('register');
  const registerPage = describe(registerTarget);
  window.destroyAuth();

  // ---- C. landing modal, as the landing page mounts it ----
  const modalTarget = window.mountAuth('login', { initialMode: 'signup', asModal: true });
  const modal = describe(modalTarget);

  console.log('\n--- A. /login page ---');
  console.log(`  heading:  ${loginPage.heading}`);
  console.log(`  tabs:     ${loginPage.tabs.join(' | ')}  (active: ${loginPage.activeTab})`);
  console.log(`  google:   "${loginPage.googleLabel}" -> ${loginPage.googleHref}`);
  console.log(`  divider:  ${loginPage.divider}`);
  console.log(`  inputs:   ${loginPage.inputs.join(', ') || '(none)'}`);
  console.log(`  submit:   ${loginPage.submit || '(none)'}`);

  console.log('\n--- B. /register page ---');
  console.log(`  heading:  ${registerPage.heading}`);
  console.log(`  tabs:     ${registerPage.tabs.join(' | ')}  (active: ${registerPage.activeTab})`);
  console.log(`  google:   "${registerPage.googleLabel}" -> ${registerPage.googleHref}`);
  console.log(`  divider:  ${registerPage.divider}`);
  console.log(`  inputs:   ${registerPage.inputs.join(', ') || '(none)'}`);
  console.log(`  submit:   ${registerPage.submit || '(none)'}`);

  console.log('\n--- C. landing modal (signup, asModal) ---');
  console.log(`  heading:  ${modal.heading}`);
  console.log(`  tabs:     ${modal.tabs.join(' | ')}  (active: ${modal.activeTab})`);
  console.log(`  google:   "${modal.googleLabel}" -> ${modal.googleHref}`);
  console.log(`  divider:  ${modal.divider}`);
  console.log(`  inputs:   ${modal.inputs.join(', ') || '(none)'}`);
  console.log(`  submit:   ${modal.submit || '(none)'}`);

  // ---- Assertions: the two signup surfaces must be identical ----
  const DIVERGENT_FIELDS = ['heading', 'subtitle', 'googleLabel', 'googleHref', 'divider', 'submit'];
  const diffs = DIVERGENT_FIELDS.filter((f) => registerPage[f] !== modal[f]);
  const inputDiff = JSON.stringify(registerPage.inputs) !== JSON.stringify(modal.inputs);
  if (inputDiff) diffs.push('inputs');

  if (diffs.length) {
    for (const f of diffs) {
      console.log(`\n  DIVERGES on "${f}":`);
      console.log(`    /register : ${JSON.stringify(registerPage[f])}`);
      console.log(`    modal     : ${JSON.stringify(modal[f])}`);
    }
  }

  assert.deepEqual(diffs, [], `signup surfaces must be identical; divergent: ${diffs.join(', ')}`);
  assert.equal(registerPage.text, modal.text, 'the whole signup surface must read identically');

  // The login and signup screens differ only in the ways that define them.
  assert.equal(loginPage.activeTab, 'Log in');
  assert.equal(registerPage.activeTab, 'Create account');
  assert.notEqual(loginPage.heading, registerPage.heading);

  console.log('\n✔ All signup entry points render the same auth screen');
} finally {
  await window.happyDOM.abort();
}
