/**
 * Road-network routing for routes drawn on the map (OpenRouteService).
 *
 * The user's map taps stay as waypoints; this service asks the ORS directions
 * API to route between them along actual roads and returns the snapped
 * geometry as an [[lat, lng], …] path — the shape every TRANA component
 * already renders and measures.
 *
 * Requires the build-time VITE_ORS_API_KEY env var (Vercel → trana-web).
 * Every failure mode — no key, timeout, quota, offline, bad response —
 * resolves to null so callers keep their straight-line fallback.
 */

import { ROUTING } from '../config/mapConfig.js';

const API_KEY = (import.meta.env?.VITE_ORS_API_KEY ?? '').trim();

// The backend rejects routes with more than 2000 vertices; keep a small
// margin so long, winding roads can never trip validation.
const MAX_PATH_POINTS = 1900;

/**
 * True when a real (non-placeholder) routing key is configured.
 * @returns {boolean}
 */
export function routingEnabled() {
  if (!API_KEY || API_KEY.length < 32) return false;
  return !/PASTE|PLACEHOLDER|YOUR_/i.test(API_KEY);
}

/**
 * Map a TRANA activity type to an ORS routing profile.
 * @param {string} activityType
 * @returns {string}
 */
export function profileFor(activityType) {
  return ROUTING.profiles[activityType] ?? ROUTING.defaultProfile;
}

/**
 * Thin a dense path to at most `max` points, always keeping first and last.
 * @param {Array<[number, number]>} path
 * @param {number} max
 * @returns {Array<[number, number]>}
 */
function thinPath(path, max = MAX_PATH_POINTS) {
  if (path.length <= max) return path;
  const stride = Math.ceil(path.length / max);
  const out = path.filter((_, i) => i % stride === 0);
  const last = path[path.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Derive a small set of editing waypoints from a stored (possibly dense)
 * route path — used when hydrating the planner from a saved activity so the
 * map doesn't render one draggable marker per road vertex.
 *
 * @param {Array<[number, number]>} path
 * @param {number} maxPoints
 * @returns {Array<[number, number]>}
 */
export function waypointsFromPath(path, maxPoints = 12) {
  if (!Array.isArray(path) || path.length === 0) return [];
  if (path.length <= maxPoints) return path.map((p) => [...p]);
  const last = path.length - 1;
  const slots = maxPoints - 1;
  const out = [];
  for (let i = 0; i <= slots; i += 1) {
    out.push([...path[Math.round((i * last) / slots)]]);
  }
  return out;
}

/**
 * Route a sequence of [lat, lng] waypoints along the road network.
 *
 * @param {Array<[number, number]>} waypoints
 * @param {string} activityType - TRANA activity type (run/ride/walk/hike)
 * @returns {Promise<{path: Array<[number, number]>}|null>}
 *   Resolves to null when routing is unavailable or fails.
 */
export async function routeThroughRoads(waypoints, activityType) {
  if (!routingEnabled()) return null;
  if (!Array.isArray(waypoints) || waypoints.length < 2) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ROUTING.timeoutMs);

  try {
    const response = await fetch(
      `${ROUTING.baseUrl}/${profileFor(activityType)}/geojson`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, application/geo+json',
          Authorization: API_KEY,
        },
        body: JSON.stringify({
          // ORS wants [lng, lat]; TRANA stores [lat, lng].
          coordinates: waypoints.map(([lat, lng]) => [Number(lng), Number(lat)]),
          // Let the route double back at waypoints instead of demanding a
          // straight exit — required for drawn (non-heading) routes.
          options: { continue_straight: false },
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) return null;

    const data = await response.json();
    const coords = data?.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;

    const path = thinPath(
      coords.map(([lng, lat]) => [
        Number(Number(lat).toFixed(6)),
        Number(Number(lng).toFixed(6)),
      ]),
    );

    return { path };
  } catch {
    // Network error, timeout, quota or CORS failure — caller keeps straight lines.
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
