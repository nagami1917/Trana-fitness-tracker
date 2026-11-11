<script>
  import { onDestroy } from 'svelte';
  import { segmentsToGeoJSON } from '../../services/mapService.js';
  import {
    ACTIVITY_LINE_WIDTH,
    ACTIVITY_LINE_OPACITY,
    SPEED_COLOR_RAMP,
  } from '../../config/mapConfig.js';

  let { map, points = [], roadSnapping = false } = $props();

  const sourceId = 'trana-activity-route';
  const layerId = 'trana-activity-route-line';

  $effect(() => {
    if (!map || !map.isStyleLoaded?.()) return;

    const data = segmentsToGeoJSON(points);
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
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': SPEED_COLOR_RAMP,
          'line-width': ACTIVITY_LINE_WIDTH,
          'line-opacity': ACTIVITY_LINE_OPACITY,
          ...(roadSnapping ? { 'line-dasharray': [1, 2] } : {}),
        },
      });
    } else {
      map.setPaintProperty(layerId, 'line-dasharray', roadSnapping ? [1, 2] : undefined);
    }
  });

  onDestroy(() => {
    if (!map) return;
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  });
</script>

{#if roadSnapping && points.length > 0}
  <div class="pointer-events-none absolute top-4 left-4 z-20 rounded-full bg-white/95 backdrop-blur-md px-3 py-1 text-xs font-medium text-brand-700 border border-brand-200 shadow-sm">
    Road snapping on
  </div>
{/if}
