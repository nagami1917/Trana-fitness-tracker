/**
 * Shared follow-me position for every map (ref-counted).
 * The Dashboard, the activity planner and the route editor all share one
 * device watch. The first consumer starts it and the last release stops it,
 * so the GPS radio is never left running when no map is on screen.
 */
import { watchPosition } from './location.js';

let position = $state(null); // { latitude, longitude, accuracy, source, timestamp, receivedAt } | null
let status = $state('idle'); // 'idle' | 'locating' | 'active' | 'denied' | 'error'
let locationError = $state(null);

let stopWatch = null;
let refs = 0;
let watchGeneration = 0;

/** Reactive view of the last known position and the current watch state. */
export const livePosition = {
  get current() {
    return position;
  },
  get status() {
    return status;
  },
  get error() {
    return locationError;
  },
};

/** Keep a cached place as a map-center fallback, never as a live GPS fix. */
export function seedLivePosition(pos) {
  if (position) return;
  if (!Number.isFinite(pos?.latitude) || !Number.isFinite(pos?.longitude)) return;
  position = {
    latitude: pos.latitude,
    longitude: pos.longitude,
    accuracy: null,
    heading: null,
    timestamp: Number.isFinite(pos.at) ? pos.at : null,
    receivedAt: null,
    source: 'cached',
  };
}

/** Start (or join) the shared high-accuracy watch. */
export function acquireLivePosition() {
  refs += 1;
  if (stopWatch) return;

  const generation = ++watchGeneration;
  status = 'locating';
  locationError = null;
  stopWatch = watchPosition({
    smooth: false,
    options: { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    onUpdate: (fix) => {
      if (generation !== watchGeneration || refs === 0) return;
      position = { ...fix, source: 'gps' };
      status = 'active';
      locationError = null;
    },
    onError: (error) => {
      if (generation !== watchGeneration || refs === 0) return;
      status = error?.code === 'denied' ? 'denied' : 'error';
      locationError = error;
    },
  });
}

/** Release a consumer; the last one stops the watch. */
export function releaseLivePosition() {
  refs = Math.max(0, refs - 1);
  if (refs > 0 || !stopWatch) return;

  // Ignore any callback that was already queued when clearWatch ran.
  watchGeneration += 1;
  const stop = stopWatch;
  stopWatch = null;
  stop();
  status = 'idle';
  locationError = null;
}
