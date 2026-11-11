/**
 * Road- and path-network routing for routes drawn on the map.
 *
 * The user's map taps stay as anchor stops; this service routes between them
 * automatically along real streets, footpaths, park trails, and bikeways,
 * returning an [[lat, lng], …] path — the shape every TRANA component already
 * renders and measures.
 *
 * Provider chain (when `allowKeyless: true`, used by interactive UIs):
 *   1. OpenRouteService (when VITE_ORS_API_KEY is configured)
 *   2. OpenStreetMap OSRM (routed-foot / routed-bike, no API key required)
 *   3. Valhalla FOSSGIS (pedestrian / bicycle polyline6, no API key required)
 *
 * Every failure mode — timeout, quota, offline, unroutable point — resolves
 * cleanly to null so callers can keep a straight-line fallback.
 */

import { ROUTING } from '../config/mapConfig.js';

const API_KEY = (import.meta.env?.VITE_ORS_API_KEY ?? '').trim();

// The backend rejects routes with more than 2000 vertices; keep a small
// margin so long, winding roads can never trip validation.
const MAX_PATH_POINTS = 1900;

/**
 * True when a real (non-placeholder) ORS routing key is configured.
 * @returns {boolean}
 */
export function routingEnabled() {
  if (!API_KEY || API_KEY.length < 32) return false;
  return !/PASTE|PLACEHOLDER|YOUR_/i.test(API_KEY);
}

/**
 * True when automatic road/path following is available in the UI (true even
 * without an ORS key thanks to OpenStreetMap OSRM & Valhalla fallbacks).
 * @returns {boolean}
 */
export function autoRoutingAvailable() {
  return true;
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

function roundCoord(value) {
  return Number(Number(value).toFixed(6));
}

function normalizeWaypoints(waypoints) {
  if (!Array.isArray(waypoints)) return [];
  const clean = [];
  for (const pt of waypoints) {
    if (!Array.isArray(pt) || pt.length < 2) return [];
    const lat = Number(pt[0]);
    const lng = Number(pt[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    clean.push([lat, lng]);
  }
  return clean;
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
 * Decode a Valhalla / Mapbox precision-6 (1e6) encoded polyline into
 * [[lat, lng], …] coordinates.
 *
 * @param {string} encoded
 * @returns {Array<[number, number]>}
 */
export function decodePolyline6(encoded) {
  if (typeof encoded !== 'string' || !encoded.length) return [];
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let b = 0;
    do {
      if (index >= encoded.length) return points;
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      if (index >= encoded.length) return points;
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([roundCoord(lat * 1e-6), roundCoord(lng * 1e-6)]);
  }

  return points;
}

/**
 * True when the start and end waypoints already sit at roughly the same spot
 * (~25 m), so "Loop" / "Out & Back" won't stack redundant points.
 *
 * @param {Array<[number, number]>} waypoints
 * @returns {boolean}
 */
export function isClosedLoop(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length < 3) return false;
  const first = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  if (!Array.isArray(first) || !Array.isArray(last)) return false;
  return Math.abs(first[0] - last[0]) < 0.00025 && Math.abs(first[1] - last[1]) < 0.00025;
}

/**
 * Mirror a sequence of waypoints back to its start along the same stops
 * (`[A, B, C]` → `[A, B, C, B, A]`).
 *
 * @param {Array<[number, number]>} waypoints
 * @returns {Array<[number, number]>}
 */
export function outAndBackWaypoints(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    return Array.isArray(waypoints) ? waypoints.map((p) => [...p]) : [];
  }
  if (isClosedLoop(waypoints)) return waypoints.map((p) => [...p]);
  const forward = waypoints.map((p) => [...p]);
  const back = forward.slice(0, -1).reverse().map((p) => [...p]);
  return [...forward, ...back];
}

/**
 * Connect the final waypoint back to the starting point so the road router
 * completes a loop (`[A, B, C]` → `[A, B, C, A]`).
 *
 * @param {Array<[number, number]>} waypoints
 * @returns {Array<[number, number]>}
 */
export function closeLoopWaypoints(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    return Array.isArray(waypoints) ? waypoints.map((p) => [...p]) : [];
  }
  if (isClosedLoop(waypoints)) return waypoints.map((p) => [...p]);
  return [...waypoints.map((p) => [...p]), [...waypoints[0]]];
}

/**
 * Reverse waypoint order (`Start ↔ Finish`).
 *
 * @param {Array<[number, number]>} waypoints
 * @returns {Array<[number, number]>}
 */
export function reverseWaypoints(waypoints) {
  if (!Array.isArray(waypoints)) return [];
  return [...waypoints].reverse().map((p) => [...p]);
}

/**
 * Convert an [[lat, lng], …] polyline into a GeoJSON FeatureCollection for
 * MapLibre's PlannedRoute layer.
 *
 * @param {Array<[number, number]>} path
 * @param {string} [activityType]
 * @returns {object|null}
 */
export function pathToGeoJson(path, activityType = 'run') {
  const clean = normalizeWaypoints(path);
  if (clean.length < 2) return null;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { activity_type: activityType },
        geometry: {
          type: 'LineString',
          coordinates: clean.map(([lat, lng]) => [lng, lat]),
        },
      },
    ],
  };
}

async function fetchWithTimeout(url, init, externalSignal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ROUTING.timeoutMs);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

