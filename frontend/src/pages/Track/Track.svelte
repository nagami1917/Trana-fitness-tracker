<script>
  import { onMount, onDestroy } from 'svelte';
  import { derived } from 'svelte/store';
  import { formatDistance, formatDuration, formatPace, formatSpeed } from '../../lib/format.js';
  import { navigate } from '../../lib/router.js';

  import TranaMap from '../../components/map/TranaMap.svelte';
  import ActivityStats from '../../components/activity/ActivityStats.svelte';
  import ActivityControls from '../../components/activity/ActivityControls.svelte';
  import GPSStatus from '../../components/activity/GPSStatus.svelte';
  import DailyProgress from '../../components/activity/DailyProgress.svelte';
  import FoodLogger from '../../components/activity/FoodLogger.svelte';

  import { watch, getCurrentPosition, trackPoint, GpsError } from '../../services/gpsService.js';
  import {
    polylineLengthKm,
    elevationGainM,
  } from '../../services/mapService.js';
  import { validateTrackPoint } from '../../services/activityService.js';
  import { activityApi } from '../../services/activityService.js';
  import { dailySessionApi, todayDate } from '../../services/dailySessionService.js';
  import { api } from '../../services/client.js';
  import { notify } from '../../stores/index.js';

  /* ── activity type / mode ────────────────────────────────────────── */
  const ACTIVITY_TYPES = [
    { id: 'run', label: 'Run' },
    { id: 'ride', label: 'Ride' },
    { id: 'walk', label: 'Walk' },
    { id: 'hike', label: 'Hike' },
  ];

  let activityType = 'run';

  /* ── tracking state ──────────────────────────────────────────────── */
  let tracking = $state(false);
  let saving = $state(false);
  let gpsStatus = $state('idle');
  let gpsMessage = $state('Press Start to begin tracking');

  let startedAt = null;
  let endedAt = null;
  let points = $state([]); // { latitude, longitude, altitudeM, speedKmh, timestamp }

  let currentPosition = $state(null);
  let startPosition = $state(null);
  let finishPosition = $state(null);

  let autoCenter = $state(true);
  let following = $state(true);

  let roadSnapping = $state(true);
  let showRoads = $state(true);

  let watcher = null;

  /* ── derived stats ───────────────────────────────────────────────── */
  const coords = $derived(points.map((p) => [p.latitude, p.longitude]));
  const distanceKm = $derived(polylineLengthKm(coords));
  const durationSec = $derived(
    (endedAt || (tracking ? Date.now() : startedAt)) && startedAt
      ? ((endedAt || Date.now()) - new Date(startedAt).getTime()) / 1000
      : 0,
  );
  const durationMin = $derived(durationSec / 60);
  const avgSpeedKmh = $derived(
    distanceKm > 0 && durationMin > 0 ? distanceKm / (durationMin / 60) : 0,
  );
  const avgPaceMinKm = $derived(
    distanceKm > 0 && durationMin > 0 ? durationMin / distanceKm : 0,
  );
  const elevationGainMVal = $derived(elevationGainM(points));
  const caloriesBurned = $derived(Math.round(distanceKm * 60)); // estimate

  const paceForDisplay = $derived(formatPace(avgPaceMinKm));
  const speedForDisplay = $derived(formatSpeed(avgSpeedKmh));

  /* ── GPS ─────────────────────────────────────────────────────────── */
  async function startGps() {
    gpsStatus = 'requesting';
    gpsMessage = 'Requesting location permission…';

    try {
      const first = await getCurrentPosition({ enableHighAccuracy: true });
      currentPosition = [first.latitude, first.longitude];
      startPosition = currentPosition;
      gpsStatus = 'tracking';
      gpsMessage = 'GPS active';
      notify('Location access granted', 'success');
    } catch (error) {
      gpsStatus = error instanceof GpsError ? error.code : 'error';
      gpsMessage = error.message || 'Could not access location';
      notify(gpsMessage, 'error');
    }

    watcher = watch({
      onPoint: (point) => {
        currentPosition = [point.latitude, point.longitude];
        if (startPosition === null) startPosition = currentPosition;

        const errors = validateTrackPoint(point);
        if (errors.length) {
          gpsStatus = 'error';
          gpsMessage = 'Invalid GPS reading';
          return;
        }

        points.push({
          ...point,
          altitudeM: point.altitudeM,
          speedKmh: point.speedKmh,
        });

        if (autoCenter && following) {
          // TranaMap auto-centres via its own effect
        }
      },
      onError: (error) => {
        gpsStatus = error.code;
        gpsMessage = error.message;
        notify(error.message, 'error');
      },
      snapToRoadEnabled: roadSnapping,
    });
  }

  function stopGps() {
    if (watcher) watcher.stop();
    watcher = null;
  }

  /* ── activity lifecycle ──────────────────────────────────────────── */
  async function startActivity() {
    if (tracking) return;
    startedAt = new Date().toISOString();
    endedAt = null;
    points = [];
    currentPosition = null;
    startPosition = null;
    finishPosition = null;
    tracking = true;
    following = true;
    autoCenter = true;
    gpsStatus = 'requesting';
    gpsMessage = 'Starting activity…';

    await startGps();
  }

  async function endActivity() {
    if (!tracking) return;
    tracking = false;
    saving = true;
    stopGps();
    endedAt = new Date().toISOString();
    finishPosition = currentPosition;

    try {
      // Save activity to backend
      const activityPayload = {
        activity_type: activityType,
        started_at: startedAt,
        ended_at: endedAt,
        distance_km: Math.round(distanceKm * 100) / 100,
        duration_min: Math.round(durationMin * 10) / 10,
        average_speed: Math.round(avgSpeedKmh * 10) / 10,
        average_pace: Math.round(avgPaceMinKm * 100) / 100,
        elevation_gain_m: Math.round(elevationGainMVal),
        calories: caloriesBurned,
        route: coords,
        route_geojson: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { activity_type: activityType },
              geometry: { type: 'LineString', coordinates: coords.map(([lat, lng]) => [lng, lat]) },
            },
          ],
        },
        notes: `Tracked with TRANA live map`,
        source: 'gps',
      };

      await activityApi.create(activityPayload);

      // Save/update today's daily session with calories burned
      const today = todayDate();
      const existing = await dailySessionApi.today();
      if (existing?.data) {
        await dailySessionApi.saveToday({
          calories_burned: Math.round(existing.data.calories_burned) + caloriesBurned,
          calories_eaten: existing.data.calories_eaten,
          water_ml: existing.data.water_ml,
          notes: existing.data.notes,
        });
      } else {
        await dailySessionApi.saveToday({
          calories_burned: caloriesBurned,
          calories_eaten: 0,
          water_ml: 0,
          notes: 'Auto-saved from activity tracking',
        });
      }

      notify('Activity saved to today\'s session', 'success');
    } catch (error) {
      notify(error.message || 'Failed to save activity', 'error');
    } finally {
      saving = false;
      reset();
    }
  }

  function reset() {
    tracking = false;
    points = [];
    currentPosition = null;
    startPosition = null;
    finishPosition = null;
    startedAt = null;
    endedAt = null;
    gpsStatus = 'idle';
    gpsMessage = 'Press Start to begin tracking';
    following = true;
  }

  onDestroy(() => {
    stopGps();
  });
