<script>
  import { onDestroy } from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import {
    PLANNED_ROUTE_COLOR,
    PLANNED_ROUTE_WIDTH,
    PLANNED_ROUTE_OPACITY,
    PLANNED_ROUTE_DASH,
  } from '../../config/mapConfig.js';
  import { isStyleInitialized } from '../../services/mapService.js';
  import { isClosedLoop } from '../../services/roadRoutingService.js';

  let {
    map,
    plannedRoute = null,
    waypoints = [],
    interactive = false,
    onPick = null,
  } = $props();

  const sourceId = 'trana-planned-route';
  const casingLayerId = 'trana-planned-route-casing';
  const layerId = 'trana-planned-route-line';

  let markers = [];
  let styleReady = $state(false);

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

  function clearMarkers() {
    for (const marker of markers) {
      try {
        marker.remove();
      } catch {
        // Ignore already-removed markers.
      }
    }
    markers = [];
  }

  function extractLineLatLngs(geojson) {
    const out = [];
    if (!geojson) return out;
    const collect = (geom) => {
      if (!geom?.type || !Array.isArray(geom.coordinates)) return;
      if (geom.type === 'LineString') {
        for (const pt of geom.coordinates) {
          if (Array.isArray(pt) && pt.length >= 2) out.push([Number(pt[1]), Number(pt[0])]);
        }
      } else if (geom.type === 'MultiLineString') {
        for (const seg of geom.coordinates) {
          for (const pt of seg) {
            if (Array.isArray(pt) && pt.length >= 2) out.push([Number(pt[1]), Number(pt[0])]);
          }
        }
      }
    };
    if (geojson.type === 'FeatureCollection') {
      for (const f of geojson.features ?? []) collect(f?.geometry);
    } else if (geojson.type === 'Feature') {
      collect(geojson.geometry);
    } else {
      collect(geojson);
    }
    return out.filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  }

  function buildMarkerElement({ kind, label = '', title = '', isInteractive = false }) {
    const el = document.createElement('div');
    el.className = 'trana-route-marker';
    el.style.display = 'grid';
    el.style.placeItems = 'center';
    el.style.cursor = isInteractive ? 'grab' : 'default';
    el.style.userSelect = 'none';
    el.style.zIndex = kind === 'start' ? '8' : kind === 'finish' ? '7' : '6';

    if (kind === 'start') {
      el.style.width = '24px';
      el.style.height = '24px';
      el.style.borderRadius = '9999px';
      el.style.background = '#22c55e';
      el.style.color = '#ffffff';
      el.style.font = '800 11px/1 sans-serif';
      el.style.border = '2.5px solid #ffffff';
      el.style.boxShadow = '0 3px 10px rgba(34, 197, 94, 0.45)';
      el.textContent = 'S';
    } else if (kind === 'finish') {
      el.style.width = '24px';
      el.style.height = '24px';
      el.style.borderRadius = '6px';
      el.style.background = 'conic-gradient(#3f2333 0 25%, #ffffff 0 50%, #3f2333 0 75%, #ffffff 0)';
      el.style.border = '2.5px solid #ffffff';
      el.style.boxShadow = '0 4px 12px rgba(219, 39, 119, 0.45)';
    } else {
      el.style.width = '20px';
      el.style.height = '20px';
      el.style.borderRadius = '9999px';
      el.style.background = '#f9569b';
      el.style.color = '#ffffff';
      el.style.font = '800 10px/1 sans-serif';
      el.style.border = '2px solid #ffffff';
      el.style.boxShadow = '0 2px 8px rgba(249, 86, 155, 0.45)';
      el.textContent = label;
    }

    if (title) el.title = title;
    return el;
  }

  $effect(() => {
    if (!map || !styleReady || !isStyleInitialized(map)) return;

    const data = plannedRoute ?? { type: 'FeatureCollection', features: [] };
    const existing = map.getSource(sourceId);
    if (existing) {
      existing.setData(data);
    } else {
      map.addSource(sourceId, { type: 'geojson', data });
    }

    const beforeLayer = map.getLayer?.('trana-activity-route-line') ? 'trana-activity-route-line' : undefined;

    if (!map.getLayer(casingLayerId)) {
      map.addLayer(
        {
          id: casingLayerId,
          type: 'line',
          source: sourceId,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': PLANNED_ROUTE_WIDTH + 3,
            'line-opacity': 0.92,
          },
        },
        beforeLayer,
      );
    }

    if (!map.getLayer(layerId)) {
      map.addLayer(
        {
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
        },
        beforeLayer,
      );
    }
  });

  $effect(() => {
    clearMarkers();
    if (!map) return;

    let markerPoints = [];
    if (Array.isArray(waypoints) && waypoints.length > 0) {
      markerPoints = waypoints;
    } else {
      const coords = extractLineLatLngs(plannedRoute);
      if (coords.length >= 2) {
        markerPoints = [coords[0], coords[coords.length - 1]];
      } else if (coords.length === 1) {
        markerPoints = [coords[0]];
      }
    }

    if (!markerPoints.length) return;
    const closed = isClosedLoop(markerPoints);

    markerPoints.forEach(([lat, lng], index) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const isStart = index === 0;
      const isEnd = index === markerPoints.length - 1 && markerPoints.length > 1;
      const kind = isStart
        ? 'start'
        : isEnd && (!interactive || !closed)
          ? 'finish'
          : 'stop';
      const baseTitle = isStart ? 'Start' : isEnd ? 'End' : `Stop ${index + 1}`;
      const el = buildMarkerElement({
        kind,
        label: String(index + 1),
        title: interactive ? `${baseTitle} — drag to move, click to remove` : baseTitle,
        isInteractive: interactive,
      });

      const marker = new maplibregl.Marker({
        element: el,
        anchor: 'center',
        draggable: interactive,
      })
        .setLngLat([lng, lat])
        .addTo(map);

      if (interactive) {
        let justDragged = false;
        marker.on?.('dragstart', () => {
          justDragged = false;
        });
        marker.on?.('dragend', () => {
          justDragged = true;
          setTimeout(() => {
            justDragged = false;
          }, 80);
          const lngLat = marker.getLngLat?.();
          if (lngLat) onPick?.('move', index, { lat: lngLat.lat, lng: lngLat.lng });
        });
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          if (justDragged) return;
          onPick?.('remove', index, { lat, lng });
        });
      }

      markers.push(marker);
    });
  });

  onDestroy(() => {
    clearMarkers();
    if (!map) return;
    try {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getLayer(casingLayerId)) map.removeLayer(casingLayerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    } catch {
      // Map or style was already torn down by parent cleanup.
    }
  });
</script>
