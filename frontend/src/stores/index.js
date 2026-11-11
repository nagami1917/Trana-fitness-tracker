/**
 * Global app state, loaded once at boot and kept in sync with the API.
 * All dashboard/analytics numbers are derived from the activity log here so
 * every screen shows the same truth.
 */

import { derived, writable } from 'svelte/store';
import { api, onUnauthorized } from '../services/client.js';
import { loadModelCard } from '../lib/ml/index.js';
import { isSameDay, startOfWeek, weekdayShort } from '../lib/format.js';

export const session = writable(null);
export const profile = writable(null);
export const activities = writable([]);
export const plans = writable([]);
export const goals = writable(null);
export const modelCard = writable(null);
/** Health of the optional prediction service: { status: 'ok' | 'not_configured' | 'unavailable', … } */
export const mlStatus = writable(null);
export const ready = writable(false);
export const booting = writable(true);
export const bootError = writable(null);
export const toast = writable(null);

let toastTimer;
export function notify(message, tone = 'success') {
  toast.set({ id: Date.now(), message, tone });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.set(null), 3600);
}

function clearUserData() {
  session.set(null);
  profile.set(null);
  activities.set([]);
  plans.set([]);
  goals.set(null);
  mlStatus.set(null);
}

onUnauthorized(() => {
  clearUserData();
  notify('Your session has expired. Please sign in again.', 'error');
});

export async function bootstrap() {
  booting.set(true);
  ready.set(false);
  bootError.set(null);
  try {
    // A healthy response confirms the API can reach its configured database.
    const health = await api.health();
    // The prediction service is optional for reading data but required to
    // save a plan — keep its state so the UI can say so before a save fails.
    mlStatus.set(health?.ml ?? null);
    const user = await api.auth.user();
    if (user) {
      await refresh();
      session.set(user);
    } else {
      clearUserData();
    }
    loadModelCard().then((card) => modelCard.set(card));
  } catch (error) {
    clearUserData();
    // A 401 means the token was rejected; other failures keep it for a retry.
    if (error.status !== 401) bootError.set(error.message || 'Could not reach the server.');
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
}

async function finishSignIn(user) {
  try {
    // Do not show an incomplete dashboard if any account data fails to load.
    await refresh();
    session.set(user);
    return user;
  } catch (error) {
    clearUserData();
    if (error.status !== 401) {
      bootError.set('Your account was accepted, but its data could not be loaded. Check the backend and try again.');
    }
    throw error;
  }
}

export async function login(credentials) {
  return finishSignIn(await api.auth.login(credentials));
}

export async function register(payload) {
  return finishSignIn(await api.auth.register(payload));
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

const within = (rows, from, to = new Date()) =>
  rows.filter((r) => {
    const t = new Date(r.started_at).getTime();
    return t >= from.getTime() && t <= to.getTime();
  });

export const todayActivities = derived(activities, ($a) => $a.filter((row) => isSameDay(row.started_at, new Date())));
export const todayStats = derived(todayActivities, ($rows) => summarize($rows));
export const weekActivities = derived(activities, ($a) => within($a, startOfWeek(new Date())));
export const weekStats = derived(weekActivities, ($rows) => summarize($rows));

export const personalBests = derived(activities, ($a) => {
  const longest = $a.reduce((best, r) => (!best || r.distance_km > best.distance_km ? r : best), null);
  const runs = $a.filter((r) => r.activity_type === 'run' && r.distance_km >= 4.5 && r.duration_min > 0);
  const fastest = runs.reduce(
    (best, r) => {
      const paceNow = r.duration_min / r.distance_km;
      return !best || paceNow < best.pace ? { pace: paceNow, row: r } : best;
    },
    null,
  );
  const biggest = $a.reduce((best, r) => (!best || r.calories > best.calories ? r : best), null);
  return { longest, fastestRun: fastest?.row ?? null, fastestPace: fastest?.pace ?? null, biggest };
});

/** Consecutive days (ending today or yesterday) that contain at least one activity. */
export const streak = derived(activities, ($a) => {
  const days = new Set($a.map((r) => new Date(r.started_at).toDateString()));
  let count = 0;
  const cursor = new Date();
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
  while (days.has(cursor.toDateString())) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
});

/** Last 7 days vs the 7 before → percentage change per metric. */
export const trends = derived(activities, ($a) => {
  const now = new Date();
  const start = new Date(now.getTime() - 6 * DAY);
  start.setHours(0, 0, 0, 0);
  const prevStart = new Date(start.getTime() - 7 * DAY);
  const current = summarize(within($a, start));
  const previous = summarize(within($a, prevStart, new Date(start.getTime() - 1)));

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
export const weekSeries = derived(weekActivities, ($rows) => {
  const start = startOfWeek(new Date());
  return weekdayShort
    .slice(1)
    .concat(weekdayShort[0])
    .map((label, index) => {
      const day = new Date(start.getTime() + index * DAY);
      const totals = summarize($rows.filter((r) => isSameDay(r.started_at, day)));
      return { label, date: day, ...totals };
    });
});

/** Bucketed series for the chart tabs: 7 days, 30 days, 90 days. */
export const chartSeries = derived(activities, ($a) => {
  const build7 = () => {
    const start = startOfWeek(new Date());
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(start.getTime() + i * DAY);
      return {
        label: weekdayShort[day.getDay()],
        date: day,
        ...summarize($a.filter((r) => isSameDay(r.started_at, day))),
      };
    });
  };

  const buildDays = (days) => {
    const now = new Date();
    return Array.from({ length: days }, (_, i) => {
      const day = new Date(now.getTime() - (days - 1 - i) * DAY);
      return {
        label: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        date: day,
        ...summarize($a.filter((r) => isSameDay(r.started_at, day))),
      };
    });
  };

  const buildWeeks = (weeks) => {
    const now = new Date();
    return Array.from({ length: weeks }, (_, i) => {
      const end = new Date(now.getTime() - (weeks - 1 - i) * 7 * DAY);
      const start = new Date(end.getTime() - 6 * DAY);
      const bucket = summarize($a.filter((r) => new Date(r.started_at) >= start && new Date(r.started_at) <= end));
      return { label: `${start.getMonth() + 1}/${start.getDate()}`, date: start, ...bucket };
    });
  };

  return { '7D': build7(), '1M': buildDays(30), '3M': buildWeeks(13) };
});

export const typeBreakdown = derived(activities, ($a) => {
  const types = ['run', 'ride', 'walk', 'hike'];
  const totals = types.map((type) => {
    const rows = $a.filter((r) => r.activity_type === type);
    return { type, ...summarize(rows) };
  });
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

/** Signed-up weekday histogram: which days this athlete actually trains. */
export const weekdayLoad = derived(activities, ($a) =>
  weekdayShort.slice(1).concat(weekdayShort[0]).map((label) => {
    const rows = $a.filter((r) => weekdayShort[new Date(r.started_at).getDay()] === label);
    return { label, ...summarize(rows) };
  }),
);
