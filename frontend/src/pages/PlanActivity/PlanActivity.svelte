<script>
  import { onMount, tick } from 'svelte';
  import {
    Sparkles,
    MapPin,
    Route,
    Trash2,
    LoaderCircle,
    Save,
    Ruler,
    Thermometer,
    Droplets,
    ArrowRight,
    Play,
    Undo2,
    Navigation,
    Repeat,
    RotateCcw,
    ArrowLeftRight,
    Search,
    Pencil,
    Lock,
    History,
    Maximize2,
  } from 'lucide-svelte';
  import Card from '../../components/common/Card.svelte';
  import BusyOverlay from '../../components/common/BusyOverlay.svelte';
  import ActivityIcon from '../../components/activities/ActivityIcon.svelte';
  import TranaMap from '../../components/map/TranaMap.svelte';
  import FuelingPlan from '../../components/fueling/FuelingPlan.svelte';
  import Segmented from '../../components/common/Segmented.svelte';
  import { activities, profile, plans, notify, refresh } from '../../stores/index.js';
  import { api } from '../../services/client.js';
  import { navigate, query } from '../../lib/router.js';
  import { loadModel, predictPlan } from '../../lib/ml/index.js';
  import { routeLengthKm, suggestElevation } from '../../lib/ml/index.js';
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
  import { readCachedPlace } from '../../lib/location.js';
  import { acquireLivePosition, releaseLivePosition, seedLivePosition, livePosition } from '../../lib/liveLocation.svelte.js';
  import { nf } from '../../lib/format.js';

  const TYPES = [
    { id: 'run', label: 'Run', hint: 'Road, trail or treadmill' },
    { id: 'ride', label: 'Ride', hint: 'Road or gravel' },
    { id: 'walk', label: 'Walk', hint: 'Easy or brisk' },
    { id: 'hike', label: 'Hike', hint: 'Trail with climbing' },
  ];

  let model = $state(null);
  let saving = $state(false);
  let saved = $state(null);
  let loadedFromSaved = $state(false);
  let confirmDeletePlanId = $state(null);
  let deletingPlanId = $state(null);
  let showAllPlans = $state(false);
  let drawing = $state(true);
  let showRoads = $state(true);
  let following = $state(true);
  let routeMode = $state('roads'); // 'roads' (auto-follow roads & paths) | 'straight'
  let customElevation = $state(false);
  let routeMap = $state(null);

  let form = $state({
    activity_type: 'run',
    distance_km: 0,
    elevation_gain_m: 0,
    temperature_c: 26,
    route: [],
    sweat_profile: 'normal',
    planned_for: '',
  });

  let prediction = $state(null);
  let computing = $state(false);

  // Road-following geometry for the planner's stops ([] → straight lines).
  let routePath = $state([]);
  let routing = $state(false);
  let routeProvider = $state(null); // 'ors' | 'osrm' | 'valhalla' | 'saved' | 'fallback' | null
  let routeProviderLabel = $state('');
  let snapTimer;
  let snapSeq = 0;
  let snapAbort = null;

  // Destination / street search
  let placeQuery = $state('');
  let placeResults = $state([]);
  let searchingPlace = $state(false);
  let searchError = $state('');
  let searchAbort = null;

  let cachedPlace = readCachedPlace();
  const liveCoords = $derived(
    livePosition.current &&
    Number.isFinite(livePosition.current.latitude) &&
    Number.isFinite(livePosition.current.longitude)
      ? [livePosition.current.latitude, livePosition.current.longitude]
      : null,
  );
  const liveAccuracy = $derived(livePosition.current?.accuracy ?? null);
  const liveHeading = $derived(livePosition.current?.heading ?? null);
  const mapCenter = $derived.by(() => {
    if (liveCoords) return liveCoords;
    if (cachedPlace && Number.isFinite(cachedPlace.latitude) && Number.isFinite(cachedPlace.longitude)) {
      return [cachedPlace.latitude, cachedPlace.longitude];
    }
    return [14.676, 121.0437];
  });

  const lastActivityWithRoute = $derived($activities.find((a) => Array.isArray(a.route) && a.route.length >= 2) ?? null);
  const routeClosed = $derived(isClosedLoop(form.route));
  const visiblePlans = $derived(showAllPlans ? $plans : $plans.slice(0, 4));

  // Blue dot: join the shared follow-me watch; the returned cleanup releases
  // it (sync onMount → client-only; top-level onDestroy breaks this SSR
  // harness because ssr_context is already torn down at registration).
  onMount(() => {
    if (cachedPlace) seedLivePosition(cachedPlace);
    acquireLivePosition();
    void (async () => {
      model = await loadModel();
      // hydrate from a saved plan link (?plan=12) or profile defaults;
      // predictions start only after a route is added on the map.
      const params = $query;
      const planId = params.get('plan');
      const requestedPlan = planId ? $plans.find((p) => String(p.id) === String(planId)) : null;

      if (requestedPlan) {
        loadSavedPlan(requestedPlan);
      } else {
        if (params.get('type')) form.activity_type = params.get('type');
        form.temperature_c = $profile?.typical_temperature_c ?? 26;
        form.sweat_profile = $profile?.sweat_profile ?? 'normal';
      }
    })();
    return () => {
      clearTimeout(timer);
      clearTimeout(snapTimer);
      snapAbort?.abort();
      searchAbort?.abort();
      releaseLivePosition();
    };
  });

  const routeKm = $derived(
    routePath.length > 1
      ? routeLengthKm(routePath)
      : form.route.length > 1
        ? routeLengthKm(form.route)
        : 0,
  );
  const effectiveDistance = $derived(routeKm > 0.05 ? routeKm : Number(form.distance_km) || 0);
  const plannedRoute = $derived(
    routePath.length > 1 ? routePath : form.route.length > 1 ? form.route : null,
  );
  const plannedGeoJson = $derived(
    plannedRoute?.length >= 2 ? pathToGeoJson(plannedRoute, form.activity_type) : null,
  );
  const routeDashed = $derived(
    routeMode === 'straight' || (form.route.length >= 2 && routePath.length < 2),
  );

  // Navigation-app behaviour: while a route exists, the distance field itself
  // shows the measured (road-following) route length — otherwise stays 0.
  $effect(() => {
    if (loadedFromSaved) return;
    if (routeKm > 0.05) {
      form.distance_km = Number(routeKm.toFixed(2));
      if (!customElevation) {
        form.elevation_gain_m = suggestElevation(routeKm, form.activity_type);
      }
    } else {
      form.distance_km = 0;
      if (!customElevation) {
        form.elevation_gain_m = 0;
      }
    }
  });

  function markEdited() {
    saved = null;
    loadedFromSaved = false;
  }

  async function run() {
    if (!$profile || !model) return;
    if (!Array.isArray(plannedRoute) || plannedRoute.length < 2 || routeKm <= 0.05) {
      computing = false;
      return;
    }
    computing = true;
    try {
      prediction = await predictPlan({
        activity: {
          activity_type: form.activity_type,
          distance_km: effectiveDistance,
          elevation_gain_m: Number(form.elevation_gain_m) || 0,
          temperature_c: Number(form.temperature_c),
          route: plannedRoute,
        },
        profile: { ...$profile, sweat_profile: form.sweat_profile },
        activities: $activities,
      });
    } finally {
      computing = false;
    }
  }

  // Recompute whenever a valid route is plotted on the map (debounced).
  let timer;
  $effect(() => {
    void model;
    void $profile;
    void form.activity_type;
    void form.distance_km;
    void form.elevation_gain_m;
    void form.temperature_c;
    void form.sweat_profile;
    void form.planned_for;
    void form.route.length;
    void routePath;
    void routing;
    void routeMode;
    void $activities.length;

    clearTimeout(timer);
    if (loadedFromSaved) return;

    const hasPlottedRoute = Array.isArray(plannedRoute) && plannedRoute.length >= 2 && routeKm > 0.05;
    if (!hasPlottedRoute) {
      computing = false;
      prediction = null;
      return;
    }
    if (routeMode === 'roads' && routing) return;

    timer = setTimeout(run, 160);
  });

  function startOver() {
    clearTimeout(timer);
    resetSnap();
    customElevation = false;
    saved = null;
    loadedFromSaved = false;
    confirmDeletePlanId = null;
    prediction = null;
    computing = false;
    drawing = true;
    placeQuery = '';
    placeResults = [];
    searchError = '';
    form = {
      activity_type: 'run',
      distance_km: 0,
      elevation_gain_m: 0,
      temperature_c: $profile?.typical_temperature_c ?? 26,
      route: [],
      sweat_profile: $profile?.sweat_profile ?? 'normal',
      planned_for: '',
    };
  }

  function pickType(id) {
    markEdited();
    form.activity_type = id;
    if (!customElevation && routeKm > 0.05) {
      form.elevation_gain_m = suggestElevation(effectiveDistance, id);
    }
    scheduleSnap({ immediate: true }); // routing profile follows the activity type
  }

  function setRouteMode(mode) {
    markEdited();
    routeMode = mode;
    if (mode === 'straight') {
      resetSnap();
    } else {
      scheduleSnap({ immediate: true });
    }
  }

  function resetSnap() {
    clearTimeout(snapTimer);
    snapAbort?.abort();
    snapAbort = null;
    snapSeq += 1;
    routePath = [];
    routing = false;
    routeProvider = null;
    routeProviderLabel = '';
  }

  /** Re-route the planner's stops along roads & paths (debounced, stale-safe). */
  function scheduleSnap({ immediate = false, fitAfter = false } = {}) {
    clearTimeout(snapTimer);
    snapAbort?.abort();
    snapAbort = null;

    if (routeMode !== 'roads' || form.route.length < 2) {
      snapSeq += 1;
      routePath = [];
      routing = false;
      routeProvider = null;
      routeProviderLabel = '';
      return;
    }

    routing = true;
    const delay = immediate ? 0 : 220;
    snapTimer = setTimeout(() => runSnap({ fitAfter }), delay);
  }

  async function runSnap({ fitAfter = false } = {}) {
    const seq = ++snapSeq;
    const controller = new AbortController();
    snapAbort = controller;

    const waypoints = [...form.route];
    const activityType = form.activity_type;
    const result = await routeThroughRoads(waypoints, activityType, {
      allowKeyless: true,
      signal: controller.signal,
    });
    if (seq !== snapSeq || controller.signal.aborted) return; // a newer edit superseded this request

    if (result?.path?.length >= 2) {
      routePath = result.path;
      routeProvider = result.provider;
      routeProviderLabel = result.providerLabel || 'OpenStreetMap';
      if (fitAfter) void tick().then(() => routeMap?.fitRouteBounds?.());
    } else {
      routePath = [];
      routeProvider = 'fallback';
      routeProviderLabel = '';
    }
    routing = false;
  }

  function clearRoute() {
    markEdited();
    form.route = [];
    resetSnap();
  }

  /** Remove only the last stop — keeps the rest of the drawn route. */
  function undoPoint() {
    if (!form.route.length) return;
    markEdited();
    form.route = form.route.slice(0, -1);
    scheduleSnap({ immediate: true });
  }

  function startFromGps() {
    if (!liveCoords) return;
    markEdited();
    following = false;
    const pt = [Number(liveCoords[0].toFixed(5)), Number(liveCoords[1].toFixed(5))];
    if (!form.route.length) {
      form.route = [pt];
      void tick().then(() => routeMap?.focusPoint?.(pt, 16));
      notify('Start set to your GPS location — tap your destination on the map.', 'info');
      return;
    }
    form.route = [pt, ...form.route];
    scheduleSnap({ immediate: true, fitAfter: true });
  }

  function makeOutAndBack() {
    if (form.route.length < 2 || routeClosed) return;
    markEdited();
    following = false;
    form.route = outAndBackWaypoints(form.route);
    scheduleSnap({ immediate: true, fitAfter: true });
  }

  function makeLoop() {
    if (form.route.length < 2 || routeClosed) return;
    markEdited();
    following = false;
    form.route = closeLoopWaypoints(form.route);
    scheduleSnap({ immediate: true, fitAfter: true });
  }

  function reverseRoute() {
    if (form.route.length < 2) return;
    markEdited();
    form.route = reverseWaypoints(form.route);
    scheduleSnap({ immediate: true });
  }

  function loadLastActivity() {
    if (!lastActivityWithRoute) return;
    markEdited();
    following = false;
    form.activity_type = lastActivityWithRoute.activity_type || form.activity_type;
    form.route = waypointsFromPath(lastActivityWithRoute.route);
    if (lastActivityWithRoute.route.length > 2) {
      routePath = [...lastActivityWithRoute.route];
      routeProvider = 'saved';
      routeProviderLabel = 'Saved activity';
      void tick().then(() => routeMap?.fitRouteBounds?.());
    } else if (routeMode === 'roads') {
      scheduleSnap({ immediate: true, fitAfter: true });
    } else {
      routePath = [];
      routeProvider = null;
      routeProviderLabel = '';
      void tick().then(() => routeMap?.fitRouteBounds?.());
    }
  }

  function loadSavedPlan(plan) {
    if (!plan) return;
    clearTimeout(timer);
    clearTimeout(snapTimer);
    snapAbort?.abort();
    confirmDeletePlanId = null;
    loadedFromSaved = true;
    following = false;
    form.activity_type = plan.activity_type || 'run';
    form.distance_km = Number(plan.distance_km) || 0;
    form.elevation_gain_m = Number(plan.elevation_gain_m) || 0;
    customElevation = true;
    form.temperature_c = Number(plan.temperature_c ?? ($profile?.typical_temperature_c ?? 26));
    form.sweat_profile = plan.sweat_profile || $profile?.sweat_profile || 'normal';
    if (Array.isArray(plan.route) && plan.route.length >= 2) {
      form.route = waypointsFromPath(plan.route);
      if (plan.route.length > 2) {
        routePath = [...plan.route];
        routeProvider = 'saved';
        routeProviderLabel = 'Saved plan';
        void tick().then(() => routeMap?.fitRouteBounds?.());
      } else if (routeMode === 'roads') {
        scheduleSnap({ immediate: true, fitAfter: true });
      } else {
        routePath = [];
        routeProvider = null;
        routeProviderLabel = '';
        void tick().then(() => routeMap?.fitRouteBounds?.());
      }
    } else {
      form.route = [];
      resetSnap();
    }
    prediction = plan;
    saved = plan;
  }

  function onPick(mode, index, latlng) {
    if (!latlng) return;
    markEdited();
    following = false;
    const point = [Number(latlng.lat.toFixed(5)), Number(latlng.lng.toFixed(5))];
    if (mode === 'remove') {
      form.route = form.route.filter((_, i) => i !== index);
      scheduleSnap({ immediate: true });
      return;
    }
    if (mode === 'move') {
      form.route = form.route.map((existing, i) => (i === index ? point : existing));
      scheduleSnap();
      return;
    }
    form.route = [...form.route, point];
    // Snap right away once Start + Destination are set so road routing feels instant.
    scheduleSnap({ immediate: form.route.length >= 2 });
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
      near: liveCoords ?? form.route[form.route.length - 1] ?? null,
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
    markEdited();
    following = false;
    const pt = [place.latitude, place.longitude];
    form.route = [...form.route, pt];
    placeQuery = '';
    placeResults = [];
    searchError = '';
    drawing = true;

    if (form.route.length === 1) {
      void tick().then(() => routeMap?.focusPoint?.(pt, 16));
    } else {
      scheduleSnap({ immediate: true, fitAfter: true });
    }
  }

  function followOnTrack(planId = null) {
    if (planId) {
      navigate(`/track?plan=${planId}`);
      return;
    }
    if (typeof sessionStorage !== 'undefined' && plannedRoute?.length >= 2) {
      try {
        sessionStorage.setItem('trana:draft_planned_route', JSON.stringify({
          activity_type: form.activity_type,
          distance_km: Number(effectiveDistance.toFixed(2)),
          route: plannedRoute,
        }));
      } catch {
        // ignore storage quota errors
      }
    }
    navigate('/track?plan=draft');
  }

  async function save() {
    if (!prediction) return;
    saving = true;
    let written = false;
    let created = null;
    try {
      created = await api.predictions.create({
        activity_type: form.activity_type,
        distance_km: Number(effectiveDistance.toFixed(2)),
        elevation_gain_m: Number(form.elevation_gain_m) || 0,
        route: plannedRoute,
        temperature_c: Number(form.temperature_c),
        sweat_profile: form.sweat_profile,
        planned_for: form.planned_for ? new Date(form.planned_for).toISOString() : null,
      });
      written = true;
      await refresh();
      saved = created;
      prediction = created;
      notify('Plan saved — it’s on your dashboard.');
    } catch (error) {
      if (written) {
        saved = created;
        prediction = created;
      }
      notify(written ? 'Plan saved, but the view could not refresh. Reload when connected.' : (error.message || 'Could not save the plan'), 'error');
    } finally {
      saving = false;
    }
  }

  async function deleteSavedPlan(plan) {
    if (!plan || deletingPlanId) return;
    deletingPlanId = plan.id;
    let deleted = false;
    try {
      await api.predictions.remove(plan.id);
      deleted = true;
      confirmDeletePlanId = null;

      plans.update((rows) => rows.filter((row) => String(row.id) !== String(plan.id)));
      if ($plans.length <= 4) showAllPlans = false;

      if (saved && String(saved.id) === String(plan.id)) {
        if (loadedFromSaved) {
          startOver();
        } else {
          saved = null;
          if (prediction && String(prediction.id) === String(plan.id)) {
            prediction = { ...prediction, id: undefined };
          }
        }
      }

      await refresh();
      notify('Saved plan deleted.', 'info');
    } catch (error) {
      notify(
        deleted
          ? 'Plan deleted, but the view could not refresh. Reload when connected.'
          : (error.message || 'Could not delete the saved plan'),
        'error',
      );
    } finally {
      deletingPlanId = null;
    }
  }
