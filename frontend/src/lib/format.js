/** Formatting helpers shared across the app. */

/** 5.42 km → "5.42 km" */
export function formatDistance(km) {
  const n = Number(km ?? 0);
  return n < 10 ? n.toFixed(2) : n.toFixed(n < 100 ? 1 : 0);
}

/** 38.35 min → "38:21" */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes ?? 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m}:00`;
}

/** 6.15 min/km → "6:09/km" */
export function formatPace(minPerKm) {
  const n = Number(minPerKm ?? 0);
  if (!n || !Number.isFinite(n)) return '—:—';
  const m = Math.floor(n);
  const s = Math.round((n - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 9.2 km/h → "9.2" */
export function formatSpeed(kmh) {
  const n = Number(kmh ?? 0);
  return n && Number.isFinite(n) ? n.toFixed(1) : '—';
}

export const nf = (n, digits = 0) =>
  Number(n ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export const kcal = (n) => `${nf(Math.round(n))}`;
export const km = (n) => `${nf(n, Number(n) < 10 ? 1 : 0)}`;
export const grams = (n) => `${nf(Math.round(n))} g`;
export const mg = (n) => `${nf(Math.round(n))} mg`;
export const ml = (n) => (n >= 1000 ? `${nf(n / 1000, 1)} L` : `${nf(Math.round(n))} ml`);

/** 96 → "1h 36m", 42 → "42 min" */
export function duration(minutes) {
  const total = Math.round(minutes ?? 0);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** 5.5 min/km → "5:30 /km" */
export function pace(minPerKm) {
  if (!minPerKm || !Number.isFinite(minPerKm)) return '—';
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

export function speed(kmh) {
  return kmh ? `${nf(kmh, 1)} km/h` : '—';
}

export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, '0')).join(':');
}

const DAY = 86400000;

export function parseDate(value) {
  return value instanceof Date ? value : new Date(value);
}

export function dayLabel(value) {
  const d = parseDate(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function timeLabel(value) {
  return parseDate(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function shortDate(value) {
  return parseDate(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function fullDate(value) {
  return parseDate(value).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export const weekdayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ACTIVITY_LABELS = { run: 'Run', ride: 'Bike ride', walk: 'Walk', hike: 'Hike' };

export function activityLabel(type) {
  return ACTIVITY_LABELS[type] ?? String(type ?? '').replace(/^./, (c) => c.toUpperCase());
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const diff = (d.getDay() + 6) % 7; // Monday-based
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isSameDay(a, b) {
  const d1 = parseDate(a);
  const d2 = parseDate(b);
  return (
    d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate()
  );
}

export function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

export function pct(part, whole) {
  if (!whole) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

export function deltaPct(current, previous) {
  if (!previous) return 0;
  return ((current - previous) / previous) * 100;
}

/** Smooth a polyline's [lat, lng] pairs for the mini sparklines. */
export function sparkPath(values, width = 92, height = 30) {
  if (!values?.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
