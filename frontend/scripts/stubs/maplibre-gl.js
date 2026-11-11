export class Map {
  constructor() {}
  on() {}
  once() {}
  remove() {}
  resize() {}
  addControl() {}
  isStyleLoaded() { return false; }
  getZoom() { return 14; }
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
}

export class Marker {
  setLngLat() { return this; }
  addTo() { return this; }
  remove() {}
}

export class AttributionControl {}

export class LngLatBounds {
  extend() {}
  isEmpty() { return true; }
}

export default { Map, Marker, AttributionControl, LngLatBounds };