</script>

<BusyOverlay open={saving} label="Saving your plan…" />

<div class="space-y-5">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <span class="pill mb-2"><Sparkles size={12} /> TRANA prediction</span>
      <h1 class="font-display text-2xl sm:text-3xl">Plan your next session</h1>
      <p class="mt-1 text-sm font-semibold text-ink-400">
        Pick a start and destination — TRANA automatically routes along designated roads, footpaths, and trails.
      </p>
    </div>
    <button class="btn-ghost self-start" onclick={() => navigate('/activities')}>
      Log a past activity <ArrowRight size={15} />
    </button>
  </div>

  <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
    <!-- input -->
    <div class="space-y-4">
      <Card>
        <h2 class="text-lg">Activity</h2>
        <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {#each TYPES as type (type.id)}
            <button
              class="flex flex-col items-start gap-2 rounded-2xl border p-3 text-left transition {form.activity_type === type.id
                ? 'border-transparent bg-brand-gradient text-white shadow-glow'
                : 'border-brand-100 bg-white/70 text-ink-500 hover:border-brand-200'}"
              onclick={() => pickType(type.id)}
            >
              <ActivityIcon type={type.id} size="sm" tone={form.activity_type === type.id ? 'solid' : 'brand'} />
              <span class="text-sm font-extrabold">{type.label}</span>
              <span class="text-[10px] font-semibold leading-tight {form.activity_type === type.id ? 'text-white/80' : 'text-ink-400'}">
                {type.hint}
              </span>
            </button>
          {/each}
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <span class="label">Distance {routeKm > 0 ? '(from route)' : '(from map)'}</span>
            <div class="flex gap-2">
              <input
                class="input"
                type="number"
                min="0"
                step="0.1"
                value={form.distance_km > 0 ? form.distance_km : ''}
                placeholder="Add route on map"
                disabled
                class:bg-brand-50={routeKm > 0}
              />
              <span class="grid w-14 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-xs font-extrabold text-ink-500">km</span>
            </div>
            {#if routeKm > 0}
              <p class="mt-1 text-[10px] font-bold text-brand-600">Measured along your planned route</p>
            {:else}
              <p class="mt-1 text-[10px] font-semibold text-ink-400">Plot Start & Destination on the map below</p>
            {/if}
          </div>

          <div>
            <span class="label">Elevation gain</span>
            <div class="flex gap-2">
              <input
                class="input"
                type="number"
                min="0"
                step="10"
                bind:value={form.elevation_gain_m}
                oninput={() => { customElevation = true; markEdited(); }}
              />
              <span class="grid w-14 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-xs font-extrabold text-ink-500">m</span>
            </div>
          </div>

          <div>
            <span class="label"><Thermometer size={11} class="mr-1 inline" /> Expected temperature</span>
            <div class="flex gap-2">
              <input class="input" type="number" min="-5" max="45" bind:value={form.temperature_c} oninput={markEdited} />
              <span class="grid w-14 shrink-0 place-items-center rounded-2xl border border-brand-100 bg-brand-50 text-xs font-extrabold text-ink-500">°C</span>
            </div>
          </div>

          <div>
            <span class="label">When</span>
            <input class="input" type="datetime-local" bind:value={form.planned_for} oninput={markEdited} />
          </div>
        </div>

        <div class="mt-4">
          <span class="label"><Droplets size={11} class="mr-1 inline" /> Sweat profile</span>
          <Segmented
            options={[
              { id: 'low', label: 'Light sweater' },
              { id: 'normal', label: 'Average' },
              { id: 'high', label: 'Heavy sweater' },
            ]}
            value={form.sweat_profile}
            onSelect={(v) => { markEdited(); form.sweat_profile = v; }}
          />
        </div>
      </Card>

      <Card>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-lg">Route planner</h2>
            <p class="text-xs font-semibold text-ink-400">
              {routeMode === 'roads'
                ? 'Tap Start & Destination — automatically follows roads, footpaths, and trails.'
                : 'Straight-line mode — plot manual direct segments.'}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2.5">
            <label class="inline-flex items-center gap-1.5 text-xs font-bold text-ink-700 cursor-pointer select-none">
              <input type="checkbox" bind:checked={showRoads} class="accent-brand-600 rounded" />
              <span>Show roads</span>
            </label>
            <button
              type="button"
              class="btn-chip"
              class:btn-chip-active={drawing}
              onclick={() => (drawing = !drawing)}
              title={drawing ? 'Lock map to pan without adding stops' : 'Resume tapping stops on the map'}
            >
              {#if drawing}<Pencil size={12} /> Tap to add: ON{:else}<Lock size={12} /> Pan only{/if}
            </button>
          </div>
        </div>

        <!-- Auto road-follow mode switch + destination search -->
        <div class="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div class="inline-flex rounded-2xl border border-brand-100 bg-brand-50/70 p-1" role="group" aria-label="Routing mode">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-extrabold transition {routeMode === 'roads'
                ? 'bg-white text-brand-600 shadow-soft'
                : 'text-ink-500 hover:text-ink-900'}"
              onclick={() => setRouteMode('roads')}
            >
              <Route size={12} /> Follow roads & paths
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-extrabold transition {routeMode === 'straight'
                ? 'bg-white text-brand-600 shadow-soft'
                : 'text-ink-500 hover:text-ink-900'}"
              onclick={() => setRouteMode('straight')}
            >
              Straight lines
            </button>
          </div>

          <form class="flex flex-1 items-center gap-1.5 sm:max-w-xs" onsubmit={handlePlaceSearch}>
            <label class="flex flex-1 items-center gap-1.5 rounded-2xl border border-brand-100 bg-white px-3 py-1.5 focus-within:border-brand-300">
              <Search size={13} class="shrink-0 text-ink-400" />
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
          <p class="mt-2 text-[11px] font-semibold text-ink-400">{searchError}</p>
        {/if}

        {#if placeResults.length}
          <div class="mt-2 divide-y divide-brand-100/70 overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-soft">
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
                  {form.route.length ? '+ Add stop' : 'Set Start'}
                </span>
              </button>
            {/each}
          </div>
        {/if}

        <div class="mt-3 relative h-[320px] sm:h-[380px] w-full">
          <TranaMap
            bind:this={routeMap}
            plannedRoute={plannedGeoJson}
            plannedWaypoints={form.route}
            interactiveRoute={drawing}
            {routeMode}
            {routeDashed}
            {routing}
            onRoutePick={onPick}
            fitRoute={false}
            center={mapCenter}
            currentPosition={liveCoords}
            accuracyM={liveAccuracy}
            heading={liveHeading}
            bind:following
            autoCenter={true}
            {showRoads}
          />
        </div>

        <!-- Route quick helpers -->
        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          {#if liveCoords}
            <button type="button" class="btn-chip" onclick={startFromGps}>
              <Navigation size={12} /> {form.route.length ? 'Start from my GPS' : 'Use my GPS as Start'}
            </button>
          {/if}
          {#if !form.route.length && lastActivityWithRoute}
            <button type="button" class="btn-chip" onclick={loadLastActivity}>
              <History size={12} /> Load last activity route
            </button>
          {/if}
          {#if form.route.length >= 2}
            {#if !routeClosed}
              <button type="button" class="btn-chip" onclick={makeOutAndBack} title="Route back to Start along the same roads">
                <ArrowLeftRight size={12} /> Out & back
              </button>
              <button type="button" class="btn-chip" onclick={makeLoop} title="Connect Destination back to Start along roads">
                <Repeat size={12} /> Close loop
              </button>
            {/if}
            <button type="button" class="btn-chip" onclick={reverseRoute} title="Swap Start and Destination">
              <RotateCcw size={12} /> Reverse
            </button>
            <button type="button" class="btn-chip" onclick={() => { following = false; routeMap?.fitRouteBounds?.(); }}>
              <Maximize2 size={12} /> Fit route
            </button>
          {/if}
          {#if form.route.length}
            <button type="button" class="btn-chip" onclick={undoPoint}><Undo2 size={12} /> Undo</button>
            <button type="button" class="btn-chip" onclick={clearRoute}><Trash2 size={12} /> Clear</button>
          {/if}
        </div>

        <!-- Live route status pills -->
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <span class="pill">
            <MapPin size={12} />
            {form.route.length === 0
              ? 'No stops yet'
              : form.route.length === 1
                ? 'Start set — pick Destination'
                : `${form.route.length} stops`}
          </span>
          <span class="pill"><Ruler size={12} /> {routeKm > 0 ? `${nf(routeKm, 2)} km` : '—'}</span>
          {#if routing}
            <span class="pill"><LoaderCircle size={12} class="animate-spin" /> Routing along roads…</span>
          {:else if form.route.length >= 2 && routeKm <= 0.05}
            <span class="pill !bg-amber-50 !text-amber-700">
              Stops must be more than 50 m apart to predict
            </span>
          {:else if routeMode === 'straight' && form.route.length >= 2}
            <span class="pill">Straight-line mode</span>
          {:else if routePath.length > 1}
            <span class="pill !bg-emerald-50 !text-emerald-700">
              <Route size={12} /> Following roads ({routeProviderLabel || 'OpenStreetMap'})
            </span>
          {:else if form.route.length >= 2 && routeProvider === 'fallback'}
            <span class="pill !bg-amber-50 !text-amber-700">
              Straight fallback — no road found near a stop
            </span>
            <button
              type="button"
              class="btn-chip"
              onclick={() => scheduleSnap({ immediate: true })}
            >
              Retry road snap
            </button>
          {/if}
        </div>

        {#if drawing && form.route.length}
          <p class="mt-2 text-[11px] font-semibold text-ink-400">
            Drag any marker to reroute along nearby roads, click a marker to remove that stop, or tap the map to extend your route.
          </p>
        {/if}
      </Card>
    </div>

    <!-- result -->
    <div class="space-y-4">
      {#if computing && !prediction}
        <Card class="grid place-items-center !py-16">
          <LoaderCircle size={26} class="animate-spin text-brand-400" />
          <p class="mt-3 text-sm font-bold text-ink-400">Predicting duration and fueling…</p>
        </Card>
      {:else if !prediction}
        <Card class="grid place-items-center text-center !py-14 px-6 border-dashed border-brand-200 bg-brand-50/40">
          <div class="grid h-12 w-12 place-items-center rounded-2xl bg-white text-brand-500 shadow-soft">
            <MapPin size={22} />
          </div>
          <h3 class="mt-4 font-display text-lg font-extrabold text-ink-900">
            Add a route on the map to start predicting
          </h3>
          <p class="mt-1.5 max-w-sm text-xs font-semibold text-ink-500">
            Tap <strong>Start</strong> and <strong>Destination</strong> on the Route planner map (or search a street/place, use GPS, or load your last activity route). TRANA will calculate your distance, duration, and fueling plan automatically.
          </p>
        </Card>
      {:else if prediction}
        <Card class="!p-4 sm:!p-5">
          <div class="mb-3 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <ActivityIcon type={form.activity_type} size="sm" />
              <div>
                <p class="text-sm font-extrabold capitalize">{nf(effectiveDistance, 2)} km {form.activity_type}</p>
                <p class="text-[11px] font-semibold text-ink-400">
                  {nf(form.elevation_gain_m)} m gain · {form.temperature_c} °C
                </p>
              </div>
            </div>
            {#if computing}
              <LoaderCircle size={15} class="animate-spin text-brand-400" />
            {/if}
          </div>

          <FuelingPlan plan={prediction} />

          <div class="mt-4 flex flex-col gap-2 sm:flex-row">
            <button class="btn-primary flex-1" onclick={save} disabled={saving || Boolean(saved)}>
              {#if saving}
                <LoaderCircle size={16} class="animate-spin" /> Saving…
              {:else if saved}
                <Save size={16} /> Saved
              {:else}
                <Save size={16} /> Save this plan
              {/if}
            </button>
            {#if plannedRoute?.length >= 2}
              <button class="btn-ghost flex-1" onclick={() => followOnTrack(saved?.id ?? null)}>
                <Navigation size={15} /> Track this route
              </button>
            {/if}
            <button class="btn-ghost" onclick={startOver}>
              <Play size={15} /> Start over
            </button>
          </div>

          {#if saved}
            <div class="mt-3 rounded-2xl bg-emerald-50 p-3 text-[11px] font-bold text-emerald-700">
              Plan #{saved.id} saved. Tap “Track this route” to follow it with live GPS, or log it under Activities once you finish.
            </div>
          {/if}
        </Card>
      {/if}

      {#if $plans.length > 0}
        <Card>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <h2 class="text-base">Saved plans</h2>
              <span class="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-ink-500">
                {$plans.length}
              </span>
            </div>
            {#if $plans.length > 4}
              <button
                type="button"
                class="text-[11px] font-extrabold text-brand-600 hover:underline"
                onclick={() => (showAllPlans = !showAllPlans)}
              >
                {showAllPlans ? 'Show recent (4)' : `Show all (${$plans.length})`}
              </button>
            {/if}
          </div>
          <div class="mt-2 divide-y divide-brand-100/70">
            {#each visiblePlans as plan (plan.id)}
              <div class="flex items-center gap-2 py-2.5">
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-3 text-left transition hover:opacity-75"
                  onclick={() => loadSavedPlan(plan)}
                >
                  <ActivityIcon type={plan.activity_type} size="sm" />
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xs font-extrabold capitalize">
                      {plan.distance_km} km {plan.activity_type}
                      {#if plan.route?.length >= 2}
                        <span class="ml-1 text-[10px] font-bold text-brand-500">· Route</span>
                      {/if}
                    </p>
                    <p class="text-[10px] font-semibold text-ink-400">
                      ~{Math.round(plan.duration?.minutes ?? 0)} min · {plan.fueling?.carbs?.perHourG ?? 0} g carbs/h
                    </p>
                  </div>
                  <span class="shrink-0 text-[10px] font-bold text-ink-400">
                    {new Date(plan.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </button>
                {#if confirmDeletePlanId === plan.id}
                  <div class="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      class="btn-chip !border-rose-200 !bg-rose-50 !text-rose-600 hover:!bg-rose-100"
                      disabled={deletingPlanId === plan.id}
                      onclick={() => deleteSavedPlan(plan)}
                    >
                      {#if deletingPlanId === plan.id}
                        <LoaderCircle size={11} class="animate-spin" /> Deleting…
                      {:else}
                        Delete
                      {/if}
                    </button>
                    <button
                      type="button"
                      class="btn-chip"
                      disabled={deletingPlanId === plan.id}
                      onclick={() => (confirmDeletePlanId = null)}
                    >
                      Cancel
                    </button>
                  </div>
                {:else}
                  {#if plan.route?.length >= 2}
                    <button
                      type="button"
                      class="btn-chip shrink-0"
                      title="Follow this planned route on live tracking"
                      disabled={Boolean(deletingPlanId)}
                      onclick={() => followOnTrack(plan.id)}
                    >
                      <Navigation size={11} /> Track
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brand-100 bg-white/80 text-ink-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                    title="Delete saved plan"
                    aria-label="Delete saved plan {plan.distance_km} km {plan.activity_type}"
                    disabled={Boolean(deletingPlanId)}
                    onclick={() => (confirmDeletePlanId = plan.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        </Card>
      {/if}
    </div>
  </div>
</div>
