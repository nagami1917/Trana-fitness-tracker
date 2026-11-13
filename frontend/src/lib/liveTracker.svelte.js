/**
 * App-wide live Track Activity state & GPS session controller.
 *
 * Lives above individual pages so starting a workout in Track Activity keeps
 * recording GPS points, elapsed time, distance, pace, elevation, fueling cues,
 * and calories even when the athlete switches to Dashboard or another screen —
 * and keeps Dashboard immediately updated with both live status and the latest
 * result, with Screen Wake Lock + offline save queue durability.
 */
import { session, profile, upsertActivity, notify } from '../stores/index.js';
import { api } from '../services/client.js';
import { activityApi, validateTrackPoint } from '../services/activityService.js';
import { dailySessionApi } from '../services/dailySessionService.js';
import { watch, getCurrentPosition, trackPoint, GpsError } from '../services/gpsService.js';
import { snapRoute } from '../services/roadSnappingService.js';
import { haversineKm, elevationGainM } from '../services/mapService.js';
import { estimateMet, recommendFueling } from './ml/fueling.js';
import { queueActivitySave } from './offlineQueue.js';
import { KM_TO_MI, isImperial } from './units.js';

const STORAGE_PREFIX = 'trana:live_tracker:';
const BACKUP_PREFIX = 'trana:live_tracker_backup:';
const MAX_STORED_POINTS = 2000;

let activeUserId = null;
let userWeightKg = $state(60);
let userUnits = $state('metric');
let userSweat = $state('normal');
let userTempC = $state(26);
let userCalibrationFactor = $state(1);

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
let plannedFueling = $state(null);

// Live fueling & voice coaching state
let fluidLoggedMl = $state(0);
let carbsLoggedG = $state(0);
let lastHydrateSec = $state(0);
let lastFuelSec = $state(0);
let voiceCues = $state(false);
let announcedSplits = $state(0);
let wakeLockActive = $state(false);

let lastOutcome = $state(null);
let lastDailySession = $state(null);

let ticker = null;
let watcher = null;
let wakeLockSentinel = null;
let visibilityBound = false;

function storageKey(userId = activeUserId) {
  return userId ? `${STORAGE_PREFIX}${userId}` : null;
}

function backupKey(userId = activeUserId) {
  return userId ? `${BACKUP_PREFIX}${userId}` : null;
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
}

function speakCue(text) {
  if (!voiceCues || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  if (typeof SpeechSynthesisUtterance === 'undefined') return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    window.speechSynthesis.speak(u);
  } catch {
    // Ignore blocked speech synthesis on unsupported environments
  }
}

async function acquireWakeLock() {
  if (typeof navigator === 'undefined' || !navigator.wakeLock?.request) return;
  try {
    if (wakeLockSentinel) return;
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockActive = true;
    wakeLockSentinel.addEventListener?.('release', () => {
      wakeLockSentinel = null;
      wakeLockActive = false;
    });
  } catch {
    wakeLockActive = false;
  }
}

async function releaseWakeLock() {
  if (!wakeLockSentinel) {
    wakeLockActive = false;
    return;
  }
  try {
    await wakeLockSentinel.release();
  } catch {
    // ignore
  } finally {
    wakeLockSentinel = null;
    wakeLockActive = false;
  }
}

function ensureVisibilityHook() {
  if (visibilityBound || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && tracking && !paused) {
      void acquireWakeLock();
    }
  });
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
  const bKey = backupKey();
  if (!key) return;
  try {
    if (!tracking && !lastOutcome) {
      sessionStorage.removeItem(key);
      globalThis.localStorage?.removeItem?.(bKey);
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
      plannedFueling,
      fluidLoggedMl,
      carbsLoggedG,
      lastHydrateSec,
      lastFuelSec,
      voiceCues,
      announcedSplits,
      statusNote,
      lastOutcome,
    };
    const serialized = JSON.stringify(payload);
    sessionStorage.setItem(key, serialized);
    if (tracking) {
      globalThis.localStorage?.setItem?.(bKey, serialized);
    } else {
      globalThis.localStorage?.removeItem?.(bKey);
    }
  } catch {
    // Ignore storage quota / privacy-mode errors.
  }
}