async function routeViaOrs(waypoints, activityType, externalSignal) {
  try {
    const response = await fetchWithTimeout(
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
          coordinates: waypoints.map(([lat, lng]) => [lng, lat]),
          // Let the route double back at waypoints instead of demanding a
          // straight exit — required for drawn / out-and-back routes.
          options: { continue_straight: false },
        }),
      },
      externalSignal,
    );

    if (!response.ok) return null;
    const data = await response.json();
    const coords = data?.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;

    const path = thinPath(coords.map(([lng, lat]) => [roundCoord(lat), roundCoord(lng)]));
    return { path, provider: 'ors', providerLabel: 'OpenRouteService' };
  } catch {
    return null;
  }
}

async function routeViaOsrm(waypoints, activityType, externalSignal) {
  const base = ROUTING.osrmUrls?.[activityType] ?? ROUTING.osrmUrls?.run;
  if (!base) return null;

  try {
    const coordStr = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
    const url = `${base}/${coordStr}?overview=full&geometries=geojson&steps=false&continue_straight=false`;
    const response = await fetchWithTimeout(
      url,
      { method: 'GET', headers: { Accept: 'application/json' } },
      externalSignal,
    );

    if (!response.ok) return null;
    const data = await response.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;

    const path = thinPath(coords.map(([lng, lat]) => [roundCoord(lat), roundCoord(lng)]));
    return { path, provider: 'osrm', providerLabel: 'OpenStreetMap' };
  } catch {
    return null;
  }
}

async function routeViaValhalla(waypoints, activityType, externalSignal) {
  if (!ROUTING.valhallaUrl || waypoints.length > 20) return null;

  try {
    const response = await fetchWithTimeout(
      ROUTING.valhallaUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          locations: waypoints.map(([lat, lng]) => ({ lat, lon: lng })),
          costing: activityType === 'ride' ? 'bicycle' : 'pedestrian',
          directions_options: { units: 'kilometers' },
        }),
      },
      externalSignal,
    );

    if (!response.ok) return null;
    const data = await response.json();
    const legs = data?.trip?.legs;
    if (!Array.isArray(legs) || legs.length === 0) return null;

    const combined = [];
    for (const leg of legs) {
      const decoded = decodePolyline6(leg?.shape);
      for (let i = 0; i < decoded.length; i += 1) {
        const pt = decoded[i];
        const prev = combined[combined.length - 1];
        if (!prev || prev[0] !== pt[0] || prev[1] !== pt[1]) {
          combined.push(pt);
        }
      }
    }

    if (combined.length < 2) return null;
    return {
      path: thinPath(combined),
      provider: 'valhalla',
      providerLabel: 'Valhalla OSM',
    };
  } catch {
    return null;
  }
}

/**
 * Route a sequence of [lat, lng] waypoints along the designated road & path
 * network (streets, sidewalks, bike lanes, and park/mountain trails).
 *
 * @param {Array<[number, number]>} waypoints
 * @param {string} activityType - TRANA activity type (run/ride/walk/hike)
 * @param {{ allowKeyless?: boolean, signal?: AbortSignal }} [options]
 * @returns {Promise<{path: Array<[number, number]>, provider: string, providerLabel: string}|null>}
 *   Resolves to null when routing is unavailable or every provider fails.
 */
export async function routeThroughRoads(waypoints, activityType, options = {}) {
  const clean = normalizeWaypoints(waypoints);
  if (clean.length < 2) return null;

  const { allowKeyless = false, signal } = options;
  const hasOrsKey = routingEnabled();
  if (!hasOrsKey && !allowKeyless) return null;
  if (signal?.aborted) return null;

  if (hasOrsKey) {
    const ors = await routeViaOrs(clean, activityType, signal);
    if (ors) return ors;
    if (signal?.aborted) return null;
  }

  if (allowKeyless) {
    const osrm = await routeViaOsrm(clean, activityType, signal);
    if (osrm) return osrm;
    if (signal?.aborted) return null;

    const valhalla = await routeViaValhalla(clean, activityType, signal);
    if (valhalla) return valhalla;
  }

  return null;
}

/**
 * Search streets, parks, or landmarks via OpenStreetMap Nominatim so athletes
 * can pick a destination by name and let TRANA follow the roads to it.
 *
 * @param {string} query
 * @param {{ near?: [number, number]|null, limit?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<Array<{label: string, shortName: string, latitude: number, longitude: number}>>}
 */
export async function searchPlaces(query, options = {}) {
  const trimmed = typeof query === 'string' ? query.trim() : '';
  if (trimmed.length < 2 || !ROUTING.nominatimUrl) return [];

  const { near = null, limit = 5, signal } = options;
  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: String(limit),
    q: trimmed,
  });

  if (Array.isArray(near) && near.length === 2 && Number.isFinite(near[0]) && Number.isFinite(near[1])) {
    const [lat, lng] = near;
    params.set('viewbox', `${(lng - 0.35).toFixed(4)},${(lat + 0.35).toFixed(4)},${(lng + 0.35).toFixed(4)},${(lat - 0.35).toFixed(4)}`);
    params.set('bounded', '0');
  }

  try {
    const response = await fetchWithTimeout(
      `${ROUTING.nominatimUrl}?${params.toString()}`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      signal,
    );
    if (!response.ok) return [];
    const rows = await response.json();
    if (!Array.isArray(rows)) return [];

    return rows
      .map((row) => {
        const latitude = Number(row?.lat);
        const longitude = Number(row?.lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
        const label = String(row?.display_name ?? '').trim();
        const shortName = String(row?.name || label.split(',')[0] || '').trim();
        if (!label) return null;
        return { label, shortName: shortName || label, latitude: roundCoord(latitude), longitude: roundCoord(longitude) };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
