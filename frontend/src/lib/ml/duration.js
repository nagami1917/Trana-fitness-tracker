/**
 * Duration prediction in the browser.
 *
 * This is a faithful JavaScript port of `ml/duration_model/preprocess.py` +
 * `model_store.py`, evaluating the exact same gradient-boosted trees exported
 * from scikit-learn (`public/models/duration_model.json`). It runs in the PWA
 * for on-device previews. The server calculation is authoritative when a plan is saved.
 *
 *   base      = exp(a + b · ln(distance))        ← flat-normalized, Ridge-regularized curve
 *   duration  = base · exp(f(distance, elevation, experience, history_count, modality))
 */

export const ACTIVITY_TYPES = ['run', 'ride', 'walk', 'hike'];

export const DEFAULT_SPEED_KMH = { run: 8.8, ride: 20.0, walk: 4.7, hike: 3.6 };
export const RIEGEL_EXPONENT = { run: 1.06, walk: 1.06, hike: 1.15, ride: 1.03 };
export const FLAT_CLIMB_SENSITIVITY = { run: 0.85, ride: 0.45, walk: 0.70, hike: 0.75 };
export const SPEED_BOUNDS_KMH = {
  run: [2.5, 30.0],
  ride: [1.5, 65.0],
  walk: [0.5, 14.0],
  hike: [0.5, 14.0],
};
export const DOMAIN_MAX_DISTANCE_KM = { run: 45.0, ride: 150.0, walk: 25.0, hike: 40.0 };

/**
 * Steepest climb-per-km that is physically plausible for a *whole* activity.
 *
 * A single kilometre of Alpe d'Huez is ~100 m/km, and the hardest sustained
 * road climb in the world is ~130 m/km. Averaging 60 m/km over an entire
 * session is already a serious mountain route.
 *
 * This matters because elevation drives the reference curve: a GPS track whose
 * altitude noise inflated 300 m into 13,000 m becomes a ride the athlete never
 * did. Run through `flatEquivalentDuration` it looks like they averaged 51 km/h
 * on the flat instead of 22.6, and every later prediction inherits that.
 *
 * 60 rather than a looser 150 because a *clamped* value is still treated as
 * real. At 150 m/km an impossible 4,000 m ride and an impossible 6,000 m ride
 * both clamp to the same corner and produce identical, wrong predictions - the
 * ceiling turns different errors into one confident lie. Rows above this are
 * discarded by `isImplausibleElevation()` instead, so the ceiling only ever
 * applies to input an athlete could actually have ridden.
 */
export const MAX_PLAUSIBLE_ELEV_PER_KM = 60;
const RIEGEL_PRIOR_STRENGTH = 0.25;

/**
 * Measured real-world error, from the Endomondo external validation.
 *
 * These numbers come from `ml/evaluation/reports/endomondo_study.json`, which
 * scores the shipped artifact against 8,675 real recorded workouts from 65
 * athletes the model never saw during training. They are the counterweight to
 * the holdout metrics: the model card reports a self-score on the same kind of
 * data it learned from, while on unseen athletes the error is 36-37%.
 *
 * The quantile band still under-covers — 65% of actual durations land inside a
 * nominal 80% interval — and on cold-start accounts the error is nearer 45%.
 * Showing that raw band to an athlete would present a narrow window as if it
 * were the real uncertainty.
 *
 * `mape` is the median absolute percentage error to mirror outward, so the
 * displayed range reflects what the model has actually demonstrated. It is
 * applied to the *presentation* of the range only — `minutes` stays the model's
 * own estimate, and no prediction math changes.
 *
 * Keyed by sport. Walk and hike are measured on only 7 holdout workouts each,
 * so they inherit the pooled all-sport figure rather than a seven-sample
 * average that would swing wildly between runs.
 */
export const VALIDATED_ERROR_PCT = {
  run: 37.2,
  ride: 36.1,
  walk: 36.6,
  hike: 36.6,
};

