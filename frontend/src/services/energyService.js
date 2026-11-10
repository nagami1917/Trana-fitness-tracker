/**
 * TRANA wearable energy-expenditure API layer.
 *
 * A watch measures how many calories a session really cost; TRANA estimates
 * them from MET. Importing device samples lets the server compute a
 * calibration factor that is applied to new calorie estimates automatically
 * (3+ samples, clamped to 0.5x–2.0x).
 *
 * Thin wrapper over the Laravel API client (`services/client.js`), which
 * already attaches the Sanctum bearer token and handles 401s. Rows are
 * validated here before they are sent, mirroring the server-side rules.
 */

import { api } from './client.js';

export const energyApi = {
  /** Import device-reported sessions; re-importing the same session updates it. */
  importBatch(entries) {
    return api.request('/energy-expenditure', { method: 'POST', body: { entries } }).then((d) => d.data);
  },

  /** The athlete's calibration factor and sample count. */
  calibration() {
    return api.request('/energy-expenditure/calibration').then((d) => d.data);
  },

  /** Imported samples, newest session first. */
  list() {
    return api.request('/energy-expenditure').then((d) => d.data);
  },
};

/** Wearables whose exports the API accepts (keep in sync with the backend). */
export const DEVICE_TYPES = ['garmin', 'strava', 'polar', 'apple', 'coros', 'suunto', 'wahoo', 'whoop', 'other'];

/** Activity types the calibration understands (Activity::TYPES). */
export const ACTIVITY_TYPES = ['run', 'ride', 'walk', 'hike'];

/** Maximum measurements per import request (server limit). */
export const MAX_BATCH = 500;

/** Column order used by the CSV importer; also the API field names. */
export const CSV_COLUMNS = [
  'device_type',
  'activity_type',
  'distance_km',
  'duration_min',
  'avg_heart_rate',
  'weight_kg',
  'measured_calories',
  'recorded_at',
];

const num = (v) => (v === '' || v == null ? NaN : Number(v));

/** Field-level errors for one measurement; an empty array means it is valid. */
export function validateMeasurement(entry) {
  const errors = [];

  if (!DEVICE_TYPES.includes(String(entry?.device_type ?? '').toLowerCase())) errors.push('device_type');
  if (!ACTIVITY_TYPES.includes(entry?.activity_type)) errors.push('activity_type');

  const distance = num(entry?.distance_km);
  if (!Number.isFinite(distance) || distance < 0.05 || distance > 500) errors.push('distance_km');

  const duration = num(entry?.duration_min);
  if (!Number.isFinite(duration) || duration < 1 || duration > 2880) errors.push('duration_min');

  if (entry?.avg_heart_rate != null) {
    const hr = num(entry.avg_heart_rate);
    if (!Number.isInteger(hr) || hr < 30 || hr > 240) errors.push('avg_heart_rate');
  }

  if (entry?.weight_kg != null) {
    const weight = num(entry.weight_kg);
    if (!Number.isFinite(weight) || weight < 25 || weight > 250) errors.push('weight_kg');
  }

  const calories = num(entry?.measured_calories);
  if (!Number.isInteger(calories) || calories < 1 || calories > 20000) errors.push('measured_calories');

  const recorded = entry?.recorded_at ? Date.parse(entry.recorded_at) : NaN;
  if (isNaN(recorded)) errors.push('recorded_at');
  else if (recorded > Date.now()) errors.push('recorded_at');

  return errors;
}

/**
 * Validate a whole batch client-side so obvious CSV mistakes never reach the
 * API. Returns `{ index, errors }` per bad row; an empty array means all good.
 */
export function validateBatch(entries) {
  if (!Array.isArray(entries)) return [{ index: 0, errors: ['entries'] }];
  const invalid = [];
  entries.forEach((entry, index) => {
    const errors = validateMeasurement(entry);
    if (errors.length > 0) invalid.push({ index, errors });
  });
  return invalid;
}

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

/**
 * Validate and import a batch of device measurements.
 *
 * Throws with `error.fields` set to the `validateBatch` result when any row is
 * invalid, so the caller can point at the exact rows to fix.
 *
 * @param {Array<object>} entries measurements with the CSV_COLUMNS field names
 * @returns {Promise<{imported: number, updated: number, calibration: object}>}
 */
export async function importBatch(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Add at least one measurement before importing.');
  }
  if (entries.length > MAX_BATCH) {
    throw new Error(`Import at most ${MAX_BATCH} measurements at a time.`);
  }

  const invalid = validateBatch(entries);
  if (invalid.length > 0) {
    const error = new Error('Some measurements are invalid. Fix the highlighted rows and try again.');
    error.fields = invalid;
    throw error;
  }

  return energyApi.importBatch(entries);
}
