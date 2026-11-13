<script>
  import { onDestroy } from 'svelte';
  import { toLatLng, isStyleInitialized } from '../../services/mapService.js';

  let { map, center = [14.676, 121.0437], radiusM = 1200 } = $props();

  const SOURCE_ID = 'trana-road-source';
  const LAYER_ID = 'trana-road-layer';
  const roadCache = globalThis.__tranaRoadCache ?? (globalThis.__tranaRoadCache = new Map());
  let queryTimer = null;
  let lastFetchKey = '';
  let abortCtrl = null;
  let styleReady = $state(false);

  function applyFeatures(features) {
    if (map?.getSource?.(SOURCE_ID)) {
      map.getSource(SOURCE_ID).setData({ type: 'FeatureCollection', features });
    }
  }

  $effect(() => {
    const target = map;
    if (!target) {
      styleReady = false;
      return;
    }
    if (isStyleInitialized(target)) {
      styleReady = true;
      return;
    }
    styleReady = false;
    const onReady = () => {
      if (isStyleInitialized(target)) styleReady = true;
    };
    target.on?.('style.load', onReady);
    target.on?.('load', onReady);
    target.on?.('styledata', onReady);
    return () => {
      target.off?.('style.load', onReady);
      target.off?.('load', onReady);
      target.off?.('styledata', onReady);
    };
  });

  async function fetchRoads(lat, lng, radius, key) {
    if (!map || !isStyleInitialized(map)) return;

    if (roadCache.has(key)) {
      applyFeatures(roadCache.get(key));
      return;
    }

    abortCtrl?.abort();
    abortCtrl = new AbortController();

    const query = `
      [out:json][timeout:15];
      (
        way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|road|living_street|service|track|path|cycleway|footway)$"](around:${radius},${lat},${lng});
      );
      out geom;
    `;

    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ data: query }),
        signal: abortCtrl.signal,
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

      if (roadCache.size >= 16) {
        const oldestKey = roadCache.keys().next().value;
        roadCache.delete(oldestKey);
      }
      roadCache.set(key, features);
      applyFeatures(features);
    } catch {
      // Silently fail — roads are an optional visual aid.
    }
  }

  $effect(() => {
    if (!map || !styleReady || !isStyleInitialized(map)) return;

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    if (!map.getLayer(LAYER_ID)) {
      const beforeLayer = [
        'trana-gps-accuracy-fill',
        'trana-planned-route-casing',
        'trana-activity-route-line',
      ].find((id) => map.getLayer?.(id));
      map.addLayer(
        {
          id: LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#475569',
            'line-width': 2.5,
            'line-opacity': 0.5,
          },
        },
        beforeLayer,
      );
    }

    const coords = toLatLng(center);
    if (!coords) return;
    const key = `${coords[0].toFixed(3)},${coords[1].toFixed(3)},${radiusM}`;
    if (roadCache.has(key)) {
      lastFetchKey = key;
      applyFeatures(roadCache.get(key));
      return;
    }
    if (key === lastFetchKey) return;

    clearTimeout(queryTimer);
    queryTimer = setTimeout(() => {
      lastFetchKey = key;
      fetchRoads(coords[0], coords[1], radiusM, key);
    }, 600);
  });

  onDestroy(() => {
    clearTimeout(queryTimer);
    abortCtrl?.abort();
    if (!map) return;
    try {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    } catch {
      // Map or style was already torn down by parent cleanup.
    }
  });
</script>
