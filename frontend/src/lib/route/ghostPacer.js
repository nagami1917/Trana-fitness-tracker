/**
 * Virtual Ghost Pacer & Off-Route Detector for live GPS tracking.
 */

import { haversineKm } from '../../services/mapService.js';
import { interpolateRoutePosition } from './splits.js';

/** Equirectangular point-to-segment distance in meters (accurate at local scales). */
export function pointToSegmentMeters(point, segA, segB) {
  const latScale = 111320;
  const lngScale = 111320 * Math.cos(((point[0] + segA[0]) * 0.5 * Math.PI) / 180);

  const px = (point[1] - segA[1]) * lngScale;
  const py = (point[0] - segA[0]) * latScale;
  const bx = (segB[1] - segA[1]) * lngScale;
  const by = (segB[0] - segA[0]) * latScale;

  const lenSq = bx * bx + by * by;
  if (lenSq <= 0.0001) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Minimum distance in meters from `point` [lat, lng] to any segment of `polyline`. */
export function distanceFromPolylineMeters(point, polyline = []) {
  if (!Array.isArray(point) || point.length < 2 || !Array.isArray(polyline) || polyline.length < 2) {
    return null;
  }
  let best = Infinity;
  for (let i = 1; i < polyline.length; i += 1) {
    const d = pointToSegmentMeters(point, polyline[i - 1], polyline[i]);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? Math.round(best) : null;
}

/**
 * Compute live ghost pacer state given planned polyline, target total duration,
 * elapsed seconds, and athlete's covered distance.
 */
export function computeGhostPacerState({
  plannedPath = [],
  plannedDistanceKm = 0,
  targetDurationMin = 0,
  elapsedSec = 0,
  coveredDistanceKm = 0,
  currentPosition = null,
  offRouteThresholdM = 45,
} = {}) {
  const hasRoute = Array.isArray(plannedPath) && plannedPath.length >= 2;
  let routeKm = Number(plannedDistanceKm) || 0;
  if (hasRoute && routeKm <= 0) {
    for (let i = 1; i < plannedPath.length; i += 1) {
      routeKm += haversineKm(plannedPath[i - 1], plannedPath[i]);
    }
  }

  const targetSec = Math.max(60, (Number(targetDurationMin) || 0) * 60);
  const ghostProgress = targetDurationMin > 0 ? Math.max(0, Math.min(1, elapsedSec / targetSec)) : 0;
  const ghostDistanceKm = routeKm * ghostProgress;
  const ghostPosition = hasRoute && targetDurationMin > 0
    ? interpolateRoutePosition(plannedPath, ghostProgress)
    : null;

  const deltaDistanceKm = coveredDistanceKm - ghostDistanceKm;
  const targetSpeedKmPerSec = routeKm > 0 ? routeKm / targetSec : 0;
  // Positive deltaSec = athlete is ahead of ghost pacer; negative = behind.
  const deltaSec = targetSpeedKmPerSec > 0 ? Math.round(deltaDistanceKm / targetSpeedKmPerSec) : 0;

  let projectedEtaMin = null;
  if (routeKm > 0 && elapsedSec >= 20 && coveredDistanceKm >= 0.1) {
    const currentSpeedKmPerMin = coveredDistanceKm / (elapsedSec / 60);
    const remainingKm = Math.max(0, routeKm - coveredDistanceKm);
    projectedEtaMin = Math.round(remainingKm / Math.max(0.02, currentSpeedKmPerMin));
  } else if (targetDurationMin > 0) {
    projectedEtaMin = Math.max(0, Math.round((targetSec - elapsedSec) / 60));
  }

  const offRouteMeters = hasRoute && currentPosition
    ? distanceFromPolylineMeters(currentPosition, plannedPath)
    : null;

  return {
    active: hasRoute && targetDurationMin > 0,
    ghostPosition,
    ghostProgress,
    ghostDistanceKm: Math.round(ghostDistanceKm * 100) / 100,
    deltaDistanceM: Math.round(deltaDistanceKm * 1000),
    deltaSec,
    projectedEtaMin,
    offRouteMeters,
    offRoute: offRouteMeters !== null && offRouteMeters > offRouteThresholdM,
  };
}
