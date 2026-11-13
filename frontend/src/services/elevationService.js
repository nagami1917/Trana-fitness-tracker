/**
 * Real terrain elevation lookup along a plotted `[lat, lng]` route.
 *
 * Uses Open-Meteo's CORS-enabled elevation API (Copernicus 90m DEM) for up to
 * 80 sampled points along the route, computes smoothed ascent/descent and an
 * elevation profile array, and falls back smoothly to `suggestElevation()`
 * whenever offline or rate-limited.
 */

import { haversineKm } from './mapService.js';
import { computeSmoothedElevationGain, thinPoints } from '../lib/gpx.js';
import { suggestElevation } from '../lib/ml/index.js';

const CACHE = new Map();
const MAX_CACHE = 32;

function cacheKey(coords) {
  if (!coords?.length) return '';
  const first = coords[0];
  const last = coords[coords.length - 1];
  const mid = coords[Math.floor(coords.length / 2)];
  return [first, mid, last, coords.length]
    .map((p) => (Array.isArray(p) ? `${p[0].toFixed(4)},${p[1].toFixed(4)}` : String(p)))
    .join('|');
}

function buildProfilePoints(coords, elevations) {
  const profile = [];
  let cumKm = 0;
  for (let i = 0; i < coords.length; i += 1) {
    if (i > 0) cumKm += haversineKm(coords[i - 1], coords[i]);
    const ele = Number(elevations[i]);
    if (Number.isFinite(ele)) {
      profile.push({
        distKm: Math.round(cumKm * 100) / 100,
        eleM: Math.round(ele),
      });
    }
  }
  return profile;
}

/**
 * Fetch DEM elevation along `route` (`[[lat, lng], ...]`).
 * Returns `{ gainM, lossM, minM, maxM, profile, source }`.
 */
export async function fetchRouteElevation(route = [], activityType = 'run', { signal } = {}) {
  if (!Array.isArray(route) || route.length < 2) {
    return { gainM: 0, lossM: 0, minM: 0, maxM: 0, profile: [], source: 'none' };
  }

  const sampled = thinPoints(route, 75);
  const key = cacheKey(sampled);
  if (CACHE.has(key)) return CACHE.get(key);

  let totalKm = 0;
  for (let i = 1; i < route.length; i += 1) totalKm += haversineKm(route[i - 1], route[i]);

  try {
    const lats = sampled.map((p) => Number(p[0]).toFixed(5)).join(',');
    const lngs = sampled.map((p) => Number(p[1]).toFixed(5)).join(',');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });

    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`, {
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const eles = Array.isArray(data?.elevation) ? data.elevation.map(Number) : [];
    if (eles.length < 2 || eles.some((n) => !Number.isFinite(n))) {
      throw new Error('Invalid elevation series');
    }

    const gainM = computeSmoothedElevationGain(eles);
    const lossM = computeSmoothedElevationGain([...eles].reverse());
    const profile = buildProfilePoints(sampled, eles);
    const result = {
      gainM,
      lossM,
      minM: Math.round(Math.min(...eles)),
      maxM: Math.round(Math.max(...eles)),
      profile,
      source: 'dem',
    };

    if (CACHE.size >= MAX_CACHE) {
      CACHE.delete(CACHE.keys().next().value);
    }
    CACHE.set(key, result);
    return result;
  } catch {
    return {
      gainM: suggestElevation(totalKm, activityType),
      lossM: 0,
      minM: 0,
      maxM: 0,
      profile: [],
      source: 'estimate',
    };
  }
}
