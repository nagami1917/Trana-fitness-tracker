/**
 * Pure geometry helpers — no MapLibre, no DOM.
 *
 * These live apart from `mapService.js` because they are imported by tracking,
 * routing, GPX export and several pages that never render a map. Keeping them
 * here means those modules do not pull the ~300 KB gzip MapLibre bundle in
 * through the map service's transitive imports.
 */

/** Convert [lat, lng] / { latitude, longitude } / { lat, lng } to [lat, lng]. */
export function toLatLng(point) {
  if (Array.isArray(point) && point.length >= 2) {
    const lat = Number(point[0]);
    const lng = Number(point[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  }
  if (point && typeof point === 'object') {
    const lat = Number(point.latitude ?? point.lat);
    const lng = Number(point.longitude ?? point.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  }
  return null;
}

/** Great-circle distance between two [lat, lng] points, in kilometres. */
export function haversineKm([lat1, lng1], [lat2, lng2]) {
  const R = 6371.0088;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lng2 - lng1) * Math.PI) / 180;
  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a [lat, lng] polyline, in kilometres. */
export function polylineLengthKm(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineKm(points[i - 1], points[i]);
  }
  return total;
}

/** Positive elevation gain between consecutive points that have altitude. */
export function elevationGainM(points) {
  let gain = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1].altitudeM ?? null;
    const curr = points[i].altitudeM ?? null;
    if (prev !== null && curr !== null && curr > prev) {
      gain += curr - prev;
    }
  }
  return gain;
}
