/**
 * Global app state, loaded once at boot and kept in sync with the API.
 * All dashboard/analytics numbers are derived from the activity log here so
 * every screen shows the same truth.
 */

import { derived, get, writable } from 'svelte/store';
import { api, onUnauthorized } from '../services/client.js';
import { loadModelCard } from '../lib/ml/index.js';
import { startOfWeek, weekdayShort } from '../lib/format.js';
import { computeTrainingLoad } from '../lib/analytics/trainingLoad.js';
import { computeDistancePRs } from '../lib/analytics/records.js';
import { buildHrZones } from '../lib/analytics/heartRate.js';
import { buildRacePrepPlan } from '../lib/analytics/racePlanner.js';

export const session = writable(null);
export const profile = writable(null);
export const activities = writable([]);
export const plans = writable([]);
export const goals = writable(null);
export const fuelItems = writable([]);
export const gearList = writable([]);
export const raceEvents = writable([]);
export const modelCard = writable(null);
export const ready = writable(false);
export const booting = writable(true);
export const bootError = writable(null);
export const toast = writable(null);
export const unitSystem = derived(profile, ($p) => ($p?.units === 'imperial' ? 'imperial' : 'metric'));

const BOOT_CACHE_KEY = 'trana:boot_cache:v1';
const BOOT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let toastTimer;
export function notify(message, toneOrOptions = 'success', maybeOptions = {}) {
  const opts = typeof toneOrOptions === 'string'
    ? { tone: toneOrOptions, ...maybeOptions }
    : { tone: 'success', ...(toneOrOptions || {}) };
  const durationMs = opts.durationMs ?? (typeof opts.onUndo === 'function' ? 5000 : 3600);
  const id = Date.now() + Math.random();
  toast.set({
    id,
    message,
    tone: opts.tone ?? 'success',
    onUndo: typeof opts.onUndo === 'function' ? opts.onUndo : null,
    undoLabel: opts.undoLabel || 'Undo',
  });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.update((current) => (current?.id === id ? null : current));
  }, durationMs);
}

export function dismissToast() {
  clearTimeout(toastTimer);
  toast.set(null);
}

