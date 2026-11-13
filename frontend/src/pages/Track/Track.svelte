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
    Droplets,
    Flame,
    Volume2,
    VolumeX,
    ShieldCheck,
    ChevronDown,
    ChevronUp,
  } from 'lucide-svelte';
  import TranaMap from '../../components/map/TranaMap.svelte';
  import GPSStatus from '../../components/activity/GPSStatus.svelte';
  import ActivityStats from '../../components/activity/ActivityStats.svelte';
  import ActivityControls from '../../components/activity/ActivityControls.svelte';
  import DailyProgress from '../../components/activity/DailyProgress.svelte';
  import FoodLogger from '../../components/activity/FoodLogger.svelte';
  import ActivityIcon from '../../components/activities/ActivityIcon.svelte';
  import { link, navigate, query } from '../../lib/router.js';
  import { plans, notify, unitSystem } from '../../stores/index.js';
  import { distanceUnit, toDisplayDistance } from '../../lib/units.js';
  import { dailySessionApi } from '../../services/dailySessionService.js';
  import { readCachedPlace } from '../../lib/location.js';
  import { acquireLivePosition, releaseLivePosition, seedLivePosition, livePosition } from '../../lib/liveLocation.svelte.js';
  import { liveTracker } from '../../lib/liveTracker.svelte.js';
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
  import { polylineLengthKm } from '../../services/mapService.js';
  import { clock, ml, nf, shortDate } from '../../lib/format.js';

  const SPORTS = [
    { id: 'run', label: 'Run' },
    { id: 'ride', label: 'Ride' },
    { id: 'walk', label: 'Walk' },
    { id: 'hike', label: 'Hike' },
  ];

  // ── activity tracking state (backed by app-wide liveTracker) ─────────
  const activityType = $derived(liveTracker.activityType);
  const tracking = $derived(liveTracker.tracking);
  const paused = $derived(liveTracker.paused);
  const saving = $derived(liveTracker.saving);
  const points = $derived(liveTracker.points);
  const currentPosition = $derived(liveTracker.currentPosition);
  const currentAccuracyM = $derived(liveTracker.currentAccuracyM);
  const currentHeading = $derived(liveTracker.currentHeading);
  const startPosition = $derived(liveTracker.startPosition);
  const finishPosition = $derived(liveTracker.finishPosition);
  const gpsStatus = $derived(liveTracker.gpsStatus);
  const gpsMessage = $derived(liveTracker.gpsMessage);
  const roadSnapping = $derived(liveTracker.roadSnapping);
  const showRoads = $derived(liveTracker.showRoads);

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

  // ── path selection: 'none' | 'create' | 'plan' ──────────────────────
  let tranaMap = $state(null);
  let pathSource = $state('none');
  let routeToolsExpanded = $state(false);

  // Plan Activity route selection state
  let activePlan = $state(null);
  let planPath = $state([]);
  let planSnapping = $state(false);
  let planSnapSeq = 0;
  let planSnapAbort = null;
  let draftPlan = $state(null);
  let hydratedQueryPlan = false;

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

  const plannedRoute = $derived.by(() => {
    if (pathSource === 'plan') {
      return activePlanPath.length >= 2
        ? pathToGeoJson(activePlanPath, activePlan?.activity_type || activityType)
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
  const interactiveRoute = $derived(!tracking && pathSource === 'create' && customDrawing);
  const routeDashed = $derived(
    pathSource !== 'create' ||
    customRouteMode === 'straight' ||
    (customWaypoints.length >= 2 && customSnappedPath.length < 2),
  );
  const mapRouting = $derived(
    (pathSource === 'create' && customRouting) ||
    (pathSource === 'plan' && planSnapping),
  );

  // Today's daily session (shared between DailyProgress and FoodLogger)
  let todaySession = $state(null);
  let loadingSession = $state(true);

  // ── derived statistics (live from shared liveTracker) ────────────────
  const durationSec = $derived(liveTracker.durationSec);
  const durationMin = $derived(liveTracker.durationMin);
  const distanceKm = $derived(liveTracker.distanceKm);
  const avgSpeedKmh = $derived(liveTracker.avgSpeedKmh);
  const avgPaceMinKm = $derived(liveTracker.avgPaceMinKm);
  const elevationM = $derived(liveTracker.elevationM);
  const estimatedCalories = $derived(liveTracker.estimatedCalories);

  const selectedPathLabel = $derived.by(() => {
    if (pathSource === 'plan') {
      if (activePlan) {
        const kmText = activePlanKm > 0 ? `${nf(activePlanKm, 2)} km ` : '';
        return `${kmText}${activePlan.activity_type || activityType} (Plan)`;
      }
      return 'From Plan Activity';
    }
    if (pathSource === 'create') {
      return customRouteKm > 0 ? `Custom path (${nf(customRouteKm, 2)} km)` : 'Custom path';
    }
    return 'Free GPS';
  });

  const selectedPlannedPath = $derived.by(() => {
    if (pathSource === 'plan') return activePlanPath;
    if (pathSource === 'create') return activeCustomPath;
    return [];
  });

  const selectedPlanKey = $derived(
    pathSource === 'plan' && activePlan
      ? (activePlan.isDraft ? 'draft' : String(activePlan.id))
      : null,
  );

  $effect(() => {
    if (liveTracker.tracking) return;
    liveTracker.setPathContext({
      source: pathSource,
      path: selectedPlannedPath,
      label: selectedPathLabel,
      planKey: selectedPlanKey,
      fueling: activePlan?.fueling ?? null,
    });
  });

  $effect(() => {
    if (liveTracker.lastDailySession) {
      todaySession = liveTracker.lastDailySession;
    }
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
    if (tracking) return;
    pathSource = mode;
    if (mode !== 'none') routeToolsExpanded = true;
    if (mode === 'none') {
      resetPlanSnap();
      activePlan = null;
      planPath = [];
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
      customDrawing = true;
      return;
    }
    if (mode === 'plan') {
      draftPlan = readDraftPlan();
      placeResults = [];
      searchError = '';
      if (!activePlan) {
        const firstWithRoute = (draftPlan?.route?.length >= 2 ? draftPlan : null) ?? plansWithRoutes[0] ?? null;
        if (firstWithRoute) selectPlanRoute(firstWithRoute);
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
      if (!tracking && plan.activity_type) liveTracker.setActivityType(plan.activity_type);
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
      liveTracker.setActivityType(plan.activity_type);
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

  function selectSport(sportId) {
    liveTracker.setActivityType(sportId);
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
    if (seq !== customSnapSeq || controller.signal.aborted) return;

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

  // ── activity controls (delegated to shared liveTracker) ──────────────
  function startActivity() {
    following = true;
    liveTracker.startActivity({
      activityType,
      pathSource,
      plannedPath: selectedPlannedPath,
      plannedLabel: selectedPathLabel,
      plannedPlanKey: selectedPlanKey,
      plannedFueling: activePlan?.fueling ?? null,
    });
  }

  function pauseActivity() {
    liveTracker.pauseActivity();
  }

  function resumeActivity() {
    liveTracker.resumeActivity();
  }

  function discardActivity() {
    liveTracker.discardActivity();
  }

  async function stopActivity() {
    const result = await liveTracker.stopActivity({ currentTodaySession: todaySession });
    if (result?.dailySession) {
      todaySession = result.dailySession;
    }
  }

  async function saveStationary() {
    const result = await liveTracker.stopActivity({ currentTodaySession: todaySession, allowStationary: true });
    if (result?.dailySession) {
      todaySession = result.dailySession;
    }
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

  function hydrateActivePathFromTracker() {
    if (!liveTracker.tracking) return;
    pathSource = liveTracker.pathSource || 'none';
    if (pathSource === 'plan') {
      const key = liveTracker.plannedPlanKey;
      const found = key === 'draft'
        ? draftPlan
        : $plans.find((p) => String(p.id) === String(key));
      if (found) activePlan = found;
      planPath = Array.isArray(liveTracker.plannedPath) ? [...liveTracker.plannedPath] : [];
    } else if (pathSource === 'create') {
      const savedPath = Array.isArray(liveTracker.plannedPath) ? [...liveTracker.plannedPath] : [];
      customSnappedPath = savedPath;
      customWaypoints = savedPath.length >= 2 ? waypointsFromPath(savedPath) : [];
      customDrawing = false;
    }
  }

  onMount(() => {
    if (cachedPlace) seedLivePosition(cachedPlace);
    acquireLivePosition();
    loadTodaySession();
    draftPlan = readDraftPlan();

    const planParam = $query.get('plan');
    if (liveTracker.tracking) {
      hydratedQueryPlan = true;
      hydrateActivePathFromTracker();
    } else if (planParam === 'draft') {
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
      // Do NOT stop liveTracker ticker/GPS here — tracking continues across pages
      // so Dashboard stays synced until Pause / End & save / Discard.
      clearTimeout(customSnapTimer);
      customSnapAbort?.abort();
      planSnapAbort?.abort();
      searchAbort?.abort();
      releaseLivePosition();
    };
  });

  // Apply ?plan=<id> if $plans arrives asynchronously after mount (e.g., hard reload on /track?plan=2).
  $effect(() => {
    if (hydratedQueryPlan || liveTracker.tracking) return;
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

  <!-- Primary Map-First Outdoor Card -->
  <div class="card p-4 sm:p-6 space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3 scroll-mt-20" data-tour="track-controls-header">
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
          <input
            type="checkbox"
            checked={roadSnapping}
            onchange={(e) => liveTracker.setRoadSnapping(e.currentTarget.checked)}
            class="accent-brand-600 rounded"
          />
          <span>Road snap</span>
        </label>
        <label class="inline-flex items-center gap-1.5 text-xs font-bold text-ink-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showRoads}
            onchange={(e) => liveTracker.setShowRoads(e.currentTarget.checked)}
            class="accent-brand-600 rounded"
          />
          <span>Show roads</span>
        </label>
      </div>
    </div>

    <!-- Map-first canvas with translucent floating HUD overlay -->
    <div class="relative h-[340px] sm:h-[400px] lg:h-[430px] w-full">
      <TranaMap
        bind:this={tranaMap}
        {points}
        {plannedRoute}
        plannedWaypoints={mapPlannedWaypoints}
        {interactiveRoute}
        routeMode={customRouteMode}
        {routeDashed}
        routing={mapRouting}
        onRoutePick={onCustomRoutePick}
        fitRoute={!tracking && pathSource === 'plan' && Boolean(plannedRoute)}
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
      >
        {#snippet overlay()}
          <div class="pointer-events-none absolute bottom-3 left-3 right-3 z-20 flex flex-wrap items-end justify-between gap-2">
            <div class="pointer-events-auto inline-flex items-center gap-2 rounded-2xl border border-white/70 bg-white/85 px-3 py-1.5 text-[11px] font-extrabold text-ink-900 shadow-soft backdrop-blur-md">
              <MapPin size={13} class="text-brand-600" />
              <span class="num-tabular">{selectedPathLabel}</span>
            </div>
            {#if tracking}
              <div class="pointer-events-auto inline-flex items-center gap-2.5 rounded-2xl border border-white/70 bg-white/85 px-3 py-1.5 text-xs font-extrabold text-ink-900 shadow-soft backdrop-blur-md num-tabular">
                <span class="h-2 w-2 rounded-full {paused ? 'bg-amber-400' : 'bg-emerald-500 animate-pulse'}"></span>
                <span>{clock(durationSec)}</span>
                <span class="text-ink-400">·</span>
                <span>{nf(toDisplayDistance(distanceKm, $unitSystem), 2)} {distanceUnit($unitSystem)}</span>
              </div>
            {:else if pathSource === 'create' && customWaypoints.length > 0}
              <div class="pointer-events-auto flex items-center gap-1.5">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-xl border border-white/70 bg-white/90 px-2.5 py-1.5 text-[11px] font-extrabold text-ink-700 shadow-soft backdrop-blur-md hover:text-brand-600"
                  onclick={undoCustomPoint}
                >
                  <Undo2 size={12} /> Undo
                </button>
                {#if customWaypoints.length >= 2}
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded-xl border border-white/70 bg-white/90 px-2.5 py-1.5 text-[11px] font-extrabold text-ink-700 shadow-soft backdrop-blur-md hover:text-brand-600"
                    onclick={() => { following = false; tranaMap?.fitRouteBounds?.(); }}
                  >
                    <Maximize2 size={12} /> Fit
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/snippet}
      </TranaMap>
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

    {#if tracking}
      <!-- Live Fueling & Voice Coaching Bar -->
      <div class="rounded-2xl border p-3.5 transition {liveTracker.hydrateDue || liveTracker.fuelDue
        ? 'border-amber-300 bg-amber-50/70'
        : 'border-brand-100 bg-brand-50/40'}">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="num-tabular flex flex-wrap items-center gap-2 text-xs">
            <span class="pill !bg-white text-brand-700 border border-brand-100">
              <Droplets size={12} />
              Target {ml(liveTracker.activeFuelTargets.fluidPerHourMl, $unitSystem)}/h · Logged {ml(liveTracker.fluidLoggedMl, $unitSystem)}
            </span>
            {#if liveTracker.activeFuelTargets.carbsPerHourG > 0 || durationMin >= 45}
              <span class="pill !bg-white text-amber-700 border border-amber-200">
                <Flame size={12} />
                Target {liveTracker.activeFuelTargets.carbsPerHourG || 30} g/h · Logged {liveTracker.carbsLoggedG} g
              </span>
            {/if}
            {#if liveTracker.wakeLockActive}
              <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-extrabold text-emerald-700">
                <ShieldCheck size={11} /> Screen awake
              </span>
            {/if}
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              class="btn-chip !py-1.5 {liveTracker.hydrateDue ? '!border-amber-300 !bg-amber-100 !text-amber-900' : ''}"
              onclick={() => liveTracker.logHydration(200)}
            >
              <Droplets size={12} />
              <span class="num-tabular">{liveTracker.hydrateDue ? 'Drink now (+200ml)' : `Sip +200ml · ${clock(liveTracker.nextHydrateInSec).slice(3)}`}</span>
            </button>
            <button
              type="button"
              class="btn-chip !py-1.5 {liveTracker.fuelDue ? '!border-amber-300 !bg-amber-100 !text-amber-900' : ''}"
              onclick={() => liveTracker.logFuel(25)}
            >
              <Flame size={12} />
              {liveTracker.fuelDue ? 'Fuel now (+25g)' : '+25g carbs'}
            </button>
            <button
              type="button"
              class="btn-chip !py-1.5"
              class:btn-chip-active={liveTracker.voiceCues}
              onclick={() => liveTracker.toggleVoiceCues()}
              aria-label="Toggle voice pace and hydration cues"
            >
              {#if liveTracker.voiceCues}
                <Volume2 size={12} /> Voice ON
              {:else}
                <VolumeX size={12} /> Voice OFF
              {/if}
            </button>
          </div>
        </div>
      </div>
    {/if}

    {#if liveTracker.statusNote}
      <div class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-xs font-bold text-amber-800 space-y-2">
        <p>{liveTracker.statusNote}</p>
        {#if liveTracker.canSaveStationary}
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-extrabold text-amber-900 hover:bg-amber-100 transition cursor-pointer"
            onclick={saveStationary}
          >
            Save as indoor / stationary session ({Math.round(durationMin)} min)
          </button>
        {/if}
      </div>
    {/if}

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

    <!-- Collapsible Path / Route Builder Panel (sits cleanly beneath primary controls) -->
    <div class="card-flat p-3 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <span class="text-[11px] font-extrabold uppercase tracking-wide text-ink-500">Path</span>
          <div
            class="flex w-full flex-wrap items-center gap-1 rounded-2xl border border-brand-100 bg-white p-1 sm:inline-flex sm:w-auto"
            role="group"
            aria-label="Route path source"
          >
            <button
              type="button"
              disabled={tracking}
              class="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-extrabold transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed sm:flex-initial {pathSource === 'none'
                ? 'bg-brand-gradient text-white shadow-glow'
                : 'text-ink-600 hover:bg-brand-50'}"
              onclick={() => selectPathSource('none')}
            >
              <Navigation size={13} /> Free GPS
            </button>
            <button
              type="button"
              disabled={tracking}
              class="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-extrabold transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed sm:flex-initial {pathSource === 'create'
                ? 'bg-brand-gradient text-white shadow-glow'
                : 'text-ink-600 hover:bg-brand-50'}"
              onclick={() => selectPathSource('create')}
            >
              <Pencil size={13} /> Create path
            </button>
            <button
              type="button"
              disabled={tracking}
              class="inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-extrabold transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed sm:flex-initial {pathSource === 'plan'
                ? 'bg-brand-gradient text-white shadow-glow'
                : 'text-ink-600 hover:bg-brand-50'}"
              onclick={() => selectPathSource('plan')}
            >
              <Sparkles size={13} /> From Plan Activity
              {#if plansWithRoutes.length}
                <span class="num-tabular rounded-full px-1.5 py-0.5 text-[11px] leading-none {pathSource === 'plan' ? 'bg-white/25 text-white' : 'bg-brand-100 text-brand-700'}">
                  {plansWithRoutes.length}
                </span>
              {/if}
            </button>
          </div>
        </div>

        <div class="flex items-center gap-2">
          {#if pathSource !== 'none' && !tracking}
            <button
              type="button"
              class="text-xs font-extrabold text-ink-500 hover:text-brand-600 cursor-pointer"
              onclick={clearPath}
            >
              Clear path
            </button>
          {/if}
          {#if pathSource !== 'none'}
            <button
              type="button"
              class="btn-chip !py-1"
              onclick={() => (routeToolsExpanded = !routeToolsExpanded)}
            >
              {#if routeToolsExpanded}<ChevronUp size={12} /> Hide tools{:else}<ChevronDown size={12} /> Route tools{/if}
            </button>
          {/if}
        </div>
      </div>

      {#if pathSource === 'create' && routeToolsExpanded}
        <div class="space-y-2.5 border-t border-brand-100/80 pt-2.5">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex flex-wrap items-center gap-1.5">
              <div class="flex max-w-full flex-wrap rounded-xl border border-brand-100 bg-white p-0.5 sm:inline-flex" role="group" aria-label="Custom routing mode">
                <button
                  type="button"
                  class="inline-flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-extrabold transition cursor-pointer sm:flex-initial {customRouteMode === 'roads'
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-ink-500 hover:text-ink-900'}"
                  onclick={() => setCustomRouteMode('roads')}
                >
                  <RouteIcon size={12} /> Follow roads & paths
                </button>
                <button
                  type="button"
                  class="inline-flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-extrabold transition cursor-pointer sm:flex-initial {customRouteMode === 'straight'
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

            <form class="flex min-w-0 flex-1 items-center gap-1.5 sm:max-w-xs" onsubmit={handlePlaceSearch}>
              <label class="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-brand-100 bg-white px-2.5 py-1 focus-within:border-brand-300">
                <Search size={12} class="shrink-0 text-ink-400" />
                <input
                  class="min-w-0 w-full bg-transparent text-base font-semibold text-ink-900 outline-none placeholder:font-medium placeholder:text-ink-400 sm:text-xs"
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
                    <p class="truncate text-[11px] font-semibold text-ink-400">{place.label}</p>
                  </div>
                  <span class="shrink-0 text-[11px] font-extrabold text-brand-600">
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
            <span class="pill num-tabular"><Ruler size={12} /> {customRouteKm > 0 ? `${nf(toDisplayDistance(customRouteKm, $unitSystem), 2)} ${distanceUnit($unitSystem)}` : '—'}</span>
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
      {:else if pathSource === 'plan' && routeToolsExpanded}
        <div class="space-y-2.5 border-t border-brand-100/80 pt-2.5">
          {#if activePlan}
            <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-white px-3 py-2 text-xs">
              <div class="flex flex-wrap items-center gap-2">
                <span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                <span class="num-tabular font-extrabold capitalize text-ink-900">
                  {activePlan.isDraft ? 'Draft from Plan Activity:' : 'Plan selected:'}
                  {nf(activePlanKm, 2)} km {activePlan.activity_type}
                </span>
                {#if activePlan.duration?.minutes}
                  <span class="num-tabular text-ink-500 font-semibold">· ~{Math.round(activePlan.duration.minutes)} min</span>
                {/if}
                {#if planSnapping}
                  <span class="inline-flex items-center gap-1 text-brand-600 font-bold">
                    <LoaderCircle size={12} class="animate-spin" /> Routing Start → End along roads…
                  </span>
                {:else if activePlanPath.length >= 2}
                  <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-extrabold text-emerald-700">
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
                      <p class="num-tabular truncate text-xs font-extrabold capitalize text-ink-900">
                        {nf(toDisplayDistance(plan.distance_km, $unitSystem), 2)} {distanceUnit($unitSystem)} {plan.activity_type}
                        {#if plan.isDraft}
                          <span class="ml-1 text-[11px] font-bold text-brand-600">(Draft)</span>
                        {/if}
                      </p>
                      <p class="num-tabular truncate text-[11px] font-semibold text-ink-400">
                        {#if plan.duration?.minutes}~{Math.round(plan.duration.minutes)} min · {/if}
                        {#if plan.created_at}{shortDate(plan.created_at)} · {/if}
                        {hasRoute ? 'Start → End path' : 'Distance only'}
                      </p>
                    </div>
                    <span class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-extrabold {hasRoute ? 'bg-brand-50 text-brand-600' : 'bg-ink-100 text-ink-500'}">
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
      {/if}
    </div>
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
