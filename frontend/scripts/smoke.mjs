/**
 * Headless smoke test for the browser prediction pipeline.
 *
 *   node scripts/smoke.mjs
 *
 * Exercises the demo backend + the ported ML engine exactly as the UI does,
 * without a browser. Useful in CI and for comparing the JS port against the
 * Python service (see ml/evaluation/sanity_check.py).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const modelPath = resolve(here, '../public/models/duration_model.json');
const cardPath = resolve(here, '../public/models/model_card.json');
const modelJson = readFileSync(modelPath, 'utf8');
const cardJson = readFileSync(cardPath, 'utf8');

// --- minimal browser stubs -------------------------------------------------
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.fetch = async (url) => {
  const body = String(url).includes('model_card') ? cardJson : modelJson;
  return { ok: true, json: async () => JSON.parse(body), text: async () => body };
};

const { demoApi } = await import('../src/services/demo.js');
const { predictPlan, loadModel } = await import('../src/lib/ml/index.js');
const { loadModelCard } = await import('../src/lib/ml/index.js');

const model = await loadModel();
const card = await loadModelCard();
console.log(`model v${card.version} · R² ${card.metrics.r2} · MAE ${card.metrics.mae_min} min`);
if (!model?.models?.q50) throw new Error('trees failed to load');

// --- seeded history --------------------------------------------------------
const activities = await demoApi.activities.list();
const profile = await demoApi.profile.get();
const runs = activities.filter((a) => a.activity_type === 'run');
console.log(`${activities.length} seeded activities (${runs.length} runs), ${profile.weight_kg} kg athlete\n`);

const CASES = [
  ['run', 5, 40],
  ['run', 10, 80],
  ['run', 21.1, 180],
  ['ride', 40, 250],
  ['walk', 5, 20],
  ['hike', 8, 400],
];

console.log('type  dist   gain   duration            kcal  carbs/h  sodium/h  fluid/h');
for (const [activity_type, distance_km, elevation_gain_m] of CASES) {
  const plan = await predictPlan({
    activity: { activity_type, distance_km, elevation_gain_m },
    profile,
    activities,
  });
  const d = plan.duration;
  const f = plan.fueling;
  console.log(
    [
      activity_type.padEnd(5),
      String(distance_km).padStart(5),
      String(elevation_gain_m).padStart(5),
      ` ${Math.round(d.minutes)} min (${Math.round(d.low)}–${Math.round(d.high)})`.padEnd(20),
      String(f.calories.total).padStart(5),
      `${f.carbs.perHourG} g/h`.padStart(8),
      `${f.sodium.perHourMg} mg/h`.padStart(10),
      `${f.fluid.perHourMl} ml/h`.padStart(9),
    ].join(''),
  );
}

// --- persisted plan round-trip --------------------------------------------
const saved = await demoApi.predictions.create({
  activity_type: 'run',
  distance_km: 12,
  elevation_gain_m: 90,
});
const plans = await demoApi.predictions.list();
if (!plans.find((p) => p.id === saved.id)) throw new Error('plan was not persisted');
console.log(`\nsaved plan #${saved.id}: ${Math.round(saved.duration.minutes)} min, ${saved.fueling.carbs.totalG} g carbs`);

// --- monotonicity + sanity guards -----------------------------------------
const a = await predictPlan({ activity: { activity_type: 'run', distance_km: 8, elevation_gain_m: 40 }, profile, activities });
const b = await predictPlan({ activity: { activity_type: 'run', distance_km: 16, elevation_gain_m: 80 }, profile, activities });
if (!(b.duration.minutes > a.duration.minutes)) throw new Error('longer run did not take longer');
if (!(a.duration.low <= a.duration.minutes && a.duration.minutes <= a.duration.high)) {
  throw new Error('quantile interval is not ordered');
}
const flat = await predictPlan({ activity: { activity_type: 'run', distance_km: 10, elevation_gain_m: 0 }, profile, activities });
const hilly = await predictPlan({ activity: { activity_type: 'run', distance_km: 10, elevation_gain_m: 600 }, profile, activities });
if (!(hilly.duration.minutes > flat.duration.minutes)) throw new Error('hills did not slow the athlete down');

console.log('sanity guards passed ✔');
