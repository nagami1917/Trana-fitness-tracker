/**
 * Road snapping service for TRANA.
 *
 * Queries the free Overpass API (OpenStreetMap) to find road ways near a GPS
 * point and snaps the point to the nearest road segment. No API key required.
 *
 * Overpass QL query finds all road ways within a radius of the point, then the
 * service computes the closest point on each road segment and returns the
 * snapped coordinate.
 */

import { ROAD_SNAPPING } from '../config/mapConfig.js';

const OVERPASS_TIMEOUT = 15000; // 15 seconds

/**
 * Build an Overpass QL query to find road ways near a point.
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} radiusM - Search radius in metres
 * @returns {string} Overpass QL query string
 */
function buildOverpassQuery(lat, lng, radiusM) {
  const roadTypes = ROAD_SNAPPING.roadTypes.join('|');
  return `
    [out:json][timeout:25];
    (
      way["highway"~"(${roadTypes})"](around:${radiusM},${lat},${lng});
    );
    out geom;
  `;
}

/**
 * Compute the closest point on a line segment to a given point.
 * Returns { lat, lng, distM } where distM is the distance in metres.
 *
 * @param {number} lat - Point latitude
 * @param {number} lng - Point longitude
 * @param {number} lat1 - Segment start latitude
 * @param {number} lng1 - Segment start longitude
 * @param {number} lat2 - Segment end latitude
 * @param {number} lng2 - Segment end longitude
 * @returns {{lat:number, lng:number, distM:number}|null}
 */
function closestPointOnSegment(lat, lng, lat1, lng1, lat2, lng2) {
  // Convert to approximate metres for projection math
  const toMeters = (dLat, dLng) => {
    const mPerLat = 111132.92;
    const mPerLng = 111132.92 * Math.cos((lat * Math.PI) / 180);
    return { x: dLng * mPerLng, y: dLat * mPerLat };
  };

  const p = toMeters(lat, lng);
  const a = toMeters(lat1, lng1);
  const b = toMeters(lat2, lng2);

  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const apX = p.x - a.x;
  const apY = p.y - a.y;

  const abLenSq = abX * abX + abY * abY;
  if (abLenSq === 0) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    return { lat: lat1, lng: lng1, distM: Math.sqrt(dx * dx + dy * dy) };
  }

  // Project point onto line, clamped to segment
  let t = (apX * abX + apY * abY) / abLenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = a.x + t * abX;
  const closestY = a.y + t * abY;

  // Convert back to lat/lng
  const mPerLat = 111132.92;
  const mPerLng = 111132.92 * Math.cos((lat * Math.PI) / 180);
  const closestLat = lat1 + (closestY - a.y) / mPerLat;
  const closestLng = lng1 + (closestX - a.x) / mPerLng;

  const dx = p.x - closestX;
  const dy = p.y - closestY;
  const distM = Math.sqrt(dx * dx + dy * dy);

  return { lat: closestLat, lng: closestLng, distM };
}

/**
 * Parse Overpass geometry and find the closest road point to the given point.
 *
 * @param {number} lat - Point latitude
 * @param {number} lng - Point longitude
 * @param {Array} elements - Overpass elements with geometry
 * @returns {{lat:number, lng:number, distM:number}|null}
 */
function findNearestRoadPoint(lat, lng, elements) {
  let best = null;

  for (const element of elements) {
    if (element.type !== 'way' || !element.geometry) continue;

    const coords = element.geometry;
    for (let i = 1; i < coords.length; i += 1) {
      const lat1 = coords[i - 1].lat;
      const lng1 = coords[i - 1].lon;
      const lat2 = coords[i].lat;
      const lng2 = coords[i].lon;

      const candidate = closestPointOnSegment(lat, lng, lat1, lng1, lat2, lng2);
      if (candidate && (best === null || candidate.distM < best.distM)) {
        best = candidate;
      }
    }
  }

  return best;
}

/**
 * Snap a GPS point to the nearest road using Overpass API.
 *
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<{lat:number, lng:number, snapped:boolean}|null>}
 *   Resolves to null if snapping is disabled or fails.
 */
export async function snapToRoad(lat, lng) {
  if (!ROAD_SNAPPING.enabled) {
    return null;
  }

  const radiusM = ROAD_SNAPPING.maxSearchRadiusM;
  const query = buildOverpassQuery(lat, lng, radiusM);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT);

    const response = await fetch(ROAD_SNAPPING.overpassUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const elements = data.elements || [];

    if (elements.length === 0) {
      return null; // no roads found nearby
    }

    const nearest = findNearestRoadPoint(lat, lng, elements);

    if (!nearest) {
      return null;
    }

    // If nearest road is too far, keep the raw point
    if (nearest.distM > ROAD_SNAPPING.snapThresholdM) {
      return null;
    }

    return {
      lat: nearest.lat,
      lng: nearest.lng,
      snapped: true,
      distM: nearest.distM,
    };
  } catch {
    // Network error, timeout, or abort — silently fail and keep raw point
    return null;
  }
}

/**
 * Batch snap multiple points to roads. Processes sequentially to avoid
 * overwhelming the Overpass API.
 *
 * @param {Array<{lat:number, lng:number}>} points
 * @returns {Promise<Array<{lat:number, lng:number, snapped:boolean|null}>}
 */
export async function snapPointsToRoads(points) {
  const results = [];
  for (const point of points) {
    const snapped = await snapToRoad(point.lat, point.lng);
    results.push({
      lat: snapped ? snapped.lat : point.lat,
      lng: snapped ? snapped.lng : point.lng,
      snapped: snapped ? snapped.snapped : false,
    });
  }
  return results;
}

/**
 * Snap a [[lat, lng], ...] route polyline cleanly with a cap on Overpass queries
 * so saving long live-tracked routes never stalls.
 */
export async function snapRoute(coords = []) {
  if (!Array.isArray(coords) || coords.length < 2) return coords ?? [];
  if (coords.length > 20) return coords;
  const snapped = await snapPointsToRoads(coords.map(([lat, lng]) => ({ lat, lng })));
  return snapped.map((p) => [p.lat, p.lng]);
}
