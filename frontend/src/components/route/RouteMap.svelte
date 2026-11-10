<script>
  import { onMount } from 'svelte';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';

  let {
    points = [],
    path = [],
    height = 260,
    interactive = false,
    center = [14.676, 121.0437],
    zoom = 13,
    onPick = null,
    class: cls = '',
    showAttribution = true,
    children,
  } = $props();

  let container;
  let map;
  let layerGroup;
  let line;
  let guide;
  let markers = [];

  const startIcon = () =>
    L.divIcon({
      className: '',
      html: '<span class="route-marker" style="display:block;width:16px;height:16px;background:#22c55e"></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

  const finishIcon = () =>
    L.divIcon({
      className: '',
      html: '<span style="display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:conic-gradient(#3f2333 0 25%, #fff 0 50%, #3f2333 0 75%, #fff 0);border:2.5px solid #fff;box-shadow:0 4px 12px rgba(219,39,119,.45)"></span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });

  const dotIcon = () =>
    L.divIcon({
      className: '',
      html: '<span class="route-marker" style="display:block;width:12px;height:12px;background:#f9569b"></span>',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });

  function draw() {
    if (!map) return;
    markers.forEach((m) => m.remove());
    markers = [];
    if (line) {
      line.remove();
      line = null;
    }
    if (guide) {
      guide.remove();
      guide = null;
    }

    const snapped = Array.isArray(path) && path.length > 1;
    // The rendered line: while editing, the snapped road path when we have it
    // and a dashed guide through the raw taps otherwise; when viewing, the
    // stored route (which is the snapped path for newly saved activities).
    const linePoints = interactive ? [] : snapped ? path : points;
    if (!interactive && !linePoints.length) return;
    if (interactive && !points?.length && !snapped) return;

    if (interactive) {
      if (points.length) {
        guide = L.polyline(points, {
          color: '#f9569b',
          weight: 3,
          opacity: snapped ? 0.4 : 0.95,
          lineJoin: 'round',
          lineCap: 'round',
          dashArray: '1 8',
        }).addTo(layerGroup);
      }
      if (snapped) {
        line = L.polyline(path, {
          color: '#f9569b',
          weight: 4,
          opacity: 0.95,
          lineJoin: 'round',
          lineCap: 'round',
        }).addTo(layerGroup);
      }
    } else {
      line = L.polyline(linePoints, {
        color: '#f9569b',
        weight: 5,
        opacity: 0.95,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(layerGroup);
    }

    // Interactive maps get a marker per waypoint (draggable). View-only maps
    // only show start/finish — saved routes can be hundreds of road vertices.
    const markerPoints = interactive
      ? points
      : linePoints.length > 2
        ? [linePoints[0], linePoints[linePoints.length - 1]]
        : linePoints;

    markerPoints.forEach((point, index) => {
      const isStart = index === 0;
      const isEnd = index === markerPoints.length - 1;
      const marker = L.marker(point, {
        icon: isStart ? startIcon() : isEnd && !interactive ? finishIcon() : dotIcon(),
        draggable: interactive,
        keyboard: false,
      }).addTo(layerGroup);
      if (interactive) {
        marker.on('dragend', () => onPick?.('move', index, marker.getLatLng()));
      }
      markers.push(marker);
    });

    if (linePoints.length > 1) {
      map.fitBounds(L.latLngBounds(linePoints).pad(0.22), { animate: false });
    } else if (interactive && points.length > 1) {
      map.fitBounds(L.latLngBounds(snapped ? path : points).pad(0.22), { animate: false });
    } else if (interactive && points.length === 1) {
      map.setView(points[0], zoom, { animate: false });
    }
  }

  onMount(() => {
    map = L.map(container, {
      center,
      zoom,
      zoomControl: false,
      attributionControl: showAttribution,
      dragging: true,
      scrollWheelZoom: false,
      doubleClickZoom: !interactive,
      boxZoom: false,
      keyboard: false,
      tap: false,
      touchZoom: true,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
      className: 'trana-tiles',
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    // Drawing can be toggled after mount; check the current setting on click.
    map.on('click', (event) => {
      if (interactive) onPick?.('add', null, event.latlng);
    });

    layerGroup = L.layerGroup().addTo(map);
    draw();

    const observer = new ResizeObserver(() => map?.invalidateSize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      map?.remove();
      map = null;
    };
  });

  $effect(() => {
    // Redraw markers, the snapped path and map behaviour when they change.
    void points;
    void path;
    void interactive;
    if (map) {
      if (interactive) map.doubleClickZoom.disable();
      else map.doubleClickZoom.enable();
      draw();
    }
  });
</script>

<div class="relative overflow-hidden rounded-3xl border border-brand-100 {cls}" style="height:{height}px">
  <div bind:this={container} class="h-full w-full" class:cursor-crosshair={interactive}></div>
  {#if interactive && !points.length}
    <div class="pointer-events-none absolute inset-0 grid place-items-center">
      <div class="rounded-2xl bg-white/90 px-4 py-2 text-xs font-bold text-ink-500 shadow-soft">
        Tap the map to draw your route
      </div>
    </div>
  {/if}
  {@render children?.()}
</div>

<style>
  :global(.trana-tiles) {
    filter: saturate(1.05) brightness(1.02);
  }
  :global(.leaflet-container) {
    border-radius: 1.5rem;
  }
</style>
