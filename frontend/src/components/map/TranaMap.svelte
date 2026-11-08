<script>
  import { onMount, onDestroy } from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';

  import { createMap, applyTranaTheme, fitToPoints, panTo } from '../../services/mapService.js';
  import PlannedRoute from './PlannedRoute.svelte';
  import ActivityRoute from './ActivityRoute.svelte';
  import ActivityMarker from './ActivityMarker.svelte';
  import NutritionMarker from './NutritionMarker.svelte';
  import MapControls from './MapControls.svelte';

  let {
    // Route data
    plannedRoute = null,      // GeoJSON object (LineString / FeatureCollection)
    points = [],              // track-point objects: { latitude, longitude, ... }
    currentPosition = null,   // [lat, lng]
    startPosition = null,     // [lat, lng]
    finishPosition = null,    // [lat, lng]
    nutritionMarkers = [],    // [{ lat, lng, label, message }]
    showNutrition = false,

    // Behaviour
    autoCenter = true,        // pan to the latest GPS position while tracking
    following = true,         // false once the user drags the map themselves
    fitRoute = false,         // fit bounds to the whole route when it changes
    fitPadding = 60,
  } = $props();

  let container;
  let map = $state(null);

  // ── lifecycle ──────────────────────────────────────────────────────────
  onMount(() => {
    if (!container) return;
    map = createMap(container, {
      center: currentPosition ?? [14.676, 121.0437],
      zoom: 13,
    });

    map.once('load', () => {
      applyTranaTheme(map);
      // Attribution is required for the OpenStreetMap-based demo style.
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    });

    map.on('movestart', () => {
      // The user took over the map: following is handled by the parent.
    });

    const observer = new ResizeObserver(() => {
      if (map) map.resize();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  });

  onDestroy(() => {
    if (map) {
      map.remove();
      map = null;
    }
  });

  $effect(() => {
    if (map && !map._tranaThemeApplied) applyTranaTheme(map);
  });

  // ── auto-centre on live GPS ────────────────────────────────────────────
  $effect(() => {
    if (!map || !autoCenter || !following || !currentPosition) return;
    panTo(map, currentPosition, { zoom: 15 });
  });

  // ── fit the whole route into view ──────────────────────────────────────
  $effect(() => {
    if (!map || !fitRoute) return;

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
  class="trana-map relative h-full w-full rounded-3xl border border-brand-100 overflow-hidden"
  role="region"
  aria-label="TRANA activity map"
  bind:this={container}
>
  <PlannedRoute {map} {plannedRoute} />
  <ActivityRoute {map} {points} />
  <ActivityMarker {map} {currentPosition} {startPosition} {finishPosition} />
  {#if showNutrition}
    <NutritionMarker {map} {nutritionMarkers} />
  {/if}

  <!-- Controls float above the map; the bottom statistics panel owns the lower edge. -->
  <div class="absolute top-4 right-4 z-30 flex flex-col gap-2">
    <MapControls {map} />
  </div>

  {#if currentPosition && following}
    <div
      class="absolute bottom-1/2 left-1/2 -translate-y-1/2 -translate-x-1/2 z-10 pointer-events-none"
      aria-label="Following your location"
    >
      <div class="trana-locating ring-2 ring-brand-500/40 rounded-full bg-brand-500/10 backdrop-blur-sm" style="width:64px;height:64px"></div>
    </div>
  {/if}
</div>

<style>
  .trana-map canvas {
    width: 100%;
    height: 100%;
    display: block;
    border-radius: 1.5rem;
  }

  .trana-locating {
    animation: trana-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  @keyframes trana-pulse {
    0% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 0.7;
    }
    50% {
      transform: translate(-50%, -50%) scale(1.6);
      opacity: 0.15;
    }
    100% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 0.7;
    }
  }
</style>