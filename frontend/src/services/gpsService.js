/**
 * GPS tracking for TRANA activities.
 *
 * Wraps the browser Geolocation API (watchPosition) and turns device reports
 * into TRANA track points. The device reports speed in m/s and altitude in
 * metres; both are converted/normalised here. Nothing is sent to a server
 * without the athlete's explicit action — this service only observes.
 */

import { snapToRoad } from './roadSnappingService.js';
import { createGpsSmoother } from './gpsFilter.js';

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

  let isoTimestamp;
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    isoTimestamp = new Date(timestamp).toISOString();
  } else if (timestamp instanceof Date && Number.isFinite(timestamp.getTime())) {
    isoTimestamp = timestamp.toISOString();
  } else if (typeof timestamp === 'string' && !Number.isNaN(Date.parse(timestamp))) {
    isoTimestamp = new Date(timestamp).toISOString();
  } else {
    isoTimestamp = new Date().toISOString();
  }

  return {
    latitude,
    longitude,
    altitudeM: Number.isFinite(coords.altitude) ? coords.altitude : null,
    speedKmh: Number.isFinite(coords.speed) && coords.speed >= 0
      ? Math.round(coords.speed * 3.6 * 10) / 10 // m/s → km/h
      : null,
    accuracyM: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
    heading: Number.isFinite(coords.heading) && coords.heading >= 0 && coords.heading <= 360
      ? Math.round(coords.heading) % 360
      : null,
    timestamp: isoTimestamp,
  };
}

/**
 * Start live tracking. Calls onPoint(point) for every filtered/smoothed
 * device report and onError(error) when the device cannot locate the user.
 *
 * Returns { stop: () => void }. The returned watch id is cleared on stop.
 *
 * @param {Object} params
 * @param {Function} [params.onPoint] - Called with each track point
 * @param {Function} [params.onError] - Called on GPS errors
 * @param {Object} [params.options] - Geolocation watchPosition options
 * @param {boolean} [params.snapToRoadEnabled=false] - Snap points to nearest road
 * @param {string} [params.activityType='run'] - Activity type for speed-spike rejection
 * @param {Object|null} [params.initialPoint=null] - Seed fix from the one-shot startup position
 */
export function watch({ onPoint, onError, options = {}, snapToRoadEnabled = false, activityType = 'run', initialPoint = null } = {}) {
  const geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : null;
  if (!geolocation || typeof geolocation.watchPosition !== 'function') {
    onError?.(new GpsError('unsupported'));
    return { stop: () => {} };
  }

  const smoother = createGpsSmoother({ activityType, initialPoint });

  const watchId = geolocation.watchPosition(
    async (position) => {
      try {
        const rawPoint = trackPoint(position.coords, position.timestamp);
        const filtered = smoother.push(rawPoint);
        if (!filtered) return;

        const point = {
          latitude: filtered.latitude,
          longitude: filtered.longitude,
          altitudeM: filtered.altitudeM ?? rawPoint.altitudeM,
          speedKmh: filtered.speedKmh ?? rawPoint.speedKmh,
          accuracyM: filtered.accuracyM ?? rawPoint.accuracyM,
          heading: filtered.heading ?? rawPoint.heading,
          timestamp: rawPoint.timestamp,
          suppressedDrift: Boolean(filtered.suppressedDrift),
        };

        // Optionally snap to nearest road (Overpass API) when actually moving
        if (snapToRoadEnabled && !point.suppressedDrift) {
          try {
            const snapped = await snapToRoad(point.latitude, point.longitude);
            if (snapped) {
              point.latitude = snapped.lat;
              point.longitude = snapped.lng;
              point.snappedToRoad = snapped.snapped;
            }
          } catch {
            // Silently keep smoothed point if snapping fails
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