function startTicker() {
  stopTicker();
  nowMs = Date.now();
  ticker = setInterval(() => {
    nowMs = Date.now();
    // Voice reminder check for hydration & distance splits
    if (voiceCues && tracking && !paused) {
      const sec = Math.max(0, Math.round((elapsedBeforePauseMs + (activeSegmentStartMs ? nowMs - activeSegmentStartMs : 0)) / 1000));
      if (sec - lastHydrateSec === 1200) {
        speakCue('Hydration reminder: take a sip of water or electrolyte fluid.');
      }
      if (sec >= 1800 && sec - lastFuelSec === 1800) {
        speakCue('Fueling reminder: take 20 to 30 grams of carbohydrates.');
      }
    }
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
  fluidLoggedMl = 0;
  carbsLoggedG = 0;
  lastHydrateSec = 0;
  lastFuelSec = 0;
  announcedSplits = 0;
  statusNote = '';
  void releaseWakeLock();
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

    // Check split milestone for optional voice cue
    if (voiceCues && distanceKm > 0) {
      const displayDist = isImperial(userUnits) ? distanceKm * KM_TO_MI : distanceKm;
      const completedSplits = Math.floor(displayDist);
      if (completedSplits > announcedSplits && completedSplits >= 1) {
        announcedSplits = completedSplits;
        const unitWord = isImperial(userUnits) ? 'mile' : 'kilometer';
        const paceMin = durationMin / Math.max(0.01, displayDist);
        const mins = Math.floor(paceMin);
        const secs = Math.round((paceMin - mins) * 60);
        speakCue(`${completedSplits} ${unitWord}${completedSplits > 1 ? 's' : ''} complete. Average pace ${mins} minutes ${secs} seconds per ${unitWord}.`);
      }
    }
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
  return Math.round(met * (Number(userWeightKg) || 60) * (durationMin / 60) * userCalibrationFactor);
});

const activeFuelTargets = $derived.by(() => {
  if (plannedFueling?.fluid?.perHourMl) {
    return {
      fluidPerHourMl: Number(plannedFueling.fluid.perHourMl) || 600,
      carbsPerHourG: Number(plannedFueling.carbs?.perHourG) || 0,
      sodiumPerHourMg: Number(plannedFueling.sodium?.perHourMg) || 450,
    };
  }
  const estMin = Math.max(45, durationMin);
  const rec = recommendFueling({
    activityType,
    durationMin: estMin,
    weightKg: userWeightKg,
    elevationPerKm: distanceKm > 0 ? elevationM / distanceKm : 8,
    avgSpeedKmh: avgSpeedKmh || 9,
    sweatProfile: userSweat,
    temperatureC: userTempC,
    energyCalibrationFactor: userCalibrationFactor,
  });
  return {
    fluidPerHourMl: rec.fluid.perHourMl,
    carbsPerHourG: rec.carbs.perHourG,
    sodiumPerHourMg: rec.sodium.perHourMg,
  };
});

const hydrateIntervalSec = 1200; // 20 min
const fuelIntervalSec = 1800; // 30 min
const nextHydrateInSec = $derived(Math.max(0, hydrateIntervalSec - Math.max(0, Math.round(durationSec) - lastHydrateSec)));
const nextFuelInSec = $derived(Math.max(0, fuelIntervalSec - Math.max(0, Math.round(durationSec) - lastFuelSec)));
const hydrateDue = $derived(tracking && !paused && durationSec >= 60 && nextHydrateInSec === 0);
const fuelDue = $derived(
  tracking && !paused && (activeFuelTargets.carbsPerHourG > 0 || durationMin >= 45) && durationSec >= 1200 && nextFuelInSec === 0,
);

const canSaveStationary = $derived(!saving && tracking && durationMin >= 1 && distanceKm < 0.05);

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
  plannedFueling = null;
  lastOutcome = null;
  lastDailySession = null;
}

