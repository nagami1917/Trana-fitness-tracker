/**
 * Minimal Leaflet stand-in for headless DOM smoke tests.
 * Covers only the API surface TRANA's map components touch.
 */

const layer = () => ({
  addTo() { return this; },
  remove() { return this; },
  removeLayer() { return this; },
  addLayer() { return this; },
  setLatLngs() { return this; },
  setStyle() { return this; },
  bindPopup() { return this; },
  on() { return this; },
  off() { return this; },
  getLatLng() { return { lat: 0, lng: 0 }; },
  setIcon() { return this; },
});

export default {
  map: () => ({
    setView() { return this; },
    on() { return this; },
    off() { return this; },
    remove() { return this; },
    invalidateSize() { return this; },
    fitBounds() { return this; },
    getZoom() { return 13; },
    setZoom() { return this; },
    doubleClickZoom: { enable() { return this; }, disable() { return this; } },
    scrollWheelZoom: { enable() { return this; }, disable() { return this; } },
  }),
  tileLayer: () => layer(),
  marker: () => layer(),
  polyline: () => layer(),
  circleMarker: () => layer(),
  divIcon: (options = {}) => ({ options }),
  layerGroup: () => layer(),
  latLngBounds: (points) => ({
    pad() { return this; },
    getCenter() { return { lat: 0, lng: 0 }; },
    points: points ?? [],
  }),
  control: {
    zoom: () => ({ addTo() { return this; } }),
  },
};

export const map = () => ({});
