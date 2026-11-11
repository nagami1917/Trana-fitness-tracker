<script>
  import { onMount } from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';

  import { createMap, applyTranaTheme, fitToPoints, panTo, toLatLng } from '../../services/mapService.js';
  import PlannedRoute from './PlannedRoute.svelte';
  import ActivityRoute from './ActivityRoute.svelte';
  import ActivityMarker from './ActivityMarker.svelte';
  import NutritionMarker from './NutritionMarker.svelte';
  import MapControls from './MapControls.svelte';
  import RoadLayer from './RoadLayer.svelte';

  let {
    // Route data
    plannedRoute = null,      // GeoJSON object (LineString / FeatureCollection)
    points = [],              // track-point objects: { latitude, longitude, ... }
    center = [14.676, 121.0437], // initial/fallback center [lat, lng]
    currentPosition = null,   // [lat, lng]
    startPosition = null,     // [lat, lng]
    finishPosition = null,    // [lat, lng]
    nutritionMarkers = [],    // [{ lat, lng, label, message }]
    showNutrition = false,

    // Behaviour
    autoCenter = true,        // pan to the latest GPS position while tracking
    following = $bindable(true), // false once the user drags the map themselves
    fitRoute = false,         // fit bounds to the whole route when it changes
    fitPadding = 60,

    // Road snapping
    showRoads = false,        // show nearby roads as a visual reference
    roadSnapping = false,     // snap GPS points to nearest road
  } = $props();

  let container;
  let map = $state(null);
  let styleReady = $state(false);
  let observer = null;

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

    if (instance.isStyleLoaded?.()) {
      markReady();
    } else {
      instance.once('load', () => {
        markReady();
      });
    }

    try {
      instance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    } catch {
      // Ignore in test stubs that omit addControl.
    }

    instance.on('dragstart', () => {
      following = false;
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

  // ── center on initial/cached place when not actively tracking ───────────
  $effect(() => {
    if (!map || !styleReady || currentPosition || fitRoute || !following || !center) return;
    panTo(map, center, { zoom: 14 });
  });

  // ── auto-centre on live GPS ────────────────────────────────────────────
  $effect(() => {
    if (!map || !styleReady || !autoCenter || !following || !currentPosition) return;
    panTo(map, currentPosition, { zoom: Math.max(map.getZoom(), 15) });
  });

  // ── fit the whole route into view ──────────────────────────────────────
  $effect(() => {
    if (!map || !styleReady || !fitRoute) return;

    const routeCoords = [];
    if (plannedRoute?.geometry?.coordinates) {
      plannedRoute.geometry.coordinates.forEach(([lng, lat]) => routeCoords.push([lat, lng]));
    } else if (plannedRoute?.features) {
      plannedRoute.features.forEach((f) => {
        f.geometry?.coordinates?.forEach(([lng, lat]) => routeCoords.push([lat, lng]));
      });
    }

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
    <PlannedRoute {map} {plannedRoute} />
    <ActivityRoute {map} {points} {roadSnapping} />
    <ActivityMarker {map} {currentPosition} {startPosition} {finishPosition} />
    {#if showNutrition}
      <NutritionMarker {map} markers={nutritionMarkers} />
    {/if}
  {/if}

  <div class="absolute top-4 right-4 z-30 flex flex-col gap-2">
    <MapControls {map} {following} onToggleFollow={toggleFollow} />
  </div>
</div>

<style>
  .trana-map :global(.maplibregl-canvas) {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
