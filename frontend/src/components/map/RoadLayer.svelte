<script>
  import { onDestroy } from 'svelte';
  import maplibregl from 'maplibre-gl';

  let { map, center = [14.676, 121.0437], radiusM = 2000 } = $props();

  const SOURCE_ID = 'trana-road-layer';
  const LAYER_ID = 'trana-road-layer';
  let queryTimer = null;

  $effect(() => {
    if (!map) return;

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);

    map.addLayer({
      id: LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#475569',
        'line-width': 3,
        'line-opacity': 0.6,
      },
    });

    fetchRoads(center[0], center[1], radiusM);
  });

  async function fetchRoads(lat, lng, radiusM) {
    if (!map) return;

    const query = `
      [out:json][timeout:25];
      (
        way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|road|living_street|service|track|path|cycleway|footway)$"](around:${radiusM},${lat},${lng});
      );
      out geom;
    `;

    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) return;
      const data = await response.json();

      const features = (data.elements || [])
        .filter((el) => el.type === 'way' && el.geometry)
        .map((el) => ({
          type: 'Feature',
          properties: { highway: el.tags?.highway || 'road' },
          geometry: {
            type: 'LineString',
            coordinates: el.geometry.map((g) => [g.lon, g.lat]),
          },
        }));

      if (map.getSource(SOURCE_ID)) {
        map.getSource(SOURCE_ID).setData({ type: 'FeatureCollection', features });
      }
    } catch {
      // Silently fail — roads are a nice-to-have visual aid
    }
  }

  // Re-fetch roads when centre moves significantly
  $effect(() => {
    if (!map) return;
    clearTimeout(queryTimer);
    queryTimer = setTimeout(() => {
      fetchRoads(center[0], center[1], radiusM);
    }, 2000);
  });

  onDestroy(() => {
    clearTimeout(queryTimer);
    if (!map) return;
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  });
</script>

<slot />