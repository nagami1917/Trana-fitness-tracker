/**
 * Route Planner & MapLibre worker bundling regression test.
 *
 *   node scripts/route-planner-smoke.mjs
 *
 * Verifies:
 * 1. Vite bundles maplibre-gl's dedicated Web Worker asset instead of leaving
 *    MapLibre's broken runtime `./maplibre-gl-worker.mjs` fallback (which fails
 *    with HTML MIME errors behind SPA rewrites and wipes out GeoJSON lines).
 * 2. The emitted worker asset instantiates cleanly in a WorkerGlobalScope and
 *    registers GeoJSON source/tile handlers.
 * 3. TranaMap sets MapLibre's worker URL before creating the Map instance and
 *    forwards MapLibre worker/GeoJSON errors (while ignoring noisy OSM tile errors).
 * 4. PlannedRoute renders solid vs dashed route layers cleanly after style.load
 *    (even while `isStyleLoaded()` stays false during tile streaming) and unwraps
 *    Svelte `$state` proxies so `structuredClone` (`postMessage`) never fails.
 */

import assert from 'node:assert/strict';
import vm from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const bundle = await build({
  root,
  configFile: false,
  envFile: false,
  logLevel: 'silent',
  plugins: [svelte()],
  resolve: {
    alias: [
      { find: /^maplibre-gl\/dist\/maplibre-gl\.css$/, replacement: resolve(root, 'scripts/stubs/empty.css') },
      { find: /^maplibre-gl$/, replacement: resolve(root, 'scripts/stubs/maplibre-gl-interactive.js') },
    ],
  },
  build: {
    write: false,
    minify: false,
    lib: {
      entry: resolve(root, 'scripts/stubs/route-planner-entry.js'),
      name: 'RoutePlannerTest',
      formats: ['iife'],
    },
  },
});

const outputs = Array.isArray(bundle) ? bundle[0].output : bundle.output;
const chunk = outputs.find((entry) => entry.type === 'chunk');
const workerAsset = outputs.find(
  (entry) => entry.type === 'asset' && /^assets\/maplibre-gl-worker-.*\.js$/.test(entry.fileName),
);

assert.ok(chunk?.code, 'Expected compiled test bundle chunk');
assert.ok(workerAsset, 'Vite must bundle maplibre-gl-worker-*.js when TranaMap is built');

// Verify the built worker script itself executes and registers GeoJSON handlers.
const workerPorts = [];
class UnrefMessageChannel extends MessageChannel {
  constructor() {
    super();
    this.port1.unref?.();
    this.port2.unref?.();
    workerPorts.push(this.port1, this.port2);
  }
}

const workerCtx = vm.createContext({
  addEventListener() {},
  postMessage() {},
  setTimeout: (fn, ms, ...args) => {
    const t = setTimeout(fn, ms, ...args);
    t.unref?.();
    return t;
  },
  clearTimeout,
  URL,
  performance,
  TextDecoder,
  TextEncoder,
  MessageChannel: UnrefMessageChannel,
  location: {
    origin: 'https://trana-web.vercel.app',
    href: `https://trana-web.vercel.app/${workerAsset.fileName}`,
  },
});
vm.runInContext(
  'function WorkerGlobalScope(){}; this.self = this; this.WorkerGlobalScope = WorkerGlobalScope; Object.setPrototypeOf(this, WorkerGlobalScope.prototype);',
  workerCtx,
);
vm.runInContext(String(workerAsset.source), workerCtx);
assert.ok(workerCtx.worker, 'Emitted MapLibre worker must instantiate self.worker');
assert.ok(workerCtx.worker.actor?.messageHandlers?.LD, 'Emitted MapLibre worker must register GeoJSON loadData (LD)');
assert.ok(workerCtx.worker.actor?.messageHandlers?.LT, 'Emitted MapLibre worker must register GeoJSON loadTile (LT)');

// Exercise TranaMap + PlannedRoute in a real Svelte 5 DOM via happy-dom.
const window = new Window({ url: 'https://trana-web.vercel.app/plan' });
const { document } = window;
window.structuredClone = globalThis.structuredClone;
document.body.innerHTML = '<div id="app"></div>';

