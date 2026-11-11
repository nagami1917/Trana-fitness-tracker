/**
 * Shared follow-me position for every map (ref-counted).
 * The Dashboard, the activity planner and the route editor all show the
 * same blue dot from a single geolocation watch: the first consumer to
 * acquire starts it, the last release stops it, so the GPS radio is never
 * left running while no map is on screen.
 */
import { watchPosition } from './location.js';

let position = $state(null); // { latitude, longitude, accuracy } | null

let stopWatch = null;
let refs = 0;

/** Reactive view of the current device position (null until the first fix). */
export const livePosition = {
  get current() {
    return position;
  },
};

/** Show a position immediately (e.g. from the dashboard's 10-min cache). */
export function seedLivePosition(pos) {
  if (position) return;
  if (!Number.isFinite(pos?.latitude) || !Number.isFinite(pos?.longitude)) return;
  position = { latitude: pos.latitude, longitude: pos.longitude, accuracy: null };
}

/** Start (or join) the shared watch. Call from onMount of each map page. */
export function acquireLivePosition() {
  refs += 1;
  if (stopWatch) return;
  stopWatch = watchPosition({
    onUpdate: (p) => {
      position = p;
    },
    onError: () => {
      // Silent: consumers keep the saved city / last known dot.
    },
  });
}

/** Release a consumer; the last one stops the watch. */
export function releaseLivePosition() {
  refs = Math.max(0, refs - 1);
  if (refs > 0 || !stopWatch) return;
  const stop = stopWatch;
  stopWatch = null;
  stop();
}
