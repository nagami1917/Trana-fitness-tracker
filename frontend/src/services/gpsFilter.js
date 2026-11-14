import { haversineKm } from './mapService.js';

export const MAX_SPEED_KMH = {
  run: 50,
  walk: 25,
  hike: 25,
  ride: 100,
  default: 100,
};

const SPEED_SMOOTHING_WINDOW = 3;
const STATIONARY_SPEED_KMH = 0.5;
const SPEED_HISTORY_RESET_MS = 10_000;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function toMs(ts) {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (ts instanceof Date && Number.isFinite(ts.getTime())) return ts.getTime();
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/** Forward azimuth / bearing from [lat1, lng1] to [lat2, lng2] in degrees [0, 360). */
export function computeBearingDeg([lat1, lng1], [lat2, lng2]) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lng2 - lng1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  if (y === 0 && x === 0) return null;
  return (Math.round(toDeg(Math.atan2(y, x))) + 360) % 360;
}

/**
 * Stateful GPS fix filter & smoother for live tracking and follow-me dots.
 * - Rejects coarse accuracy spikes once a good fix exists
 * - Rejects physically impossible teleportation speed jumps
 * - Suppresses sub-threshold stationary GPS drift
 * - Smooths coordinates and normalizes speed with accuracy-aware filters
 * - Calculates a stable heading from accepted movement
 */
