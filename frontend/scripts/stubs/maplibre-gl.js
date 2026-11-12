let workerUrl = '';

export function setWorkerUrl(value) {
  workerUrl = value || '';
}

export function getWorkerUrl() {
  return workerUrl;
}

export class Map {
  constructor() {}
  on() {}
  once() {}
  off() {}
  remove() {}
  resize() {}
  addControl() {}
  isStyleLoaded() { return false; }
  getZoom() { return 14; }
  getCanvas() { return { style: {} }; }
  easeTo() {}
  fitBounds() {}
  zoomIn() {}
  zoomOut() {}
  getLayer() { return null; }
  getSource() { return null; }
  addSource() {}
  addLayer() {}
  removeLayer() {}
  removeSource() {}
  setPaintProperty() {}
  setLayoutProperty() {}
}

export class Marker {
  setLngLat() { return this; }
  getLngLat() { return { lat: 0, lng: 0 }; }
  on() { return this; }
  addTo() { return this; }
  remove() {}
}

export class AttributionControl {}

export class LngLatBounds {
  extend() {}
  isEmpty() { return true; }
}

export default {
  Map,
  Marker,
  AttributionControl,
  LngLatBounds,
  setWorkerUrl,
  getWorkerUrl,
};