function readBootCache() {
  try {
    const raw = globalThis.localStorage?.getItem(BOOT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.session?.id || !parsed?.profile) return null;
    if (Date.now() - Number(parsed.ts || 0) > BOOT_CACHE_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBootCache() {
  try {
    const currentSession = get(session);
    const currentProfile = get(profile);
    if (!currentSession?.id || !currentProfile) return;
    const payload = {
      ts: Date.now(),
      session: currentSession,
      profile: currentProfile,
      activities: get(activities).slice(0, 250),
      plans: get(plans).slice(0, 60),
      goals: get(goals),
    };
    globalThis.localStorage?.setItem(BOOT_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota / private-mode failures.
  }
}

function clearBootCache() {
  try {
    globalThis.localStorage?.removeItem(BOOT_CACHE_KEY);
  } catch {
    // ignore
  }
}

function clearUserData() {
  clearBootCache();
  session.set(null);
  profile.set(null);
  activities.set([]);
  plans.set([]);
  goals.set(null);
  fuelItems.set([]);
  gearList.set([]);
  raceEvents.set([]);
}

onUnauthorized(() => {
  clearUserData();
  notify('Your session has expired. Please sign in again.', 'error');
});

export async function bootstrap() {
  bootError.set(null);

  if (!api.auth.hasToken()) {
    clearUserData();
    ready.set(true);
    booting.set(false);
    return;
  }

  // Hydrate immediately from the cached account snapshot when available so
  // returning athletes skip the cold-start splash while syncing in background.
  const cached = readBootCache();
  const hadCache = Boolean(cached);
  if (cached) {
    session.set(cached.session);
    profile.set(cached.profile);
    activities.set(Array.isArray(cached.activities) ? cached.activities : []);
    plans.set(Array.isArray(cached.plans) ? cached.plans : []);
    goals.set(cached.goals ?? null);
    ready.set(true);
    booting.set(false);
  } else {
    booting.set(true);
    ready.set(false);
  }

  try {
    // Run DB health and token validation concurrently (1 parallel RTT instead of 2 serial RTTs).
    const [, user] = await Promise.all([api.health(), api.auth.user()]);
    if (user) {
      await refresh();
      session.set(user);
      writeBootCache();
    } else {
      clearUserData();
    }
    loadModelCard().then((card) => modelCard.set(card));
  } catch (error) {
    if (!hadCache) {
      clearUserData();
      // A 401 means the token was rejected; other failures keep it for a retry.
      if (error.status !== 401) bootError.set(error.message || 'Could not reach the server.');
    }
  } finally {
    ready.set(true);
    booting.set(false);
  }
}

export async function refresh() {
  const [p, a, pl, g] = await Promise.all([
    api.profile.get(),
    api.activities.list(),
    api.predictions.list(),
    api.goals.get(),
  ]);
  profile.set(p);
  activities.set(a);
  plans.set(pl);
  goals.set(g);
  if (get(session)?.id) writeBootCache();
}

export async function loadFuelItems() {
  if (!api.auth.hasToken()) return [];
  try {
    const items = await api.fuelItems.list();
    if (Array.isArray(items)) fuelItems.set(items);
    return items ?? [];
  } catch {
    return get(fuelItems);
  }
}

export async function loadGear() {
  if (!api.auth.hasToken()) return [];
  try {
    const items = await api.gear.list();
    if (Array.isArray(items)) gearList.set(items);
    return items ?? [];
  } catch {
    return get(gearList);
  }
}

export async function loadRaceEvents() {
  if (!api.auth.hasToken()) return [];
  try {
    const items = await api.raceEvents.list();
    if (Array.isArray(items)) raceEvents.set(items);
    return items ?? [];
  } catch {
    return get(raceEvents);
  }
}

export function upsertActivity(saved) {
  if (!saved) return;
  activities.update((rows) => {
    const filtered = rows.filter((row) => String(row.id) !== String(saved.id));
    return [saved, ...filtered].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  });
  writeBootCache();
}

export function removeActivityById(id) {
  activities.update((rows) => rows.filter((row) => String(row.id) !== String(id)));
  writeBootCache();
}

export function upsertPlan(saved) {
  if (!saved) return;
  plans.update((rows) => [saved, ...rows.filter((row) => String(row.id) !== String(saved.id))]);
  writeBootCache();
}

export function removePlanById(id) {
  plans.update((rows) => rows.filter((row) => String(row.id) !== String(id)));
  writeBootCache();
}

async function finishSignIn(user) {
  try {
    // Do not show an incomplete dashboard if any account data fails to load.
    await refresh();
    session.set(user);
    writeBootCache();
    return user;
  } catch (error) {
    clearUserData();
    if (error.status !== 401) {
      bootError.set('Your account was accepted, but its data could not be loaded. Check the backend and try again.');
    }
    throw error;
  }
}

export const requestLoginCode = (email) => api.auth.requestLoginCode(email);

export const requestRegistrationCode = (payload) => api.auth.requestRegistrationCode(payload);

export async function verifyOtpAndSignIn(credentials) {
  return finishSignIn(await api.auth.verifyOtp(credentials));
}

export async function logout() {
  try {
    await api.auth.logout();
  } catch (error) {
    if (error.status !== 401) {
      notify('Signed out on this device, but the server session could not be revoked.', 'error');
    }
  } finally {
    clearUserData();
  }
}

/* ------------------------------------------------------------------ metrics */

const DAY = 86400000;

const localDayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function summarize(rows = []) {
  return rows.reduce(
    (acc, row) => {
      acc.calories += Number(row.calories) || 0;
      acc.distance += Number(row.distance_km) || 0;
      acc.minutes += Number(row.duration_min) || 0;
      acc.elevation += Number(row.elevation_gain_m) || 0;
      acc.count += 1;
      return acc;
    },
    { calories: 0, distance: 0, minutes: 0, elevation: 0, count: 0 },
  );
}

/**
 * Single-pass pre-parsed index of all activities so every derived dashboard
 * chart, streak, and breakdown avoids repeated `new Date()` allocations.
 */
const parsedActivities = derived(activities, ($a) => {
  const items = [];
  const byDay = new Map();
  for (const row of $a) {
    const dt = new Date(row.started_at);
    const ts = dt.getTime();
    if (!Number.isFinite(ts)) continue;
    const key = localDayKey(dt);
    const entry = { row, ts, key, weekday: dt.getDay() };
    items.push(entry);
    let bucket = byDay.get(key);
    if (!bucket) {
      bucket = [];
      byDay.set(key, bucket);
    }
    bucket.push(row);
  }
  return { items, byDay };
});

export const todayActivities = derived(parsedActivities, ($idx) => {
  return $idx.byDay.get(localDayKey(new Date())) ?? [];
});

export const todayStats = derived(todayActivities, ($rows) => summarize($rows));

export const weekActivities = derived(parsedActivities, ($idx) => {
  const from = startOfWeek(new Date()).getTime();
  const to = Date.now();
  const rows = [];
  for (const item of $idx.items) {
    if (item.ts >= from && item.ts <= to) rows.push(item.row);
  }
  return rows;
});

export const weekStats = derived(weekActivities, ($rows) => summarize($rows));

export const personalBests = derived(activities, ($a) => {
  let longest = null;
  let fastest = null;
  let biggest = null;
  for (const r of $a) {
    if (!longest || r.distance_km > longest.distance_km) longest = r;
    if (!biggest || r.calories > biggest.calories) biggest = r;
    if (r.activity_type === 'run' && r.distance_km >= 4.5 && r.duration_min > 0) {
      const paceNow = r.duration_min / r.distance_km;
      if (!fastest || paceNow < fastest.pace) fastest = { pace: paceNow, row: r };
    }
  }
  return { longest, fastestRun: fastest?.row ?? null, fastestPace: fastest?.pace ?? null, biggest };
});

/** Consecutive days (ending today or yesterday) that contain at least one activity. */
export const streak = derived(parsedActivities, ($idx) => {
  let count = 0;
  const cursor = new Date();
  if (!$idx.byDay.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while ($idx.byDay.has(localDayKey(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
});

/** Last 7 days vs the 7 before → percentage change per metric. */
export const trends = derived(parsedActivities, ($idx) => {
  const now = Date.now();
  const start = new Date(now - 6 * DAY);
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  const prevStartMs = startMs - 7 * DAY;
  const currentRows = [];
  const previousRows = [];
  for (const item of $idx.items) {
    if (item.ts >= startMs && item.ts <= now) currentRows.push(item.row);
    else if (item.ts >= prevStartMs && item.ts < startMs) previousRows.push(item.row);
  }
  const current = summarize(currentRows);
  const previous = summarize(previousRows);

  const change = (c, p) => (p > 0 ? ((c - p) / p) * 100 : c > 0 ? 100 : 0);
  return {
    calories: change(current.calories, previous.calories),
    distance: change(current.distance, previous.distance),
    minutes: change(current.minutes, previous.minutes),
    current,
    previous,
  };
});

/** Mon→Sun series for the current week. */
export const weekSeries = derived(parsedActivities, ($idx) => {
  const start = startOfWeek(new Date());
  const startMs = start.getTime();
  return weekdayShort
    .slice(1)
    .concat(weekdayShort[0])
    .map((label, index) => {
      const day = new Date(startMs + index * DAY);
      const rows = $idx.byDay.get(localDayKey(day)) ?? [];
      return { label, date: day, ...summarize(rows) };
    });
});

/** Bucketed series for the chart tabs: 7 days, 30 days, 90 days (O(N + buckets)). */
export const chartSeries = derived(parsedActivities, ($idx) => {
  const now = new Date();
  const nowMs = now.getTime();
  const weekStartMs = startOfWeek(now).getTime();

  const build7 = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(weekStartMs + i * DAY);
    const rows = $idx.byDay.get(localDayKey(day)) ?? [];
    return { label: weekdayShort[day.getDay()], date: day, ...summarize(rows) };
  });

  const buildDays = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(nowMs - (29 - i) * DAY);
    const rows = $idx.byDay.get(localDayKey(day)) ?? [];
    return {
      label: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      date: day,
      ...summarize(rows),
    };
  });

  const weekBuckets = Array.from({ length: 13 }, () => []);
  const oldestStartMs = nowMs - (12 * 7 + 6) * DAY;
  for (const item of $idx.items) {
    if (item.ts < oldestStartMs || item.ts > nowMs) continue;
    const daysFromEnd = Math.floor((nowMs - item.ts) / DAY);
    const bucketFromEnd = Math.floor(daysFromEnd / 7);
    const idx = 12 - bucketFromEnd;
    if (idx >= 0 && idx < 13) weekBuckets[idx].push(item.row);
  }

  const buildWeeks = Array.from({ length: 13 }, (_, i) => {
    const end = new Date(nowMs - (12 - i) * 7 * DAY);
    const start = new Date(end.getTime() - 6 * DAY);
    return { label: `${start.getMonth() + 1}/${start.getDate()}`, date: start, ...summarize(weekBuckets[i]) };
  });

  return { '7D': build7, '1M': buildDays, '3M': buildWeeks };
});

export const typeBreakdown = derived(activities, ($a) => {
  const buckets = { run: [], ride: [], walk: [], hike: [] };
  for (const r of $a) {
    if (buckets[r.activity_type]) buckets[r.activity_type].push(r);
  }
  const totals = ['run', 'ride', 'walk', 'hike'].map((type) => ({ type, ...summarize(buckets[type]) }));
  const totalDistance = totals.reduce((s, t) => s + t.distance, 0) || 1;
  return totals.map((t) => ({ ...t, share: (t.distance / totalDistance) * 100 }));
});

/** Pace of the last N runs, oldest → newest, for the analytics trend line. */
export const paceTrend = derived(activities, ($a) =>
  $a
    .filter((r) => r.activity_type === 'run' && r.distance_km >= 3 && r.duration_min > 0)
    .slice(0, 14)
    .reverse()
    .map((r) => ({
      label: new Date(r.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      pace: r.duration_min / r.distance_km,
      distance: r.distance_km,
      id: r.id,
    })),
);

/** Signed-up weekday histogram: which days this athlete actually trains (single-pass O(N)). */
export const weekdayLoad = derived(parsedActivities, ($idx) => {
  const buckets = Array.from({ length: 7 }, () => []);
  for (const item of $idx.items) {
    buckets[item.weekday].push(item.row);
  }
  return [1, 2, 3, 4, 5, 6, 0].map((dayIndex) => ({
    label: weekdayShort[dayIndex],
    ...summarize(buckets[dayIndex]),
  }));
});

export const trainingLoad = derived(activities, ($a) => computeTrainingLoad($a));

export const distancePRs = derived(activities, ($a) => computeDistancePRs($a));

export const hrZones = derived(profile, ($p) =>
  buildHrZones({
    maxHr: $p?.max_hr,
    restingHr: $p?.resting_hr,
    birthYear: $p?.birth_year,
    customZones: $p?.hr_zones,
  }),
);

export const activeRacePrep = derived([raceEvents, profile], ([$races, $p]) => {
  const weightKg = Number($p?.weight_kg) || 60;
  for (const race of $races) {
    const prep = buildRacePrepPlan(race, weightKg);
    if (prep && prep.daysUntil >= 0) return { race, prep };
  }
  return null;
});
