/**
 * TRANA prediction integration interface.
 *
 * This module prepares the route analysis the TRANA ML system needs and sends
 * it to POST /api/predictions (Laravel → FastAPI). It is a pass-through: no
 * duration, calorie, carb or electrolyte values are invented here. When the ML
 * service is unavailable the call fails visibly instead of faking a result.
 *
 * Later, when a real ML endpoint is wired up, this is the only file that needs
 * to change on the frontend side.
 */

import { api } from './client.js';
import { polylineLengthKm, haversineKm } from '../lib/geo.js';
import { robustElevationGain } from '../lib/elevation.js';

/**
 * Build the ML-facing analysis of a tracked or planned route.
 *
 * Returns:
 *   totalDistanceKm, durationMin, avgSpeedKmh, avgPaceMinKm, elevationGainM,
 *   route ([lat, lng] points), plannedDistanceKm, plannedDurationMin,
 *   elevation (altitude samples where available)
 */
export function routeAnalysis({
  points = [],
  startedAt,
  endedAt,
  activityType,
  plannedDistanceKm = null,
  plannedDurationMin = null,
}) {
  const coords = points.map((p) => [p.latitude, p.longitude]);
  const distanceKm = polylineLengthKm(coords);
  const durationSec = endedAt && startedAt
    ? (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000
    : 0;
  const durationMin = durationSec / 60;
  const avgSpeedKmh = distanceKm > 0 && durationMin > 0 ? distanceKm / (durationMin / 60) : 0;
  const avgPaceMinKm = distanceKm > 0 && durationMin > 0 ? durationMin / distanceKm : 0;
  const elevation = points
    .map((p) => p.altitudeM)
    .filter((v) => v != null);
  // Same filtered ascent the tracker shows. Summing raw altitude steps here
  // would feed a noise-inflated climb into the prediction that the athlete
  // never saw, and the two numbers would disagree on the same activity.
  const gain = robustElevationGain(points, { haversine: haversineKm });

  return {
    activityType,
    totalDistanceKm: Math.round(distanceKm * 100) / 100,
    durationMin: Math.round(durationMin * 10) / 10,
    avgSpeedKmh: Math.round(avgSpeedKmh * 10) / 10,
    avgPaceMinKm: Math.round(avgPaceMinKm * 100) / 100,
    elevationGainM: gain.gainM,
    route: coords,
    elevation,
    plannedDistanceKm,
    plannedDurationMin,
  };
}

/**
 * Send a completed activity's analysis to the prediction API.
 * The server computes duration, calories, carbs, electrolytes, fluid, etc.
 */
export async function submitForPrediction(analysis, profile = {}) {
  const payload = {
    activity_type: analysis.activityType,
    distance_km: analysis.totalDistanceKm || analysis.plannedDistanceKm,
    elevation_gain_m: analysis.elevationGainM,
    route: analysis.route,
    temperature_c: profile.typical_temperature_c ?? 24,
    sweat_profile: profile.sweat_profile ?? 'normal',
  };

  const data = await api.predictions.create(payload).then((d) => d.data);
  return data;
}

/** List the athlete's saved predictions. */
export function listPredictions() {
  return api.predictions.list();
}
