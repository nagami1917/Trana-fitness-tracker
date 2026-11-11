<script>
  import { onDestroy } from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import { MARKER_COLORS } from '../../config/mapConfig.js';
  import { toLatLng } from '../../services/mapService.js';

  let { map, currentPosition = null, startPosition = null, finishPosition = null } = $props();

  let markers = [];

  function makeCircle({ color, size = 14, pulse = false, ring = '#ffffff', title = '', zIndex = '10' }) {
    const el = document.createElement('div');
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.borderRadius = '9999px';
    el.style.background = color;
    el.style.border = `2.5px solid ${ring}`;
    el.style.zIndex = zIndex;
    el.style.boxShadow = pulse
      ? '0 0 0 6px rgba(13, 148, 136, 0.25), 0 2px 6px rgba(0, 0, 0, 0.3)'
      : '0 2px 6px rgba(0, 0, 0, 0.35)';
    if (title) el.title = title;
    return el;
  }

  function clearMarkers() {
    for (const m of markers) {
      try {
        m.remove();
      } catch {
        // Ignore already-removed markers.
      }
    }
    markers = [];
  }

  $effect(() => {
    clearMarkers();
    if (!map) return;

    const start = toLatLng(startPosition);
    if (start) {
      markers.push(
        new maplibregl.Marker({
          element: makeCircle({ color: MARKER_COLORS.start, size: 12, title: 'Start' }),
          anchor: 'center',
        })
          .setLngLat([start[1], start[0]])
          .addTo(map),
      );
    }

    const finish = toLatLng(finishPosition);
    if (finish) {
      markers.push(
        new maplibregl.Marker({
          element: makeCircle({ color: MARKER_COLORS.finish, size: 12, title: 'Finish' }),
          anchor: 'center',
        })
          .setLngLat([finish[1], finish[0]])
          .addTo(map),
      );
    }

    const current = toLatLng(currentPosition);
    if (current) {
      markers.push(
        new maplibregl.Marker({
          element: makeCircle({
            color: MARKER_COLORS.current,
            size: 16,
            pulse: true,
            title: 'Current position',
            zIndex: '20',
          }),
          anchor: 'center',
        })
          .setLngLat([current[1], current[0]])
          .addTo(map),
      );
    }
  });

  onDestroy(() => {
    clearMarkers();
  });
</script>
