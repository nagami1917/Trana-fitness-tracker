<script>
  import { onDestroy } from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import { MARKER_COLORS } from '../../config/mapConfig.js';
  import { toLatLng, isStyleInitialized } from '../../services/mapService.js';

  let {
    map,
    currentPosition = null,
    startPosition = null,
    finishPosition = null,
    accuracyM = null,
    heading = null,
  } = $props();

  const ACCURACY_SOURCE_ID = 'trana-gps-accuracy';
  const ACCURACY_FILL_ID = 'trana-gps-accuracy-fill';
  const ACCURACY_RING_ID = 'trana-gps-accuracy-ring';

  let styleReady = $state(false);
  let startMarker = null;
  let finishMarker = null;
  let currentMarker = null;
  let currentConeEl = null;

  let displayedPos = null; // [lat, lng]
  let animFrameId = null;
  let activeAccuracyM = null;

  function makeCircle({ color, size = 14, ring = '#ffffff', title = '', zIndex = '10' }) {
    const el = document.createElement('div');
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.borderRadius = '9999px';
    el.style.background = color;
    el.style.border = `2.5px solid ${ring}`;
    el.style.zIndex = zIndex;
    el.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.35)';
    if (title) el.title = title;
    return el;
  }

  function makeLiveIndicator() {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.width = '40px';
    wrapper.style.height = '40px';
    wrapper.style.display = 'grid';
    wrapper.style.placeItems = 'center';
    wrapper.style.pointerEvents = 'none';
    wrapper.style.zIndex = '20';

    // Subtle directional heading cone (points North at 0deg)
    const cone = document.createElement('div');
    cone.style.position = 'absolute';
    cone.style.inset = '0';
    cone.style.background =
      'conic-gradient(from -26deg at 50% 50%, rgba(249, 86, 155, 0.42) 0deg 52deg, transparent 52deg 360deg)';
    cone.style.borderRadius = '9999px';
    cone.style.transition = 'transform 220ms ease-out, opacity 200ms ease';
    cone.style.opacity = '0';
    cone.style.transform = 'rotate(0deg)';
    wrapper.appendChild(cone);

    // Core pulsing dot
    const dot = document.createElement('div');
    dot.style.position = 'relative';
    dot.style.width = '18px';
    dot.style.height = '18px';
    dot.style.borderRadius = '9999px';
    dot.style.background = MARKER_COLORS.current;
    dot.style.border = '3px solid #ffffff';
    dot.style.boxShadow = '0 0 0 6px rgba(249, 86, 155, 0.22), 0 2px 8px rgba(0, 0, 0, 0.32)';
    dot.title = 'Current GPS position';
    wrapper.appendChild(dot);

    return { wrapper, cone };
  }

  function accuracyCircleGeoJson(pos, radiusM) {
    if (!pos || !Number.isFinite(radiusM) || radiusM <= 0) {
      return { type: 'FeatureCollection', features: [] };
    }
    const clampedM = Math.max(5, Math.min(250, radiusM));
    const [lat, lng] = pos;
    const steps = 36;
    const earthRadiusM = 6378137;
    const latRad = (lat * Math.PI) / 180;
    const coords = [];
    for (let i = 0; i <= steps; i += 1) {
      const theta = (i / steps) * 2 * Math.PI;
      const dLat = (clampedM / earthRadiusM) * Math.cos(theta) * (180 / Math.PI);
      const dLng =
        ((clampedM / (earthRadiusM * Math.max(0.15, Math.cos(latRad)))) *
          Math.sin(theta) *
          180) /
        Math.PI;
      coords.push([lng + dLng, lat + dLat]);
    }
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [coords] },
        },
      ],
    };
  }

  function updateAccuracyLayer(pos, radiusM) {
    if (!map || !styleReady || !isStyleInitialized(map)) return;
    const data = accuracyCircleGeoJson(pos, radiusM);
    const existing = map.getSource?.(ACCURACY_SOURCE_ID);
    if (existing) {
      existing.setData?.(data);
    } else if (data.features.length > 0) {
      map.addSource?.(ACCURACY_SOURCE_ID, { type: 'geojson', data });
    }

    if (!map.getSource?.(ACCURACY_SOURCE_ID)) return;

    const beforeLayer = map.getLayer?.('trana-planned-route-casing')
      ? 'trana-planned-route-casing'
      : map.getLayer?.('trana-activity-route-line')
        ? 'trana-activity-route-line'
        : undefined;

    if (!map.getLayer?.(ACCURACY_FILL_ID)) {
      map.addLayer?.(
        {
          id: ACCURACY_FILL_ID,
          type: 'fill',
          source: ACCURACY_SOURCE_ID,
          paint: {
            'fill-color': MARKER_COLORS.current,
            'fill-opacity': 0.12,
          },
        },
        beforeLayer,
      );
    }

    if (!map.getLayer?.(ACCURACY_RING_ID)) {
      map.addLayer?.(
        {
          id: ACCURACY_RING_ID,
          type: 'line',
          source: ACCURACY_SOURCE_ID,
          paint: {
            'line-color': MARKER_COLORS.current,
            'line-width': 1.5,
            'line-opacity': 0.35,
          },
        },
        beforeLayer,
      );
    }
  }

  function cancelAnim() {
    if (animFrameId != null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(animFrameId);
    }
    animFrameId = null;
  }

  function removeMarker(m) {
    if (!m) return;
    try {
      m.remove();
    } catch {
      // Ignore already-removed markers.
    }
  }

  function clearAllMarkers() {
    cancelAnim();
    removeMarker(startMarker);
    removeMarker(finishMarker);
    removeMarker(currentMarker);
    startMarker = null;
    finishMarker = null;
    currentMarker = null;
    currentConeEl = null;
    displayedPos = null;
  }

  // Watch map style readiness for the accuracy ring GeoJSON layer
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

  // Start marker (reused)
  $effect(() => {
    if (!map) {
      removeMarker(startMarker);
      startMarker = null;
      return;
    }
    const start = toLatLng(startPosition);
    if (!start) {
      removeMarker(startMarker);
      startMarker = null;
      return;
    }
    if (!startMarker) {
      startMarker = new maplibregl.Marker({
        element: makeCircle({ color: MARKER_COLORS.start, size: 12, title: 'Start' }),
        anchor: 'center',
      })
        .setLngLat([start[1], start[0]])
        .addTo(map);
    } else {
      startMarker.setLngLat([start[1], start[0]]);
    }
  });

  // Finish marker (reused)
  $effect(() => {
    if (!map) {
      removeMarker(finishMarker);
      finishMarker = null;
      return;
    }
    const finish = toLatLng(finishPosition);
    if (!finish) {
      removeMarker(finishMarker);
      finishMarker = null;
      return;
    }
    if (!finishMarker) {
      finishMarker = new maplibregl.Marker({
        element: makeCircle({ color: MARKER_COLORS.finish, size: 12, title: 'Finish' }),
        anchor: 'center',
      })
        .setLngLat([finish[1], finish[0]])
        .addTo(map);
    } else {
      finishMarker.setLngLat([finish[1], finish[0]]);
    }
  });

  // Live GPS marker: reused + smoothly animated with requestAnimationFrame + heading cone + accuracy ring
  $effect(() => {
    activeAccuracyM = Number.isFinite(Number(accuracyM)) ? Number(accuracyM) : null;
    if (!map) {
      cancelAnim();
      removeMarker(currentMarker);
      currentMarker = null;
      currentConeEl = null;
      displayedPos = null;
      return;
    }

    const targetPos = toLatLng(currentPosition);
    if (!targetPos) {
      cancelAnim();
      removeMarker(currentMarker);
      currentMarker = null;
      currentConeEl = null;
      displayedPos = null;
      updateAccuracyLayer(null, null);
      return;
    }

    if (!currentMarker) {
      const { wrapper, cone } = makeLiveIndicator();
      currentConeEl = cone;
      currentMarker = new maplibregl.Marker({
        element: wrapper,
        anchor: 'center',
      })
        .setLngLat([targetPos[1], targetPos[0]])
        .addTo(map);
      displayedPos = targetPos;
      updateAccuracyLayer(targetPos, activeAccuracyM);
    } else if (displayedPos) {
      const [fromLat, fromLng] = displayedPos;
      const [toLat, toLng] = targetPos;
      const changed = Math.abs(toLat - fromLat) > 1e-7 || Math.abs(toLng - fromLng) > 1e-7;
      if (changed && typeof requestAnimationFrame === 'function' && typeof performance !== 'undefined') {
        cancelAnim();
        const startMs = performance.now();
        const durationMs = 420;
        const step = (now) => {
          const t = Math.min(1, (now - startMs) / durationMs);
          const eased = 1 - (1 - t) ** 3;
          const lat = fromLat + (toLat - fromLat) * eased;
          const lng = fromLng + (toLng - fromLng) * eased;
          displayedPos = [lat, lng];
          currentMarker?.setLngLat([lng, lat]);
          updateAccuracyLayer(displayedPos, activeAccuracyM);
          if (t < 1) {
            animFrameId = requestAnimationFrame(step);
          } else {
            animFrameId = null;
            displayedPos = targetPos;
          }
        };
        animFrameId = requestAnimationFrame(step);
      } else {
        displayedPos = targetPos;
        currentMarker.setLngLat([toLng, toLat]);
        updateAccuracyLayer(targetPos, activeAccuracyM);
      }
    }

    if (currentConeEl) {
      if (Number.isFinite(Number(heading))) {
        currentConeEl.style.opacity = '1';
        currentConeEl.style.transform = `rotate(${Math.round(Number(heading))}deg)`;
      } else {
        currentConeEl.style.opacity = '0';
      }
    }
  });

  // Sync accuracy circle whenever styleReady flips true or accuracyM changes without position change
  $effect(() => {
    void styleReady;
    const acc = Number.isFinite(Number(accuracyM)) ? Number(accuracyM) : null;
    const pos = displayedPos ?? toLatLng(currentPosition);
    if (pos) updateAccuracyLayer(pos, acc);
  });

  onDestroy(() => {
    clearAllMarkers();
    if (!map) return;
    try {
      if (map.getLayer?.(ACCURACY_RING_ID)) map.removeLayer(ACCURACY_RING_ID);
      if (map.getLayer?.(ACCURACY_FILL_ID)) map.removeLayer(ACCURACY_FILL_ID);
      if (map.getSource?.(ACCURACY_SOURCE_ID)) map.removeSource(ACCURACY_SOURCE_ID);
    } catch {
      // Map or style was already torn down by parent cleanup.
    }
  });
</script>
