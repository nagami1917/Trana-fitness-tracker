<script>
  import { onDestroy } from 'svelte';
  import * as maplibregl from 'maplibre-gl';
  import { MARKER_COLORS, MARKER_SIZE } from '../../config/mapConfig.js';

  let { map, currentPosition = null, startPosition = null, finishPosition = null } = $props();

  const markers = $state([]);

  function iconHtml({ color, size = MARKER_SIZE, ring = '#ffffff', ringWidth = 2 }) {
    const radius = size / 2;
    return `
      <div style="
        display:grid;place-items:center;
        width:${size}px;height:${size}px;
        border-radius:50%;
        background:${color};
        border:${ringWidth}px solid ${ring};
        box-shadow:0 2px 8px rgba(0,0,0,0.35);
      ">
        <div style="width:${size * 0.45}px;height:${size * 0.45}px;border-radius:50%;background:${ring}"></div>
      </div>`;
  }

  $effect(() => {
    if (!map) return;
    clear();

    if (startPosition) {
      markers.push(
        new maplibregl.Marker({
          element: toElement(iconHtml({ color: MARKER_COLORS.start })),
          anchor: 'bottom',
        })
          .setLngLat([startPosition[1], startPosition[0]])
          .addTo(map),
      );
    }

    if (currentPosition) {
      markers.push(
        new maplibregl.Marker({
          element: toElement(iconHtml({ color: MARKER_COLORS.current })),
          anchor: 'bottom',
        })
          .setLngLat([currentPosition[1], currentPosition[0]])
          .addTo(map),
      );
    }

    if (finishPosition) {
      markers.push(
        new maplibregl.Marker({
          element: toElement(iconHtml({ color: MARKER_COLORS.finish, ring: '#cbd5e1' })),
          anchor: 'bottom',
        })
          .setLngLat([finishPosition[1], finishPosition[0]])
          .addTo(map),
      );
    }
  });

  function clear() {
    markers.forEach((m) => m.remove());
    markers.length = 0;
  }

  function toElement(html) {
    const div = document.createElement('div');
    div.innerHTML = html.trim();
    return div.firstElementChild;
  }

  onDestroy(() => clear());
</script>

<slot />