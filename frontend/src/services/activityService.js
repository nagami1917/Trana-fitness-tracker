/**
 * TRANA activity API layer.
 *
 * Thin wrapper over the Laravel API client (`services/client.js`). The client
 * already attaches the Sanctum bearer token and handles 401s, so this module
 * only shapes request payloads and parses responses. GPS coordinates and
 * speed are validated here before they are sent — client values are never
 * trusted for server-side records.
 */

import { api } from './client.js';

export const activityApi = {
  /** Create a finished activity (GPS-tracked or manual). */
  create(payload) {
    return api.activities.create(payload).then((d) => d.data);
  },

  /** List the authenticated athlete's activities. */
  list() {
    return api.activities.list();
  },

  /** Get one activity, 404s when it belongs to another athlete. */
  get(id) {
    return api.request(`/api/activities/${id}`).then((d) => d.data);
  },

  /** Remove one activity (owner only). */
  remove(id) {
    return api.activities.remove(id);
  },

  /**
   * Append one GPS sample to a live-tracked activity.
   * point: { latitude, longitude, altitude?, speed?, accuracy?, timestamp }
   */
  appendPoint(activityId, point) {
    return api.request(`/api/activities/${activityId}/points`, {
      method: 'POST',
      body: point,
    }).then((d) => d.data);
  },

  /** Planned routes */
  routes: {
    list() {
      return api.request('/api/routes').then((d) => d.data);
    },
    create(payload) {
      return api.request('/api/routes', { method: 'POST', body: payload }).then((d) => d.data);
    },
    get(id) {
      return api.request(`/api/routes/${id}`).then((d) => d.data);
    },
  },
};

/** Validate a single GPS point before it ever reaches the API. */
export function validateTrackPoint(point) {
  const errors = [];
  const lat = Number(point.latitude);
  const lng = Number(point.longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push('latitude');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.push('longitude');
  if (point.altitude != null && (!Number.isFinite(point.altitude) || point.altitude < -1000 || point.altitude > 9000)) {
    errors.push('altitude');
  }
  if (point.speed != null && (!Number.isFinite(point.speed) || point.speed < 0 || point.speed > 300)) {
    errors.push('speed');
  }
  if (!point.timestamp || isNaN(Date.parse(point.timestamp))) errors.push('timestamp');
  return errors;
}
