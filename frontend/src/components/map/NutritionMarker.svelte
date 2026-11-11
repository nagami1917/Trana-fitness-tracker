<script>
  import { onDestroy } from 'svelte';
  import { MARKER_COLORS } from '../../config/mapConfig.js';

  let { map, markers = [] } = $props();

  const layerId = 'trana-nutrition-markers';
  const sourceId = 'trana-nutrition-source';

  $effect(() => {
    if (!map || !map.isStyleLoaded?.()) return;

    const features = (markers ?? [])
      .filter((m) => Number.isFinite(Number(m?.lat)) && Number.isFinite(Number(m?.lng)))
      .map((m, i) => ({
        type: 'Feature',
        properties: { label: m.label ?? '', message: m.message ?? '', index: i },
        geometry: { type: 'Point', coordinates: [Number(m.lng), Number(m.lat)] },
      }));

    const data = { type: 'FeatureCollection', features };
    const existing = map.getSource(sourceId);
    if (existing) {
      existing.setData(data);
    } else {
      map.addSource(sourceId, { type: 'geojson', data });
    }

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: 'circle',
        source: sourceId,
        paint: {
          'circle-radius': 6,
          'circle-color': MARKER_COLORS.nutrition,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 0.95,
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
