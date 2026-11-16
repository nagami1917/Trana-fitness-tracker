// Minimal Leaflet stand-in for smoke tests.
//
// RouteMap.svelte now mounts a MapLibre GL layer (via
// @maplibre/maplibre-gl-leaflet) instead of a raw OSM raster tile layer, so
// this stub needs the handful of Leaflet members that path touches and
// nothing more. See leaflet-interactive.js for the instrumented variant.

function makeLayer(kind, data, options = {}) {
  return {
    kind,
    data,
    options,
    removed: false,
    addTo(target) {
      if (target && Array.isArray(target.children)) target.children.push(this);
      return this;
    },
    remove() {
      this.removed = true;
    },
    getLatLng() {
      return { lat: data?.[0] ?? 0, lng: data?.[1] ?? 0 };
    },
  };
}

function makeMap(container, options = {}) {
  return {
    container,
    options,
    zoom: options.zoom ?? 13,
    center: options.center ?? [0, 0],
    children: [],
    invalidateSize() {},
    getZoom() {
      return this.zoom;
    },
    setView(target, z) {
      this.center = target;
      if (typeof z === 'number') this.zoom = z;
      return this;
    },
    on() {},
    off() {},
    remove() {},
    whenReady(fn) {
      if (typeof fn === 'function') fn();
      return this;
    },
  };
}

const L = {
  map: makeMap,
  tileLayer: (url, options) => makeLayer('tileLayer', url, options),
  layerGroup: () => makeLayer('layerGroup'),
  marker: (latlng, options) => makeLayer('marker', latlng, options),
  polyline: (latlngs, options) => makeLayer('polyline', latlngs, options),
  circleMarker: (latlng, options) => makeLayer('circleMarker', latlng, options),
  divIcon: (options) => ({ options }),
  latLngBounds: (a) => ({
    extend() {
      return this;
    },
    isValid() {
      return true;
    },
  }),
  control: {
    zoom: () => ({ addTo() { return this; } }),
    attribution: () => ({ addTo() { return this; } }),
  },
};

export const map = L.map;
export const tileLayer = L.tileLayer;

export default L;
