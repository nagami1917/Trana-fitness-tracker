<script>
  import { onMount, tick } from 'svelte';
  import {
    Route as RouteIcon,
    Pencil,
    Sparkles,
    Search,
    LoaderCircle,
    Navigation,
    ArrowLeftRight,
    Repeat,
    RotateCcw,
    Undo2,
    Trash2,
    Lock,
    Maximize2,
    MapPin,
    Ruler,
    History,
  } from 'lucide-svelte';
  import TranaMap from '../../components/map/TranaMap.svelte';
  import GPSStatus from '../../components/activity/GPSStatus.svelte';
  import ActivityStats from '../../components/activity/ActivityStats.svelte';
  import ActivityControls from '../../components/activity/ActivityControls.svelte';
  import DailyProgress from '../../components/activity/DailyProgress.svelte';
  import FoodLogger from '../../components/activity/FoodLogger.svelte';
  import ActivityIcon from '../../components/activities/ActivityIcon.svelte';
  import { link, navigate, query } from '../../lib/router.js';
  import { profile, plans, activities, refresh, notify } from '../../stores/index.js';
  import { activityApi, validateTrackPoint } from '../../services/activityService.js';
  import { dailySessionApi } from '../../services/dailySessionService.js';
  import { estimateMet } from '../../lib/ml/fueling.js';
  import { readCachedPlace } from '../../lib/location.js';
  import { acquireLivePosition, releaseLivePosition, seedLivePosition, livePosition } from '../../lib/liveLocation.svelte.js';
  import { watch, getCurrentPosition, trackPoint, GpsError } from '../../services/gpsService.js';
  import { snapRoute } from '../../services/roadSnappingService.js';
  import {
    pathToGeoJson,
    routeThroughRoads,
    waypointsFromPath,
    outAndBackWaypoints,
    closeLoopWaypoints,
    reverseWaypoints,
    isClosedLoop,
    searchPlaces,
  } from '../../services/roadRoutingService.js';
  import { haversineKm, polylineLengthKm, elevationGainM } from '../../services/mapService.js';
  import { nf, shortDate } from '../../lib/format.js';

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
  let currentAccuracyM = $state(null);
  let currentHeading = $state(null);
  let startPosition = $state(null);
  let finishPosition = $state(null);
  let following = $state(true);

  let cachedPlace = readCachedPlace();
  const liveCoords = $derived(
    livePosition.current &&
    Number.isFinite(livePosition.current.latitude) &&
    Number.isFinite(livePosition.current.longitude)
      ? [livePosition.current.latitude, livePosition.current.longitude]
      : null,
  );
  const displayPosition = $derived(currentPosition ?? liveCoords);
  const displayAccuracyM = $derived(currentAccuracyM ?? livePosition.current?.accuracy ?? null);
  const displayHeading = $derived(currentHeading ?? livePosition.current?.heading ?? null);
  let mapCenter = $derived.by(() => {
    if (currentPosition) return currentPosition;
    if (liveCoords) return liveCoords;
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

  // ── path selection: 'none' | 'create' | 'plan' | 'activity' ──────────
  let tranaMap = $state(null);
  let pathSource = $state('none');

  // Plan Activity route selection state
  let activePlan = $state(null);
  let planPath = $state([]);
  let planSnapping = $state(false);
  let planSnapSeq = 0;
  let planSnapAbort = null;
  let draftPlan = $state(null);
  let hydratedQueryPlan = false;

  // Logged Activity route selection state
  let activeActivity = $state(null);
  let activityPath = $state([]);
  let activitySnapping = $state(false);
  let activitySnapSeq = 0;
  let activitySnapAbort = null;

  // Custom path creation state
  let customWaypoints = $state([]);
  let customSnappedPath = $state([]);
  let customRouteMode = $state('roads'); // 'roads' | 'straight'
  let customDrawing = $state(true);
  let customRouting = $state(false);
  let customProvider = $state(null);
  let customProviderLabel = $state('');
  let customSnapTimer;
  let customSnapSeq = 0;
  let customSnapAbort = null;

  // Street / landmark search for custom path creation
  let placeQuery = $state('');
  let placeResults = $state([]);
  let searchingPlace = $state(false);
  let searchError = $state('');
  let searchAbort = null;

  const plansWithRoutes = $derived($plans.filter((p) => Array.isArray(p.route) && p.route.length >= 2));
  const availablePlans = $derived.by(() => {
    const list = [];
    if (draftPlan?.route?.length >= 2) {
      list.push(draftPlan);
    }
    const withRoutes = $plans.filter((p) => Array.isArray(p.route) && p.route.length >= 2);
    const withoutRoutes = $plans.filter((p) => !Array.isArray(p.route) || p.route.length < 2);
    return [...list, ...withRoutes, ...withoutRoutes];
  });

  const activitiesWithRoutes = $derived($activities.filter((a) => Array.isArray(a.route) && a.route.length >= 2));
  const availableActivities = $derived.by(() => {
    const withRoutes = $activities.filter((a) => Array.isArray(a.route) && a.route.length >= 2);
    const withoutRoutes = $activities.filter((a) => !Array.isArray(a.route) || a.route.length < 2);
    return [...withRoutes, ...withoutRoutes];
  });

  const customClosed = $derived(isClosedLoop(customWaypoints));
  const activeCustomPath = $derived(
    customSnappedPath.length > 1
      ? customSnappedPath
      : customWaypoints.length > 1
        ? customWaypoints
        : [],
  );
  const customRouteKm = $derived(activeCustomPath.length > 1 ? polylineLengthKm(activeCustomPath) : 0);

  const activePlanPath = $derived(
    planPath.length >= 2
      ? planPath
      : activePlan?.route?.length >= 2
        ? activePlan.route
        : [],
  );
  const activePlanKm = $derived(
    activePlanPath.length >= 2
      ? polylineLengthKm(activePlanPath)
      : Number(activePlan?.distance_km ?? 0) || 0,
  );

  const activeActivityPath = $derived(
    activityPath.length >= 2
      ? activityPath
      : activeActivity?.route?.length >= 2
        ? activeActivity.route
        : [],
  );
  const activeActivityKm = $derived(
    activeActivityPath.length >= 2
      ? polylineLengthKm(activeActivityPath)
      : Number(activeActivity?.distance_km ?? 0) || 0,
  );

  const plannedRoute = $derived.by(() => {
    if (pathSource === 'plan') {
      return activePlanPath.length >= 2
        ? pathToGeoJson(activePlanPath, activePlan?.activity_type || activityType)
        : null;
    }
    if (pathSource === 'activity') {
      return activeActivityPath.length >= 2
        ? pathToGeoJson(activeActivityPath, activeActivity?.activity_type || activityType)
        : null;
    }
    if (pathSource === 'create') {
      return activeCustomPath.length >= 2
        ? pathToGeoJson(activeCustomPath, activityType)
        : null;
    }
    return null;
  });

  const mapPlannedWaypoints = $derived(pathSource === 'create' ? customWaypoints : []);
  const interactiveRoute = $derived(pathSource === 'create' && customDrawing);
  const mapRouting = $derived(
    (pathSource === 'create' && customRouting) ||
    (pathSource === 'plan' && planSnapping) ||
    (pathSource === 'activity' && activitySnapping),
  );

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

  // ── path source helpers ──────────────────────────────────────────────
  function readDraftPlan() {
    if (typeof sessionStorage === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem('trana:draft_planned_route');
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.route?.length >= 2) {
        return { ...parsed, id: 'draft', isDraft: true };
      }
    } catch {
      // ignore invalid draft storage
    }
    return null;
  }

  function resetPlanSnap() {
    planSnapAbort?.abort();
    planSnapAbort = null;
    planSnapSeq += 1;
    planSnapping = false;
  }

  function resetActivitySnap() {
    activitySnapAbort?.abort();
    activitySnapAbort = null;
    activitySnapSeq += 1;
    activitySnapping = false;
  }

  function resetCustomSnap() {
    clearTimeout(customSnapTimer);
    customSnapAbort?.abort();
    customSnapAbort = null;
    customSnapSeq += 1;
    customSnappedPath = [];
    customRouting = false;
    customProvider = null;
    customProviderLabel = '';
  }

  function selectPathSource(mode) {
    pathSource = mode;
    if (mode === 'none') {
      resetPlanSnap();
      activePlan = null;
      planPath = [];
      resetActivitySnap();
      activeActivity = null;
      activityPath = [];
      resetCustomSnap();
      customWaypoints = [];
      placeResults = [];
      searchError = '';
      return;
    }
    if (mode === 'create') {
      resetPlanSnap();
      activePlan = null;
      planPath = [];
      resetActivitySnap();
      activeActivity = null;
      activityPath = [];
      customDrawing = true;
      return;
    }
    if (mode === 'plan') {
      resetActivitySnap();
      activeActivity = null;
      activityPath = [];
      draftPlan = readDraftPlan();
      placeResults = [];
      searchError = '';
      if (!activePlan) {
        const firstWithRoute = (draftPlan?.route?.length >= 2 ? draftPlan : null) ?? plansWithRoutes[0] ?? null;
        if (firstWithRoute) selectPlanRoute(firstWithRoute);
      }
      return;
    }
    if (mode === 'activity') {
      resetPlanSnap();
      activePlan = null;
      planPath = [];
      placeResults = [];
      searchError = '';
      if (!activeActivity) {
        const firstWithRoute = activitiesWithRoutes[0] ?? null;
        if (firstWithRoute) selectActivityRoute(firstWithRoute);
      }
    }
  }

  function clearPath() {
    selectPathSource('none');
  }

  function selectPlanRoute(plan) {
    if (!plan) return;
    resetPlanSnap();

    if (!Array.isArray(plan.route) || plan.route.length < 2) {
      if (!tracking && plan.activity_type) activityType = plan.activity_type;
      activePlan = plan;
      planPath = [];
      notify('This saved plan only has a target distance. Switching to Create path so you can plot Start & End on the map.', 'info');
      pathSource = 'create';
      customDrawing = true;
      return;
    }

    pathSource = 'plan';
    activePlan = plan;
    planPath = [...plan.route];
    if (!tracking && plan.activity_type) {
      activityType = plan.activity_type;
    }
    following = false;
    void tick().then(() => tranaMap?.fitRouteBounds?.());

    // Older saved plans or 2-point drafts only stored [Start, End] — upgrade
    // them automatically along the road/path network when clicked.
    if (plan.route.length === 2) {
      const seq = ++planSnapSeq;
      const controller = new AbortController();
      planSnapAbort = controller;
      planSnapping = true;
      void (async () => {
        const result = await routeThroughRoads(
          plan.route,
          plan.activity_type || activityType,
          { allowKeyless: true, signal: controller.signal },
        );
        if (seq !== planSnapSeq) return;
        if (result?.path?.length >= 2) {
          planPath = result.path;
          void tick().then(() => tranaMap?.fitRouteBounds?.());
        }
        planSnapping = false;
      })();
    }
  }

  function customizeLoadedPlan() {
    if (!activePlan) return;
    const sourcePath = activePlanPath;
    if (sourcePath.length < 2) {
      selectPathSource('create');
      return;
    }
    const rawStops = Array.isArray(activePlan.route) && activePlan.route.length <= 12
      ? activePlan.route.map((p) => [...p])
      : waypointsFromPath(sourcePath);

    resetPlanSnap();
    activePlan = null;
    planPath = [];
    pathSource = 'create';
    customWaypoints = rawStops;
    customDrawing = true;
    if (sourcePath.length > 2) {
      customSnappedPath = [...sourcePath];
      customProvider = 'saved';
      customProviderLabel = 'From Plan Activity';
      customRouting = false;
      void tick().then(() => tranaMap?.fitRouteBounds?.());
    } else if (customRouteMode === 'roads') {
      scheduleCustomSnap({ immediate: true, fitAfter: true });
    } else {
      void tick().then(() => tranaMap?.fitRouteBounds?.());
    }
  }

  function selectActivityRoute(act) {
    if (!act) return;
    resetActivitySnap();

    if (!Array.isArray(act.route) || act.route.length < 2) {
      if (!tracking && act.activity_type) activityType = act.activity_type;
      activeActivity = act;
      activityPath = [];
      notify('This logged activity has no saved map path. Switching to Create path so you can plot Start & End.', 'info');
      pathSource = 'create';
      customDrawing = true;
      return;
    }

    pathSource = 'activity';
    activeActivity = act;
    activityPath = [...act.route];
    if (!tracking && act.activity_type) {
      activityType = act.activity_type;
    }
    following = false;
    void tick().then(() => tranaMap?.fitRouteBounds?.());

    if (act.route.length === 2) {
      const seq = ++activitySnapSeq;
      const controller = new AbortController();
      activitySnapAbort = controller;
      activitySnapping = true;
      void (async () => {
        const result = await routeThroughRoads(
          act.route,
          act.activity_type || activityType,
          { allowKeyless: true, signal: controller.signal },
        );
        if (seq !== activitySnapSeq) return;
        if (result?.path?.length >= 2) {
          activityPath = result.path;
          void tick().then(() => tranaMap?.fitRouteBounds?.());
        }
        activitySnapping = false;
      })();
    }
  }

  function customizeLoadedActivity() {
    if (!activeActivity) return;
    const sourcePath = activeActivityPath;
    if (sourcePath.length < 2) {
      selectPathSource('create');
      return;
    }
    const rawStops = Array.isArray(activeActivity.route) && activeActivity.route.length <= 12
      ? activeActivity.route.map((p) => [...p])
      : waypointsFromPath(sourcePath);

    resetActivitySnap();
    activeActivity = null;
    activityPath = [];
    pathSource = 'create';
    customWaypoints = rawStops;
    customDrawing = true;
    if (sourcePath.length > 2) {
      customSnappedPath = [...sourcePath];
      customProvider = 'saved';
      customProviderLabel = 'From Activities';
      customRouting = false;
      void tick().then(() => tranaMap?.fitRouteBounds?.());
    } else if (customRouteMode === 'roads') {
      scheduleCustomSnap({ immediate: true, fitAfter: true });
    } else {
      void tick().then(() => tranaMap?.fitRouteBounds?.());
    }
  }

  function selectSport(sportId) {
    activityType = sportId;
    if (pathSource === 'create' && customWaypoints.length >= 2 && customRouteMode === 'roads') {
      scheduleCustomSnap({ immediate: true });
    }
  }

  function setCustomRouteMode(mode) {
    customRouteMode = mode;
    if (mode === 'straight') {
      resetCustomSnap();
    } else {
      scheduleCustomSnap({ immediate: true });
    }
  }

  function scheduleCustomSnap({ immediate = false, fitAfter = false } = {}) {
    clearTimeout(customSnapTimer);
    customSnapAbort?.abort();
    customSnapAbort = null;

    if (customRouteMode !== 'roads' || customWaypoints.length < 2) {
      customSnapSeq += 1;
      customSnappedPath = [];
      customRouting = false;
      customProvider = null;
      customProviderLabel = '';
      return;
    }

    customRouting = true;
    const delay = immediate ? 0 : 220;
    customSnapTimer = setTimeout(() => runCustomSnap({ fitAfter }), delay);
  }

  async function runCustomSnap({ fitAfter = false } = {}) {
    const seq = ++customSnapSeq;
    const controller = new AbortController();
    customSnapAbort = controller;

    const waypoints = [...customWaypoints];
    const sport = activityType;
    const result = await routeThroughRoads(waypoints, sport, {
      allowKeyless: true,
      signal: controller.signal,
    });
    if (seq !== customSnapSeq) return;

    if (result?.path?.length >= 2) {
      customSnappedPath = result.path;
      customProvider = result.provider;
      customProviderLabel = result.providerLabel || 'OpenStreetMap';
      if (fitAfter) void tick().then(() => tranaMap?.fitRouteBounds?.());
    } else {
      customSnappedPath = [];
      customProvider = 'fallback';
      customProviderLabel = '';
    }
    customRouting = false;
  }

  function onCustomRoutePick(mode, index, latlng) {
    if (!latlng) return;
    following = false;
    const point = [Number(latlng.lat.toFixed(5)), Number(latlng.lng.toFixed(5))];
    if (mode === 'remove') {
      customWaypoints = customWaypoints.filter((_, i) => i !== index);
      scheduleCustomSnap({ immediate: true });
      return;
    }
    if (mode === 'move') {
      customWaypoints = customWaypoints.map((existing, i) => (i === index ? point : existing));
      scheduleCustomSnap();
      return;
    }
    customWaypoints = [...customWaypoints, point];
    scheduleCustomSnap({ immediate: customWaypoints.length >= 2 });
  }

  function startCustomFromGps() {
    const anchor = currentPosition ?? liveCoords;
    if (!anchor) return;
    const pt = [Number(anchor[0].toFixed(5)), Number(anchor[1].toFixed(5))];
    if (!customWaypoints.length) {
      customWaypoints = [pt];
      following = false;
      tranaMap?.focusPoint?.(pt, 16);
      notify('Start set to your GPS location — tap End on the map.', 'info');
      return;
    }
    customWaypoints = [pt, ...customWaypoints];
    following = false;
    scheduleCustomSnap({ immediate: true, fitAfter: true });
  }

  function makeCustomOutAndBack() {
    if (customWaypoints.length < 2 || customClosed) return;
    customWaypoints = outAndBackWaypoints(customWaypoints);
    following = false;
    scheduleCustomSnap({ immediate: true, fitAfter: true });
  }

  function makeCustomLoop() {
    if (customWaypoints.length < 2 || customClosed) return;
    customWaypoints = closeLoopWaypoints(customWaypoints);
    following = false;
    scheduleCustomSnap({ immediate: true, fitAfter: true });
  }

  function reverseCustomRoute() {
    if (customWaypoints.length < 2) return;
    customWaypoints = reverseWaypoints(customWaypoints);
    scheduleCustomSnap({ immediate: true });
  }

  function undoCustomPoint() {
    if (!customWaypoints.length) return;
    customWaypoints = customWaypoints.slice(0, -1);
    scheduleCustomSnap({ immediate: true });
  }

  function clearCustomRoute() {
    customWaypoints = [];
    resetCustomSnap();
  }

  async function handlePlaceSearch(event) {
    event?.preventDefault?.();
    const q = placeQuery.trim();
    if (q.length < 2) {
      placeResults = [];
      searchError = 'Type at least 2 characters to search a street, park, or landmark.';
      return;
    }
    searchAbort?.abort();
    const controller = new AbortController();
    searchAbort = controller;
    searchingPlace = true;
    searchError = '';

    const results = await searchPlaces(q, {
      near: currentPosition ?? liveCoords ?? customWaypoints[customWaypoints.length - 1] ?? null,
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;

    searchingPlace = false;
    placeResults = results;
    if (!results.length) {
      searchError = 'No matching streets or places found nearby.';
    }
  }

  function addPlaceAsStop(place) {
    const pt = [place.latitude, place.longitude];
    customWaypoints = [...customWaypoints, pt];
    placeQuery = '';
    placeResults = [];
    searchError = '';
    customDrawing = true;
    following = false;

    if (customWaypoints.length === 1) {
      tranaMap?.focusPoint?.(pt, 16);
    } else {
      scheduleCustomSnap({ immediate: true, fitAfter: true });
    }
  }

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

  function appendGpsFix(fix) {
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
      points = [...points, pt];
    }
    gpsStatus = 'tracking';
    gpsMessage = pt.accuracyM != null ? `±${Math.round(pt.accuracyM)}m` : 'Active';
  }

  async function startGps() {
    gpsStatus = 'requesting';
    gpsMessage = 'Acquiring GPS…';

    try {
      const first = await getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      appendGpsFix(first);
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
      activityType,
      onPoint: (pt) => {
        if (paused) return;
        appendGpsFix(pt);
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
    currentAccuracyM = null;
    currentHeading = null;
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
    draftPlan = readDraftPlan();

    const planParam = $query.get('plan');
    if (planParam === 'draft') {
      hydratedQueryPlan = true;
      if (draftPlan) selectPlanRoute(draftPlan);
    } else if (planParam) {
      const found = $plans.find((p) => String(p.id) === String(planParam));
      if (found) {
        hydratedQueryPlan = true;
        selectPlanRoute(found);
      }
    }

    return () => {
      stopTicker();
      stopGps();
      clearTimeout(customSnapTimer);
      customSnapAbort?.abort();
      planSnapAbort?.abort();
      activitySnapAbort?.abort();
      searchAbort?.abort();
      releaseLivePosition();
    };
  });

  // Apply ?plan=<id> if $plans arrives asynchronously after mount (e.g., hard reload on /track?plan=2).
  $effect(() => {
    if (hydratedQueryPlan) return;
    const planParam = $query.get('plan');
    if (!planParam || planParam === 'draft') return;
    const found = $plans.find((p) => String(p.id) === String(planParam));
    if (found) {
      hydratedQueryPlan = true;
      selectPlanRoute(found);
    }
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
            onclick={() => selectSport(sport.id)}
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

    <!-- Path selection: Free GPS vs Create path vs From Plan Activity vs From Activities -->
    <div class="rounded-2xl border border-brand-100 bg-brand-50/50 p-3 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-[11px] font-extrabold uppercase tracking-wide text-ink-500">Path</span>
          <div
            class="inline-flex flex-wrap items-center gap-1 rounded-2xl border border-brand-100 bg-white p-1"
            role="group"
            aria-label="Route path source"
          >
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition cursor-pointer {pathSource === 'none'
                ? 'bg-brand-gradient text-white shadow-glow'
                : 'text-ink-600 hover:bg-brand-50'}"
              onclick={() => selectPathSource('none')}
            >
              <Navigation size={13} /> Free GPS
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition cursor-pointer {pathSource === 'create'
                ? 'bg-brand-gradient text-white shadow-glow'
                : 'text-ink-600 hover:bg-brand-50'}"
              onclick={() => selectPathSource('create')}
            >
              <Pencil size={13} /> Create path
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition cursor-pointer {pathSource === 'plan'
                ? 'bg-brand-gradient text-white shadow-glow'
                : 'text-ink-600 hover:bg-brand-50'}"
              onclick={() => selectPathSource('plan')}
            >
              <Sparkles size={13} /> From Plan Activity
              {#if plansWithRoutes.length}
                <span class="rounded-full px-1.5 py-0.5 text-[10px] leading-none {pathSource === 'plan' ? 'bg-white/25 text-white' : 'bg-brand-100 text-brand-700'}">
                  {plansWithRoutes.length}
                </span>
              {/if}
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition cursor-pointer {pathSource === 'activity'
                ? 'bg-brand-gradient text-white shadow-glow'
                : 'text-ink-600 hover:bg-brand-50'}"
              onclick={() => selectPathSource('activity')}
            >
              <History size={13} /> From Activities
              {#if activitiesWithRoutes.length}
                <span class="rounded-full px-1.5 py-0.5 text-[10px] leading-none {pathSource === 'activity' ? 'bg-white/25 text-white' : 'bg-brand-100 text-brand-700'}">
                  {activitiesWithRoutes.length}
                </span>
              {/if}
            </button>
          </div>
        </div>

        {#if pathSource !== 'none'}
          <button
            type="button"
            class="text-xs font-extrabold text-ink-500 hover:text-brand-600 cursor-pointer"
            onclick={clearPath}
          >
            Clear path
          </button>
        {/if}
      </div>

      {#if pathSource === 'create'}
        <div class="space-y-2.5 border-t border-brand-100/80 pt-2.5">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex flex-wrap items-center gap-1.5">
              <div class="inline-flex rounded-xl border border-brand-100 bg-white p-0.5" role="group" aria-label="Custom routing mode">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-extrabold transition cursor-pointer {customRouteMode === 'roads'
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-ink-500 hover:text-ink-900'}"
                  onclick={() => setCustomRouteMode('roads')}
                >
                  <RouteIcon size={12} /> Follow roads & paths
                </button>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-extrabold transition cursor-pointer {customRouteMode === 'straight'
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-ink-500 hover:text-ink-900'}"
                  onclick={() => setCustomRouteMode('straight')}
                >
                  Straight lines
                </button>
              </div>

              <button
                type="button"
                class="btn-chip"
                class:btn-chip-active={customDrawing}
                onclick={() => (customDrawing = !customDrawing)}
                title={customDrawing ? 'Lock map to pan without adding stops' : 'Tap map to plot Start & End'}
              >
                {#if customDrawing}
                  <Pencil size={12} /> Tap to add: ON
                {:else}
                  <Lock size={12} /> Pan only
                {/if}
              </button>
            </div>

            <form class="flex flex-1 items-center gap-1.5 sm:max-w-xs" onsubmit={handlePlaceSearch}>
              <label class="flex flex-1 items-center gap-1.5 rounded-xl border border-brand-100 bg-white px-2.5 py-1 focus-within:border-brand-300">
                <Search size={12} class="shrink-0 text-ink-400" />
                <input
                  class="w-full bg-transparent text-xs font-semibold text-ink-900 outline-none placeholder:font-medium placeholder:text-ink-400"
                  placeholder="Search street, park, or stop…"
                  bind:value={placeQuery}
                />
              </label>
              <button type="submit" class="btn-chip shrink-0" disabled={searchingPlace}>
                {#if searchingPlace}<LoaderCircle size={12} class="animate-spin" />{:else}Find{/if}
              </button>
            </form>
          </div>

          {#if searchError}
            <p class="text-[11px] font-semibold text-ink-500">{searchError}</p>
          {/if}

          {#if placeResults.length}
            <div class="divide-y divide-brand-100/70 overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-soft">
              {#each placeResults as place (place.label + place.latitude + place.longitude)}
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-brand-50/70"
                  onclick={() => addPlaceAsStop(place)}
                >
                  <MapPin size={13} class="shrink-0 text-brand-500" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-extrabold text-ink-900">{place.shortName}</p>
                    <p class="truncate text-[10px] font-semibold text-ink-400">{place.label}</p>
                  </div>
                  <span class="shrink-0 text-[10px] font-extrabold text-brand-600">
                    {customWaypoints.length ? '+ Add stop' : 'Set Start'}
                  </span>
                </button>
              {/each}
            </div>
          {/if}

          <div class="flex flex-wrap items-center gap-1.5">
            {#if currentPosition || liveCoords}
              <button type="button" class="btn-chip" onclick={startCustomFromGps}>
                <Navigation size={12} /> {customWaypoints.length ? 'Start from GPS' : 'Use GPS as Start'}
              </button>
            {/if}
            {#if customWaypoints.length >= 2}
              {#if !customClosed}
                <button type="button" class="btn-chip" onclick={makeCustomOutAndBack}>
                  <ArrowLeftRight size={12} /> Out & back
                </button>
                <button type="button" class="btn-chip" onclick={makeCustomLoop}>
                  <Repeat size={12} /> Close loop
                </button>
              {/if}
              <button type="button" class="btn-chip" onclick={reverseCustomRoute}>
                <RotateCcw size={12} /> Reverse
              </button>
              <button type="button" class="btn-chip" onclick={() => { following = false; tranaMap?.fitRouteBounds?.(); }}>
                <Maximize2 size={12} /> Fit route
              </button>
            {/if}
            {#if customWaypoints.length}
              <button type="button" class="btn-chip" onclick={undoCustomPoint}>
                <Undo2 size={12} /> Undo
              </button>
              <button type="button" class="btn-chip" onclick={clearCustomRoute}>
                <Trash2 size={12} /> Clear stops
              </button>
            {/if}
          </div>

          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="pill">
              <MapPin size={12} />
              {customWaypoints.length === 0
                ? 'Tap Start & End on the map'
                : customWaypoints.length === 1
                  ? 'Start set — tap End on the map'
                  : `${customWaypoints.length} stops (Start → End)`}
            </span>
            <span class="pill"><Ruler size={12} /> {customRouteKm > 0 ? `${nf(customRouteKm, 2)} km` : '—'}</span>
            {#if customRouting}
              <span class="pill"><LoaderCircle size={12} class="animate-spin" /> Routing along roads…</span>
            {:else if customRouteMode === 'straight' && customWaypoints.length >= 2}
              <span class="pill">Straight-line mode</span>
            {:else if customSnappedPath.length > 1}
              <span class="pill !bg-emerald-50 !text-emerald-700">
                <RouteIcon size={12} /> Following roads ({customProviderLabel || 'OpenStreetMap'})
              </span>
            {:else if customWaypoints.length >= 2 && customProvider === 'fallback'}
              <span class="pill !bg-amber-50 !text-amber-700">
                Straight fallback — no road found near a stop
              </span>
              <button type="button" class="btn-chip" onclick={() => scheduleCustomSnap({ immediate: true })}>
                Retry road snap
              </button>
            {/if}
          </div>
        </div>
      {:else if pathSource === 'plan'}
        <div class="space-y-2.5 border-t border-brand-100/80 pt-2.5">
          {#if activePlan}
            <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-white px-3 py-2 text-xs">
              <div class="flex flex-wrap items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                <span class="font-extrabold capitalize text-ink-900">
                  {activePlan.isDraft ? 'Draft from Plan Activity:' : 'Plan selected:'}
                  {nf(activePlanKm, 2)} km {activePlan.activity_type}
                </span>
                {#if activePlan.duration?.minutes}
                  <span class="text-ink-500 font-semibold">· ~{Math.round(activePlan.duration.minutes)} min</span>
                {/if}
                {#if planSnapping}
                  <span class="inline-flex items-center gap-1 text-brand-600 font-bold">
                    <LoaderCircle size={12} class="animate-spin" /> Routing Start → End along roads…
                  </span>
                {:else if activePlanPath.length >= 2}
                  <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700">
                    Start & End displayed
                  </span>
                {/if}
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  class="btn-chip !py-1"
                  onclick={() => { following = false; tranaMap?.fitRouteBounds?.(); }}
                >
                  <Maximize2 size={11} /> Fit view
                </button>
                <button type="button" class="btn-chip !py-1" onclick={customizeLoadedPlan}>
                  <Pencil size={11} /> Edit stops
                </button>
              </div>
            </div>
          {/if}

          {#if availablePlans.length}
            <div>
              <p class="mb-1.5 text-[11px] font-bold text-ink-500">
                Click a customized session from Plan Activity to show its Start → End path:
              </p>
              <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {#each availablePlans as plan (plan.isDraft ? 'draft' : plan.id)}
                  {@const hasRoute = Array.isArray(plan.route) && plan.route.length >= 2}
                  {@const isSelected = activePlan && ((plan.isDraft && activePlan.isDraft) || (!plan.isDraft && String(activePlan.id) === String(plan.id)))}
                  <button
                    type="button"
                    class="flex items-center gap-2.5 rounded-2xl border p-2.5 text-left transition cursor-pointer {isSelected
                      ? 'border-brand-400 bg-white shadow-soft ring-2 ring-brand-200'
                      : 'border-brand-100 bg-white/85 hover:border-brand-300 hover:bg-white'}"
                    onclick={() => selectPlanRoute(plan)}
                  >
                    <ActivityIcon type={plan.activity_type || 'run'} size="sm" />
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-xs font-extrabold capitalize text-ink-900">
                        {plan.distance_km} km {plan.activity_type}
                        {#if plan.isDraft}
                          <span class="ml-1 text-[10px] font-bold text-brand-600">(Draft)</span>
                        {/if}
                      </p>
                      <p class="truncate text-[10px] font-semibold text-ink-400">
                        {#if plan.duration?.minutes}~{Math.round(plan.duration.minutes)} min · {/if}
                        {#if plan.created_at}{shortDate(plan.created_at)} · {/if}
                        {hasRoute ? 'Start → End path' : 'Distance only'}
                      </p>
                    </div>
                    <span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold {hasRoute ? 'bg-brand-50 text-brand-600' : 'bg-ink-100 text-ink-500'}">
                      {isSelected ? 'Shown' : hasRoute ? 'Load' : 'Set path'}
                    </span>
                  </button>
                {/each}
              </div>
            </div>
          {:else}
            <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-brand-200 bg-white/80 px-3 py-2.5 text-xs">
              <span class="font-semibold text-ink-500">
                No saved plans from Plan Activity yet — create one in Plan Activity or draw a path right here.
              </span>
              <div class="flex items-center gap-1.5">
                <button type="button" class="btn-chip" onclick={() => selectPathSource('create')}>
                  <Pencil size={12} /> Create path here
                </button>
                <button type="button" class="btn-chip btn-chip-active" onclick={() => navigate('/plan')}>
                  Open Plan Activity →
                </button>
              </div>
            </div>
          {/if}
        </div>
      {:else if pathSource === 'activity'}
        <div class="space-y-2.5 border-t border-brand-100/80 pt-2.5">
          {#if activeActivity}
            <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-white px-3 py-2 text-xs">
              <div class="flex flex-wrap items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                <span class="font-extrabold capitalize text-ink-900">
                  Activity loaded: {nf(activeActivityKm, 2)} km {activeActivity.activity_type}
                </span>
                {#if activeActivity.duration_min}
                  <span class="text-ink-500 font-semibold">· {Math.round(activeActivity.duration_min)} min</span>
                {/if}
                {#if activitySnapping}
                  <span class="inline-flex items-center gap-1 text-brand-600 font-bold">
                    <LoaderCircle size={12} class="animate-spin" /> Routing Start → End along roads…
                  </span>
                {:else if activeActivityPath.length >= 2}
                  <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700">
                    Start & End displayed
                  </span>
                {/if}
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  class="btn-chip !py-1"
                  onclick={() => { following = false; tranaMap?.fitRouteBounds?.(); }}
                >
                  <Maximize2 size={11} /> Fit view
                </button>
                <button type="button" class="btn-chip !py-1" onclick={customizeLoadedActivity}>
                  <Pencil size={11} /> Edit stops
                </button>
              </div>
            </div>
          {/if}

          {#if availableActivities.length}
            <div>
              <p class="mb-1.5 text-[11px] font-bold text-ink-500">
                Click a past activity to load its Start → End route onto the tracking map:
              </p>
              <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {#each availableActivities as act (act.id)}
                  {@const hasRoute = Array.isArray(act.route) && act.route.length >= 2}
                  {@const isSelected = activeActivity && String(activeActivity.id) === String(act.id)}
                  <button
                    type="button"
                    class="flex items-center gap-2.5 rounded-2xl border p-2.5 text-left transition cursor-pointer {isSelected
                      ? 'border-brand-400 bg-white shadow-soft ring-2 ring-brand-200'
                      : 'border-brand-100 bg-white/85 hover:border-brand-300 hover:bg-white'}"
                    onclick={() => selectActivityRoute(act)}
                  >
                    <ActivityIcon type={act.activity_type || 'run'} size="sm" />
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-xs font-extrabold capitalize text-ink-900">
                        {act.distance_km} km {act.activity_type}
                      </p>
                      <p class="truncate text-[10px] font-semibold text-ink-400">
                        {#if act.duration_min}{Math.round(act.duration_min)} min · {/if}
                        {#if act.started_at}{shortDate(act.started_at)} · {/if}
                        {hasRoute ? 'Start → End path' : 'Distance only'}
                      </p>
                    </div>
                    <span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold {hasRoute ? 'bg-brand-50 text-brand-600' : 'bg-ink-100 text-ink-500'}">
                      {isSelected ? 'Shown' : hasRoute ? 'Load' : 'Set path'}
                    </span>
                  </button>
                {/each}
              </div>
            </div>
          {:else}
            <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-brand-200 bg-white/80 px-3 py-2.5 text-xs">
              <span class="font-semibold text-ink-500">
                No logged activities yet — create a path right here or log one under Activities.
              </span>
              <div class="flex items-center gap-1.5">
                <button type="button" class="btn-chip" onclick={() => selectPathSource('create')}>
                  <Pencil size={12} /> Create path here
                </button>
                <button type="button" class="btn-chip btn-chip-active" onclick={() => navigate('/activities')}>
                  Open Activities →
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Live Map (explicit height so MapLibre never collapses to 0px) -->
    <div class="relative h-[320px] sm:h-[380px] lg:h-[410px] w-full">
      <TranaMap
        bind:this={tranaMap}
        {points}
        {plannedRoute}
        plannedWaypoints={mapPlannedWaypoints}
        {interactiveRoute}
        routeMode={customRouteMode}
        routing={mapRouting}
        onRoutePick={onCustomRoutePick}
        fitRoute={!tracking && (pathSource === 'plan' || pathSource === 'activity') && Boolean(plannedRoute)}
        center={mapCenter}
        currentPosition={displayPosition}
        accuracyM={displayAccuracyM}
        heading={displayHeading}
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
