const createdMaps = [];

export function getLeafletMaps() {
  return createdMaps;
}

function makeLayer(kind, data, options = {}) {
  const layer = {
    kind,
    data,
    options,
    removed: false,
    listeners: new Map(),
    on(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set());
      this.listeners.get(event).add(fn);
      return this;
    },
    addTo(target) {
      if (target && Array.isArray(target.children)) {
        target.children.push(this);
      }
      return this;
    },
    remove() {
      this.removed = true;
    },
    getLatLng() {
      return { lat: data?.[0] ?? 0, lng: data?.[1] ?? 0 };
    },
  };
  return layer;
}

const L = {
  map(container, options = {}) {
    const instance = {
      container,
      options,
      zoom: options.zoom ?? 13,
      center: options.center ?? [0, 0],
      layers: [],
      fittedBounds: [],
      doubleClickZoom: { enable() {}, disable() {} },
      invalidateSize() {},
      getZoom() { return this.zoom; },
      setView(target, z) {
        this.center = target;
        if (typeof z === 'number') this.zoom = z;
      },
      fitBounds(bounds, opts) {
        this.fittedBounds.push({ bounds, opts });
      },
      on() {},
      remove() {
        this.removed = true;
      },
    };
    createdMaps.push(instance);
    return instance;
  },
  tileLayer() {
    return { addTo() { return this; } };
  },
  control: {
    zoom() {
      return { addTo() { return this; } };
    },
  },
  layerGroup() {
    const group = {
      children: [],
      addTo(target) {
        target?.layers?.push(this);
        return this;
      },
    };
    return group;
  },
  polyline(points, options) {
    return makeLayer('polyline', points, options);
  },
  marker(point, options) {
    return makeLayer('marker', point, options);
  },
  divIcon(options) {
    return options;
  },
  latLngBounds(points) {
    return {
      points,
      pad() { return this; },
    };
  },
  DomEvent: {
    stopPropagation() {},
  },
};

export default L;
