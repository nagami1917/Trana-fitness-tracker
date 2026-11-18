/**
 * Real-browser mobile layout check.
 *
 *   node scripts/mobile-layout-smoke.mjs
 *
 * Every other smoke script here runs components in Node or happy-dom, where
 * there is no layout engine: a card can be 4,000px wide and all assertions
 * still pass. This one mounts the real component in real Chromium at real phone
 * viewports and measures the geometry the user would actually see.
 *
 * How: a temporary Vite dev server serves tiny fixture pages that mount the
 * component exactly as its page does (same props, same client runtime, same
 * compiled Tailwind + globals). Only the router and the API calls are left out,
 * because the screens behind auth need credentials this script does not have.
 * CSS and component code are the parts that break on a narrow screen, and none
 * of that is stubbed.
 *
 * Asserted per case, per viewport (390 iPhone 14, 360 Pixel 5, 375 iPhone SE):
 *   1. the document does not scroll sideways;
 *   2. no element's box extends past the viewport's right edge;
 *   3. no text node is clipped by a fixed-height container;
 *   4. no interactive control is under 40x40 CSS px;
 *   5. no two controls overlap;
 *   6. no text renders below 12px.
 *
 * Chromium comes from `npx playwright install --with-deps chromium`, which CI
 * runs. A sandbox that cannot download it skips this step and says so, rather
 * than implying the layout was checked.
 */

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { measure } from './mobile-layout-measure.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = resolve(root, 'scripts/.mobile-fixtures');

// In CI, Chromium is installed on the step before this runs, so a missing
// browser there means the install failed - not "no browser available here".
// Failing loudly is the difference between a real check and a green tick that
// measured nothing, so CI passes --require-browser.
const requireBrowser = process.argv.includes('--require-browser');

let chromium = null;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error(
    'mobile-layout-smoke: `playwright-core` is not installed.\n' +
      '  npm ci && npx playwright install --with-deps chromium',
  );
  if (requireBrowser) {
    console.error('--require-browser was passed, so this is a failure, not a skip.');
    process.exit(1);
  }
  console.error('SKIPPED - layout was NOT checked here.');
  process.exit(0);
}

/* --------------------------------------------------------------- viewports */

const VIEWPORTS = [
  { name: 'iPhone 14', width: 390, height: 844, dpr: 3 },
  { name: 'Pixel 5', width: 360, height: 800, dpr: 2.75 },
  { name: 'iPhone SE', width: 375, height: 667, dpr: 2 },
];

/* ------------------------------------------------------------------- cases */

/**
 * A plan built by the real model helpers, not hand-written numbers - so the
 * fixture cannot drift from what the app actually renders.
 *
 * `intakeNote` is the line item 1 added: measured intake from past sessions
 * compared against this plan's target. It is long prose in a narrow card, which
 * is exactly the shape that overflows on a phone.
 */
const CASES = [
  {
    id: 'fueling-no-history',
    label: 'Fueling plan - 52 km ride, no history',
    props: { historyCount: 0, intakeNote: null },
  },
  {
    id: 'fueling-with-intake',
    label: 'Fueling plan - 52 km ride, history + intake note',
    props: {
      historyCount: 2,
      intakeNote:
        'Last 2 sessions you logged 49 g carbs/h and 443 ml fluid/h. This plan asks for 85 g/h - about 36 g/h more. Practise the higher rate on training days before relying on it.',
    },
  },
];

const FIXTURE_JS = (id) => `
import { mount } from 'svelte';
import FuelingPlan from '../../src/components/fueling/FuelingPlan.svelte';
import { predictDuration, loadModel } from '../../src/lib/ml/duration.js';
import { recommendFueling } from '../../src/lib/ml/fueling.js';

const CASE = '__ID__';
const HISTORY_COUNT = __COUNT__;
const INTAKE_NOTE = __NOTE__;

const model = await loadModel();
const history = Array.from({ length: HISTORY_COUNT }, (_, i) => ({
  id: i + 1,
  activity_type: 'ride',
  distance_km: 40,
  duration_min: 110,
  elevation_gain_m: 100,
  started_at: \`2026-11-0\${i + 1}T07:00:00Z\`,
}));

const duration = predictDuration({ model, activityType: 'ride', distanceKm: 52, elevationGainM: 130, history });
const plan = {
  activity_type: 'ride',
  distance_km: 52,
  elevation_gain_m: 130,
  duration_min: duration.minutes,
  started_at: new Date().toISOString(),
  intake_note: INTAKE_NOTE,
  duration,
  fueling: recommendFueling({ durationMin: duration.minutes, weightKg: 60, activityType: 'ride' }),
};

mount(FuelingPlan, { target: document.getElementById('root'), props: { plan } });
document.documentElement.dataset.ready = '1';
`;

