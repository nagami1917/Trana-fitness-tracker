/**
 * Server-side render smoke test.
 *
 *   node scripts/render-smoke.mjs
 *
 * Renders every screen through Svelte's SSR compiler with a populated store.
 * onMount effects (charts, maps) are skipped, but all template logic, derived
 * values and store reads run for real — this catches the class of bug that a
 * build cannot: undefined values, bad guards, broken `$derived` chains.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const require = createRequire(import.meta.url);

// --- browser stubs ---------------------------------------------------------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.fetch = async () => ({ ok: false, json: async () => null, text: async () => '' });
globalThis.window = { location: { pathname: '/', search: '' }, addEventListener() {}, scrollTo() {} };

const { createServer } = await import('vite');
const { svelte } = await import('@sveltejs/vite-plugin-svelte');
const { render } = await import('svelte/server');

const vite = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  plugins: [svelte({ compilerOptions: { generate: 'server', dev: false } })],
  resolve: {
    alias: [
      // Leaflet and Chart.js touch `window` at import time; neither is needed for
      // template rendering, so swap them for inert stand-ins.
      { find: /^leaflet\/dist\/leaflet\.css$/, replacement: resolve(here, 'stubs/empty.css') },
      { find: /^leaflet$/, replacement: resolve(here, 'stubs/leaflet.js') },
      { find: /^chart\.js\/auto$/, replacement: resolve(here, 'stubs/chart.js') },
    ],
  },
  ssr: { noExternal: true },
  server: { middlewareMode: true, hmr: false },
});

let failures = 0;

try {
  const stores = await vite.ssrLoadModule('/src/stores/index.js');
  await stores.continueAsGuest();
  await stores.refresh();

  const routes = [
    ['/', 'Dashboard'],
    ['/plan', 'PlanActivity'],
    ['/activities', 'Activities'],
    ['/analytics', 'Analytics'],
    ['/fueling', 'Fueling'],
    ['/goals', 'Goals'],
    ['/profile', 'Profile'],
    ['/settings', 'Settings'],
    ['/nope', 'NotFound'],
  ];

  for (const [path, name] of routes) {
    const file = `/src/pages/${name}/${name}.svelte`;
    try {
      const mod = await vite.ssrLoadModule(file);
      const html = render(mod.default).body;
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text.length) throw new Error('rendered no text');
      const suspicious = ['NaN', 'undefined', 'Infinity', '[object Object]'].filter((bad) => text.includes(bad));
      if (suspicious.length) throw new Error(`rendered suspicious tokens: ${suspicious.join(', ')}`);
      console.log(`✔ ${path.padEnd(12)} ${name.padEnd(11)} ${String(text.length).padStart(5)} chars`);
      if (process.env.DUMP === name) console.log(`\n--- ${name} ---\n${text.slice(0, 1600)}\n`);
    } catch (error) {
      failures += 1;
      console.error(`✘ ${path} (${name}): ${error.message}`);
      if (process.env.VERBOSE) console.error(error.stack);
    }
  }

  // App shell + auth gate
  try {
    const mod = await vite.ssrLoadModule('/src/App.svelte');
    const html = render(mod.default).body;
    console.log(`✔ /            App         ${String(html.length).padStart(5)} chars`);
  } catch (error) {
    failures += 1;
    console.error(`✘ App: ${error.message}`);
  }

  // Onboarding wizard
  try {
    const mod = await vite.ssrLoadModule('/src/pages/Onboarding/Onboarding.svelte');
    const html = render(mod.default).body;
    console.log(`✔ /onboarding  Onboarding  ${String(html.length).padStart(5)} chars`);
  } catch (error) {
    failures += 1;
    console.error(`✘ Onboarding: ${error.message}`);
  }

  // Login + register screens (signed out)
  stores.session.set(null);
  for (const name of ['Login', 'Register']) {
    try {
      const mod = await vite.ssrLoadModule(`/src/pages/${name}/${name}.svelte`);
      const html = render(mod.default).body;
      console.log(`✔ /${name.toLowerCase().padEnd(9)} ${name.padEnd(11)} ${String(html.length).padStart(5)} chars`);
    } catch (error) {
      failures += 1;
      console.error(`✘ ${name}: ${error.message}`);
    }
  }
} finally {
  await vite.close();
}

if (failures) {
  console.error(`\n${failures} screen(s) failed to render`);
  process.exit(1);
}
console.log('\nall screens rendered ✔');
