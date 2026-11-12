let workerUrl = '';
const createdMaps = [];

export function setWorkerUrl(value) {
  workerUrl = value || '';
}

export function getWorkerUrl() {
  return workerUrl;
}

export function getCreatedMaps() {
  return createdMaps;
}

export class Map {
  constructor(options = {}) {
    this.options = options;
    this.workerUrlAtCreate = workerUrl;
    this.style = { _loaded: false };
    this.sources = new globalThis.Map();
    this.layers = [];
    this.markers = [];
    this.listeners = new globalThis.Map();
    this.canvas = { style: {} };
    createdMaps.push(this);
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
  }

  once(event, fn) {
    const wrapper = (payload) => {
      this.off(event, wrapper);
      fn(payload);
    };
    this.on(event, wrapper);
  }

  off(event, fn) {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event, payload = {}) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }

  isStyleLoaded() {
    // Deliberately false even after style._loaded is true to mimic streaming OSM raster tiles.
    return false;
  }

  getZoom() { return 14; }
  getCanvas() { return this.canvas; }
  addControl() {}
  resize() {}
  easeTo() {}
  fitBounds() {}
  zoomIn() {}
  zoomOut() {}

  getSource(id) {
    return this.sources.get(id) ?? null;
  }

  addSource(id, def) {
    const cloned = structuredClone(def.data);
    const source = {
      id,
      type: def.type,
      data: cloned,
      setData(nextData) {
        this.data = structuredClone(nextData);
      },
    };
    this.sources.set(id, source);
    return source;
  }

  removeSource(id) {
    this.sources.delete(id);
  }

  getLayer(id) {
    return this.layers.find((layer) => layer.id === id) ?? null;
  }

  addLayer(def, beforeId) {
    const copy = {
      ...def,
      layout: { ...(def.layout ?? {}) },
      paint: { ...(def.paint ?? {}) },
    };
    if (beforeId) {
      const idx = this.layers.findIndex((layer) => layer.id === beforeId);
      if (idx !== -1) {
        this.layers.splice(idx, 0, copy);
        return;
      }
    }
    this.layers.push(copy);
  }

  removeLayer(id) {
    this.layers = this.layers.filter((layer) => layer.id !== id);
  }

  setLayoutProperty(id, prop, value) {
    const layer = this.getLayer(id);
    if (layer) layer.layout[prop] = value;
  }

  setPaintProperty(id, prop, value) {
    const layer = this.getLayer(id);
    if (layer) {
      if (value === undefined || value === null) delete layer.paint[prop];
      else layer.paint[prop] = value;
    }
  }

  remove() {
    this.removed = true;
    this.markers = [];
    this.layers = [];
    this.sources.clear();
  }
}

export class Marker {
  constructor(options = {}) {
    this.options = options;
    this.element = options.element ?? null;
    this.lngLat = null;
    this.map = null;
  }

  setLngLat(coords) {
    this.lngLat = Array.isArray(coords) ? { lng: coords[0], lat: coords[1] } : coords;
    return this;
  }

  getLngLat() {
    return this.lngLat ?? { lat: 0, lng: 0 };
  }

  on() { return this; }

  addTo(map) {
    this.map = map;
    if (map?.markers && !map.markers.includes(this)) {
      map.markers.push(this);
    }
    return this;
  }

  remove() {
    if (this.map?.markers) {
      this.map.markers = this.map.markers.filter((m) => m !== this);
    }
    this.map = null;
  }
}

export class AttributionControl {}

export class LngLatBounds {
  constructor() {
    this.points = [];
  }
  extend(pt) {
    this.points.push(pt);
  }
  isEmpty() {
    return this.points.length === 0;
  }
}

export default {
  Map,
  Marker,
  AttributionControl,
  LngLatBounds,
  setWorkerUrl,
  getWorkerUrl,
  getCreatedMaps,
};
