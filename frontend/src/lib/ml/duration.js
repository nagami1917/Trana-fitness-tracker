/**
 * Duration prediction in the browser.
 *
 * This is a faithful JavaScript port of `ml/duration_model/preprocess.py` +
 * `model_store.py`, evaluating the exact same gradient-boosted trees exported
 * from scikit-learn (`public/models/duration_model.json`). It runs when the PWA
 * for on-device previews. The server calculation is authoritative when a plan is saved.
 *
 *   base      = exp(a + b · ln(distance))        ← athlete's own distance→time curve
 *   duration  = base · exp(f(distance, elevation, weight, experience, modality))
 */

export const ACTIVITY_TYPES = ['run', 'ride', 'walk', 'hike'];

export const DEFAULT_SPEED_KMH = { run: 8.8, ride: 20.0, walk: 4.7, hike: 3.6 };
export const RIEGEL_EXPONENT = { run: 1.06, walk: 1.06, hike: 1.15, ride: 1.03 };

export const FEATURE_ORDER = [
  'distance_km',
  'elevation_gain_m',
  'elevation_per_km',
  'weight_kg',
  'experience_level',
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

/** Fit log t = a + b·log d on the athlete's own history for one modality. */
export function referenceCurve(history = [], activityType, excludeId = null) {
  const points = [];
  for (const row of history) {
    if (row.activity_type !== activityType) continue;
    if (excludeId != null && row.id === excludeId) continue;
    const distance = Number(row.distance_km) || 0;
    const duration = Number(row.duration_min) || 0;
    if (distance > 0 && duration > 0) points.push([Math.log(distance), Math.log(duration)]);
  }

  const defaultB = RIEGEL_EXPONENT[activityType] ?? 1.0;
  if (points.length === 0) {
    const speed = DEFAULT_SPEED_KMH[activityType] ?? 6;
    return { a: Math.log(60 / speed), b: 1, source: 'no_history' };
  }
  if (points.length === 1) {
    const [x, y] = points[0];
    return { a: y - defaultB * x, b: defaultB, source: 'single_activity' };
  }

  const n = points.length;
  const meanX = points.reduce((s, p) => s + p[0], 0) / n;
  const meanY = points.reduce((s, p) => s + p[1], 0) / n;
  const varX = points.reduce((s, p) => s + (p[0] - meanX) ** 2, 0);
  if (varX < 1e-9) {
    const [x, y] = points[0];
    return { a: y - defaultB * x, b: defaultB, source: 'single_distance' };
  }
  let b = points.reduce((s, p) => s + (p[0] - meanX) * (p[1] - meanY), 0) / varX;
  b = Math.min(1.35, Math.max(0.85, b));
  return { a: meanY - b * meanX, b, source: 'personal_curve', points: n };
}

export function baseMinutes(distanceKm, a, b) {
  const d = Math.max(distanceKm, 0.1);
  const minutes = Math.exp(a + b * Math.log(d));
  return Math.min(45 * d, Math.max(2 * d, minutes));
}

export function referenceSpeed(history = [], activityType, excludeId = null) {
  const speeds = history
    .filter((r) => r.activity_type === activityType && (excludeId == null || r.id !== excludeId))
    .map((r) => (Number(r.duration_min) > 0 ? Number(r.distance_km) / (Number(r.duration_min) / 60) : 0))
    .filter((v) => v > 0);
  if (!speeds.length) return DEFAULT_SPEED_KMH[activityType] ?? 6;
  return speeds.reduce((a, b) => a + b, 0) / speeds.length;
}

export function experienceLevel(totalActivities = 0) {
  if (totalActivities >= 40) return 5;
  if (totalActivities >= 24) return 4;
  if (totalActivities >= 12) return 3;
  if (totalActivities >= 5) return 2;
  return 1;
}

export function featureRow({ activityType, distanceKm, elevationGainM, weightKg, experience }) {
  const d = Math.max(0.1, Number(distanceKm) || 0);
  const e = Math.max(0, Number(elevationGainM) || 0);
  return [
    d,
    e,
    e / d,
    Math.max(30, Number(weightKg) || 0),
    Number(experience) || 3,
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
  weightKg = 60,
  experienceLevel: exp,
  history = [],
}) {
  const curve = referenceCurve(history, activityType);
  const base = baseMinutes(distanceKm, curve.a, curve.b);
  const experience = exp ?? experienceLevel(history.length);
  const x = featureRow({ activityType, distanceKm, elevationGainM, weightKg, experience });

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
    basis = 'gradient_boosted_pace_factor';
  } else {
    const climb = 1 / (1 + (1.4 * (elevationGainM / Math.max(distanceKm, 0.1))) / 100);
    const fatigue = 1 / (1 + 0.012 * Math.max(0, distanceKm - 8));
    median = base / (climb * fatigue);
    const spread = Math.max(3, median * 0.14);
    low = median - spread;
    high = median + spread;
    basis = 'physics_fallback';
  }

  const speedKmh = distanceKm / (median / 60);
  return {
    minutes: Math.round(median * 10) / 10,
    hours: Math.round((median / 60) * 100) / 100,
    low: Math.round(Math.max(1, low) * 10) / 10,
    high: Math.round(high * 10) / 10,
    paceMinPerKm: ['run', 'walk', 'hike'].includes(activityType) ? median / distanceKm : null,
    speedKmh: Math.round(speedKmh * 100) / 100,
    confidence: Math.min(0.97, Math.max(0.35, 1 - (high - low) / (2 * median))),
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
