/**
 * TRANA energy expenditure service.
 *
 * Manages wearable-measured energy expenditure data (e.g. WEEE dataset) used
 * to calibrate TRANA's calorie estimates against real sensor data.
 */

import { api } from './client.js';

export const energyApi = {
  /** List the authenticated user's energy expenditure entries. */
  list() {
    return api.request('/api/energy-expenditure').then((d) => d.data);
  },

  /** Record a new energy expenditure entry (wearable import or manual). */
  create(payload) {
    return api.request('/api/energy-expenditure', {
      method: 'POST',
      body: payload,
    }).then((d) => d.data);
  },

  /** Get the user's current calibration factor and sample count. */
  calibration() {
    return api.request('/api/energy-expenditure/calibration').then((d) => d.data);
  },
};

/**
 * Import a batch of energy expenditure entries (e.g. from WEEE dataset CSV).
 * Each entry: { device_type, activity_type, distance_km, duration_min,
 *   avg_heart_rate, max_heart_rate, weight_kg, height_cm, age, sex,
 *   measured_calories, recorded_at }
 */
export async function importBatch(entries) {
  const results = [];
  for (const entry of entries) {
    try {
      const result = await energyApi.create(entry);
      results.push({ success: true, data: result.data });
    } catch (error) {
      results.push({ success: false, entry, error: error.message });
    }
  }
  return results;
}
