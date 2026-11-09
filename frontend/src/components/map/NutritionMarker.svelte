<script>
  import { onDestroy } from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import { MARKER_COLORS } from '../../config/mapConfig.js';

  let { map, markers = [] } = $props();

  const layerId = 'trana-nutrition-markers';
  const sourceId = 'trana-nutrition-source';

  $effect(() => {
    if (!map) return;

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    if (map.getLayer(layerId)) map.removeLayer(layerId);

    const features = (markers ?? []).map((m, i) => ({
      type: 'Feature',
      properties: { label: m.label, message: m.message, index: i },
      geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
    }));

    map.addLayer({
      id: layerId,
      type: 'symbol',
      source: sourceId,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': MARKER_COLORS.nutrition,
        'text-halo-color': '#ffffff',
        'text-halo-width': 2,
        'text-halo-blur': 1,
        'text-opacity': markers.length ? 0.9 : 0,
      },
    });

    map.getSource(sourceId).setData({ type: 'FeatureCollection', features });
  });

  onDestroy(() => {
    if (!map) return;
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  });
</script>

<slot />