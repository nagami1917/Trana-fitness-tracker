/**
 * Lightweight local weather lookup for planned activity coordinates & time.
 * Uses Open-Meteo Forecast API (CORS-enabled, keyless). Returns `null` cleanly
 * whenever offline, out of range (>14 days), or unavailable.
 */

const CACHE = new Map();

export async function fetchRouteWeather(lat, lng, whenIso = new Date().toISOString()) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const targetMs = Date.parse(whenIso);
  if (!Number.isFinite(targetMs)) return null;

  const diffDays = (targetMs - Date.now()) / 86400000;
  if (diffDays < -1 || diffDays > 14) return null;

  const targetDate = new Date(targetMs);
  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}@${dateStr}:${targetDate.getHours()}`;

  if (CACHE.has(key)) return CACHE.get(key);

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
      `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const hours = data?.hourly?.time;
    const temps = data?.hourly?.temperature_2m;
    const feels = data?.hourly?.apparent_temperature;
    const hum = data?.hourly?.relative_humidity_2m;
    if (!Array.isArray(hours) || !Array.isArray(temps) || hours.length === 0) return null;

    const hr = Math.min(hours.length - 1, Math.max(0, targetDate.getHours()));
    const result = {
      tempC: Math.round(Number(temps[hr])),
      feelsLikeC: Number.isFinite(Number(feels?.[hr])) ? Math.round(Number(feels[hr])) : null,
      humidityPct: Number.isFinite(Number(hum?.[hr])) ? Math.round(Number(hum[hr])) : null,
      hourLabel: `${String(hr).padStart(2, '0')}:00`,
    };
    if (!Number.isFinite(result.tempC)) return null;
    CACHE.set(key, result);
    return result;
  } catch {
    return null;
  }
}
