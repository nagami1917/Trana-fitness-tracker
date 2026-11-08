/**
 * MapLibre GL JS helpers for TRANA.
 *
 * Keeps map creation, styling and geometry helpers in one place so components
 * only deal with data and UI.
 */
import * as maplibregl from 'maplibre-gl';
import { MAP_STYLE_URL, DARK_LAYER_OVERRIDES, TRANA_THEME } from '../config/mapConfig.js';

/** Create a MapLibre map inside a container element. */
export function createMap(container, { center = [14.676, 121.0437], zoom = 13 } = {}) {
  if (!container) throw new Error('Map container is required.');
  if (typeof window === 'undefined' || !window.document) {
    throw new Error('MapLibre requires a browser environment.');
  }

  const map = new maplibregl.Map({
    container,
    style: MAP_STYLE_URL,
    center: [center[1], center[0]], // MapLibre takes [lng, lat]
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
 * Apply the TRANA dark theme overlays to layers that exist in the loaded style.
 * Called after the style loads so the map keeps its own road/park/water/label
 * structure but gets TRANA colours and minimal labels.
 */
export function applyTranaTheme(map) {
  if (map._tranaThemeApplied) return;
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
  map._tranaThemeApplied = true;
}

/** Fit the map to a [lat, lng] points array with padding, once. */
export function fitToPoints(map, points, { padding = 60, maxZoom = 15 } = {}) {
  if (!points || points.length === 0) return;
  const bounds = new maplibregl.LngLatBounds();
  points.forEach(([lat, lng]) => bounds.extend([lng, lat]));
  if (bounds.isEmpty()) return;
  map.fitBounds(bounds, { padding, maxZoom, animate: true, duration: 800 });
}

/** Smoothly pan to a [lat, lng] position. */
export function panTo(map, [lat, lng], { zoom, offset } = {}) {
  map.easeTo({
    center: [lng, lat],
    zoom: zoom ?? map.getZoom(),
    offset,
    animate: true,
    duration: 500,
  });
}

/** Convert [lat, lng] pairs to GeoJSON LineString segments with per-segment speed. */
export function segmentsToGeoJSON(points) {
  if (!points || points.length < 2) return { type: 'FeatureCollection', features: [] };

  const features = [];
  for (let i = 1; i < points.length; i += 1) {
    const [lat1, lng1] = points[i - 1];
    const [lat2, lng2] = points[i];
    const speedKmh = points[i].speedKmh ?? null;
    features.push({
      type: 'Feature',
      properties: { speedKmh, index: i },
      geometry: {
        type: 'LineString',
        coordinates: [[lng1, lat1], [lng2, lat2]],
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
