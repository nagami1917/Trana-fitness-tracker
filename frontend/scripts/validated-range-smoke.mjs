/**
 * The displayed range must reflect measured real-world error.
 *
 *   node scripts/validated-range-smoke.mjs
 *
 * The model's q10-q90 band is calibrated on the synthetic corpus. Scored
 * against GeoLife's real GPS activities it covers the truth ~17% of the time
 * (nominal 80%), and per-sport MAPE is 25.7% (ride) to 40.5% (walk). Presenting
 * the synthetic band as "166-211 min range" advertises a precision the model
 * has never demonstrated.
 *
 * predictDuration() therefore also returns validatedLow/High, derived from the
 * measured error for that sport and history depth. This harness pins the
 * relationship between the two so the honest band can never collapse back to
 * the synthetic one.
 */

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await build({
  root, configFile: false, envFile: false, logLevel: 'silent', plugins: [svelte()],
  build: { write: false, minify: false, lib: { entry: resolve(root, 'src/lib/ml/duration.js'), name: 'V', formats: ['es'] } },
});
const chunk = (Array.isArray(bundle) ? bundle[0].output : bundle.output).find((e) => e.type === 'chunk');
const duration = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);

const model = JSON.parse(readFileSync(resolve(root, 'public/models/duration_model.json'), 'utf8'));

const predict = (activityType, historyCount) => {
  const history = Array.from({ length: historyCount }, (_, i) => ({
    id: i + 1,
    activity_type: activityType,
    distance_km: 40,
    duration_min: 110,
    elevation_gain_m: 100,
    started_at: `2026-11-0${(i % 9) + 1}T07:00:00Z`,
  }));
  return duration.predictDuration({
    model, activityType, distanceKm: 52, elevationGainM: 130,
    experienceLevel: 1, history,
  });
};

// 1. The published error table matches the GeoLife report on disk.
const report = JSON.parse(
  readFileSync(resolve(root, '../ml/evaluation/reports/geolife_validation.json'), 'utf8'),
);
for (const sport of ['ride', 'walk']) {
  assert.ok(
    Math.abs(duration.VALIDATED_ERROR_PCT[sport] - report.by_mode[sport].mape_pct) < 0.1,
    `${sport} error must match the validation report (${report.by_mode[sport].mape_pct}%)`,
  );
}

// 2. The honest band is always wider than the synthetic one.
for (const sport of ['run', 'ride', 'walk', 'hike']) {
  for (const hist of [0, 1, 2, 5]) {
    const r = predict(sport, hist);
    const modelWidth = r.high - r.low;
    const honestWidth = r.validatedHigh - r.validatedLow;
    assert.ok(honestWidth > modelWidth,
      `${sport}/${hist}: validated band (${honestWidth.toFixed(0)} min) must exceed the synthetic band (${modelWidth.toFixed(0)} min)`);
  }
}

// 3. The band is centred on the median estimate and symmetric in percentage.
const r0 = predict('ride', 0);
assert.ok(Math.abs((r0.validatedLow + r0.validatedHigh) / 2 - r0.minutes) < 0.5,
  'the validated band is centred on the reported estimate');
const lowPct = (r0.minutes - r0.validatedLow) / r0.minutes;
const highPct = (r0.validatedHigh - r0.minutes) / r0.minutes;
assert.ok(Math.abs(lowPct - highPct) < 0.001, 'and symmetric in percentage terms');

// 4. Thin history widens the band: cold start is worse than two sessions.
const cold = predict('ride', 0);
const two = predict('ride', 2);
assert.ok(cold.validatedErrorPct > two.validatedErrorPct,
  `cold start must advertise more error than a populated account (${cold.validatedErrorPct}% vs ${two.validatedErrorPct}%)`);
assert.ok(cold.validatedErrorPct > 30,
  `cold-start ride error should reflect the ~51% GeoLife figure after scaling, got ${cold.validatedErrorPct}%`);

// 5. The model's own quantile fields are untouched — this is presentation only.
assert.ok(r0.low > 0 && r0.high > r0.low, 'the original quantile band is still returned');
assert.ok(Math.abs(r0.minutes - 188) < 1, `the median estimate must not change, got ${r0.minutes}`);
assert.equal(r0.rangeBasis, 'geolife_validated');

console.log('Validated range checks passed ✔');
console.log(`  ride, no history: ${r0.minutes} min · synthetic ${Math.round(r0.low)}–${Math.round(r0.high)} · honest ${Math.round(r0.validatedLow)}–${Math.round(r0.validatedHigh)} (±${r0.validatedErrorPct}%)`);
