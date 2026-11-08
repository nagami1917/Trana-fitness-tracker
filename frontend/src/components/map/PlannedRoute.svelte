<script>
  import { onDestroy } from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import {
    PLANNED_ROUTE_WIDTH,
    PLANNED_ROUTE_OPACITY,
    PLANNED_ROUTE_DASH,
  } from '../../config/mapConfig.js';

  let { map, plannedRoute = null } = $props();

  const SOURCE_ID = 'trana-planned-route';
  const LAYER_ID = 'trana-planned-route-layer';

  $effect(() => {
    if (!map) return;

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);

    if (!plannedRoute) {
      map.getSource(SOURCE_ID).setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    map.addLayer({
      id: LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#f9569b',
        'line-width': PLANNED_ROUTE_WIDTH,
        'line-opacity': PLANNED_ROUTE_OPACITY,
        'line-dasharray': PLANNED_ROUTE_DASH,
      },
    });

    map.getSource(SOURCE_ID).setData(plannedRoute);
  });

  onDestroy(() => {
    if (!map) return;
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  });
</script>

<slot />