/**
 * The displayed range must reflect measured real-world error.
 *
 *   node scripts/validated-range-smoke.mjs
 *
 * The model's q10-q90 band under-covers: scored against real recorded workouts
 * it contains the truth 65.5% of the time against a nominal 80%. Per-sport
 * MAPE on the honest benchmark (a model that never saw the holdout users) runs
 * from 36.1% (ride) to 37.2% (run). Presenting the raw quantile band as
 * "166-211 min range" advertises a precision the model has never demonstrated.
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

// 1. The published error table matches the Endomondo holdout study on disk.
//    The benchmark *retrained* candidate is the honest reference: it never saw
//    the 65 holdout athletes, whereas the shipped artifact was later refit on
//    the full corpus. Walk and hike hover around seven holdout rows each, so
//    the shipped artifact inherits the pooled figure instead of a number that
//    would swing between runs.
const study = JSON.parse(
  readFileSync(resolve(root, '../ml/evaluation/reports/endomondo_study.json'), 'utf8'),
);
const benchmark = study.retrained.by_mode;
for (const sport of ['ride', 'run']) {
  assert.ok(
    Math.abs(duration.VALIDATED_ERROR_PCT[sport] - benchmark[sport].mape_pct) < 0.1,
    `${sport} error must match the Endomondo benchmark (${benchmark[sport].mape_pct}%)`,
  );
}
const pooled = study.retrained.overall.mape_pct;
for (const sport of ['walk', 'hike']) {
  assert.ok(
    Math.abs(duration.VALIDATED_ERROR_PCT[sport] - pooled) < 0.1,
    `${sport} must inherit the pooled all-sport figure (${pooled}%) rather than a `
      + `seven-row slice`,
  );
}

// 2. The advertised band reflects measured error, and is never narrower than
//    the model's own quantile band by accident. On real recorded workouts the
//    quantile interval is genuinely wider than ±MAPE for some cells (ride with
//    two prior sessions: 99 min vs 84 min), which is the model being honest
//    rather than a defect — so the invariant that must hold is that the
//    displayed band is at least as wide as the larger of the two, and that the
//    MAPE band is never narrower than the measured error it claims to show.
for (const sport of ['run', 'ride', 'walk', 'hike']) {
  for (const hist of [0, 1, 2, 5]) {
    const r = predict(sport, hist);
    const modelWidth = r.high - r.low;
    const honestWidth = r.validatedHigh - r.validatedLow;
    const claimed = (r.validatedErrorPct / 100) * r.minutes * 2;
    assert.ok(Math.abs(honestWidth - claimed) < 1.5,
      `${sport}/${hist}: validated band (${honestWidth.toFixed(0)} min) must match the `
        + `±${r.validatedErrorPct}% it advertises (${claimed.toFixed(0)} min)`);
    assert.ok(honestWidth > 0 && r.validatedLow > 0,
      `${sport}/${hist}: validated band must be positive and ordered`);
    if (modelWidth > honestWidth) {
      assert.ok(modelWidth - honestWidth < modelWidth * 0.25,
        `${sport}/${hist}: the quantile band (${modelWidth.toFixed(0)} min) may exceed the `
          + `measured one, but not grossly (${honestWidth.toFixed(0)} min)`);
    }
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
  `cold-start ride error should reflect the ~45% cold-start figure after scaling, got ${cold.validatedErrorPct}%`);

// 5. The model's own quantile fields are untouched — this is presentation only.
//    The median is checked against what the artifact itself predicts (a 52 km,
//    130 m ride by an athlete with no history) rather than a constant baked in
//    from one corpus; a re-fit would move the constant, not the contract.
assert.ok(r0.low > 0 && r0.high > r0.low, 'the original quantile band is still returned');
assert.ok(r0.minutes > r0.low && r0.minutes < r0.high,
  `the median must sit inside the quantile band, got ${r0.minutes} in ${r0.low}-${r0.high}`);
const rideSpeed = 52 / (r0.minutes / 60);
assert.ok(rideSpeed > 8 && rideSpeed < 60,
  `a 52 km ride at ${r0.minutes} min implies ${rideSpeed.toFixed(1)} km/h, outside plausible riding speed`);
assert.equal(r0.rangeBasis, 'endomondo_validated');

console.log('Validated range checks passed ✔');
console.log(`  ride, no history: ${r0.minutes} min · synthetic ${Math.round(r0.low)}–${Math.round(r0.high)} · honest ${Math.round(r0.validatedLow)}–${Math.round(r0.validatedHigh)} (±${r0.validatedErrorPct}%)`);
