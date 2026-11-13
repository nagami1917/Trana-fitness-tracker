/**
 * Metric <-> Imperial unit helpers.
 *
 * TRANA's API and ML pipeline always persist canonical metric values
 * (km, m, kg, cm, °C, ml). This module converts at the display & form-input
 * boundary whenever `profile.units === 'imperial'`.
 */

export const KM_TO_MI = 0.62137119;
export const M_TO_FT = 3.2808399;
export const KG_TO_LB = 2.20462262;
export const CM_TO_IN = 0.39370079;
export const ML_TO_FLOZ = 0.03381402;

export const isImperial = (units) => units === 'imperial';

export function toDisplayDistance(km, units = 'metric') {
  const n = Number(km ?? 0);
  if (!Number.isFinite(n)) return 0;
  return isImperial(units) ? n * KM_TO_MI : n;
}

export function fromDisplayDistance(value, units = 'metric') {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return isImperial(units) ? n / KM_TO_MI : n;
}

export function toDisplayElevation(meters, units = 'metric') {
  const n = Number(meters ?? 0);
  if (!Number.isFinite(n)) return 0;
  return isImperial(units) ? n * M_TO_FT : n;
}

export function fromDisplayElevation(value, units = 'metric') {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return isImperial(units) ? n / M_TO_FT : n;
}

export function toDisplaySpeed(kmh, units = 'metric') {
  const n = Number(kmh ?? 0);
  if (!Number.isFinite(n)) return 0;
  return isImperial(units) ? n * KM_TO_MI : n;
}

export function toDisplayPace(minPerKm, units = 'metric') {
  const n = Number(minPerKm ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return isImperial(units) ? n / KM_TO_MI : n;
}

export function toDisplayWeight(kg, units = 'metric') {
  const n = Number(kg ?? 0);
  if (!Number.isFinite(n)) return 0;
  return isImperial(units) ? n * KG_TO_LB : n;
}

export function fromDisplayWeight(value, units = 'metric') {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return isImperial(units) ? n / KG_TO_LB : n;
}

export function toDisplayHeight(cm, units = 'metric') {
  const n = Number(cm ?? 0);
  if (!Number.isFinite(n)) return 0;
  return isImperial(units) ? n * CM_TO_IN : n;
}

export function fromDisplayHeight(value, units = 'metric') {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return isImperial(units) ? n / CM_TO_IN : n;
}

export function toDisplayTemp(celsius, units = 'metric') {
  const n = Number(celsius ?? 0);
  if (!Number.isFinite(n)) return 0;
  return isImperial(units) ? (n * 9) / 5 + 32 : n;
}

export function fromDisplayTemp(value, units = 'metric') {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return isImperial(units) ? ((n - 32) * 5) / 9 : n;
}

export function toDisplayFluid(ml, units = 'metric') {
  const n = Number(ml ?? 0);
  if (!Number.isFinite(n)) return 0;
  return isImperial(units) ? n * ML_TO_FLOZ : n;
}

export function fromDisplayFluid(value, units = 'metric') {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return isImperial(units) ? n / ML_TO_FLOZ : n;
}

export const distanceUnit = (units = 'metric') => (isImperial(units) ? 'mi' : 'km');
export const elevationUnit = (units = 'metric') => (isImperial(units) ? 'ft' : 'm');
export const paceUnit = (units = 'metric') => (isImperial(units) ? '/mi' : '/km');
export const speedUnit = (units = 'metric') => (isImperial(units) ? 'mph' : 'km/h');
export const weightUnit = (units = 'metric') => (isImperial(units) ? 'lb' : 'kg');
export const heightUnit = (units = 'metric') => (isImperial(units) ? 'in' : 'cm');
export const tempUnit = (units = 'metric') => (isImperial(units) ? '°F' : '°C');
export const fluidUnit = (units = 'metric') => (isImperial(units) ? 'fl oz' : 'ml');
