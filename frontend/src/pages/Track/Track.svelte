<script>
  import { onMount } from 'svelte';
  import { link } from '../../lib/router.js';
  import TranaMap from '../../components/map/TranaMap.svelte';
  import GPSStatus from '../../components/activity/GPSStatus.svelte';
  import ActivityStats from '../../components/activity/ActivityStats.svelte';
  import ActivityControls from '../../components/activity/ActivityControls.svelte';
  import DailyProgress from '../../components/activity/DailyProgress.svelte';
  import FoodLogger from '../../components/activity/FoodLogger.svelte';
  import ActivityIcon from '../../components/activities/ActivityIcon.svelte';
  import { profile, refresh, notify } from '../../stores/index.js';
  import { activityApi, validateTrackPoint } from '../../services/activityService.js';
  import { dailySessionApi } from '../../services/dailySessionService.js';
  import { estimateMet } from '../../lib/ml/fueling.js';
  import { readCachedPlace } from '../../lib/location.js';
  import { acquireLivePosition, releaseLivePosition, seedLivePosition, livePosition } from '../../lib/liveLocation.svelte.js';
  import { watch, getCurrentPosition, trackPoint, GpsError } from '../../services/gpsService.js';
  import { snapRoute } from '../../services/roadSnappingService.js';
  import { haversineKm, elevationGainM } from '../../services/mapService.js';

  const SPORTS = [
    { id: 'run', label: 'Run' },
    { id: 'ride', label: 'Ride' },
    { id: 'walk', label: 'Walk' },
    { id: 'hike', label: 'Hike' },
  ];

  // ── activity tracking state ──────────────────────────────────────────
  let activityType = $state('run');
  let tracking = $state(false);
  let paused = $state(false);
  let saving = $state(false);

  let points = $state([]);          // [{ latitude, longitude, altitudeM, speedKmh, timestamp }]
  let snappedPoints = $state([]);   // [[lat, lng], ...]
  let currentPosition = $state(null); // [lat, lng]
  let startPosition = $state(null);
  let finishPosition = $state(null);
  let following = $state(true);

  let cachedPlace = readCachedPlace();
  let mapCenter = $derived.by(() => {
    if (currentPosition) return currentPosition;
    const live = livePosition.current;
    if (live && Number.isFinite(live.latitude) && Number.isFinite(live.longitude)) {
      return [live.latitude, live.longitude];
    }
    if (cachedPlace && Number.isFinite(cachedPlace.latitude) && Number.isFinite(cachedPlace.longitude)) {
      return [cachedPlace.latitude, cachedPlace.longitude];
    }
    return [14.676, 121.0437];
  });

  // Stopwatch state (explicit ms accumulation so timers tick & pause accurately)
  let startedAtIso = $state(null);
  let activeSegmentStartMs = $state(null);
  let elapsedBeforePauseMs = $state(0);
  let nowMs = $state(Date.now());
  let ticker = null;

  let gpsStatus = $state('idle');
  let gpsMessage = $state('');
  let watcher = null;

  let roadSnapping = $state(true);
  let showRoads = $state(true);

  // Today's daily session (shared between DailyProgress and FoodLogger)
  let todaySession = $state(null);
  let loadingSession = $state(true);

  // ── derived statistics ───────────────────────────────────────────────
  let durationSec = $derived.by(() => {
    if (!tracking) return 0;
    const activeMs = !paused && activeSegmentStartMs ? Math.max(0, nowMs - activeSegmentStartMs) : 0;
    return Math.max(0, (elapsedBeforePauseMs + activeMs) / 1000);
  });

  let durationMin = $derived(durationSec / 60);

  let distanceKm = $derived.by(() => {
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

  let avgSpeedKmh = $derived(durationMin > 0 && distanceKm > 0 ? distanceKm / (durationMin / 60) : 0);
  let avgPaceMinKm = $derived(distanceKm > 0 && durationMin > 0 ? durationMin / distanceKm : 0);
  let elevationM = $derived(points.length >= 2 ? elevationGainM(points) : 0);

  let estimatedCalories = $derived.by(() => {
    if (durationMin <= 0) return 0;
    const weightKg = Number($profile?.weight_kg) || 60;
    const elevPerKm = distanceKm > 0 ? elevationM / distanceKm : 0;
    const met = estimateMet(activityType, avgSpeedKmh, elevPerKm);
    return Math.round(met * weightKg * (durationMin / 60));
  });

  // ── GPS & lifecycle ──────────────────────────────────────────────────
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

  function appendGpsFix(coords, timestamp) {
    const pt = trackPoint(coords, timestamp);
    const errors = validateTrackPoint(pt);
    if (errors.length > 0) {
      gpsStatus = 'error';
      gpsMessage = 'Invalid GPS reading';
      return;
    }

    const pos = [pt.latitude, pt.longitude];
    currentPosition = pos;
    if (!startPosition) startPosition = pos;
    points = [...points, pt];
    gpsStatus = 'tracking';
    gpsMessage = pt.accuracyM != null ? `±${Math.round(pt.accuracyM)}m` : 'Active';
  }

  async function startGps() {
    gpsStatus = 'requesting';
    gpsMessage = 'Acquiring GPS…';

    try {
      const first = await getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
      appendGpsFix(first.coords, first.timestamp);
    } catch (error) {
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

    if (watcher) {
      watcher.stop();
      watcher = null;
    }

    watcher = watch({
      onPoint: (pt) => {
        if (paused) return;
        const errors = validateTrackPoint(pt);
        if (errors.length > 0) {
          gpsStatus = 'error';
          gpsMessage = 'Invalid GPS reading';
          return;
        }
        const pos = [pt.latitude, pt.longitude];
        currentPosition = pos;
        if (!startPosition) startPosition = pos;
        points = [...points, pt];
        gpsStatus = 'tracking';
        gpsMessage = pt.accuracyM != null ? `±${Math.round(pt.accuracyM)}m` : 'Active';
      },
      onError: (err) => {
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

  function stopGps() {
    if (watcher) {
      watcher.stop();
      watcher = null;
    }
    gpsStatus = 'idle';
    gpsMessage = '';
  }

  function startActivity() {
    points = [];
    snappedPoints = [];
    startPosition = null;
    finishPosition = null;
    elapsedBeforePauseMs = 0;
    startedAtIso = new Date().toISOString();
    activeSegmentStartMs = Date.now();
    nowMs = Date.now();
    paused = false;
    tracking = true;
    following = true;

    startTicker();
    startGps();
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
  }

  function resumeActivity() {
    if (!tracking || !paused) return;
    activeSegmentStartMs = Date.now();
    nowMs = Date.now();
    paused = false;
    startTicker();
    gpsStatus = 'tracking';
    gpsMessage = 'Resumed';
  }

  function discardActivity() {
    stopTicker();
    stopGps();
    reset();
    notify('Tracking discarded', 'info');
  }

  async function stopActivity() {
    if (!tracking || saving) return;

    const finalDurationMin = Math.round(durationMin * 10) / 10;
    const finalDistanceKm = Math.round(distanceKm * 100) / 100;

    if (finalDistanceKm < 0.05 || finalDurationMin < 1) {
      if (!paused) pauseActivity();
      notify('Record at least 0.05 km (50 m) and 1:00 to save — or tap Discard to reset.', 'info');
      return;
    }

    saving = true;
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

      const activityPayload = {
        activity_type: activityType,
        started_at: startedAtIso ?? new Date(Date.now() - Math.round(durationSec * 1000)).toISOString(),
        ended_at: new Date().toISOString(),
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

      // Preserve today's logged calories_eaten / water / notes while adding newly burned calories.
      let existingBurned = Number(todaySession?.calories_burned ?? 0);
      if (!todaySession) {
        try {
          const todayRes = await dailySessionApi.today();
          todaySession = todayRes?.data ?? null;
          existingBurned = Number(todaySession?.calories_burned ?? 0);
        } catch {
          // ignore
        }
      }

      const sessionRes = await dailySessionApi.saveToday({
        calories_burned: existingBurned + caloriesBurned,
      });
      if (sessionRes?.data) {
        todaySession = sessionRes.data;
      }

      await refresh();
      notify("Activity saved to today's session", 'success');
      stopGps();
      reset();
    } catch (error) {
      notify(error?.message || 'Failed to save activity', 'error');
    } finally {
      saving = false;
    }
  }

  function reset() {
    tracking = false;
    paused = false;
    points = [];
    snappedPoints = [];
    currentPosition = null;
    startPosition = null;
    finishPosition = null;
    startedAtIso = null;
    activeSegmentStartMs = null;
    elapsedBeforePauseMs = 0;
  }

  // ── load today's session & seed city view ────────────────────────────
  async function loadTodaySession() {
    try {
      const res = await dailySessionApi.today();
      todaySession = res?.data ?? null;
    } catch {
      todaySession = null;
    } finally {
      loadingSession = false;
    }
  }

  onMount(() => {
    if (cachedPlace) seedLivePosition(cachedPlace);
    acquireLivePosition();
    loadTodaySession();

    return () => {
      stopTicker();
      stopGps();
      releaseLivePosition();
    };
  });
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div>
      <span class="pill-brand">Live tracking</span>
      <h1 class="mt-2 font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-ink-900">
        Track Activity
      </h1>
      <p class="text-sm text-ink-500 mt-1">
        Record live GPS distance, pace, route, and calories — synced straight into today’s nutrition session.
      </p>
    </div>
    <a href="/track/history" use:link class="btn-ghost text-xs">
      View History →
    </a>
  </div>

  <!-- Sport selector + GPS status + Map options -->
  <div class="rounded-3xl border border-brand-100 bg-white shadow-card p-4 sm:p-6 space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2" role="group" aria-label="Activity type">
        {#each SPORTS as sport (sport.id)}
          <button
            type="button"
            disabled={tracking}
            onclick={() => (activityType = sport.id)}
            class="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed {activityType === sport.id
              ? 'bg-brand-gradient text-white shadow-glow'
              : 'bg-brand-50 text-ink-700 hover:bg-brand-100'}"
          >
            <ActivityIcon type={sport.id} size="xs" tone={activityType === sport.id ? 'solid' : 'brand'} />
            <span>{sport.label}</span>
          </button>
        {/each}
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <GPSStatus status={gpsStatus} message={gpsMessage} />
        <label class="inline-flex items-center gap-1.5 text-xs font-bold text-ink-700 cursor-pointer select-none">
          <input type="checkbox" bind:checked={roadSnapping} class="accent-brand-600 rounded" />
          <span>Road snap</span>
        </label>
        <label class="inline-flex items-center gap-1.5 text-xs font-bold text-ink-700 cursor-pointer select-none">
          <input type="checkbox" bind:checked={showRoads} class="accent-brand-600 rounded" />
          <span>Show roads</span>
        </label>
      </div>
    </div>

    <!-- Live Map (explicit height so MapLibre never collapses to 0px) -->
    <div class="relative h-[340px] sm:h-[420px] lg:h-[460px] w-full">
      <TranaMap
        {points}
        center={mapCenter}
        {currentPosition}
        {startPosition}
        {finishPosition}
        bind:following
        autoCenter={true}
        {roadSnapping}
        {showRoads}
      />
    </div>

    <!-- Live Metrics -->
    <ActivityStats
      {distanceKm}
      {durationMin}
      durationSec={tracking ? durationSec : null}
      {avgSpeedKmh}
      {avgPaceMinKm}
      elevationGainM={elevationM}
      calories={estimatedCalories}
    />

    <!-- Action Buttons -->
    <ActivityControls
      {tracking}
      {paused}
      {saving}
      onStart={startActivity}
      onPause={pauseActivity}
      onResume={resumeActivity}
      onStop={stopActivity}
      onDiscard={discardActivity}
    />
  </div>

  <!-- Daily Session & Food Log -->
  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <div class="lg:col-span-2">
      <DailyProgress
        session={todaySession}
        onSessionChange={(updated) => (todaySession = updated)}
      />
    </div>
    <div class="lg:col-span-1">
      <FoodLogger
        session={todaySession}
        onSessionChange={(updated) => (todaySession = updated)}
      />
    </div>
  </div>
</div>
