import { haversineKm } from './mapService.js';

export const MAX_SPEED_KMH = {
  run: 50,
  walk: 25,
  hike: 25,
  ride: 100,
  default: 100,
};

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
 * - Smooths coordinates with accuracy-aware EMA and calculates heading
 */
export function createGpsSmoother({ activityType = 'run', initialPoint = null } = {}) {
  let sport = activityType;
  let lastAccepted = null; // { latitude, longitude, accuracy, timestampMs, heading }

  function setActivityType(nextSport) {
    sport = nextSport || 'run';
  }

  function reset() {
    lastAccepted = null;
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
      : Number.isFinite(Number(raw?.speed)) && Number(raw.speed) >= 0
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
        heading: validRawHeading,
      };
      return {
        ...raw,
        latitude: lat,
        longitude: lng,
        accuracy,
        accuracyM: accuracy,
        speedKmh,
        heading: validRawHeading,
        timestampMs,
        suppressedDrift: false,
      };
    }

    const dtSec = (timestampMs - lastAccepted.timestampMs) / 1000;

    // 1. Reject coarse/noisy jumps once we already have a reasonably accurate fix.
    if (accuracy !== null) {
      const hadGoodFix = lastAccepted.accuracy !== null && lastAccepted.accuracy <= 60;
      if (accuracy > 100 && lastAccepted.accuracy !== null && accuracy > lastAccepted.accuracy * 2) {
        return null;
      }
      if (hadGoodFix && accuracy > 60 && dtSec < 30) {
        return null;
      }
    }

    const distKm = haversineKm([lastAccepted.latitude, lastAccepted.longitude], [lat, lng]);
    const distM = distKm * 1000;

    // 2. Reject physically impossible speed spikes between consecutive fixes.
    if (dtSec > 0.1) {
      const impliedSpeedKmh = (distKm / dtSec) * 3600;
      const limit = MAX_SPEED_KMH[sport] ?? MAX_SPEED_KMH.default;
      if (impliedSpeedKmh > limit && distM > 25) {
        return null;
      }
    }

    // 3. Suppress GPS wobble inside the combined uncertainty of the old and
    // new fixes. A single 15–25 m jump can be multipath noise, especially on
    // phones starting a watch after a one-shot location request. Device speed
    // is not a safe override here: it can be noisy while the phone is still.
    const previousAccuracy = lastAccepted.accuracy ?? 10;
    const currentAccuracy = accuracy ?? 10;
    const driftThresholdM = Math.max(6, Math.min(30, (previousAccuracy + currentAccuracy) * 1.25));
    if (distM <= driftThresholdM) {
      if (accuracy !== null && (lastAccepted.accuracy === null || accuracy < lastAccepted.accuracy)) {
        lastAccepted.accuracy = accuracy;
      }
      lastAccepted.timestampMs = timestampMs;
      return {
        ...raw,
        latitude: lastAccepted.latitude,
        longitude: lastAccepted.longitude,
        accuracy: lastAccepted.accuracy,
        accuracyM: lastAccepted.accuracy,
        speedKmh: speedKmh ?? 0,
        heading: lastAccepted.heading,
        timestampMs,
        suppressedDrift: true,
      };
    }

    // 4. Accuracy-weighted smoothing: follow briskly on accurate fixes, smooth noisy jitter.
    const alpha =
      accuracy === null
        ? 0.75
        : accuracy <= 15
          ? 0.82
          : accuracy <= 30
            ? 0.65
            : 0.48;

    const smoothedLat = lastAccepted.latitude + alpha * (lat - lastAccepted.latitude);
    const smoothedLng = lastAccepted.longitude + alpha * (lng - lastAccepted.longitude);

    const movedStepM = haversineKm([lastAccepted.latitude, lastAccepted.longitude], [smoothedLat, smoothedLng]) * 1000;
    const computedHeading = movedStepM >= 3
      ? computeBearingDeg([lastAccepted.latitude, lastAccepted.longitude], [smoothedLat, smoothedLng])
      : null;
    const nextHeading =
      validRawHeading !== null && (speedKmh === null || speedKmh >= 1.2)
        ? validRawHeading
        : computedHeading ?? lastAccepted.heading;

    lastAccepted = {
      latitude: smoothedLat,
      longitude: smoothedLng,
      accuracy: accuracy ?? lastAccepted.accuracy,
      timestampMs,
      heading: nextHeading,
    };

    return {
      ...raw,
      latitude: smoothedLat,
      longitude: smoothedLng,
      accuracy: lastAccepted.accuracy,
      accuracyM: lastAccepted.accuracy,
      speedKmh,
      heading: nextHeading,
      timestampMs,
      suppressedDrift: false,
    };
  }

  if (initialPoint) push(initialPoint);

  return { push, reset, setActivityType };
}