const html = (c) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>${c.label}</title>
</head>
<body>
<main id="root"></main>
<script type="module" src="./${c.id}.js"></script>
</body>
</html>`;

mkdirSync(fixtureDir, { recursive: true });
for (const c of CASES) {
  const js = FIXTURE_JS(c.id)
    .replace('__ID__', c.id)
    .replace('__COUNT__', String(c.props.historyCount))
    .replace('__NOTE__', JSON.stringify(c.props.intakeNote));
  writeFileSync(resolve(fixtureDir, `${c.id}.js`), js);
  writeFileSync(resolve(fixtureDir, `${c.id}.html`), html(c));
}

/* ------------------------------------------------------------ the browser */

let exe = null;
try {
  exe = chromium.executablePath();
} catch {
  exe = null;
}
if (!exe || !existsSync(exe)) {
  console.error(
    'mobile-layout-smoke: Chromium is not installed.\n' +
      '  npx playwright install --with-deps chromium',
  );
  if (requireBrowser) {
    console.error('--require-browser was passed, so this is a failure, not a skip.');
    process.exit(1);
  }
  console.error('SKIPPED - layout was NOT checked here.');
  process.exit(0);
}

/* Vite dev server: real module graph, real compiled CSS.
 *
 * `appType: 'mpa'` matters: as a SPA, Vite's history fallback answers *any*
 * unknown path with index.html - including these fixture .js files, which then
 * get served as HTML and silently mount nothing. */
const server = await createServer({
  root,
  logLevel: 'silent',
  appType: 'mpa',
  server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { strict: false } },
  // No `plugins` here on purpose: vite.config.js already registers svelte().
  // Adding a second copy compiles every component twice and the second pass
  // fails with a bogus "Expected token }".
});
await server.listen();
// With port 0 Vite picks a free port and config still reads 0, so ask the
// server itself what it bound to.
const port = server.httpServer.address().port;
const base = `http://127.0.0.1:${port}/scripts/.mobile-fixtures`;

const browser = await chromium.launch();
let failures = 0;
try {
  for (const c of CASES) {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.dpr,
        isMobile: true,
        hasTouch: true,
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));

      // Guard the failure mode that makes this whole script useless: if the
      // fixture module is answered with index.html, nothing mounts and every
      // measurement is zero - a green run that checked nothing.
      const jsRes = await page.request.get(`${base}/${c.id}.js`);
      const jsBody = await jsRes.text();
      assert.ok(
        /\bimport\b|\bmount\b/.test(jsBody) && !jsBody.trimStart().startsWith('<!doctype'),
        `fixture ${c.id}.js was not served as JavaScript (got ${jsBody.slice(0, 80)})`,
      );

      await page.goto(`${base}/${c.id}.html`, { waitUntil: 'networkidle' });
      // The fixture sets data-ready once mount() has run.
      await page.waitForSelector('html[data-ready="1"]', { timeout: 20000 });
      await page.waitForTimeout(120);

      const m = await page.evaluate(measure);
      const tag = `${c.id} @ ${vp.name} ${vp.width}px`;

      const problems = [];
      if (errors.length) problems.push(`page error: ${errors[0]}`);
      // A component with no buttons still renders; an unmounted one renders
      // nothing at all. Check for content, not for interactivity.
      if (m.elements < 5) problems.push(`only ${m.elements} elements rendered - the fixture did not mount`);
      if (m.docScroll > m.viewport + 1) problems.push(`scrolls sideways ${m.docScroll}px vs ${m.viewport}px`);
      if (m.pastEdge.length) problems.push(`${m.pastEdge.length} past right edge: ${JSON.stringify(m.pastEdge.slice(0, 3))}`);
      if (m.clipped.length) problems.push(`${m.clipped.length} clipped text: ${JSON.stringify(m.clipped.slice(0, 3))}`);
      if (m.smallTargets.length) problems.push(`${m.smallTargets.length} targets <40px: ${JSON.stringify(m.smallTargets.slice(0, 3))}`);
      if (m.overlaps.length) problems.push(`${m.overlaps.length} overlapping controls: ${m.overlaps.slice(0, 2).join('; ')}`);
      if (m.tinyText.length) problems.push(`${m.tinyText.length} text <12px: ${JSON.stringify(m.tinyText.slice(0, 3))}`);

      if (problems.length) {
        failures++;
        console.error(`FAIL ${tag}`);
        for (const p of problems) console.error(`  - ${p}`);
        await page.screenshot({ path: resolve(fixtureDir, `FAIL-${c.id}-${vp.width}.png`), fullPage: true });
      } else {
        // Print the geometry measured, so a passing CI log is evidence of what
        // was actually checked rather than just a tick.
        const tallest = m.pastEdge.length ? '' : '; nothing past edge';
        console.log(`     root ${m.rootWidth}px, tallest block ${m.tallest}px${tallest}`);
        console.log(`ok   ${tag} (doc ${m.docScroll}px, ${m.elements} elements, ${m.controls} controls, ${m.tinyText.length} tiny)`);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures) {
  console.error(`\nmobile-layout-smoke: ${failures} failing case(s). See scripts/.mobile-fixtures/FAIL-*.png`);
  process.exit(1);
}
console.log(`\nmobile-layout-smoke: all ${CASES.length} case(s) pass at ${VIEWPORTS.length} phone viewports.`);
