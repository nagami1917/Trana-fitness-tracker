/**
 * App-wide live Track Activity state & GPS session controller.
 *
 * Lives above individual pages so starting a workout in Track Activity keeps
 * recording GPS points, elapsed time, distance, pace, elevation, and calories
 * even when the athlete switches to Dashboard or another screen — and keeps
 * Dashboard immediately updated with both live status and the latest result.
 */
import { session, profile, refresh, notify } from '../stores/index.js';
import { activityApi, validateTrackPoint } from '../services/activityService.js';
import { dailySessionApi } from '../services/dailySessionService.js';
import { watch, getCurrentPosition, trackPoint, GpsError } from '../services/gpsService.js';
import { snapRoute } from '../services/roadSnappingService.js';
import { haversineKm, elevationGainM } from '../services/mapService.js';
import { estimateMet } from './ml/fueling.js';

const STORAGE_PREFIX = 'trana:live_tracker:';
const MAX_STORED_POINTS = 2000;

let activeUserId = null;
let userWeightKg = $state(60);

let activityType = $state('run');
let tracking = $state(false);
let paused = $state(false);
let saving = $state(false);

let points = $state([]);
let snappedPoints = $state([]);
let currentPosition = $state(null);
let currentAccuracyM = $state(null);
let currentHeading = $state(null);
let startPosition = $state(null);
let finishPosition = $state(null);

let startedAtIso = $state(null);
let activeSegmentStartMs = $state(null);
let elapsedBeforePauseMs = $state(0);
let nowMs = $state(Date.now());

let gpsStatus = $state('idle');
let gpsMessage = $state('');
let statusNote = $state('');

let roadSnapping = $state(true);
let showRoads = $state(true);

let pathSource = $state('none'); // 'none' | 'create' | 'plan'
let plannedPath = $state([]);
let plannedLabel = $state('Free GPS');
let plannedPlanKey = $state(null);

let lastOutcome = $state(null);
let lastDailySession = $state(null);

let ticker = null;
let watcher = null;

function storageKey(userId = activeUserId) {
  return userId ? `${STORAGE_PREFIX}${userId}` : null;
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
}

function downsampleCoords(coords, max = MAX_STORED_POINTS) {
  if (!Array.isArray(coords) || coords.length <= max) return coords;
  const out = [coords[0]];
  const innerTarget = max - 2;
  const step = (coords.length - 2) / innerTarget;
  for (let i = 0; i < innerTarget; i += 1) {
    out.push(coords[1 + Math.floor(i * step)]);
  }
  out.push(coords[coords.length - 1]);
  return out;
}

function persist() {
  if (!canUseStorage()) return;
  const key = storageKey();
  if (!key) return;
  try {
    if (!tracking && !lastOutcome) {
      sessionStorage.removeItem(key);
      return;
    }
    const payload = {
      activityType,
      tracking,
      paused,
      points: points.slice(-MAX_STORED_POINTS),
      currentPosition,
      currentAccuracyM,
      currentHeading,
      startPosition,
      finishPosition,
      startedAtIso,
      activeSegmentStartMs,
      elapsedBeforePauseMs,
      roadSnapping,
      showRoads,
      pathSource,
      plannedPath: downsampleCoords(plannedPath, 600),
      plannedLabel,
      plannedPlanKey,
      statusNote,
      lastOutcome,
    };
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore storage quota / privacy-mode errors.
  }
}

