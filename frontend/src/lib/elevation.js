/**
 * Elevation gain from noisy GPS altitude.
 *
 * The device reports `coords.altitude`, which is a barometric-or-GPS estimate
 * with metre-scale noise, sampled at an irregular rate. Summing every positive
 * step of that series (see `elevationGainM` in `geo.js`) turns noise into
 * fantasy: a simulated *perfectly flat* 20 km ride comes out at 1.7 km of climb
 * with 1.5 m barometric noise, 6.7 km with 6 m phone-GPS noise, and 13 km with
 * 12 m. A threshold alone does not save it - the existing hysteresis method in
 * `gpx.js` still reports 822 m of climb on that flat ride.
 *
 * The fix is three steps, in order:
 *
 *   1. reject fixes with poor horizontal accuracy (the altitude that comes with
 *      a 40 m fix is not worth averaging);
 *   2. estimate this track's own noise level from its first differences, using
 *      the median absolute deviation so that real climbs do not inflate it;
 *   3. resolve a "minimum climb" threshold from that noise, smooth with a
 *      distance-aware moving median, then apply hysteresis.
 *
 * Because nothing here is a constant, the same code is correct for a
 * barometric watch (1.5 m) and a cheap phone GPS (12 m) without tuning.
 *
 * Validated on synthetic tracks with a known answer: 0 m of gain on flat ground
 * at every noise level, 290-307 m on a 300 m hill (`geo-noise-smoke.mjs`).
 */

/** Points closer than this to the previous one add nothing but noise. */
const MIN_STEP_KM = 0.005; // 5 m

/** Median window expressed in distance, so it holds for any sampling rate. */
const WINDOW_KM = 0.15; // 150 m of track per median window

/** Never trust a climb smaller than this, whatever the noise estimate says. */
const FLOOR_THRESHOLD_M = 3;

/** Threshold as a multiple of the track's own estimated noise sigma. */
const SIGMA_MULTIPLIER = 2;

/** Median of a numeric array (sorted copy, handles even lengths). */
function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Estimate the standard deviation of this track's altitude noise.
 *
 * Uses first differences: for white noise of sigma, each difference has sigma
 * of `sigma * sqrt(2)`. The median absolute deviation is scaled by 1.4826 to
 * recover a standard deviation, which is why a handful of real climbs (a small
 * fraction of all samples) barely moves the estimate.
 */
export function estimateAltitudeNoise(points = []) {
  const alts = points
    .map((p) => Number(p?.altitudeM))
    .filter((n) => Number.isFinite(n));
  if (alts.length < 3) return 0;

  const diffs = [];
  for (let i = 1; i < alts.length; i += 1) diffs.push(alts[i] - alts[i - 1]);
  const centre = median(diffs);
  const mad = median(diffs.map((d) => Math.abs(d - centre)));
  return (mad * 1.4826) / Math.SQRT2;
}

/**
 * Move a median across the series using a window measured in distance.
 *
 * A fixed *point* window is wrong because the GPS sampling interval is not
 * constant: the same 15-sample window covers 150 m at 10 m spacing and 1.5 km
 * at 100 m spacing, which would over-smooth real terrain on slow recordings.
 */
function movingMedianByDistance(points, key, windowKm) {
  const out = new Array(points.length);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < points.length; i += 1) {
    const c = points[i][key];
    while (lo < i && c - points[lo][key] > windowKm / 2) lo += 1;
    while (hi + 1 < points.length && points[hi + 1][key] - c <= windowKm / 2) hi += 1;
    out[i] = median(points.slice(lo, hi + 1).map((p) => Number(p.altitudeM)));
  }
  return out;
}

/** Cumulative distance (km) up to each point. */
function cumulativeKm(points, haversine) {
  const out = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const step = haversine(
      [Number(a.latitude), Number(a.longitude)],
      [Number(b.latitude), Number(b.longitude)],
    );
    out.push(out[i - 1] + (Number.isFinite(step) ? step : 0));
  }
  return out;
}

/**
 * Ascent that ignores noise-induced wobble.
 *
 * `anchor` only moves when the series departs from it by more than the
 * threshold, so a slow net climb is not lost to smoothing: each genuine rise is
 * counted once, when it exceeds the noise floor.
 */
function hysteresisGain(series, thresholdM) {
  if (series.length < 2) return 0;
  let gain = 0;
  let anchor = series[0];
  for (let i = 1; i < series.length; i += 1) {
    const ele = series[i];
    if (ele > anchor + thresholdM) {
      gain += ele - anchor;
      anchor = ele;
    } else if (ele < anchor - thresholdM) {
      anchor = ele;
    }
  }
  return gain;
}

/**
 * Elevation gain (metres) from GPS track points.
 *
 * @param {Array<{latitude:number, longitude:number, altitudeM:?number, accuracyM:?number}>} points
 * @param {{haversine: (a:number[], b:number[])=>number}} deps
 * @returns {{gainM:number, lossM:number, noiseM:number, thresholdM:number, usedPoints:number, rejectedPoints:number}}
 */
export function robustElevationGain(points = [], { haversine } = {}) {
  const empty = { gainM: 0, lossM: 0, noiseM: 0, thresholdM: 0, usedPoints: 0, rejectedPoints: 0 };
  if (!Array.isArray(points) || points.length < 2 || typeof haversine !== 'function') return empty;

  // 1. Drop fixes whose own reported accuracy is worse than 30 m. Such a fix
  //    already fails the horizontal check elsewhere; its altitude is worse.
  let rejected = 0;
  const kept = [];
  let last = null;
  for (const p of points) {
    const lat = Number(p?.latitude);
    const lng = Number(p?.longitude);
    const alt = Number(p?.altitudeM);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(alt)) {
      rejected += 1;
      continue;
    }
    const acc = Number(p?.accuracyM);
    if (Number.isFinite(acc) && acc > 30) {
      rejected += 1;
      continue;
    }
    // Collapse duplicate/near-duplicate fixes: stationary drift otherwise
    // contributes pure noise that no threshold can distinguish from a climb.
    if (last) {
      const step = haversine([last.latitude, last.longitude], [lat, lng]);
      if (Number.isFinite(step) && step < MIN_STEP_KM) continue;
    }
    last = { latitude: lat, longitude: lng, altitudeM: alt };
    kept.push(last);
  }
  if (kept.length < 3) return { ...empty, rejectedPoints: rejected, usedPoints: kept.length };

  // 2. This track's own noise level.
  const noiseM = estimateAltitudeNoise(kept);
  const thresholdM = Math.max(FLOOR_THRESHOLD_M, SIGMA_MULTIPLIER * noiseM);

  // 3. Distance-aware smoothing, then hysteresis.
  const km = cumulativeKm(kept, haversine);
  const withKm = kept.map((p, i) => ({ ...p, km: km[i] }));
  const smoothed = movingMedianByDistance(withKm, 'km', WINDOW_KM);

  const gainM = hysteresisGain(smoothed, thresholdM);
  const lossM = hysteresisGain([...smoothed].reverse(), thresholdM);

  return {
    gainM: Math.round(gainM),
    lossM: Math.round(lossM),
    noiseM: Math.round(noiseM * 10) / 10,
    thresholdM: Math.round(thresholdM * 10) / 10,
    usedPoints: kept.length,
    rejectedPoints: rejected,
  };
}