</script>

<div class="min-h-[calc(100vh-64px)] w-full flex flex-col">
  <!-- Map occupies most of the screen -->
  <div class="flex-1 min-h-0 relative">
    <TranaMap
      {points}
      {currentPosition}
      {startPosition}
      {finishPosition}
      {autoCenter}
      {following}
      fitRoute={!tracking}
      fitPadding={72}
      {roadSnapping}
      {showRoads}
    />
  </div>

  <!-- GPS status bar -->
  <div class="border-t border-brand-100 bg-white/80 backdrop-blur px-4 py-2 flex items-center justify-between">
    <GPSStatus {gpsStatus} {gpsMessage} />
    <div class="flex items-center gap-3">
      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          class="form-checkbox rounded text-brand-500 focus:ring-brand-500"
          checked={roadSnapping}
          onchange={(e) => (roadSnapping = e.target.checked)}
          aria-label="Snap to roads"
        />
        <span class="text-xs font-bold text-ink-700">Road snap</span>
      </label>
      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          class="form-checkbox rounded text-brand-500 focus:ring-brand-500"
          checked={showRoads}
          onchange={(e) => (showRoads = e.target.checked)}
          aria-label="Show roads"
        />
        <span class="text-xs font-bold text-ink-700">Show roads</span>
      </label>
      <div class="text-xs font-bold text-ink-500">
        {activityType.charAt(0).toUpperCase() + activityType.slice(1)}
      </div>
    </div>
    <a href="/track/history" class="text-xs font-bold text-brand-500 hover:underline">View History →</a>
  </div>

  <!-- Daily Progress + Food Logger (bottom panel instead of simple stats) -->
  <div class="border-t border-brand-100 bg-white shadow-card flex-1">
    <div class="p-4 sm:p-6">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <DailyProgress lg:col-span-2 />
        <FoodLogger lg:col-span-1 />
      </div>
    </div>
  </div>
</div>