function startTicker() {
  stopTicker();
  nowMs = Date.now();
  ticker = setInterval(() => {
    nowMs = Date.now();
  }, 1000);
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function stopGps() {
  if (watcher) {
    watcher.stop();
    watcher = null;
  }
  gpsStatus = 'idle';
  gpsMessage = '';
}

function resetLiveFields() {
  tracking = false;
  paused = false;
  saving = false;
  points = [];
  snappedPoints = [];
  currentPosition = null;
  currentAccuracyM = null;
  currentHeading = null;
  startPosition = null;
  finishPosition = null;
  startedAtIso = null;
  activeSegmentStartMs = null;
  elapsedBeforePauseMs = 0;
  statusNote = '';
}

function appendGpsFix(fix) {
  if (!tracking) return;
  const pt = fix?.coords ? trackPoint(fix.coords, fix.timestamp) : fix;
  const errors = validateTrackPoint(pt);
  if (errors.length > 0) {
    gpsStatus = 'error';
    gpsMessage = 'Invalid GPS reading';
    return;
  }

  const pos = [pt.latitude, pt.longitude];
  currentPosition = pos;
  if (pt.accuracyM != null) currentAccuracyM = pt.accuracyM;
  if (pt.heading != null) currentHeading = pt.heading;
  if (!startPosition) startPosition = pos;
  if (!pt.suppressedDrift || points.length === 0) {
    const next = [...points, pt];
    points = next.length > MAX_STORED_POINTS ? downsampleCoords(next, MAX_STORED_POINTS) : next;
  }
  if (!paused) {
    gpsStatus = 'tracking';
    gpsMessage = pt.accuracyM != null ? `±${Math.round(pt.accuracyM)}m` : 'Active';
  }
  persist();
}

async function startGps() {
  gpsStatus = 'requesting';
  gpsMessage = 'Acquiring GPS…';

  try {
    const first = await getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    if (!tracking) return;
    appendGpsFix(first);
  } catch (error) {
    if (!tracking) return;
    if (error instanceof GpsError && error.code === 'unsupported') {
      gpsStatus = 'error';
      gpsMessage = 'GPS unavailable in this browser';
      notify(gpsMessage, 'error');
      return;
    }
    if (error instanceof GpsError && error.code === 'denied') {
      gpsStatus = 'denied';
      gpsMessage = 'Location permission denied';
      notify(gpsMessage, 'error');
      return;
    }
    gpsStatus = 'no-signal';
    gpsMessage = 'Searching for signal…';
  }

  if (!tracking) return;

  if (watcher) {
    watcher.stop();
    watcher = null;
  }

  watcher = watch({
    activityType,
    onPoint: (pt) => {
      if (!tracking || paused) return;
      appendGpsFix(pt);
    },
    onError: (err) => {
      if (!tracking) return;
      if (err instanceof GpsError && err.code === 'denied') {
        gpsStatus = 'denied';
        gpsMessage = 'Location permission denied';
      } else if (err instanceof GpsError && err.code === 'unavailable') {
        gpsStatus = 'no-signal';
        gpsMessage = 'Waiting for GPS signal';
      } else {
        gpsStatus = 'error';
        gpsMessage = err?.message || 'GPS unavailable';
      }
    },
  });
}

// ── Derived metrics ──────────────────────────────────────────────────
const durationSec = $derived.by(() => {
  if (!tracking) return 0;
  const activeMs = !paused && activeSegmentStartMs ? Math.max(0, nowMs - activeSegmentStartMs) : 0;
  return Math.max(0, (elapsedBeforePauseMs + activeMs) / 1000);
});

const durationMin = $derived(durationSec / 60);

const distanceKm = $derived.by(() => {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineKm(
      [points[i - 1].latitude, points[i - 1].longitude],
      [points[i].latitude, points[i].longitude],
    );
  }
  return total;
});

const avgSpeedKmh = $derived(durationMin > 0 && distanceKm > 0 ? distanceKm / (durationMin / 60) : 0);
const avgPaceMinKm = $derived(distanceKm > 0 && durationMin > 0 ? durationMin / distanceKm : 0);
const elevationM = $derived(points.length >= 2 ? elevationGainM(points) : 0);

const estimatedCalories = $derived.by(() => {
  if (durationMin <= 0) return 0;
  const elevPerKm = distanceKm > 0 ? elevationM / distanceKm : 0;
  const met = estimateMet(activityType, avgSpeedKmh, elevPerKm);
  return Math.round(met * (Number(userWeightKg) || 60) * (durationMin / 60));
});

const recordedCoords = $derived(
  points.map((p) => [p.latitude, p.longitude]),
);

const status = $derived.by(() => {
  if (saving) return 'saving';
  if (tracking && paused) return 'paused';
  if (tracking) return 'tracking';
  if (lastOutcome?.status === 'completed') return 'completed';
  if (lastOutcome?.status === 'discarded') return 'discarded';
  return 'idle';
});

// ── Session hydration & cleanup ──────────────────────────────────────
function clearRuntimeOnly() {
  stopTicker();
  stopGps();
  resetLiveFields();
  activityType = 'run';
  roadSnapping = true;
  showRoads = true;
  pathSource = 'none';
  plannedPath = [];
  plannedLabel = 'Free GPS';
  plannedPlanKey = null;
  lastOutcome = null;
  lastDailySession = null;
}

