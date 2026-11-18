/**
 * Does the GPS elevation filter actually remove noise without eating real climb?
 *
 *   node scripts/geo-noise-smoke.mjs
 *
 * The bug this pins: `elevationGainM()` in `lib/geo.js` sums every positive step
 * of raw `coords.altitude`. Altitude noise is roughly symmetric, so on flat
 * ground half of every wiggle counts as a climb. A simulated *flat* 20 km ride
 * reports 1.7 km of ascent with barometric-grade noise and 13 km with cheap-GPS
 * noise - and that number is what gets stored, shown, and fed back into the
 * duration model as its most important feature.
 *
 * `robustElevationGain()` must report ~0 on flat ground and ~the true climb on a
 * hill, at every noise level and sampling rate, with no tuning per device.
 */

import assert from 'node:assert/strict';
import { robustElevationGain, estimateAltitudeNoise } from '../src/lib/elevation.js';
import { haversineKm } from '../src/lib/geo.js';

let checks = 0;
const ok = (label, fn) => {
  fn();
  checks++;
  console.log(`  ok  ${label}`);
};

/* ------------------------------------------------------------- track builder */

/** Deterministic PRNG so a failure is reproducible. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Gaussian-ish noise (~N(0, sigma)) from four uniforms. */
function noise(sigma, rand) {
  return (rand() + rand() + rand() + rand() - 2) * sigma * 1.7;
}

/**
 * Straight 20 km track heading north, sampled every `stepKm`.
 * `profile(t)` returns the true elevation at fraction t of the route.
 */
function buildTrack({ stepKm = 0.01, sigma = 6, profile = () => 100, seed = 1 } = {}) {
  const rand = rng(seed);
  const n = Math.round(20 / stepKm);
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / (n - 1);
    const lat = 47 + (20 / 111.32) * (i / (n - 1)); // north
    const lng = 8;
    pts.push({
      latitude: lat,
      longitude: lng,
      altitudeM: profile(t) + noise(sigma, rand),
      accuracyM: 5,
    });
  }
  return pts;
}

const gain = (pts) => robustElevationGain(pts, { haversine: haversineKm }).gainM;

/* -------------------------------------------------------------------- cases */

ok('a perfectly flat ride reports no climb (barometric noise)', () => {
  // Truth: 0 m. The old naive sum reports ~1,674 m here.
  const g = gain(buildTrack({ sigma: 1.5, seed: 11 }));
  assert.ok(g <= 15, `flat + 1.5 m noise must stay near 0, got ${g} m`);
});

ok('a perfectly flat ride reports no climb (phone-GPS noise)', () => {
  // Truth: 0 m. The old naive sum reports ~6,676 m here.
  const g = gain(buildTrack({ sigma: 6, seed: 12 }));
  assert.ok(g <= 40, `flat + 6 m noise must stay near 0, got ${g} m`);
});

ok('a perfectly flat ride reports no climb (cheap-GPS noise)', () => {
  // Truth: 0 m. The old naive sum reports ~13,353 m here.
  const g = gain(buildTrack({ sigma: 12, seed: 13 }));
  assert.ok(g <= 90, `flat + 12 m noise must stay near 0, got ${g} m`);
});

ok('a real 300 m hill is measured, not smoothed away', () => {
  const hill = (t) => 100 + 300 * Math.sin(Math.PI * t);
  for (const sigma of [1.5, 6, 12]) {
    const g = gain(buildTrack({ sigma, profile: hill, seed: 21 }));
    assert.ok(g >= 240 && g <= 360, `300 m hill at sigma ${sigma} gave ${g} m - must stay within 20%`);
  }
});

ok('the result does not depend on sampling rate', () => {
  // A device recording every 3 m and one recording every 50 m must agree: the
  // smoothing window is in distance, so this is the property that proves it.
  const hill = (t) => 100 + 300 * Math.sin(Math.PI * t);
  const dense = gain(buildTrack({ stepKm: 0.003, sigma: 6, profile: hill, seed: 31 }));
  const sparse = gain(buildTrack({ stepKm: 0.05, sigma: 6, profile: hill, seed: 31 }));
  assert.ok(
    Math.abs(dense - sparse) <= 90,
    `dense sampling ${dense} m vs sparse ${sparse} m must agree within 90 m`,
  );
});

ok('repeated out-and-back climbing is counted, not collapsed', () => {
  // 5 hills of 100 m each = 500 m of gain.
  const fiveHills = (t) => 100 + 100 * Math.abs(Math.sin(Math.PI * 5 * t));
  const g = gain(buildTrack({ sigma: 3, profile: fiveHills, seed: 41 }));
  assert.ok(g >= 350, `500 m of repeated climb must be measured, got ${g} m`);
});

ok('the noise estimate tracks the actual noise level', () => {
  const low = estimateAltitudeNoise(buildTrack({ sigma: 1.5, seed: 51 }));
  const high = estimateAltitudeNoise(buildTrack({ sigma: 12, seed: 51 }));
  assert.ok(high > low * 3, `noise estimate must separate 1.5 m from 12 m (got ${low} vs ${high})`);
  assert.ok(low > 0.3 && low < 6, `1.5 m noise estimated as ${low}`);
});

ok('bad-accuracy fixes are rejected rather than averaged in', () => {
  const pts = buildTrack({ sigma: 6, seed: 61 });
  // Inject fixes with wild altitude and terrible horizontal accuracy.
  for (let i = 50; i < pts.length; i += 50) {
    pts[i] = { ...pts[i], altitudeM: pts[i].altitudeM + 500, accuracyM: 120 };
  }
  const r = robustElevationGain(pts, { haversine: haversineKm });
  assert.ok(r.rejectedPoints >= 10, `poor-accuracy fixes must be rejected, got ${r.rejectedPoints}`);
  assert.ok(r.gainM <= 60, `injected 500 m spikes must not become climb, got ${r.gainM} m`);
});

ok('stationary drift contributes no climb', () => {
  // Standing still: tiny position jitter, metre-scale altitude wobble.
  const rand = rng(71);
  const pts = Array.from({ length: 400 }, () => ({
    latitude: 47 + noise(0.000004, rand),
    longitude: 8 + noise(0.000004, rand),
    altitudeM: 100 + noise(5, rand),
    accuracyM: 4,
  }));
  const g = gain(pts);
  assert.ok(g <= 25, `standing still must not accrue climb, got ${g} m`);
});

ok('degenerate input never throws', () => {
  assert.equal(gain([]), 0);
  assert.equal(gain([{ latitude: 47, longitude: 8, altitudeM: 100 }]), 0);
  assert.equal(robustElevationGain(null, { haversine: haversineKm }).gainM, 0);
  // No altitude at all: 0, not NaN.
  const noAlt = Array.from({ length: 50 }, (_, i) => ({ latitude: 47 + i * 0.001, longitude: 8, altitudeM: null }));
  assert.equal(gain(noAlt), 0);
  // Real terrain plus a NaN in the middle must still measure.
  const hill = (t) => 100 + 300 * Math.sin(Math.PI * t);
  const pts = buildTrack({ sigma: 3, profile: hill, seed: 81 });
  pts[100] = { ...pts[100], altitudeM: NaN };
  assert.ok(gain(pts) > 240, 'one corrupt fix must not zero the whole track');
});

console.log(`\ngeo-noise-smoke: ${checks} checks pass - GPS noise no longer inflates elevation.`);
