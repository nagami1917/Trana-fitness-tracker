<script>
  import { onMount } from 'svelte';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { LoaderCircle, LocateFixed, Maximize2 } from 'lucide-svelte';
  import { MAP_STYLE_URL, MAP_TILE_URL, MAP_ATTRIBUTION } from '../../config/mapConfig.js';

  /**
   * Load the vector basemap stack on demand.
   *
   * Both MapLibre and the Leaflet bridge are far larger than this component,
   * and the preview maps render on Dashboard and Activities. Loading them in a
   * separate chunk keeps the ~300 KB gzip bill off those pages: the route
   * polyline draws immediately on the Leaflet canvas, then the basemap fades in
   * underneath when the chunk arrives.
   */
  async function loadVectorBasemap() {
    const [{ maplibreGL }] = await Promise.all([
      import('@maplibre/maplibre-gl-leaflet'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]);
    return (target) => maplibreGL({ style: MAP_STYLE_URL }).addTo(target);
  }

  let {
    points = [],
    path = [],
    plannedPath = [],
    live = false,
    height = 260,
    interactive = false,
    autoFit = undefined,
    center = [14.676, 121.0437],
    zoom = 13,
    userLocation = null, // [lat, lng] — blue-dot "you are here" indicator
    hoverCoord = null, // [lat, lng] — route scrub marker
    ghostPosition = null, // [lat, lng] — ghost pacer position
    routing = false,
    routeMode = 'roads', // 'roads' | 'straight'
    onPick = null,
    class: cls = '',
    showAttribution = true,
    children,
  } = $props();

  let container;
  let map;
  let layerGroup;
  let line;
  let casing;
  let guide;
  let locationMarker;
  let hoverMarker;
  let ghostMarker;
  let markers = [];
  let hasCenteredOnUser = false;
  let basemapLayer = null;

  const startIcon = () =>
    L.divIcon({
      className: '',
      html: '<span class="route-marker" style="display:grid;place-items:center;width:20px;height:20px;border-radius:9999px;background:#22c55e;color:#fff;font:800 10px/1 sans-serif;border:2.5px solid #fff;box-shadow:0 3px 10px rgba(34,197,94,.45)">S</span>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

  const finishIcon = () =>
    L.divIcon({
      className: '',
      html: '<span style="display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:conic-gradient(#3f2333 0 25%, #fff 0 50%, #3f2333 0 75%, #fff 0);border:2.5px solid #fff;box-shadow:0 4px 12px rgba(219,39,119,.45)"></span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });

  const stopIcon = (label) =>
    L.divIcon({
      className: '',
      html: `<span class="route-marker" style="display:grid;place-items:center;width:18px;height:18px;border-radius:9999px;background:#b7f34a;color:#fff;font:800 9px/1 sans-serif;border:2px solid #fff;box-shadow:0 2px 8px rgba(249,86,155,.45)">${label}</span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

  // Google-Maps-style blue dot for the device's current GPS position.
  const hereIcon = () =>
    L.divIcon({
      className: '',
      html:
        '<span style="display:block;width:18px;height:18px;border-radius:9999px;background:#3b82f6;border:3.5px solid #fff;box-shadow:0 0 0 6px rgba(59,130,246,.22),0 2px 8px rgba(0,0,0,.3)"></span>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

  const hoverIcon = () =>
    L.divIcon({
      className: '',
      html:
        '<span style="display:block;width:16px;height:16px;border-radius:9999px;background:#f59e0b;border:3px solid #fff;box-shadow:0 0 0 6px rgba(245,158,11,.28),0 2px 8px rgba(0,0,0,.35)"></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

  const ghostIcon = () =>
    L.divIcon({
      className: '',
      html:
        '<span style="display:grid;place-items:center;width:22px;height:22px;border-radius:9999px;background:#7c3aed;color:#fff;font:800 10px/1 sans-serif;border:2.5px solid #fff;box-shadow:0 0 0 6px rgba(124,58,237,.22),0 3px 10px rgba(0,0,0,.3)">G</span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });

  function isClosed(pts) {
    if (!Array.isArray(pts) || pts.length < 3) return false;
    const a = pts[0];
    const b = pts[pts.length - 1];
    return Math.abs(a[0] - b[0]) < 0.00025 && Math.abs(a[1] - b[1]) < 0.00025;
  }

  export function fitRouteBounds() {
    if (!map) return;
    map.invalidateSize?.(false);
    const target = Array.isArray(path) && path.length > 1 ? path : points;
    if (!Array.isArray(target) || target.length === 0) return;
    if (target.length === 1) {
      map.setView(target[0], Math.max(map.getZoom?.() ?? zoom, 15), { animate: true });
      return;
    }
    map.fitBounds(L.latLngBounds(target).pad(0.2), { animate: true });
  }

  export function focusPoint(latlng, targetZoom = 16) {
    if (!map || !Array.isArray(latlng) || latlng.length < 2) return;
    map.invalidateSize?.(false);
    const currentZoom = typeof map.getZoom === 'function' ? map.getZoom() : zoom;
    map.setView(latlng, Math.max(currentZoom, targetZoom), { animate: true });
  }

  function clearLayers() {
    markers.forEach((m) => m.remove());
    markers = [];
    if (line) {
      line.remove();
      line = null;
    }
    if (casing) {
      casing.remove();
      casing = null;
    }
    if (guide) {
      guide.remove();
      guide = null;
    }
  }

  function draw() {
    if (!map || !layerGroup) return;
    clearLayers();

    const snapped = Array.isArray(path) && path.length > 1;
    const hasPlanned = Array.isArray(plannedPath) && plannedPath.length > 1;
    const linePoints = interactive ? [] : snapped ? path : points;
    if (!interactive && !linePoints.length && !hasPlanned) return;
    if (interactive && !points?.length && !snapped) return;

    if (interactive) {
      if (snapped) {
        casing = L.polyline(path, {
          color: '#ffffff',
          weight: 7.5,
          opacity: 0.9,
          lineJoin: 'round',
          lineCap: 'round',
        }).addTo(layerGroup);
        line = L.polyline(path, {
          color: '#b7f34a',
          weight: 4.5,
          opacity: 0.96,
          lineJoin: 'round',
          lineCap: 'round',
        }).addTo(layerGroup);
      } else if (points.length > 1) {
        guide = L.polyline(points, {
          color: '#b7f34a',
          weight: 3.5,
          opacity: 0.9,
          lineJoin: 'round',
          lineCap: 'round',
          dashArray: '6 8',
        }).addTo(layerGroup);
      }
    } else {
      if (hasPlanned) {
        guide = L.polyline(plannedPath, {
          color: '#5fd4e8',
          weight: 3.5,
          opacity: linePoints.length > 1 ? 0.55 : 0.85,
          lineJoin: 'round',
          lineCap: 'round',
          dashArray: '6 8',
        }).addTo(layerGroup);
      }
      if (linePoints.length > 1) {
        casing = L.polyline(linePoints, {
          color: '#ffffff',
          weight: 7.5,
          opacity: 0.85,
          lineJoin: 'round',
          lineCap: 'round',
        }).addTo(layerGroup);
        line = L.polyline(linePoints, {
          color: '#b7f34a',
          weight: 4.5,
          opacity: 0.96,
          lineJoin: 'round',
          lineCap: 'round',
        }).addTo(layerGroup);
      }
    }

    // Interactive maps get a draggable marker per waypoint (click to remove).
    // View-only maps show Start / Finish (or Start only while live-tracking).
    const markerPoints = interactive
      ? points
      : live && linePoints.length > 0
        ? [linePoints[0]]
        : linePoints.length > 2
          ? [linePoints[0], linePoints[linePoints.length - 1]]
          : linePoints;

    const closed = isClosed(markerPoints);

    markerPoints.forEach((point, index) => {
      const isStart = index === 0;
      const isEnd = index === markerPoints.length - 1 && markerPoints.length > 1;
      const icon = isStart
        ? startIcon()
        : isEnd && (!interactive || !closed)
          ? finishIcon()
          : stopIcon(String(index + 1));

      const marker = L.marker(point, {
        icon,
        draggable: interactive,
        keyboard: false,
        zIndexOffset: isStart ? 200 : isEnd ? 150 : 100,
        title: interactive
          ? `${isStart ? 'Start' : isEnd ? 'Destination' : `Stop ${index + 1}`} — drag to adjust, click to remove`
          : undefined,
      }).addTo(layerGroup);

      if (interactive) {
        marker.on('dragend', () => onPick?.('move', index, marker.getLatLng()));
        marker.on('click', (event) => {
          L.DomEvent?.stopPropagation?.(event);
          onPick?.('remove', index, marker.getLatLng());
        });
      }
      markers.push(marker);
    });

    // Only auto-fit bounds when autoFit is enabled (default: read-only views)
    // so drawing or pausing to pan never hijacks the athlete's current zoom.
    const shouldFit = autoFit ?? !interactive;
    const fitTarget = linePoints.length > 0 ? linePoints : hasPlanned ? plannedPath : [];
    if (shouldFit && fitTarget.length > 1) {
      map.fitBounds(L.latLngBounds(fitTarget).pad(0.22), { maxZoom: 16, animate: false });
    } else if (shouldFit && fitTarget.length === 1) {
      map.setView(fitTarget[0], Math.max(map.getZoom?.() ?? zoom, 15), { animate: false });
    }
  }

  /**
   * Current-position blue dot ("you are here" indicator).
   * Recenters at most once initially when no route is shown so subsequent GPS
   * updates never pull the camera away while planning across town.
   */
  function drawLocation() {
    if (!map || !layerGroup) return;
    if (locationMarker) {
      locationMarker.remove();
      locationMarker = null;
    }
    const valid =
      Array.isArray(userLocation) &&
      userLocation.length === 2 &&
      Number.isFinite(userLocation[0]) &&
      Number.isFinite(userLocation[1]);
    if (!valid) return;
    locationMarker = L.marker(userLocation, {
      icon: hereIcon(),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000,
    }).addTo(layerGroup);

    const snapped = Array.isArray(path) && path.length > 1;
    const hasPlanned = Array.isArray(plannedPath) && plannedPath.length > 1;
    const hasRouteView = snapped || hasPlanned || (Array.isArray(points) && points.length > 0);
    if ((!hasRouteView && !hasCenteredOnUser) || (live && !hasRouteView)) {
      hasCenteredOnUser = true;
      map.setView(userLocation, Math.max(zoom, 15), { animate: false });
    }
  }

  onMount(() => {
    map = L.map(container, {
      center,
      zoom,
      zoomControl: false,
      attributionControl: showAttribution ? { prefix: false } : false,
      dragging: true,
      scrollWheelZoom: false,
      doubleClickZoom: !interactive,
      boxZoom: false,
      keyboard: false,
      tap: false,
      touchZoom: true,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Basemap. Default is OpenFreeMap vector tiles through MapLibre, which
    // needs no key and no volume limit, so the preview maps cannot run into
    // OpenStreetMap's tile-server usage policy.
    //
    // MapLibre is imported lazily on purpose: these previews are small and
    // RouteMap is used on Dashboard and Activities, which must not pay ~300 KB
    // of gzip for a 214 px thumbnail. Set VITE_MAP_TILE_URL to use a raster
    // provider instead — its URL must carry its own {s}/{z}/{x}/{y}.
    if (MAP_TILE_URL) {
      L.tileLayer(MAP_TILE_URL, {
        maxZoom: 19,
        attribution: MAP_ATTRIBUTION,
        className: 'trana-tiles',
      }).addTo(map);
    } else {
      void loadVectorBasemap()
        .then((mount) => {
          if (!map) return; // torn down before the chunk arrived
          basemapLayer = mount(map) ?? null;
        })
        .catch(() => {
          // Offline or the chunk failed to load: the route line still draws on
          // the plain container background, so the preview degrades quietly.
        });
    }
    map.on('click', (event) => {
      if (interactive) onPick?.('add', null, event.latlng);
    });

    layerGroup = L.layerGroup().addTo(map);
    draw();

    const observer = new ResizeObserver(() => map?.invalidateSize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      // Tear the GL layer down explicitly: it owns a separate canvas and a
      // requestAnimationFrame loop that outlive the Leaflet map otherwise.
      try {
        basemapLayer?.remove?.();
      } catch {
        // Already removed with the parent map.
      }
      basemapLayer = null;
      map?.remove();
      map = null;
    };
  });

  $effect(() => {
    void points;
    void path;
    void plannedPath;
    void live;
    void interactive;
    if (map) {
      if (interactive) map.doubleClickZoom.disable();
      else map.doubleClickZoom.enable();
      draw();
    }
  });

  $effect(() => {
    void userLocation;
    drawLocation();
  });

  $effect(() => {
    const coord = hoverCoord;
    if (!map || !layerGroup) return;
    if (hoverMarker) {
      hoverMarker.remove();
      hoverMarker = null;
    }
    if (Array.isArray(coord) && coord.length === 2 && Number.isFinite(coord[0]) && Number.isFinite(coord[1])) {
      hoverMarker = L.marker(coord, {
        icon: hoverIcon(),
        interactive: false,
        keyboard: false,
        zIndexOffset: 950,
      }).addTo(layerGroup);
    }
  });

  $effect(() => {
    const coord = ghostPosition;
    if (!map || !layerGroup) return;
    if (ghostMarker) {
      ghostMarker.remove();
      ghostMarker = null;
    }
    if (Array.isArray(coord) && coord.length === 2 && Number.isFinite(coord[0]) && Number.isFinite(coord[1])) {
      ghostMarker = L.marker(coord, {
        icon: ghostIcon(),
        interactive: false,
        keyboard: false,
        zIndexOffset: 900,
      }).addTo(layerGroup);
    }
  });

  const hasValidUserLocation = $derived(
    Array.isArray(userLocation) &&
    userLocation.length === 2 &&
    Number.isFinite(userLocation[0]) &&
    Number.isFinite(userLocation[1]),
  );
</script>

<div class="relative overflow-hidden rounded-3xl border border-brand-100 {cls}" style="height:{height}px">
  <div bind:this={container} class="relative isolate z-0 h-full w-full" class:cursor-crosshair={interactive}></div>

  {#if interactive && !points.length}
    <div class="pointer-events-none absolute inset-0 z-10 grid place-items-center px-4 text-center">
      <div class="rounded-2xl bg-white/92 px-4 py-2.5 text-xs font-bold text-ink-600 shadow-soft backdrop-blur-sm">
        {routeMode === 'roads'
          ? 'Tap Start, then tap Destination — TRANA follows the roads & paths'
          : 'Tap anywhere on the map to plot straight points'}
      </div>
    </div>
  {:else if interactive && points.length === 1}
    <div class="pointer-events-none absolute left-3 top-3 right-14 z-10">
      <div class="inline-flex max-w-full items-center gap-1.5 rounded-2xl bg-white/95 px-3 py-1.5 text-[11px] font-bold text-ink-600 shadow-soft sm:rounded-full">
        <span class="h-2 w-2 shrink-0 rounded-full bg-emerald-500"></span>
        <span>{routeMode === 'roads'
          ? 'Now tap your Destination to auto-follow roads'
          : 'Now tap your next point'}</span>
      </div>
    </div>
  {/if}

  {#if routing}
    <div class="pointer-events-none absolute left-3 top-3 z-20">
      <div class="inline-flex items-center gap-1.5 rounded-full bg-ink-900/85 px-3 py-1.5 text-[11px] font-bold text-white shadow-soft">
        <LoaderCircle size={12} class="animate-spin text-brand-300" />
        Following roads & paths…
      </div>
    </div>
  {/if}

  {#if (interactive || autoFit === false) && (hasValidUserLocation || points.length > 1 || path.length > 1)}
    <div class="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
      {#if points.length > 1 || path.length > 1}
        <button
          type="button"
          class="grid h-8 w-8 place-items-center rounded-xl border border-brand-100 bg-white/95 text-ink-600 shadow-soft transition hover:bg-brand-50 hover:text-brand-600"
          title="Fit whole route in view"
          aria-label="Fit whole route in view"
          onclick={(e) => {
            e.stopPropagation();
            fitRouteBounds();
          }}
        >
          <Maximize2 size={14} />
        </button>
      {/if}
      {#if hasValidUserLocation}
        <button
          type="button"
          class="grid h-8 w-8 place-items-center rounded-xl border border-brand-100 bg-white/95 text-ink-600 shadow-soft transition hover:bg-brand-50 hover:text-brand-600"
          title="Center on my GPS location"
          aria-label="Center on my GPS location"
          onclick={(e) => {
            e.stopPropagation();
            focusPoint(userLocation, 16);
          }}
        >
          <LocateFixed size={14} />
        </button>
      {/if}
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
  /* Keep the required basemap credit readable without covering the route:
     small, translucent, and never wider than the map itself. */
  :global(.leaflet-control-attribution) {
    max-width: calc(100% - 1rem);
    padding: 0 4px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.82);
    color: #475569;
    font-size: 9px;
    line-height: 1.5;
    white-space: normal;
    text-align: right;
  }
  :global(.leaflet-control-attribution a) {
    color: #b7f34a;
  }
  :global(.theme-dark .leaflet-control-attribution) {
    background: rgba(15, 19, 29, 0.82);
    color: #94a3b8;
  }
</style>
