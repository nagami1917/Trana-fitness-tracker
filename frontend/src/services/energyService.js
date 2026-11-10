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
 *
 * The API stores one entry per request, so entries are sent one at a time;
 * a failing row is reported instead of aborting the whole import.
 */
export async function importBatch(entries) {
  const results = [];
  for (const entry of entries) {
    try {
      const result = await energyApi.create(entry);
      results.push({ success: true, data: result });
    } catch (error) {
      results.push({ success: false, entry, error: error.message });
    }
  }
  return results;
}

/** Column order used by the CSV importer; also the API field names. */
export const CSV_COLUMNS = [
  'device_type',
  'activity_type',
  'distance_km',
  'duration_min',
  'avg_heart_rate',
  'max_heart_rate',
  'weight_kg',
  'height_cm',
  'age',
  'sex',
  'measured_calories',
  'recorded_at',
];

/**
 * Parse CSV text (with a header row) into measurement entries.
 * Missing optional columns become null; unknown columns are ignored.
 */
export function parseCsv(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const entry = {};
    headers.forEach((header, i) => {
      if (!CSV_COLUMNS.includes(header)) return;
      const value = cells[i] ?? '';
      entry[header] = value === '' ? null : value;
    });
    return entry;
  });
}