function hydrateForUser(userId) {
  clearRuntimeOnly();
  if (!canUseStorage() || !userId) return;
  try {
    const raw = sessionStorage.getItem(storageKey(userId)) || globalThis.localStorage?.getItem?.(backupKey(userId));
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
    plannedFueling = saved.plannedFueling ?? null;
    fluidLoggedMl = Number(saved.fluidLoggedMl) || 0;
    carbsLoggedG = Number(saved.carbsLoggedG) || 0;
    lastHydrateSec = Number(saved.lastHydrateSec) || 0;
    lastFuelSec = Number(saved.lastFuelSec) || 0;
    voiceCues = Boolean(saved.voiceCues);
    announcedSplits = Number(saved.announcedSplits) || 0;
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
        void acquireWakeLock();
        ensureVisibilityHook();
        void startGps();
      }
    }
  } catch {
    // Ignore corrupt snapshot.
  }
}

profile.subscribe((p) => {
  userWeightKg = Number(p?.weight_kg) || 60;
  userUnits = p?.units === 'imperial' ? 'imperial' : 'metric';
  userSweat = p?.sweat_profile || 'normal';
  userTempC = Number(p?.typical_temperature_c ?? 26);
  userCalibrationFactor = Math.min(2, Math.max(0.5, Number(p?.energy_calibration_factor) || 1));
});

