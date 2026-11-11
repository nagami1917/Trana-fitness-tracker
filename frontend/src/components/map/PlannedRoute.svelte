<script>
  import { onDestroy } from 'svelte';
  import {
    PLANNED_ROUTE_COLOR,
    PLANNED_ROUTE_WIDTH,
    PLANNED_ROUTE_OPACITY,
    PLANNED_ROUTE_DASH,
  } from '../../config/mapConfig.js';

  let { map, plannedRoute = null } = $props();

  const sourceId = 'trana-planned-route';
  const layerId = 'trana-planned-route-line';

  $effect(() => {
    if (!map || !map.isStyleLoaded?.()) return;

    const data = plannedRoute ?? { type: 'FeatureCollection', features: [] };
    const existing = map.getSource(sourceId);
    if (existing) {
      existing.setData(data);
    } else {
      map.addSource(sourceId, { type: 'geojson', data });
    }

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': PLANNED_ROUTE_COLOR,
          'line-width': PLANNED_ROUTE_WIDTH,
          'line-opacity': PLANNED_ROUTE_OPACITY,
          'line-dasharray': PLANNED_ROUTE_DASH,
        },
      });
    }
  });

  onDestroy(() => {
    if (!map) return;
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  });
</script>
