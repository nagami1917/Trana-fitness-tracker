/**
 * Deterministic demo dataset.
 *
 * Used when the app runs without a Laravel API (instant preview / offline PWA).
 * It is shaped exactly like the Supabase rows the real backend returns, so the
 * UI needs no knowledge of where data came from.
 */

import { estimateMet } from '../ml/fueling.js';
import { routeLengthKm } from '../ml/index.js';

const CITY = { lat: 14.676, lng: 121.0437 }; // Quezon City

const TRUE_SPEED = { run: 10.3, ride: 21.5, walk: 4.9, hike: 3.7 };

function mulberry32(a) {
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a wandering loop and rescale it so its length matches the target. */
export function syntheticRoute(distanceKm, rand, center = CITY) {
  const points = [];
  const segments = 26;
  let angle = rand() * Math.PI * 2;
  let lat = center.lat;
  let lng = center.lng;
  for (let i = 0; i < segments; i += 1) {
    angle += (rand() - 0.5) * 0.9;
    lat += Math.sin(angle) * 0.0016;
    lng += Math.cos(angle) * 0.0016;
    points.push([lat, lng]);
  }
  const actual = routeLengthKm(points) || 1;
  const factor = distanceKm / actual;
  const midLat = points.reduce((s, p) => s + p[0], 0) / points.length;
  const midLng = points.reduce((s, p) => s + p[1], 0) / points.length;
  return points.map(([la, ln]) => [
    Number((midLat + (la - midLat) * factor).toFixed(5)),
    Number((midLng + (ln - midLng) * factor).toFixed(5)),
  ]);
}

const PLAN_TEMPLATES = [
  { type: 'run', distance: 12, elevation: 90 },
  { type: 'ride', distance: 35, elevation: 280 },
  { type: 'hike', distance: 9, elevation: 520 },
];

export function createSeedState() {
  const rand = mulberry32(20261103);
  const now = new Date();

  const profile = {
    id: 1,
    name: 'Nagami',
    email: 'nagami@trana.app',
    avatar_url: '/mascot-cat.png',
    weight_kg: 55,
    height_cm: 162,
    birth_year: 1999,
    sex: 'female',
    city: 'Quezon City, PH',
    sweat_profile: 'normal',
    experience_level: 4,
    typical_temperature_c: 27,
    daily_calorie_goal: 2700,
    daily_carb_goal_g: 330,
    daily_distance_goal_km: 10,
    daily_active_min_goal: 90,
    weekly_calorie_goal: 15000,
    weekly_distance_goal_km: 45,
    units: 'metric',
    onboarded: true,
  };

  const activities = [];
  let id = 1;
  const dayPlan = [
    // days ago, type, distance
    [0, 'run', 5.0],
    [0, 'walk', 1.6],
    [1, 'run', 8.2],
    [2, 'ride', 12.0],
    [3, 'walk', 3.2],
    [4, 'run', 4.6],
    [5, 'hike', 7.4],
    [6, 'run', 10.1],
    [8, 'ride', 24.5],
    [9, 'run', 6.3],
    [10, 'run', 5.1],
    [12, 'walk', 4.0],
    [13, 'run', 7.8],
    [15, 'hike', 11.2],
    [16, 'run', 4.2],
    [18, 'ride', 18.0],
    [19, 'run', 9.4],
    [21, 'run', 5.6],
    [23, 'walk', 2.8],
    [25, 'run', 12.4],
    [28, 'ride', 30.6],
    [30, 'run', 6.0],
    [33, 'run', 5.3],
    [36, 'hike', 8.8],
    [38, 'run', 8.6],
    [42, 'ride', 22.1],
    [45, 'run', 4.8],
    [49, 'run', 7.2],
    [53, 'walk', 3.5],
    [57, 'run', 9.0],
    [61, 'ride', 26.4],
    [66, 'run', 5.9],
  ];

  for (const [daysAgo, type, distance] of dayPlan) {
    const started = new Date(now);
    started.setDate(started.getDate() - daysAgo);
    if (type === 'walk' && daysAgo > 0) started.setHours(19, 10, 0, 0);
    else started.setHours(6 + Math.floor(rand() * 3), Math.floor(rand() * 60), 0, 0);

    // Never seed a session in the future — the demo may be opened at 5 a.m.
    if (started > now) started.setTime(now.getTime() - (daysAgo === 0 ? 2 : 0.5) * 3600 * 1000);

    const elevationPerKm =
      type === 'hike' ? 40 + rand() * 45 : type === 'ride' ? 6 + rand() * 10 : 4 + rand() * 9;
    const elevation = Math.round(distance * elevationPerKm);
    const speed = TRUE_SPEED[type] * (0.94 + rand() * 0.12) * (1 - Math.min(0.18, elevationPerKm * 0.0012));
    const minutes = Math.round((distance / speed) * 60);
    const met = estimateMet(type, speed, elevationPerKm);
    const calories = Math.round(met * profile.weight_kg * (minutes / 60));

    activities.push({
      id: id++,
      activity_type: type,
      distance_km: Number(distance.toFixed(2)),
      elevation_gain_m: elevation,
      duration_min: minutes,
      calories,
      avg_heart_rate: Math.round(112 + met * 4 + rand() * 9),
      started_at: started.toISOString(),
      route: syntheticRoute(distance, rand),
      notes: null,
      source: 'manual',
    });
  }

  const plans = [];

  return {
    profile,
    activities,
    plans,
    goals: {
      daily_calories: profile.daily_calorie_goal,
      daily_distance_km: profile.daily_distance_goal_km,
      daily_active_min: profile.daily_active_min_goal,
      weekly_calories: profile.weekly_calorie_goal,
      weekly_distance_km: profile.weekly_distance_goal_km,
    },
    templates: PLAN_TEMPLATES,
    session: null,
  };
}
