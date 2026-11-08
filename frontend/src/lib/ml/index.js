/**
 * The TRANA prediction pipeline used by the UI.
 *
 *   planned activity + this athlete's history
 *        → duration (ML, quantile range)
 *        → fueling (physiology formulas)
 *        → one recommendation object
 *
 * In live mode the exact same shape comes back from `POST /api/predictions`
 * (Laravel → FastAPI), so components never care where a number was computed.
 */

import { experienceLevel, loadModel, predictDuration, referenceSpeed } from './duration.js';
import { recommendFueling } from './fueling.js';

export { loadModel, predictDuration, referenceSpeed, experienceLevel };

let cardPromise = null;

/** Model card (metrics, feature importances) for the Analytics screen. */
export function loadModelCard() {
  if (!cardPromise) {
    cardPromise = fetch('/models/model_card.json')
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return cardPromise;
}

/** Great-circle distance of a [[lat, lng], …] polyline, in km. */
export function routeLengthKm(points = []) {
  const R = 6371.0088;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [lat1, lon1] = points[i - 1];
    const [lat2, lon2] = points[i];
    const p1 = (lat1 * Math.PI) / 180;
    const p2 = (lat2 * Math.PI) / 180;
    const dPhi = p2 - p1;
    const dLambda = ((lon2 - lon1) * Math.PI) / 180;
    const h = Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) ** 2;
    total += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  return total;
}

/** Coarse surface length: sensible default elevation when the user hasn't entered it. */
export function suggestElevation(distanceKm, activityType) {
  const perKm = { run: 8, ride: 9, walk: 6, hike: 45 }[activityType] ?? 8;
  return Math.round(distanceKm * perKm);
}

export async function predictPlan({ activity, profile, activities = [] }) {
  const [model, card] = await Promise.all([loadModel(), loadModelCard()]);
  const history = activities
    .filter((a) => a.duration_min && a.distance_km)
    .map((a) => ({
      id: a.id,
      activity_type: a.activity_type,
      distance_km: Number(a.distance_km),
      duration_min: Number(a.duration_min),
      elevation_gain_m: Number(a.elevation_gain_m) || 0,
    }));

  const distanceKm = Number(activity.distance_km) || 0;
  const elevationGainM = Number(activity.elevation_gain_m) || 0;
  const weightKg = Number(profile?.weight_kg) || 60;
  const experience = profile?.experience_level ?? experienceLevel(activities.length);

  const duration = predictDuration({
    model,
    activityType: activity.activity_type,
    distanceKm,
    elevationGainM,
    weightKg,
    experienceLevel: experience,
    history,
  });

  const fueling = recommendFueling({
    activityType: activity.activity_type,
    durationMin: duration.minutes,
    weightKg,
    elevationPerKm: elevationGainM / Math.max(distanceKm, 0.1),
    avgSpeedKmh: duration.speedKmh,
    sweatProfile: profile?.sweat_profile || 'normal',
    temperatureC: activity.temperature_c ?? profile?.typical_temperature_c ?? 24,
    dailyCarbTargetG: profile?.daily_carb_goal_g,
  });

  return {
    activity_type: activity.activity_type,
    distance_km: round(distanceKm, 2),
    elevation_gain_m: Math.round(elevationGainM),
    route: activity.route ?? null,
    duration,
    fueling,
    history_used: history.filter((h) => h.activity_type === activity.activity_type).length,
    model: {
      name: card?.name ?? 'TRANA duration model',
      version: card?.version ?? 'offline-fallback',
      basis: duration.basis,
      metrics: card?.metrics ?? null,
      feature_importance: card?.feature_importance ?? null,
    },
    generated_at: new Date().toISOString(),
  };
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
