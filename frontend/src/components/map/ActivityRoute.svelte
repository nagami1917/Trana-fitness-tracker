<script>
  import { onDestroy } from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import { segmentsToGeoJSON } from '../../services/mapService.js';
  import {
    ACTUAL_ROUTE_WIDTH,
    ACTUAL_ROUTE_OPACITY,
    PLANNED_ROUTE_WIDTH,
    PLANNED_ROUTE_OPACITY,
    PLANNED_ROUTE_DASH,
    SLOW_ROUTE_COLOR,
    MODERATE_ROUTE_COLOR,
    FAST_ROUTE_COLOR,
    SLOW_SPEED_KMH,
    MODERATE_SPEED_KMH,
  } from '../../config/mapConfig.js';

  let { map, points = [], roadSnapping = false } = $props();

  // GeoJSON source / layer ids.
  const SOURCE_ID = 'trana-actual-route';
  const LAYER_ID = 'trana-actual-route-layer';
  const SNAP_INDICATOR_ID = 'trana-snap-indicator';

  $effect(() => {
    if (!map) return;

    // Create (or reuse) a vector source for the actual route.
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);

    const geojson = segmentsToGeoJSON(points);

    map.addLayer({
      id: LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'speedKmh'], null], SLOW_ROUTE_COLOR,
          ['>', ['get', 'speedKmh'], MODERATE_SPEED_KMH], FAST_ROUTE_COLOR,
          ['>', ['get', 'speedKmh'], SLOW_SPEED_KMH], MODERATE_ROUTE_COLOR,
          SLOW_ROUTE_COLOR,
        ],
        'line-width': ACTUAL_ROUTE_WIDTH,
        'line-opacity': ACTUAL_ROUTE_OPACITY,
        // When road snapping is active, add a subtle dashed outer stroke to show it
        'line-dasharray': roadSnapping ? [1, 2] : ['literal', 'none'],
      },
    });

    map.getSource(SOURCE_ID).setData(geojson);
  });

  onDestroy(() => {
    if (!map) return;
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    if (map.getLayer(SNAP_INDICATOR_ID)) map.removeLayer(SNAP_INDICATOR_ID);
  });
</script>

{#if roadSnapping}
  <div class="absolute bottom-4 left-4 z-30 flex items-center gap-2 rounded-lg border border-brand-100 bg-white px-3 py-1.5 text-xs font-bold shadow-sm">
    <span class="text-emerald-500">●</span>
    <span class="text-ink-700">Road snapping on</span>
  </div>
{/if}

<slot />