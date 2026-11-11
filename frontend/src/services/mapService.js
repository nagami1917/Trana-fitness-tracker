/**
 * MapLibre GL JS helpers for TRANA.
 *
 * Keeps map creation, styling and geometry helpers in one place so components
 * only deal with data and UI.
 */
import * as maplibregl from 'maplibre-gl';
import { MAP_STYLE, HAS_CUSTOM_STYLE, DARK_LAYER_OVERRIDES } from '../config/mapConfig.js';

/** Normalise [lat, lng] or { latitude, longitude } / { lat, lng } to [lat, lng]. */
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

/** Create a MapLibre map inside a container element. */
export function createMap(container, { center = [14.676, 121.0437], zoom = 13 } = {}) {
  if (!container) throw new Error('Map container is required.');
  if (typeof window === 'undefined' || !window.document) {
    throw new Error('MapLibre requires a browser environment.');
  }

  const coords = toLatLng(center) ?? [14.676, 121.0437];

  const map = new maplibregl.Map({
    container,
    style: MAP_STYLE,
    center: [coords[1], coords[0]], // MapLibre takes [lng, lat]
    zoom,
    zoomControl: false,
    attributionControl: false,
    scrollZoom: false,
    doubleClickZoom: false,
    dragRotate: false,
    touchZoomRotate: false,
    keyboard: false,
  });

  return map;
}

/**
 * Apply the TRANA dark theme overlays when a custom vector style is active.
 * Keeps OpenStreetMap raster tiles crisp and readable by default.
 */
export function applyTranaTheme(map) {
  if (map._tranaThemeApplied) return;
  if (HAS_CUSTOM_STYLE) {
    for (const override of DARK_LAYER_OVERRIDES) {
      if (!map.getLayer(override.id)) continue;
      for (const [property, value] of Object.entries(override.paint ?? {})) {
        try {
          map.setPaintProperty(override.id, property, value);
        } catch {
          // Ignore layers/paints the style doesn't define.
        }
      }
    }
  }
  map._tranaThemeApplied = true;
}

/**
 * True once MapLibre's base style has loaded so addSource/addLayer will not
 * throw "Style is not done loading." — unlike `map.isStyleLoaded()`, this
 * stays true while background OSM raster tiles are streaming in.
 */
export function isStyleInitialized(map) {
  if (!map) return false;
  if (map.style && typeof map.style === 'object' && '_loaded' in map.style) {
    return Boolean(map.style._loaded);
  }
  return Boolean(map.isStyleLoaded?.());
}

/** Fit the map to an array of [lat, lng] or { latitude, longitude } points. */
export function fitToPoints(map, points, { padding = 60, maxZoom = 15 } = {}) {
  if (!map || typeof map.fitBounds !== 'function' || !points || points.length === 0) return;
  const bounds = new maplibregl.LngLatBounds();
  for (const point of points) {
    const coords = toLatLng(point);
    if (coords) bounds.extend([coords[1], coords[0]]);
  }
  if (bounds.isEmpty()) return;
  map.fitBounds(bounds, { padding, maxZoom, animate: true, duration: 800 });
}

/** Smoothly pan to a [lat, lng] or { latitude, longitude } position. */
export function panTo(map, position, { zoom, offset } = {}) {
  if (!map || typeof map.easeTo !== 'function') return;
  const coords = toLatLng(position);
  if (!coords) return;
  // Never pass `offset: undefined` into MapLibre's easeTo(): MapLibre's
  // extend({ offset: [0, 0] }, options) overwrites the default with undefined
  // and crashes inside Point.convert(options.offset).
  const easeOptions = {
    center: [coords[1], coords[0]],
    animate: true,
    duration: 500,
  };
  const resolvedZoom = zoom ?? (typeof map.getZoom === 'function' ? map.getZoom() : undefined);
  if (Number.isFinite(resolvedZoom)) easeOptions.zoom = resolvedZoom;
  if (offset !== undefined) easeOptions.offset = offset;
  map.easeTo(easeOptions);
}

/** Convert track points ([lat, lng] or { latitude, longitude, speedKmh }) to GeoJSON LineString segments. */
export function segmentsToGeoJSON(points) {
  if (!points || points.length < 2) return { type: 'FeatureCollection', features: [] };

  const features = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = toLatLng(points[i - 1]);
    const curr = toLatLng(points[i]);
    if (!prev || !curr) continue;
    const speedKmh = points[i]?.speedKmh ?? null;
    features.push({
      type: 'Feature',
      properties: { speedKmh, index: i },
      geometry: {
        type: 'LineString',
        coordinates: [[prev[1], prev[0]], [curr[1], curr[0]]],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Haversine distance between two [lat, lng] points, in kilometres. */
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

/** Cleanup a map instance and its containers/markers. */
export function destroyMap(map) {
  if (!map) return;
  try {
    map.remove();
  } catch {
    /* map already removed */
  }
}