export function createGpsSmoother({ activityType = 'run', initialPoint = null } = {}) {
  let sport = activityType;
  let lastAccepted = null; // { latitude, longitude, accuracy, timestampMs, positionTimestampMs, heading }
  let speedSamples = [];
  let smoothedSpeedKmh = null;

  function setActivityType(nextSport) {
    sport = nextSport || 'run';
  }

  function resetSpeed() {
    speedSamples = [];
    smoothedSpeedKmh = null;
  }

  function reset() {
    lastAccepted = null;
    resetSpeed();
  }

  function normalizeSpeed(reportedSpeedKmh, positionSpeedKmh, elapsedSec) {
    const limit = MAX_SPEED_KMH[sport] ?? MAX_SPEED_KMH.default;
    let candidateSpeedKmh = positionSpeedKmh;

    // Prefer the speed implied by filtered movement. Blend the phone's reading
    // only when it agrees reasonably well; otherwise treat it as sensor noise.
    if (positionSpeedKmh !== null && reportedSpeedKmh !== null) {
      const tolerance = Math.max(4, positionSpeedKmh * 0.6);
      if (Math.abs(positionSpeedKmh - reportedSpeedKmh) <= tolerance) {
        candidateSpeedKmh = positionSpeedKmh * 0.7 + reportedSpeedKmh * 0.3;
      }
    } else if (positionSpeedKmh === null) {
      candidateSpeedKmh = reportedSpeedKmh;
    }

    if (!Number.isFinite(candidateSpeedKmh)) return 0;
    candidateSpeedKmh = Math.max(0, Math.min(limit, candidateSpeedKmh));
    if (candidateSpeedKmh < STATIONARY_SPEED_KMH) candidateSpeedKmh = 0;

    speedSamples.push(candidateSpeedKmh);
    if (speedSamples.length > SPEED_SMOOTHING_WINDOW) speedSamples.shift();
    const robustSpeedKmh = median(speedSamples) ?? candidateSpeedKmh;
    const safeElapsedSec = Number.isFinite(elapsedSec) ? Math.max(0, elapsedSec) : 0;
    const alpha = Number.isFinite(smoothedSpeedKmh)
      ? Math.max(0.25, Math.min(0.75, safeElapsedSec / (safeElapsedSec + 5)))
      : 1;
    smoothedSpeedKmh = smoothedSpeedKmh === null
      ? robustSpeedKmh
      : smoothedSpeedKmh + alpha * (robustSpeedKmh - smoothedSpeedKmh);
    smoothedSpeedKmh = Math.max(0, Math.min(limit, smoothedSpeedKmh));
    if (smoothedSpeedKmh < STATIONARY_SPEED_KMH) smoothedSpeedKmh = 0;
    return Math.round(smoothedSpeedKmh * 10) / 10;
  }

  function push(raw) {
    const lat = Number(raw?.latitude);
    const lng = Number(raw?.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return null;
    }

    const rawAccuracy = raw?.accuracy ?? raw?.accuracyM;
    const accuracy = Number.isFinite(Number(rawAccuracy)) && Number(rawAccuracy) >= 0 ? Number(rawAccuracy) : null;

    const rawSpeedKmh = raw?.speedKmh != null
      ? Number(raw.speedKmh)
      : raw?.speed != null && Number.isFinite(Number(raw.speed)) && Number(raw.speed) >= 0
        ? Number(raw.speed) * 3.6
        : null;
    const speedKmh = Number.isFinite(rawSpeedKmh) && rawSpeedKmh >= 0 ? Math.round(rawSpeedKmh * 10) / 10 : null;

    const rawHeading = Number(raw?.heading);
    const validRawHeading = Number.isFinite(rawHeading) && rawHeading >= 0 && rawHeading <= 360
      ? Math.round(rawHeading) % 360
      : null;

    const timestampMs = toMs(raw?.timestamp);

    if (!lastAccepted) {
      lastAccepted = {
        latitude: lat,
        longitude: lng,
        accuracy,
        timestampMs,
        positionTimestampMs: timestampMs,
        heading: validRawHeading,
      };
      return {
        ...raw,
        latitude: lat,
        longitude: lng,
        accuracy,
        accuracyM: accuracy,
        speedKmh: 0,
        heading: validRawHeading,
        timestampMs,
        suppressedDrift: false,
      };
    }

    const observationDtSec = (timestampMs - lastAccepted.timestampMs) / 1000;
    const positionDtSec = (timestampMs - lastAccepted.positionTimestampMs) / 1000;

    // 1. Reject coarse/noisy jumps once we already have a reasonably accurate fix.
    if (accuracy !== null) {
      const hadGoodFix = lastAccepted.accuracy !== null && lastAccepted.accuracy <= 60;
      if (accuracy > 100 && lastAccepted.accuracy !== null && accuracy > lastAccepted.accuracy * 2) {
        return null;
      }
      if (hadGoodFix && accuracy > 60 && observationDtSec < 30) {
        return null;
      }
    }

    const distKm = haversineKm([lastAccepted.latitude, lastAccepted.longitude], [lat, lng]);
    const distM = distKm * 1000;
    const previousAccuracy = lastAccepted.accuracy ?? 10;
    const currentAccuracy = accuracy ?? 10;
    const driftThresholdM = Math.max(6, Math.min(30, (previousAccuracy + currentAccuracy) * 1.25));

    // 2. Compare movement with the time since the last accepted coordinate,
    // not merely the previous sample. Suppressed fixes keep accumulating from
    // the same anchor, so using only the latest sample interval overstates speed.
    if (positionDtSec > 0.1 && distM > driftThresholdM) {
      const impliedSpeedKmh = (distKm / positionDtSec) * 3600;
      const limit = MAX_SPEED_KMH[sport] ?? MAX_SPEED_KMH.default;
      if (impliedSpeedKmh > limit) return null;
    }

    // 3. Suppress GPS wobble inside the combined uncertainty of the old and
    // new fixes. A single 15–25 m jump can be multipath noise, especially on
    // phones starting a watch after a one-shot location request. Device speed
    // is not a safe override here: it can be noisy while the phone is still.
    if (distM <= driftThresholdM) {
      if (accuracy !== null && (lastAccepted.accuracy === null || accuracy < lastAccepted.accuracy)) {
        lastAccepted.accuracy = accuracy;
      }
      if (positionDtSec * 1000 >= SPEED_HISTORY_RESET_MS) resetSpeed();
      lastAccepted.timestampMs = timestampMs;
      return {
        ...raw,
        latitude: lastAccepted.latitude,
        longitude: lastAccepted.longitude,
        accuracy: lastAccepted.accuracy,
        accuracyM: lastAccepted.accuracy,
        speedKmh: 0,
        heading: lastAccepted.heading,
        timestampMs,
        suppressedDrift: true,
      };
    }

    // 4. Accuracy-weighted position EMA. Lower gains damp device motion and
    // GPS wobble more while keeping accurate fixes responsive to real movement.
    const alpha = accuracy === null
      ? positionDtSec >= 30 ? 0.88 : positionDtSec >= 10 ? 0.75 : 0.62
      : accuracy <= 15
        ? positionDtSec >= 30 ? 0.95 : positionDtSec >= 10 ? 0.82 : 0.68
        : accuracy <= 30
          ? positionDtSec >= 30 ? 0.84 : positionDtSec >= 10 ? 0.68 : 0.52
          : positionDtSec >= 30 ? 0.72 : positionDtSec >= 10 ? 0.55 : 0.38;

    const smoothedLat = lastAccepted.latitude + alpha * (lat - lastAccepted.latitude);
    const smoothedLng = lastAccepted.longitude + alpha * (lng - lastAccepted.longitude);

    if (positionDtSec * 1000 >= SPEED_HISTORY_RESET_MS) resetSpeed();
    const movedStepM = haversineKm([lastAccepted.latitude, lastAccepted.longitude], [smoothedLat, smoothedLng]) * 1000;
    const positionSpeedKmh = positionDtSec > 0.1 ? (movedStepM / positionDtSec) * 3.6 : null;
    const normalizedSpeedKmh = normalizeSpeed(speedKmh, positionSpeedKmh, Math.max(0, positionDtSec));
    const computedHeading = movedStepM >= 3
      ? computeBearingDeg([lastAccepted.latitude, lastAccepted.longitude], [smoothedLat, smoothedLng])
      : null;
    const nextHeading =
      validRawHeading !== null && normalizedSpeedKmh >= 1.2
        ? validRawHeading
        : computedHeading ?? lastAccepted.heading;

    lastAccepted = {
      latitude: smoothedLat,
      longitude: smoothedLng,
      accuracy: accuracy ?? lastAccepted.accuracy,
      timestampMs,
      positionTimestampMs: timestampMs,
      heading: nextHeading,
    };

    return {
      ...raw,
      latitude: smoothedLat,
      longitude: smoothedLng,
      accuracy: lastAccepted.accuracy,
      accuracyM: lastAccepted.accuracy,
      speedKmh: normalizedSpeedKmh,
      heading: nextHeading,
      timestampMs,
      suppressedDrift: false,
    };
  }

  if (initialPoint) push(initialPoint);

  return { push, reset, setActivityType };
}
