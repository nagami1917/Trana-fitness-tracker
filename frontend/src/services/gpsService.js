/**
 * GPS tracking for TRANA activities.
 *
 * Wraps the browser Geolocation API (watchPosition) and turns device reports
 * into TRANA track points. The device reports speed in m/s and altitude in
 * metres; both are converted/normalised here. Nothing is sent to a server
 * without the athlete's explicit action — this service only observes.
 */

import { snapToRoad } from './roadSnappingService.js';

const DEFAULT_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0,
};

const MESSAGES = {
  unsupported: 'Geolocation is not available in this browser.',
  denied: 'Location permission was denied. Enable it in your browser or device settings to track live.',
  timeout: 'Locating your device timed out. Try again.',
  unavailable: 'Your device could not determine your location. Try again.',
  invalid: 'Your device returned an invalid position.',
};

export class GpsError extends Error {
  constructor(code) {
    super(MESSAGES[code] ?? MESSAGES.unavailable);
    this.name = 'GpsError';
    this.code = code;
  }
}

/** One normalised GPS sample. */
export function trackPoint(coords, timestamp) {
  const latitude = Number(coords.latitude);
  const longitude = Number(coords.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new GpsError('invalid');
  }

  return {
    latitude,
    longitude,
    altitudeM: Number.isFinite(coords.altitude) ? coords.altitude : null,
    speedKmh: Number.isFinite(coords.speed) && coords.speed >= 0
      ? Math.round(coords.speed * 3.6 * 10) / 10 // m/s → km/h
      : null,
    accuracyM: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
    timestamp: timestamp ?? new Date().toISOString(),
  };
}

/**
 * Start live tracking. Calls onPoint({ point }) for every device report and
 * onError({ error }) when the device cannot locate the user.
 *
 * Returns { stop: () => void }. The returned watch id is cleared on stop.
 *
 * @param {Object} params
 * @param {Function} [params.onPoint] - Called with each track point
 * @param {Function} [params.onError] - Called on GPS errors
 * @param {Object} [params.options] - Geolocation watchPosition options
 * @param {boolean} [params.snapToRoad=false] - Snap points to nearest road
 */
export function watch({ onPoint, onError, options = {}, snapToRoadEnabled = false } = {}) {
  const geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : null;
  if (!geolocation || typeof geolocation.watchPosition !== 'function') {
    onError?.(new GpsError('unsupported'));
    return { stop: () => {} };
  }

  const watchId = geolocation.watchPosition(
    async (position) => {
      try {
        const point = trackPoint(position.coords, position.timestamp);

        // Optionally snap to nearest road (Overpass API)
        if (snapToRoadEnabled) {
          try {
            const snapped = await snapToRoad(point.latitude, point.longitude);
            if (snapped) {
              point.latitude = snapped.lat;
              point.longitude = snapped.lng;
              point.snappedToRoad = snapped.snapped;
            }
          } catch {
            // Silently keep raw point if snapping fails
          }
        }

        onPoint?.(point);
      } catch (error) {
        onError?.(error instanceof GpsError ? error : new GpsError('invalid'));
      }
    },
    (error) => {
      const code = error?.code === 1 ? 'denied' : error?.code === 3 ? 'timeout' : 'unavailable';
      onError?.(new GpsError(code));
    },
    { ...DEFAULT_OPTIONS, ...options },
  );

  return {
    stop() {
      if (watchId != null) {
        geolocation.clearWatch(watchId);
      }
    },
  };
}

/** One-shot current position (used to centre the map before tracking starts). */
export function getCurrentPosition(options = {}) {
  const geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : null;
  if (!geolocation) return Promise.reject(new GpsError('unsupported'));

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        try {
          resolve(trackPoint(position.coords, position.timestamp));
        } catch {
          reject(new GpsError('invalid'));
        }
      },
      (error) => {
        const code = error?.code === 1 ? 'denied' : error?.code === 3 ? 'timeout' : 'unavailable';
        reject(new GpsError(code));
      },
      { ...DEFAULT_OPTIONS, ...options },
    );
  });
}