const errorReports = [];
window.fetch = async (url, init = {}) => {
  if (String(url).includes('/api/client-errors')) {
    errorReports.push(JSON.parse(init.body));
    return { ok: true, status: 201, text: async () => '{}' };
  }
  return { ok: true, status: 200, json: async () => ({ elements: [] }), text: async () => '{}' };
};

window.eval(chunk.code);
const harness = window.__routePlannerTest;

try {
  harness.flush();
  const map = harness.getMap();
  assert.ok(map, 'TranaMap must construct a MapLibre Map instance');
  assert.match(
    map.workerUrlAtCreate,
    /maplibre-gl-worker-.*\.js$/,
    'TranaMap must call maplibregl.setWorkerUrl(...) with the bundled worker URL before creating Map',
  );

  // Simulate base style finishing load even while isStyleLoaded() stays false (OSM tiles streaming).
  map.style._loaded = true;
  map.emit('style.load');
  harness.flush();

  // 1. Straight-line / pre-snap guide (dashed = true) with reactive Svelte $state objects.
  const straightGeo = {
    type: 'Feature',
    properties: { activity_type: 'run' },
    geometry: {
      type: 'LineString',
      coordinates: [
        [121.035, 14.676],
        [121.051, 14.671],
      ],
    },
  };
  harness.setState({
    plannedRoute: straightGeo,
    plannedWaypoints: [
      [14.676, 121.035],
      [14.671, 121.051],
    ],
    routeDashed: true,
    showRoads: true,
  });

  const src1 = map.getSource('trana-planned-route');
  assert.ok(src1, 'PlannedRoute must create trana-planned-route GeoJSON source');
  assert.equal(src1.data.features[0].geometry.coordinates.length, 2);
  assert.equal(map.getLayer('trana-planned-route-dashed')?.layout.visibility, 'visible');
  assert.equal(map.getLayer('trana-planned-route-line')?.layout.visibility, 'none');
  assert.equal(map.markers.length, 2);
  assert.equal(map.markers[0].element.textContent, 'S');

  // RoadLayer must stay underneath the planned route casing so it never obscures the route line.
  const roadIdx = map.layers.findIndex((l) => l.id === 'trana-road-layer');
  const casingIdx = map.layers.findIndex((l) => l.id === 'trana-planned-route-casing');
  assert.ok(roadIdx !== -1 && casingIdx !== -1 && roadIdx < casingIdx, 'RoadLayer must render beneath planned route layers');

  // 2. Road-snapped route arrives -> solid polyline becomes visible, dashed hides.
  const snappedGeo = {
    type: 'Feature',
    properties: { activity_type: 'run' },
    geometry: {
      type: 'LineString',
      coordinates: [
        [121.035, 14.676],
        [121.041, 14.675],
        [121.046, 14.673],
        [121.051, 14.671],
      ],
    },
  };
  harness.setState({
    plannedRoute: snappedGeo,
    routeDashed: false,
  });

  assert.equal(src1.data.features[0].geometry.coordinates.length, 4);
  assert.equal(map.getLayer('trana-planned-route-line')?.layout.visibility, 'visible');
  assert.equal(map.getLayer('trana-planned-route-dashed')?.layout.visibility, 'none');

  // 3. Clearing the route empties the GeoJSON source and clears markers cleanly.
  harness.setState({
    plannedRoute: null,
    plannedWaypoints: [],
    routeDashed: false,
  });
  assert.equal(src1.data.features.length, 0);
  assert.equal(map.markers.length, 0);

  // 4. MapLibre error reporting ignores tile noise ('osm') but reports worker/GeoJSON failures.
  map.emit('error', { sourceId: 'osm', error: new Error('tile 429') });
  map.emit('error', { error: new Error('Failed to load maplibre worker script') });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(errorReports.length, 1);
  assert.match(errorReports[0].message, /MapLibre: Failed to load maplibre worker script/);

  await harness.destroy();
  console.log('Route planner worker & PlannedRoute layer checks passed ✔');
} finally {
  for (const port of workerPorts) port.close?.();
  await window.happyDOM.abort();
}
