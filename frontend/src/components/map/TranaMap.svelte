<script>
  import { onMount } from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { LoaderCircle } from 'lucide-svelte';

  if (typeof maplibregl.setWorkerUrl === 'function' && maplibreWorkerUrl) {
    maplibregl.setWorkerUrl(maplibreWorkerUrl);
  }

  import { createMap, applyTranaTheme, fitToPoints, panTo, toLatLng, isStyleInitialized } from '../../services/mapService.js';
  import { reportClientError } from '../../lib/errorMonitor.js';
  import { theme } from '../../lib/theme.js';
  import PlannedRoute from './PlannedRoute.svelte';
  import ActivityRoute from './ActivityRoute.svelte';
  import ActivityMarker from './ActivityMarker.svelte';
  import NutritionMarker from './NutritionMarker.svelte';
  import MapControls from './MapControls.svelte';
  import RoadLayer from './RoadLayer.svelte';

  let {
    // Route data
    plannedRoute = null,      // GeoJSON object (LineString / FeatureCollection)
    plannedWaypoints = [],    // optional [[lat, lng], ...] for interactive editing & Start/End markers
    points = [],              // track-point objects: { latitude, longitude, ... }
    center = [14.676, 121.0437], // initial/fallback center [lat, lng]
    currentPosition = null,   // [lat, lng]
    accuracyM = null,         // GPS horizontal accuracy in metres
    heading = null,           // movement heading in degrees [0..360)
    startPosition = null,     // [lat, lng]
    finishPosition = null,    // [lat, lng]
    ghostPosition = null,     // [lat, lng]
    nutritionMarkers = [],    // [{ lat, lng, label, message }]
    showNutrition = false,

    // Behaviour
    autoCenter = true,        // pan to the latest GPS position while tracking
    following = $bindable(true), // false once the user drags the map themselves
    fitRoute = false,         // fit bounds to the whole route when it changes
    fitPadding = 60,

    // Interactive route drawing
    interactiveRoute = false,
    routeMode = 'roads',      // 'roads' | 'straight'
    routeDashed = false,
    routing = false,
    onRoutePick = null,

    // Road snapping
    showRoads = false,        // show nearby roads as a visual reference
    roadSnapping = false,     // snap GPS points to nearest road
    overlay = null,           // optional floating HUD snippet rendered over the map
  } = $props();

  let container;
  let map = $state(null);
  let styleReady = $state(false);
  let observer = null;
  let interactiveRef = false;
  let onRoutePickRef = null;

  $effect(() => {
    interactiveRef = interactiveRoute;
    onRoutePickRef = onRoutePick;
  });

  function extractPlannedCoords() {
    const routeCoords = [];
    if (plannedRoute?.geometry?.coordinates) {
      plannedRoute.geometry.coordinates.forEach(([lng, lat]) => routeCoords.push([lat, lng]));
    } else if (plannedRoute?.features) {
      plannedRoute.features.forEach((f) => {
        f.geometry?.coordinates?.forEach(([lng, lat]) => routeCoords.push([lat, lng]));
      });
    }
    if (!routeCoords.length && Array.isArray(plannedWaypoints) && plannedWaypoints.length) {
      plannedWaypoints.forEach((pt) => {
        const coords = toLatLng(pt);
        if (coords) routeCoords.push(coords);
      });
    }
    return routeCoords;
  }

  export function fitRouteBounds() {
    if (!map) return;
    const targets = extractPlannedCoords();
    if (targets.length >= 2) {
      fitToPoints(map, targets, { padding: fitPadding });
    } else if (targets.length === 1) {
      panTo(map, targets[0], { zoom: Math.max(map.getZoom?.() ?? 14, 15) });
    }
  }

  export function focusPoint(latlng, targetZoom = 16) {
    if (!map) return;
    const coords = toLatLng(latlng);
    if (!coords) return;
    const currentZoom = typeof map.getZoom === 'function' ? map.getZoom() : 14;
    panTo(map, coords, { zoom: Math.max(currentZoom, targetZoom) });
  }

  function markReady() {
    if (!map) return;
    applyTranaTheme(map);
    styleReady = true;
  }

  function toggleFollow() {
    following = !following;
    if (following && map) {
      const target = currentPosition ?? center;
      if (target) panTo(map, target, { zoom: Math.max(map.getZoom(), 15) });
    }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────
  onMount(() => {
    if (!container) return;
    const initialCenter = toLatLng(currentPosition) ?? toLatLng(center) ?? [14.676, 121.0437];
    const instance = createMap(container, {
      center: initialCenter,
      zoom: 14,
    });
    map = instance;

    if (isStyleInitialized(instance)) {
      markReady();
    } else {
      const onReady = () => {
        if (!map || styleReady) return;
        if (isStyleInitialized(instance)) markReady();
      };
      instance.once('style.load', onReady);
      instance.once('load', onReady);
    }

    try {
      instance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    } catch {
      // Ignore in test stubs that omit addControl.
    }

    instance.on('dragstart', () => {
      following = false;
    });

    instance.on('error', (event) => {
      if (event?.sourceId === 'osm') return;
      const err = event?.error;
      const msg = err?.message || String(err || '');
      if (!msg) return;
      if (/worker|style|geojson|webgl|shader/i.test(msg)) {
        reportClientError({
          message: `MapLibre: ${msg}`,
          stack: err?.stack || '',
        });
      }
    });

    instance.on('click', (event) => {
      if (!interactiveRef || !event?.lngLat) return;
      const targetEl = event?.originalEvent?.target;
      if (targetEl?.closest?.('.trana-route-marker, .maplibregl-marker, .maplibregl-ctrl')) return;
      onRoutePickRef?.('add', null, { lat: event.lngLat.lat, lng: event.lngLat.lng });
    });

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        if (map) map.resize();
      });
      observer.observe(container);
    }

    return () => {
      observer?.disconnect();
      styleReady = false;
      if (map) {
        map.remove();
        map = null;
      }
    };
  });

  // ── cursor for interactive path drawing ─────────────────────────────────
  $effect(() => {
    const canvas = map?.getCanvas?.();
    if (canvas) {
      canvas.style.cursor = interactiveRoute ? 'crosshair' : '';
    }
  });

  // ── center on initial/cached place when not actively tracking ───────────
  $effect(() => {
    if (!map || !styleReady || currentPosition || fitRoute || interactiveRoute || !following || !center) return;
    if (plannedRoute || plannedWaypoints.length > 0) return;
    panTo(map, center, { zoom: 14 });
  });

  // ── auto-centre on live GPS ────────────────────────────────────────────
  $effect(() => {
    if (!map || !styleReady || !autoCenter || !following || !currentPosition || fitRoute) return;
    panTo(map, currentPosition, { zoom: Math.max(map.getZoom(), 15) });
  });

  // ── reactive dark/light basemap raster styling ──────────────────────────
  $effect(() => {
    if (!map || !styleReady) return;
    if (typeof map.getLayer !== 'function' || typeof map.setPaintProperty !== 'function') return;
    const isDark = $theme === 'dark';
    try {
      if (map.getLayer('background')) {
        map.setPaintProperty('background', 'background-color', isDark ? '#131826' : '#eaf3ee');
      }
      if (map.getLayer('osm-tiles')) {
        map.setPaintProperty('osm-tiles', 'raster-brightness-max', isDark ? 0.52 : 1);
        map.setPaintProperty('osm-tiles', 'raster-contrast', isDark ? 0.25 : 0);
        map.setPaintProperty('osm-tiles', 'raster-saturation', isDark ? -0.45 : 0);
      }
    } catch {
      // Ignore if custom vector style lacks those layers.
    }
  });

  // ── fit the whole route into view ──────────────────────────────────────
  $effect(() => {
    if (!map || !styleReady || !fitRoute) return;

    const routeCoords = extractPlannedCoords();
    const targets = routeCoords.length
      ? routeCoords
      : points.filter((p) => p.latitude != null && p.longitude != null);

    if (targets.length >= 2) {
      fitToPoints(map, targets, { padding: fitPadding });
    } else if (targets.length === 1) {
      panTo(map, targets[0], { zoom: 15 });
    }
  });