function hydrateForUser(userId) {
  clearRuntimeOnly();
  if (!canUseStorage() || !userId) return;
  try {
    const raw = sessionStorage.getItem(storageKey(userId));
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return;

    if (saved.activityType) activityType = saved.activityType;
    if (typeof saved.roadSnapping === 'boolean') roadSnapping = saved.roadSnapping;
    if (typeof saved.showRoads === 'boolean') showRoads = saved.showRoads;
    if (saved.pathSource) pathSource = saved.pathSource;
    if (Array.isArray(saved.plannedPath)) plannedPath = saved.plannedPath;
    if (typeof saved.plannedLabel === 'string') plannedLabel = saved.plannedLabel;
    plannedPlanKey = saved.plannedPlanKey ?? null;
    if (typeof saved.statusNote === 'string') statusNote = saved.statusNote;
    if (saved.lastOutcome && typeof saved.lastOutcome === 'object') lastOutcome = saved.lastOutcome;

    if (saved.tracking) {
      tracking = true;
      paused = Boolean(saved.paused);
      points = Array.isArray(saved.points) ? saved.points : [];
      currentPosition = Array.isArray(saved.currentPosition) ? saved.currentPosition : null;
      currentAccuracyM = saved.currentAccuracyM ?? null;
      currentHeading = saved.currentHeading ?? null;
      startPosition = Array.isArray(saved.startPosition) ? saved.startPosition : null;
      finishPosition = Array.isArray(saved.finishPosition) ? saved.finishPosition : null;
      startedAtIso = saved.startedAtIso ?? new Date().toISOString();
      activeSegmentStartMs = saved.activeSegmentStartMs ?? null;
      elapsedBeforePauseMs = Number(saved.elapsedBeforePauseMs) || 0;
      nowMs = Date.now();

      if (paused) {
        gpsStatus = 'paused';
        gpsMessage = 'Paused';
      } else {
        startTicker();
        void startGps();
      }
    }
  } catch {
    // Ignore corrupt snapshot.
  }
}

profile.subscribe((p) => {
  userWeightKg = Number(p?.weight_kg) || 60;
});

session.subscribe((user) => {
  const nextId = user?.id ?? null;
  if (nextId === activeUserId) return;
  if (!nextId) {
    if (canUseStorage() && activeUserId) {
      try {
        sessionStorage.removeItem(storageKey(activeUserId));
      } catch {
        // ignore
      }
    }
    activeUserId = null;
    clearRuntimeOnly();
    return;
  }
  activeUserId = nextId;
  hydrateForUser(nextId);
});

// ── Public actions ───────────────────────────────────────────────────
function setActivityType(type) {
  if (tracking || !type) return;
  activityType = type;
}

function setRoadSnapping(value) {
  roadSnapping = Boolean(value);
  if (tracking) persist();
}

function setShowRoads(value) {
  showRoads = Boolean(value);
  if (tracking) persist();
}

function setPathContext({
  source = 'none',
  path = [],
  label = 'Free GPS',
  planKey = null,
} = {}) {
  if (tracking) return;
  pathSource = source;
  plannedPath = Array.isArray(path) ? [...path] : [];
  plannedLabel = label;
  plannedPlanKey = planKey;
}

function startActivity(overrides = {}) {
  if (tracking) return;
  if (overrides.activityType) activityType = overrides.activityType;
  if (overrides.pathSource !== undefined) pathSource = overrides.pathSource;
  if (Array.isArray(overrides.plannedPath)) plannedPath = [...overrides.plannedPath];
  if (overrides.plannedLabel !== undefined) plannedLabel = overrides.plannedLabel;
  if (overrides.plannedPlanKey !== undefined) plannedPlanKey = overrides.plannedPlanKey;

  points = [];
  snappedPoints = [];
  currentPosition = null;
  currentAccuracyM = null;
  currentHeading = null;
  startPosition = null;
  finishPosition = null;
  elapsedBeforePauseMs = 0;
  startedAtIso = new Date().toISOString();
  activeSegmentStartMs = Date.now();
  nowMs = Date.now();
  paused = false;
  tracking = true;
  statusNote = '';
  lastOutcome = null;

  persist();
  startTicker();
  void startGps();
}