session.subscribe((user) => {
  const nextId = user?.id ?? null;
  if (nextId === activeUserId) return;
  if (!nextId) {
    if (canUseStorage() && activeUserId) {
      try {
        sessionStorage.removeItem(storageKey(activeUserId));
        globalThis.localStorage?.removeItem?.(backupKey(activeUserId));
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
  fueling = null,
} = {}) {
  if (tracking) return;
  pathSource = source;
  plannedPath = Array.isArray(path) ? [...path] : [];
  plannedLabel = label;
  plannedPlanKey = planKey;
  plannedFueling = fueling;
}

function logHydration(mlAmount = 200) {
  if (!tracking) return;
  fluidLoggedMl += Math.max(0, Number(mlAmount) || 0);
  lastHydrateSec = Math.round(durationSec);
  persist();
}

function logFuel(gramsAmount = 25) {
  if (!tracking) return;
  carbsLoggedG += Math.max(0, Number(gramsAmount) || 0);
  lastFuelSec = Math.round(durationSec);
  persist();
}

function toggleVoiceCues() {
  voiceCues = !voiceCues;
  if (voiceCues) speakCue('Voice coaching enabled.');
  if (tracking) persist();
}

function startActivity(overrides = {}) {
  if (tracking) return;
  if (overrides.activityType) activityType = overrides.activityType;
  if (overrides.pathSource !== undefined) pathSource = overrides.pathSource;
  if (Array.isArray(overrides.plannedPath)) plannedPath = [...overrides.plannedPath];
  if (overrides.plannedLabel !== undefined) plannedLabel = overrides.plannedLabel;
  if (overrides.plannedPlanKey !== undefined) plannedPlanKey = overrides.plannedPlanKey;
  if (overrides.plannedFueling !== undefined) plannedFueling = overrides.plannedFueling;

  points = [];
  snappedPoints = [];
  currentPosition = null;
  currentAccuracyM = null;
  currentHeading = null;
  startPosition = null;
  finishPosition = null;
  elapsedBeforePauseMs = 0;
  fluidLoggedMl = 0;
  carbsLoggedG = 0;
  lastHydrateSec = 0;
  lastFuelSec = 0;
  announcedSplits = 0;
  startedAtIso = new Date().toISOString();
  activeSegmentStartMs = Date.now();
  nowMs = Date.now();
  paused = false;
  tracking = true;
  statusNote = '';
  lastOutcome = null;

  persist();
  startTicker();
  ensureVisibilityHook();
  void acquireWakeLock();
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
  void releaseWakeLock();
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
  void acquireWakeLock();
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

async function stopActivity({ currentTodaySession = null, allowStationary = false } = {}) {
  if (!tracking || saving) return { saved: false, reason: 'not_tracking' };

  const finalDurationSec = Math.round(durationSec);
  const finalDurationMin = Math.round(durationMin * 10) / 10;
  let finalDistanceKm = Math.round(distanceKm * 100) / 100;

  if (finalDurationMin < 1 || (finalDistanceKm < 0.05 && !allowStationary)) {
    if (!paused) pauseActivity();
    statusNote = 'Record at least 0.05 km (50 m) and 1:00 to save — resume moving or tap Discard.';
    persist();
    notify('Record at least 0.05 km (50 m) and 1:00 to save — or tap Discard to reset.', 'info');
    return { saved: false, reason: 'too_short' };
  }

  if (finalDistanceKm < 0.05 && allowStationary) {
    finalDistanceKm = 0.05;
  }

  saving = true;
  statusNote = '';
  stopTicker();

  let activityPayload = null;

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
    const intakeParts = [];
    if (allowStationary && distanceKm < 0.05) intakeParts.push('Indoor / stationary session');
    if (fluidLoggedMl > 0 || carbsLoggedG > 0) {
      intakeParts.push(`Intake during session: ${fluidLoggedMl} ml fluid, ${carbsLoggedG} g carbs`);
    }

    activityPayload = {
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
      notes: intakeParts.length ? intakeParts.join(' · ') : null,
      source: allowStationary && distanceKm < 0.05 ? 'manual' : 'gps',
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

    if (savedActivity) upsertActivity(savedActivity);
    void api.profile.get().then((p) => p && profile.set(p)).catch(() => {});

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
    // Queue locally on connectivity/server failures (never discard an athlete's outdoor run!)
    const isClientValidation = error?.status >= 400 && error?.status < 500 && error?.status !== 408 && error?.status !== 429;
    if (!isClientValidation && activityPayload) {
      queueActivitySave(activityPayload);
      const offlineOutcome = {
        status: 'completed',
        activityId: null,
        activity_type: activityPayload.activity_type,
        pathSource,
        plannedLabel,
        plannedPath: [...plannedPath],
        route: activityPayload.route ?? [],
        distance_km: activityPayload.distance_km,
        duration_min: activityPayload.duration_min,
        duration_sec: finalDurationSec,
        elevation_gain_m: activityPayload.elevation_gain_m,
        calories: activityPayload.calories,
        average_speed: activityPayload.average_speed,
        average_pace: activityPayload.average_pace,
        started_at: activityPayload.started_at,
        ended_at: activityPayload.ended_at,
        updated_at: new Date().toISOString(),
        note: 'Saved offline on this device — will sync automatically when you reconnect.',
      };
      stopGps();
      resetLiveFields();
      lastOutcome = offlineOutcome;
      persist();
      notify('No connection — workout queued locally and will sync automatically.', 'info');
      return { saved: true, queuedOffline: true, outcome: offlineOutcome };
    }

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
  get plannedFueling() { return plannedFueling; },
  get activeFuelTargets() { return activeFuelTargets; },
  get fluidLoggedMl() { return fluidLoggedMl; },
  get carbsLoggedG() { return carbsLoggedG; },
  get nextHydrateInSec() { return nextHydrateInSec; },
  get nextFuelInSec() { return nextFuelInSec; },
  get hydrateDue() { return hydrateDue; },
  get fuelDue() { return fuelDue; },
  get voiceCues() { return voiceCues; },
  get wakeLockActive() { return wakeLockActive; },
  get canSaveStationary() { return canSaveStationary; },
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
  logHydration,
  logFuel,
  toggleVoiceCues,
  appendGpsFix,
  startActivity,
  pauseActivity,
  resumeActivity,
  discardActivity,
  stopActivity,
  clearOutcome,
  resetAll: clearRuntimeOnly,
};