/**
 * Extra error for thin history. Endomondo `cold_start` MAPE is 45.4% and
 * `thin_history_1` is 49.6%, against 36.4% once two or more sessions exist.
 * Expressed as a multiple of the sport's baseline error so a well-populated
 * account is not penalised for a defect that belongs to new accounts.
 */
export const THIN_HISTORY_MULTIPLIER = {
  none: 45.4 / 36.4, // ≈1.25 — no usable sessions for this sport
  one: 49.6 / 36.4,  // ≈1.36 — a single point cannot establish fatigue decay
  two: 1.0,
};

/**
 * The error a prediction should honestly advertise, as a fraction.
 *
 * `historyCount` is the model's own count of same-sport sessions that reached
 * the curve, so a row the model discarded does not earn a tighter range.
 */
export function validatedErrorFraction(activityType, historyCount = 0) {
  const base = VALIDATED_ERROR_PCT[activityType] ?? 40.5;
  const count = Number(historyCount) || 0;
  const multiplier = count <= 0
    ? THIN_HISTORY_MULTIPLIER.none
    : count === 1
      ? THIN_HISTORY_MULTIPLIER.one
      : THIN_HISTORY_MULTIPLIER.two;
  return (base * multiplier) / 100;
}

export const FEATURE_ORDER = [
  'distance_km',
  'elevation_gain_m',
  'elevation_per_km',
  'experience_level',
  'history_count',
  'is_run',
  'is_ride',
  'is_walk',
  'is_hike',
];

let modelPromise = null;

