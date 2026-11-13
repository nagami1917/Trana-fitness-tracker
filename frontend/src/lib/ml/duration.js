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
const RIEGEL_PRIOR_STRENGTH = 0.25;

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
  const elevPerKm = Math.min(300, Math.max(0, Number(elevationGainM) || 0) / Math.max(distanceKm, 0.1));
  const sens = FLAT_CLIMB_SENSITIVITY[activityType] ?? 1.0;
  return durationMin / (1 + sens * (elevPerKm / 100));
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
    const flatMin = flatEquivalentDuration(duration, distance, ele, activityType);
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

  return {
    minutes: Math.round(median * 10) / 10,
    hours: Math.round((median / 60) * 100) / 100,
    low: Math.round(low * 10) / 10,
    high: Math.round(high * 10) / 10,
    paceMinPerKm: ['run', 'walk', 'hike'].includes(activityType) ? median / distanceKm : null,
    speedKmh: Math.round(speedKmh * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    referenceSpeedKmh: Math.round(referenceSpeed(history, activityType) * 100) / 100,
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