</script>

<div
  class="trana-map relative h-full w-full rounded-3xl border border-brand-100 bg-brand-50/40 overflow-hidden"
  role="region"
  aria-label="TRANA activity map"
  bind:this={container}
>
  {#if map && styleReady}
    {#if showRoads && (currentPosition || center)}
      <RoadLayer {map} center={currentPosition ?? center} radiusM={1200} />
    {/if}
    <PlannedRoute
      {map}
      {plannedRoute}
      waypoints={plannedWaypoints}
      interactive={interactiveRoute}
      dashed={routeDashed}
      onPick={onRoutePick}
    />
    <ActivityRoute {map} {points} {roadSnapping} />
    <ActivityMarker {map} {currentPosition} {startPosition} {finishPosition} {ghostPosition} {accuracyM} {heading} />
    {#if showNutrition}
      <NutritionMarker {map} markers={nutritionMarkers} />
    {/if}
  {/if}

  {#if interactiveRoute && plannedWaypoints.length === 0}
    <div class="pointer-events-none absolute left-3 top-3 right-16 z-20 sm:left-4 sm:top-4 sm:right-20">
      <div class="w-fit max-w-full rounded-2xl bg-white/95 px-3 py-2 text-[11px] font-bold text-ink-700 shadow-soft backdrop-blur-sm border border-brand-100 sm:px-3.5 sm:text-xs">
        {routeMode === 'roads'
          ? 'Tap Start, then tap End on the map — follows roads & paths'
          : 'Tap Start, then tap End on the map to plot straight points'}
      </div>
    </div>
  {:else if interactiveRoute && plannedWaypoints.length === 1}
    <div class="pointer-events-none absolute left-3 top-3 right-16 z-20 sm:left-4 sm:top-4 sm:right-20">
      <div class="inline-flex max-w-full items-center gap-1.5 rounded-2xl bg-white/95 px-3 py-1.5 text-[11px] font-bold text-ink-700 shadow-soft border border-brand-100 sm:rounded-full sm:px-3.5 sm:text-xs">
        <span class="h-2 w-2 shrink-0 rounded-full bg-emerald-500"></span>
        <span>{routeMode === 'roads'
          ? 'Start set — now tap End on the map to follow roads'
          : 'Start set — now tap End on the map'}</span>
      </div>
    </div>
  {/if}

  {#if routing}
    <div class="pointer-events-none absolute left-4 bottom-4 z-20">
      <div class="inline-flex items-center gap-1.5 rounded-full bg-ink-900/85 px-3 py-1.5 text-[11px] font-bold text-white shadow-soft">
        <LoaderCircle size={12} class="animate-spin text-brand-300" />
        Following roads & paths…
      </div>
    </div>
  {/if}

  <div class="absolute top-4 right-4 z-30 flex flex-col gap-2">
    <MapControls {map} {following} onToggleFollow={toggleFollow} />
  </div>

  {@render overlay?.()}
</div>

<style>
  .trana-map :global(.maplibregl-canvas) {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