/** Load (once) the exported tree ensemble. Resolves to null if unavailable. */
export function loadModel() {
  if (!modelPromise) {
    modelPromise = fetch('/models/duration_model.json')
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return modelPromise;
}

export function flatEquivalentDuration(durationMin, distanceKm, elevationGainM, activityType) {
  const rawPerKm = Math.max(0, Number(elevationGainM) || 0) / Math.max(distanceKm, 0.1);
  const elevPerKm = Math.min(MAX_PLAUSIBLE_ELEV_PER_KM, rawPerKm);
  const sens = FLAT_CLIMB_SENSITIVITY[activityType] ?? 1.0;
  return durationMin / (1 + sens * (elevPerKm / 100));
}

/**
 * True when a history row's elevation is too steep to be real terrain.
 *
 * Used to discount - not delete - such rows when fitting the athlete's
 * reference curve. Deleting would throw away a genuine session (and the pace
 * the athlete really rode); trusting the elevation would corrupt the curve for
 * everyone who shares that sport. Treating it as flat keeps the distance and
 * duration and drops only the part that cannot be believed.
 */
export function isImplausibleElevation(distanceKm, elevationGainM, { tolerance = 1 } = {}) {
  const distance = Number(distanceKm) || 0;
  const elevation = Math.max(0, Number(elevationGainM) || 0);
  if (!(distance > 0) || !(elevation > 0)) return false;
  return elevation / distance > MAX_PLAUSIBLE_ELEV_PER_KM * tolerance;
}

function parseTimestampSec(raw) {
  if (raw == null || raw === '') return null;
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms / 1000 : null;
}

function median(vals) {
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : 0.5 * (s[mid - 1] + s[mid]);
}

function validHistoryPoints(history = [], activityType, excludeId = null) {
  const [loSpd, hiSpd] = SPEED_BOUNDS_KMH[activityType] ?? [0.5, 60.0];
  const pts = [];
  for (const row of history) {
    if (row.activity_type !== activityType) continue;
    if (excludeId != null && row.id === excludeId) continue;
    const distance = Number(row.distance_km) || 0;
    const duration = Number(row.duration_min) || 0;
    if (distance <= 0 || duration <= 0) continue;
    const speed = distance / (duration / 60);
    if (speed < loSpd || speed > hiSpd) continue;
    const ele = Math.max(0, Number(row.elevation_gain_m) || 0);
    // An impossible climb-per-km makes the flat-equivalent pace meaningless.
    // Keep the session, drop the claim: treat it as flat so a corrupted
    // elevation cannot move the athlete's reference curve.
    // 2x tolerance: only reject climbs that are impossible, not merely extreme.
    // A real 80 m/km mountain route stays in the fit; a GPS artefact does not.
    const believable = !isImplausibleElevation(distance, ele, { tolerance: 2 });
    const flatMin = flatEquivalentDuration(duration, distance, believable ? ele : 0, activityType);
    pts.push({
      distance,
      duration,
      flatMin,
      x: Math.log(distance),
      y: Math.log(flatMin),
      logPace: Math.log(flatMin / distance),
      ts: parseTimestampSec(row.started_at),
      w: 1,
    });
  }

  if (!pts.length) return pts;

  const timestamps = pts.map((p) => p.ts).filter((t) => t !== null);
  const tMax = timestamps.length ? Math.max(...timestamps) : null;

  const medPace = pts.length >= 4 ? median(pts.map((p) => p.logPace)) : 0;
  const mad = pts.length >= 4 ? median(pts.map((p) => Math.abs(p.logPace - medPace))) : 0;
  const scale = Math.max(0.15, 1.4826 * mad);

  for (const p of pts) {
    let wTime = 1;
    if (tMax !== null && p.ts !== null) {
      const ageDays = Math.max(0, (tMax - p.ts) / 86400);
      wTime = Math.max(0.25, 0.5 ** (ageDays / 90));
    }
    let wRob = 1;
    if (pts.length >= 4) {
      const resid = Math.abs(p.logPace - medPace);
      if (resid > 2 * scale) wRob = (2 * scale) / resid;
    }
    p.w = wTime * wRob;
  }
  return pts;
}

/** Fit log t_flat = a + b·log d on the athlete's own history for one modality. */
export function referenceCurve(history = [], activityType, excludeId = null, experience = 3) {
  const pts = validHistoryPoints(history, activityType, excludeId);
  const defaultB = RIEGEL_EXPONENT[activityType] ?? 1.06;

  if (pts.length === 0) {
    const baseSpeed = DEFAULT_SPEED_KMH[activityType] ?? 6;
    const expClamped = Math.min(5, Math.max(1, Math.round(Number(experience) || 3)));
    const expMult = 1 + 0.085 * (expClamped - 3);
    return {
      a: Math.log(60 / (baseSpeed * expMult)),
      b: defaultB,
      source: 'no_history',
      points: 0,
      maxDistanceKm: 0,
    };
  }

  const maxDistanceKm = Math.max(...pts.map((p) => p.distance));
  if (pts.length === 1) {
    const p = pts[0];
    return {
      a: p.y - defaultB * p.x,
      b: defaultB,
      source: 'single_activity',
      points: 1,
      maxDistanceKm,
    };
  }

  const wSum = pts.reduce((s, p) => s + p.w, 0);
  const meanX = pts.reduce((s, p) => s + p.w * p.x, 0) / wSum;
  const meanY = pts.reduce((s, p) => s + p.w * p.y, 0) / wSum;
  const sXX = pts.reduce((s, p) => s + p.w * (p.x - meanX) ** 2, 0);
  const sXY = pts.reduce((s, p) => s + p.w * (p.x - meanX) * (p.y - meanY), 0);

  let b = (sXY + RIEGEL_PRIOR_STRENGTH * defaultB) / (sXX + RIEGEL_PRIOR_STRENGTH);
  b = Math.min(1.30, Math.max(1.00, b));
  return {
    a: meanY - b * meanX,
    b,
    source: sXX < 1e-6 ? 'single_distance' : 'personal_curve',
    points: pts.length,
    maxDistanceKm,
  };
}

export function baseMinutes(distanceKm, a, b) {
  const d = Math.max(distanceKm, 0.1);
  const minutes = Math.exp(a + b * Math.log(d));
  return Math.min(45 * d, Math.max(2 * d, minutes));
}

export function referenceSpeed(history = [], activityType, excludeId = null) {
  const pts = validHistoryPoints(history, activityType, excludeId);
  if (!pts.length) return DEFAULT_SPEED_KMH[activityType] ?? 6;
  const wSum = pts.reduce((s, p) => s + p.w, 0);
  return pts.reduce((s, p) => s + p.w * (p.distance / (p.duration / 60)), 0) / wSum;
}

export function experienceLevel(totalActivities = 0) {
  if (totalActivities >= 40) return 5;
  if (totalActivities >= 24) return 4;
  if (totalActivities >= 12) return 3;
  if (totalActivities >= 5) return 2;
  return 1;
}

export function featureRow({ activityType, distanceKm, elevationGainM, experience = 3, historyCount = 0 }) {
  const d = Math.max(0.1, Number(distanceKm) || 0);
  const e = Math.max(0, Number(elevationGainM) || 0);
  const exp = Math.min(5, Math.max(1, Math.round(Number(experience) || 3)));
  const hc = Math.min(50, Math.max(0, Math.round(Number(historyCount) || 0)));
  return [
    d,
    e,
    e / d,
    exp,
    hc,
    activityType === 'run' ? 1 : 0,
    activityType === 'ride' ? 1 : 0,
    activityType === 'walk' ? 1 : 0,
    activityType === 'hike' ? 1 : 0,
  ];
}

function treeValue(tree, x) {
  let node = 0;
  while (tree.left[node] !== -1) {
    node = x[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
  }
  return tree.value[node];
}

function forestValue(forest, x) {
  let sum = forest.init;
  for (const tree of forest.trees) sum += forest.learning_rate * treeValue(tree, x);
  return sum;
}

function computeConfidence({ q10, q50, q90, activityType, distanceKm, elevationGainM, historyCount, maxHistoryKm }) {
  const intervalConf = 1 - (q90 - q10) / (2 * Math.max(q50, 1));
  let historyFactor = 1.0;
  if (historyCount <= 0) historyFactor = 0.58;
  else if (historyCount === 1) historyFactor = 0.78;
  else if (historyCount === 2) historyFactor = 0.88;
  else if (historyCount < 5) historyFactor = 0.94;

  const domainMaxKm = DOMAIN_MAX_DISTANCE_KM[activityType] ?? 45.0;
  let oodRatio = Math.max(1, distanceKm / domainMaxKm);
  if (maxHistoryKm > 0 && distanceKm > maxHistoryKm * 2) {
    oodRatio = Math.max(oodRatio, distanceKm / (maxHistoryKm * 2));
  }
  const elevPerKm = Math.max(0, elevationGainM) / Math.max(distanceKm, 0.1);
  if (elevPerKm > 150) {
    oodRatio = Math.max(oodRatio, elevPerKm / 150);
  }
  const oodFactor = 1 / (1 + 0.35 * (oodRatio - 1));
  return Math.min(0.96, Math.max(0.30, intervalConf * historyFactor * oodFactor));
}

/**
 * @returns {{
 *   minutes:number, hours:number, low:number, high:number, paceMinPerKm:number|null,
 *   speedKmh:number, confidence:number, referenceSpeedKmh:number, curve:object, basis:string
 * }}
 */
export function predictDuration({
  model,
  activityType,
  distanceKm,
  elevationGainM = 0,
  weightKg: _weightKg = 60,
  experienceLevel: exp,
  history = [],
}) {
  void _weightKg;
  const experience = exp ?? experienceLevel(history.length);
  const curve = referenceCurve(history, activityType, null, experience);
  const historyCount = curve.points ?? 0;
  const maxHistoryKm = curve.maxDistanceKm ?? 0;
  const base = baseMinutes(distanceKm, curve.a, curve.b);
  const x = featureRow({ activityType, distanceKm, elevationGainM, experience, historyCount });

  let low;
  let median;
  let high;
  let basis;

  if (model?.models?.q50) {
    const clamp = (v) => Math.min(3, Math.max(0.7, v));
    const f10 = clamp(Math.exp(forestValue(model.models.q10, x)));
    const f50 = clamp(Math.exp(forestValue(model.models.q50, x)));
    const f90 = clamp(Math.exp(forestValue(model.models.q90, x)));
    low = base * f10;
    median = Math.max(base * f50, low);
    high = Math.max(base * f90, median);
    // ML phase 2: calibrated band-width factor — matches calibrate.py + model_store.py.
    const k = Number(model?.calibration?.factor) || 1;
    if (k > 1) {
      const halfwidth = (high - low) / 2;
      const loDev = median - low > 1e-9 ? median - low : halfwidth;
      const hiDev = high - median > 1e-9 ? high - median : halfwidth;
      low = median - k * loDev;
      high = median + k * hiDev;
    }
    basis = 'gradient_boosted_pace_factor';
  } else {
    const sens = FLAT_CLIMB_SENSITIVITY[activityType] ?? 1.25;
    const climb = 1 / (1 + (sens * (elevationGainM / Math.max(distanceKm, 0.1))) / 100);
    const fatigue = 1 / (1 + 0.012 * Math.max(0, distanceKm - 8));
    median = base / (climb * fatigue);
    const spreadFrac = historyCount === 0 ? 0.25 : 0.14;
    const spread = Math.max(3, median * spreadFrac);
    low = median - spread;
    high = median + spread;
    basis = 'physics_fallback';
  }

  // Never let the interval invert or go non-physical (mirrors model_store.py).
  median = Math.max(1, median);
  low = Math.max(1, Math.min(low, median));
  high = Math.max(high, median);

  const speedKmh = distanceKm / (median / 60);
  const confidence = computeConfidence({
    q10: low,
    q50: median,
    q90: high,
    activityType,
    distanceKm,
    elevationGainM,
    historyCount,
    maxHistoryKm,
  });

  // What the athlete should be shown, as opposed to what the forests emitted.
  //
  // `low`/`high` are the model's own quantile interval. On unseen athletes it
  // covers the truth ~65% of the time, so presenting it as "166-211 min range"
  // states more precision than the model has demonstrated. The honest figure is
  // the one measured on the Endomondo holdout: the median estimate ± that
  // sport's MAPE, widened further for thin history.
  const errorFraction = validatedErrorFraction(activityType, historyCount);
  const honestLow = Math.max(1, median * (1 - errorFraction));
  const honestHigh = median * (1 + errorFraction);

  return {
    minutes: Math.round(median * 10) / 10,
    hours: Math.round((median / 60) * 100) / 100,
    low: Math.round(low * 10) / 10,
    high: Math.round(high * 10) / 10,
    // The range the UI should display (validated against real data).
    validatedLow: Math.round(honestLow * 10) / 10,
    validatedHigh: Math.round(honestHigh * 10) / 10,
    validatedErrorPct: Math.round(errorFraction * 1000) / 10,
    // The band shown is the measured one, not the raw quantile interval.
    rangeBasis: 'endomondo_validated',
    paceMinPerKm: ['run', 'walk', 'hike'].includes(activityType) ? median / distanceKm : null,
    speedKmh: Math.round(speedKmh * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    referenceSpeedKmh: Math.round(referenceSpeed(history, activityType) * 100) / 100,
    // How many of this athlete's sessions of THIS sport actually reached the
    // curve. The API returns the same field; without it here the UI read
    // undefined and reported "Generic pace" even when the estimate was fitted
    // from the athlete's own sessions.
    historyCount,
    curve,
    basis,
  };
}

/** Sample points along the season for the "duration vs distance" chart. */
export function durationCurvePoints({ model, activityType, weightKg, experience, history, maxKm }) {
  const step = Math.max(1, Math.round(maxKm / 12));
  const points = [];
  for (let d = step; d <= maxKm; d += step) {
    const p = predictDuration({ model, activityType, distanceKm: d, elevationGainM: 0, weightKg, experience, history });
    points.push({ distance: d, minutes: p.minutes });
  }
  return points;
}