function pauseActivity() {
  if (!tracking || paused) return;
  if (activeSegmentStartMs) {
    elapsedBeforePauseMs += Math.max(0, Date.now() - activeSegmentStartMs);
  }
  activeSegmentStartMs = null;
  paused = true;
  stopTicker();
  gpsStatus = 'paused';
  gpsMessage = 'Paused';
  persist();
}

function resumeActivity() {
  if (!tracking || !paused) return;
  activeSegmentStartMs = Date.now();
  nowMs = Date.now();
  paused = false;
  statusNote = '';
  startTicker();
  if (!watcher) {
    void startGps();
  } else {
    gpsStatus = 'tracking';
    gpsMessage = currentAccuracyM != null ? `±${Math.round(currentAccuracyM)}m` : 'Resumed';
  }
  persist();
}

function discardActivity() {
  if (!tracking) return;
  const snapshot = {
    status: 'discarded',
    activity_type: activityType,
    pathSource,
    plannedLabel,
    plannedPath: [...plannedPath],
    route: points.map((p) => [p.latitude, p.longitude]),
    distance_km: Math.round(distanceKm * 100) / 100,
    duration_min: Math.round(durationMin * 10) / 10,
    duration_sec: Math.round(durationSec),
    elevation_gain_m: Math.round(elevationM),
    calories: estimatedCalories,
    average_speed: avgSpeedKmh > 0 ? Math.round(avgSpeedKmh * 10) / 10 : null,
    average_pace: avgPaceMinKm > 0 ? Math.round(avgPaceMinKm * 100) / 100 : null,
    started_at: startedAtIso ?? new Date().toISOString(),
    ended_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    note: 'Tracking discarded — not saved to your activity history.',
  };

  stopTicker();
  stopGps();
  resetLiveFields();
  lastOutcome = snapshot;
  persist();
  notify('Tracking discarded', 'info');
  return snapshot;
}

