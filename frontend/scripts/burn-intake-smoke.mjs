/**
 * Burn and intake must not read as the same question.
 *
 *   node scripts/burn-intake-smoke.mjs
 *
 * Background: the session plan put "Calories 1,560" first in a row of intake
 * tiles (Carbs 230 g, Electrolytes 1,838 mg, Fluid 1.9 L) with no qualifier
 * anywhere. Read left-to-right that says "eat 1,560 kcal" - the eat-back-your-
 * burn trap - and it is the exact question the screen kept provoking.
 *
 * The fix splits them into three labelled groups:
 *
 *     This session costs        calories burned (+ carbs oxidised)
 *     Take this in during ...   carbs / electrolytes / fluid
 *     Eat after                 recovery carbs + protein, as its own card
 *
 * Numbers alone would not catch a regression here: the old layout had all the
 * right figures and still misled. So this test asserts on *rendered markup* -
 * the headings, the qualifiers, and the fact that the burn figure is not inside
 * the grid of intake tiles. It renders the real component server-side, so it
 * fails if someone reverts the structure even while the numbers stay correct.
 */

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Build an SSR bundle whose entry renders FuelingPlan with a fixed plan, then
 * hands back the HTML string.
 */
async function render(plan) {
  const bundle = await build({
    root,
    configFile: false,
    envFile: false,
    logLevel: 'silent',
    plugins: [svelte()],
    // Svelte 5 chooses the SSR renderer from `svelte/server`'s resolve
    // conditions; compilerOptions.generate is a Svelte 4 idea and is ignored.
    resolve: { conditions: ['svelte', 'node', 'import'] },
    build: {
      write: false,
      minify: false,
      ssr: resolve(root, 'scripts/.burn-intake-entry.js'),
      rollupOptions: { external: [] },
    },
  });
  const chunk = (Array.isArray(bundle) ? bundle[0].output : bundle.output).find((e) => e.type === 'chunk');
  // Write to a real file rather than a data: URL - a stack trace inside a
  // base64 module is unreadable, and this script is meant to be debuggable.
  const out = resolve(root, 'scripts/.burn-intake-bundle.mjs');
  await writeFile(out, chunk.code);
  const mod = await import(`${out}?t=${Date.now()}`);
  return mod.default(plan);
}

let checks = 0;
const ok = (label, fn) => {
  fn();
  checks++;
  console.log(`  ok  ${label}`);
};

/* A real session: 52 km in 2 h 43 m, 250 m climb, 26 C, average sweat. */
const PLAN = {
  activity_type: 'ride',
  duration: {
    minutes: 163,
    low: 121,
    high: 204,
    validatedLow: 121,
    validatedHigh: 204,
    validatedErrorPct: 25.7,
    confidence: 0.74,
    historyCount: 2,
    referenceSpeedKmh: 19.2,
    paceMinPerKm: null,
    speedKmh: 19.2,
  },
  fueling: {
    intensity: 'vigorous',
    met: 9.6,
    calories: { total: 1560, perHour: 576, fromCarbsPct: 60, carbsBurnedG: 234 },
    carbs: { perHourG: 85, totalG: 230, dailyTargetG: 480, preSessionG: 60 },
    recovery: {
      carbsG: 24,
      proteinG: 15,
      window: 'Within 30 min after',
      elevatedLoad: false,
      note: "Recovery covers the next session, not this one's energy cost.",
    },
    sodium: { perHourMg: 678, totalMg: 1837 },
    fluid: { perHourMl: 715, totalMl: 1936 },
    timeline: [
      { window: '3 h before', label: 'Pre-activity meal', detail: '72 g carbs, low fibre', carbsG: 72, icon: 'meal' },
      { window: 'Within 30 min after', label: 'Recovery', detail: '24 g carbs + 15 g protein', carbsG: 24, icon: 'recovery' },
    ],
    kit: { items: [], totals: { carbsG: 0, sodiumMg: 0, fluidMl: 0 }, cadence: {} },
    notes: ['Target 85 g of carbohydrate per hour.'],
  },
};

const html = await render(PLAN);

/* --- the three groups are present and named ------------------------------- */

ok('the burn group is explicitly labelled as a cost', () => {
  assert.match(html, /This session costs/i);
});

ok('the intake group says "take in during the session"', () => {
  assert.match(html, /Take this in during the session/i);
});

ok('recovery has its own card, labelled "Eat after"', () => {
  assert.match(html, /Eat after/i);
});

/* --- the numbers carry their meaning -------------------------------------- */

ok('the calorie figure is named "Calories burned"', () => {
  assert.match(html, /Calories burned/i);
});

ok('the burn is stated as not a target to eat back', () => {
  assert.match(html, /Not a target to eat back/i);
});

ok('oxidised carbohydrate is shown next to the burn', () => {
  assert.match(html, /234 g carbs burned/i);
});

ok('intake carbs are named "Carbs to eat", not just "Carbs"', () => {
  assert.match(html, /Carbs to eat/i);
});

ok('recovery shows both macros and its energy', () => {
  assert.match(html, /24 g carbs/i);
  assert.match(html, /15 g protein/i);
  assert.match(html, /156 kcal/i);
});

/* --- the structural guarantee --------------------------------------------- */

ok('the burn figure is NOT inside the intake grid', () => {
  // Locate the intake heading, then the burn figure. Burn must come before it.
  const intakeHeading = html.indexOf('Take this in during the session');
  const burnFigure = html.indexOf('1,560');
  const eatAfter = html.indexOf('Eat after');
  assert.ok(intakeHeading > 0, 'intake heading missing');
  assert.ok(burnFigure > 0, 'burn figure missing');
  assert.ok(burnFigure < intakeHeading, 'burn figure must precede the intake group');
  assert.ok(eatAfter > intakeHeading, 'recovery must come after the intake group');
});

ok('the three intake tiles are still present', () => {
  assert.match(html, /Electrolytes/i);
  assert.match(html, /Fluid/i);
});

ok('recovery is compared against the burn, not equated with it', () => {
  assert.match(html, /far less than the 1,560 kcal/i);
});

/* --- degradation ---------------------------------------------------------- */

{
  // Awaited explicitly: `ok()` is synchronous, so an async callback would pass
  // without its assertions ever running.
  const stale = structuredClone(PLAN);
  delete stale.fueling.recovery;
  const out = await render(stale);
  assert.doesNotMatch(out, /Eat after/i, 'recovery card should be absent');
  // The burn/intake split must survive independently of recovery.
  assert.match(out, /This session costs/i);
  assert.match(out, /Take this in during the session/i);
  checks++;
  console.log('  ok  an older payload without `recovery` renders, minus that card');
}

/* Sanity: the recovery card really is present when the data is. */
ok('the recovery card renders its window and note', () => {
  assert.match(html, /Within 30 min after/);
  assert.match(html, /Recovery covers the next session/i);
});

ok('the elevated-load badge is absent when load is not elevated', () => {
  assert.doesNotMatch(html, /Training load high/i);
});

/* And present when it is. */
{
  const loaded = structuredClone(PLAN);
  loaded.fueling.recovery.elevatedLoad = true;
  loaded.fueling.recovery.carbsG = 29;
  const out = await render(loaded);
  assert.match(out, /Training load high/i);
  assert.match(out, /29 g carbs/i);
  checks++;
  console.log('  ok  the elevated-load badge appears when load is elevated');
}

console.log(`\n=> ${checks} checks passed`);
