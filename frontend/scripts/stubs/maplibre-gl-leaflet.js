// Test stub for @maplibre/maplibre-gl-leaflet.
//
// The real package mounts a full MapLibre GL canvas inside a Leaflet layer and
// needs WebGL, which happy-dom does not provide. This stub keeps the same
// public shape (`maplibreGL(options).addTo(map)`) so RouteMap's basemap branch
// is exercised without a GPU.

export function maplibreGL(options = {}) {
  const layer = {
    kind: 'maplibreGL',
    options,
    removed: false,
    addedTo: null,
    addTo(target) {
      this.addedTo = target;
      if (target && Array.isArray(target.children)) target.children.push(this);
      return this;
    },
    remove() {
      this.removed = true;
    },
    getMaplibreMap() {
      return null;
    },
  };
  return layer;
}

export class MaplibreGL {}

export default maplibreGL;
