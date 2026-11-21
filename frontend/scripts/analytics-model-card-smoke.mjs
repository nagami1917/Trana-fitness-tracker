/**
 * The Analytics model card must describe the artifact it is actually showing.
 *
 * Regression guard for a real defect: the metric labels were hardcoded
 * "R² (synthetic)" / "Error (synthetic)" regardless of training_source. After
 * the model was retrained on Endomondo's recorded workouts, held-out scores
 * were still captioned synthetic — and a stale synthetic-era card in the
 * service-worker cache could show ±6% beside a model measured at ±42%.
 *
 *   node scripts/analytics-model-card-smoke.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
      { find: /^chart\.js\/auto$/, replacement: resolve(root, 'scripts/stubs/chart.js') },
    ],
  },
  build: {
    write: false,
    minify: false,
    lib: {
      entry: resolve(root, 'scripts/stubs/analytics-entry.js'),
      name: 'AnalyticsTest',
      formats: ['iife'],
    },
  },
});

const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const codeBundle = outputs.find((entry) => entry.type === 'chunk').code;
const cssBundle = outputs
  .filter((entry) => entry.type === 'asset' && entry.fileName.endsWith('.css'))
  .map((entry) => String(entry.source))
  .join('\n');

const window = new Window({ url: 'http://localhost/analytics' });
const { document } = window;
document.head.innerHTML = `<style>${cssBundle}</style>`;
document.body.innerHTML = '<div id="app"></div>';
window.fetch = async () => ({ ok: true, status: 200, text: async () => '[]' });
window.eval(codeBundle);

const flush = () => window.__analyticsTest.flush();
const cardText = () => document.body.textContent.replace(/\s+/g, ' ');

const realCard = JSON.parse(readFileSync(resolve(root, 'public/models/model_card.json'), 'utf8'));

const syntheticCard = {
  version: 'synthetic-test',
  training_source: 'synthetic',
  corpus_rows: 8845,
  metrics: { r2: 0.9924, mape_pct: 6, mae_min: 5.76, interval_coverage_pct: 78.9 },
  validation: { split_strategy: 'random split', test_users: 0, test_rows: 0 },
  feature_importance: { distance_km: 0.4 },
};

try {
  /* ---------- real corpus: labels must NOT say synthetic ---------- */
  window.__analyticsTest.seedStores(realCard);
  await window.__analyticsTest.mountAnalytics();
  flush();

  const real = cardText();
  assert.equal(realCard.training_source, 'csv', 'shipped model card should be the Endomondo corpus');
  assert.doesNotMatch(
    real,
    /synthetic/i,
    'a model trained on recorded workouts must not be captioned synthetic anywhere',
  );
  assert.match(real, /R² \(held-out\)/, 'real metrics should be labelled held-out');
  assert.match(real, /Error \(held-out\)/, 'real error should be labelled held-out');
  assert.match(real, /held-out workouts from \d+ athletes/, 'the caption should name the holdout');
  // The measured truth must be visible, not a stale synthetic-era figure.
  assert.match(real, new RegExp(`±${Math.round(realCard.metrics.mape_pct)}%`));
  assert.ok(
    !/±6%/.test(real),
    'the synthetic-era ±6% must never appear for a real-data model',
  );

  /* ---------- synthetic corpus: labels must say synthetic ---------- */
  window.__analyticsTest.seedStores(syntheticCard);
  await window.__analyticsTest.mountAnalytics();
  flush();

  const synthetic = cardText();
  assert.match(synthetic, /R² \(synthetic\)/, 'synthetic models keep the honest label');
  assert.match(synthetic, /Error \(synthetic\)/);
  assert.match(synthetic, /formula recovery, not real-world accuracy/);
  assert.match(synthetic, /±6%/, 'synthetic card should show its own numbers');
} finally {
  await window.__analyticsTest.destroy();
  await window.happyDOM.abort();
}

console.log('Analytics model-card labelling follows its own training_source (held-out vs synthetic)');