async function stopActivity({ currentTodaySession = null } = {}) {
  if (!tracking || saving) return { saved: false, reason: 'not_tracking' };

  const finalDurationSec = Math.round(durationSec);
  const finalDurationMin = Math.round(durationMin * 10) / 10;
  const finalDistanceKm = Math.round(distanceKm * 100) / 100;

  if (finalDistanceKm < 0.05 || finalDurationMin < 1) {
    if (!paused) pauseActivity();
    statusNote = 'Record at least 0.05 km (50 m) and 1:00 to save — resume moving or tap Discard.';
    persist();
    notify('Record at least 0.05 km (50 m) and 1:00 to save — or tap Discard to reset.', 'info');
    return { saved: false, reason: 'too_short' };
  }

  saving = true;
  statusNote = '';
  stopTicker();

  try {
    let routeCoords = points.map((p) => [p.latitude, p.longitude]);
    if (roadSnapping && routeCoords.length >= 2) {
      try {
        snappedPoints = await snapRoute(routeCoords);
        if (snappedPoints.length >= 2) routeCoords = snappedPoints;
      } catch {
        snappedPoints = [];
      }
    }

    routeCoords = downsampleCoords(routeCoords, MAX_STORED_POINTS);
    if (routeCoords.length > 0) {
      finishPosition = routeCoords[routeCoords.length - 1];
    }

    const routeGeojson = routeCoords.length >= 2
      ? {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: { activity_type: activityType },
            geometry: {
              type: 'LineString',
              coordinates: routeCoords.map(([lat, lng]) => [lng, lat]),
            },
          }],
        }
      : null;

    const endedAt = new Date().toISOString();
    const activityPayload = {
      activity_type: activityType,
      started_at: startedAtIso ?? new Date(Date.now() - Math.round(durationSec * 1000)).toISOString(),
      ended_at: endedAt,
      distance_km: finalDistanceKm,
      duration_min: finalDurationMin,
      elevation_gain_m: Math.round(elevationM),
      calories: estimatedCalories,
      average_speed: avgSpeedKmh > 0 ? Math.round(avgSpeedKmh * 10) / 10 : null,
      average_pace: avgPaceMinKm > 0 ? Math.round(avgPaceMinKm * 100) / 100 : null,
      route: routeCoords.length >= 2 ? routeCoords : null,
      route_geojson: routeGeojson,
      source: 'gps',
    };

    const savedActivity = await activityApi.create(activityPayload);
    const caloriesBurned = Number(savedActivity?.calories ?? estimatedCalories) || 0;

    let sessionData = currentTodaySession;
    let existingBurned = Number(sessionData?.calories_burned ?? 0);
    if (!sessionData) {
      try {
        const todayRes = await dailySessionApi.today();
        sessionData = todayRes?.data ?? null;
        existingBurned = Number(sessionData?.calories_burned ?? 0);
      } catch {
        // ignore
      }
    }

    try {
      const sessionRes = await dailySessionApi.saveToday({
        calories_burned: existingBurned + caloriesBurned,
      });
      if (sessionRes?.data) {
        lastDailySession = sessionRes.data;
      }
    } catch {
      // Activity already persisted; daily session sync is best-effort.
    }

    await refresh();

    const completedSnapshot = {
      status: 'completed',
      activityId: savedActivity?.id ?? null,
      activity_type: savedActivity?.activity_type ?? activityType,
      pathSource,
      plannedLabel,
      plannedPath: [...plannedPath],
      route: Array.isArray(savedActivity?.route) ? savedActivity.route : routeCoords,
      distance_km: Number(savedActivity?.distance_km ?? finalDistanceKm),
      duration_min: Number(savedActivity?.duration_min ?? finalDurationMin),
      duration_sec: finalDurationSec,
      elevation_gain_m: Number(savedActivity?.elevation_gain_m ?? Math.round(elevationM)),
      calories: caloriesBurned,
      average_speed: savedActivity?.average_speed ?? activityPayload.average_speed,
      average_pace: savedActivity?.average_pace ?? activityPayload.average_pace,
      started_at: savedActivity?.started_at ?? activityPayload.started_at,
      ended_at: savedActivity?.ended_at ?? endedAt,
      updated_at: new Date().toISOString(),
      note: "Saved to Activities and Today's Summary — Dashboard map, time, and km updated.",
    };

    stopGps();
    resetLiveFields();
    lastOutcome = completedSnapshot;
    persist();
    notify("Activity saved to today's session", 'success');
    return { saved: true, outcome: completedSnapshot, dailySession: lastDailySession };
  } catch (error) {
    saving = false;
    statusNote = error?.message || 'Failed to save activity — retry or check your connection.';
    persist();
    notify(error?.message || 'Failed to save activity', 'error');
    return { saved: false, reason: 'error', error };
  }
}

function clearOutcome() {
  lastOutcome = null;
  persist();
}

export const liveTracker = {
  get activityType() { return activityType; },
  get tracking() { return tracking; },
  get paused() { return paused; },
  get saving() { return saving; },
  get status() { return status; },
  get roadSnapping() { return roadSnapping; },
  get showRoads() { return showRoads; },
  get points() { return points; },
  get recordedCoords() { return recordedCoords; },
  get snappedPoints() { return snappedPoints; },
  get currentPosition() { return currentPosition; },
  get currentAccuracyM() { return currentAccuracyM; },
  get currentHeading() { return currentHeading; },
  get startPosition() { return startPosition; },
  get finishPosition() { return finishPosition; },
  get startedAtIso() { return startedAtIso; },
  get gpsStatus() { return gpsStatus; },
  get gpsMessage() { return gpsMessage; },
  get statusNote() { return statusNote; },
  get pathSource() { return pathSource; },
  get plannedPath() { return plannedPath; },
  get plannedLabel() { return plannedLabel; },
  get plannedPlanKey() { return plannedPlanKey; },
  get durationSec() { return durationSec; },
  get durationMin() { return durationMin; },
  get distanceKm() { return distanceKm; },
  get avgSpeedKmh() { return avgSpeedKmh; },
  get avgPaceMinKm() { return avgPaceMinKm; },
  get elevationM() { return elevationM; },
  get estimatedCalories() { return estimatedCalories; },
  get lastOutcome() { return lastOutcome; },
  get lastDailySession() { return lastDailySession; },

  setActivityType,
  setRoadSnapping,
  setShowRoads,
  setPathContext,
  appendGpsFix,
  startActivity,
  pauseActivity,
  resumeActivity,
  discardActivity,
  stopActivity,
  clearOutcome,
  resetAll: clearRuntimeOnly,
};
