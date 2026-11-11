/**
 * Draw-test: the map route-drawing pipeline, offline.
 *
 * Exercises the two services behind "tap the map → get a route" —
 * roadSnappingService (GPS point → nearest OSM road) and roadRoutingService
 * (waypoints → road-following path) — with fully mocked HTTP. No real
 * coordinates leave the machine and no external API is contacted.
 *
 * Contract under test: every failure mode resolves to null / the original
 * point so the UI keeps its straight-line fallback; the success path snaps
 * onto the segment the mock road describes.
 */
import assert from 'node:assert/strict';
import {
  routingEnabled,
  autoRoutingAvailable,
  profileFor,
  waypointsFromPath,
  routeThroughRoads,
  buildOrsPayload,
  decodePolyline6,
  isClosedLoop,
  outAndBackWaypoints,
  closeLoopWaypoints,
  reverseWaypoints,
  pathToGeoJson,
  searchPlaces,
} from '../src/services/roadRoutingService.js';
import { snapToRoad, snapPointsToRoads } from '../src/services/roadSnappingService.js';
import { ROAD_SNAPPING, ROUTING } from '../src/config/mapConfig.js';

const realFetch = globalThis.fetch;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

/** Install a fetch mock for the duration of `fn`, always restoring. */
async function withFetch(mock, fn) {
  globalThis.fetch = mock;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------------------------------------------------------------- routing

// Activity type → ORS profile mapping (drives the URL path in production).
assert.equal(profileFor('run'), 'foot-walking');
assert.equal(profileFor('walk'), 'foot-walking');
assert.equal(profileFor('hike'), 'foot-hiking');
assert.equal(profileFor('ride'), 'cycling-regular');
assert.equal(profileFor('unknown-sport'), ROUTING.defaultProfile, 'unknown types fall back');
assert.equal(ROUTING.profiles.run, ROUTING.profiles.walk, 'run and walk share the walking profile');

// Without a build-time ORS key the service must never hit the network —
// the planner keeps straight lines. (CI and this smoke run keyless; if a
// developer has VITE_ORS_API_KEY exported the live-call path is theirs to
// exercise manually, not ours to hit here.)
if (!routingEnabled()) {
  let calls = 0;
  await withFetch(async () => { calls += 1; return json({}); }, async () => {
    const path = await routeThroughRoads([[14.6, 121.0], [14.61, 121.01]], 'run');
    assert.equal(path, null, 'no key → null → straight-line fallback');
    assert.equal(calls, 0, 'no key → zero network calls');
    assert.equal(await routeThroughRoads([[14.6, 121.0]], 'run'), null, 'lone waypoint → null');
    assert.equal(await routeThroughRoads('not-a-list', 'run'), null, 'garbage input → null');
  });
}

// Waypoint thinning: a dense drawn path becomes ≤12 draggable waypoints,
// first and last always preserved, copies not aliases.
assert.deepEqual(waypointsFromPath([]), []);
assert.deepEqual(waypointsFromPath(null), []);
const shortPath = [[14.6, 121.0], [14.61, 121.01]];
const thinned = waypointsFromPath(shortPath, 12);
assert.equal(thinned.length, 2);
assert.deepEqual(thinned, shortPath);
thinned[0][0] = 99;
assert.equal(shortPath[0][0], 14.6, 'output rows are copies, not aliases');

const dense = Array.from({ length: 100 }, (_, i) => [14.6 + i * 0.001, 121.0 + i * 0.001]);
const waypoints = waypointsFromPath(dense, 12);
assert.equal(waypoints.length, 12, 'dense path thins to the waypoint budget');
assert.deepEqual(waypoints[0], dense[0], 'first point preserved');
assert.deepEqual(waypoints[11], dense[99], 'last point preserved');
for (let i = 1; i < waypoints.length; i += 1) {
  assert.ok(waypoints[i][0] > waypoints[i - 1][0], 'waypoints stay in path order');
}

// ---------------------------------------------------------------- snapping

// Fixture: one east–west road at lat 14.6000. Overpass geometry uses `lon`.
const roadAt = (lat, lonA, lonB) => ({
  type: 'way',
  geometry: [
    { lat, lon: lonA },
    { lat, lon: lonB },
  ],
});
const OVERPASS_URL = ROAD_SNAPPING.overpassUrl;

// 1. Success: point ~55 m north of the road snaps onto it (dist < threshold).
{
  let body = null;
  const result = await withFetch(async (url, options) => {
    assert.equal(url, OVERPASS_URL, 'queries the configured Overpass endpoint');
    assert.equal(options.method, 'POST');
    body = JSON.parse(options.body);
    return json({ elements: [roadAt(14.6, 120.999, 121.001)] });
  }, () => snapToRoad(14.6005, 121.0));

  assert.ok(body.query.includes(`around:${ROAD_SNAPPING.maxSearchRadiusM},14.6005,121`), 'query uses the configured radius');
  assert.ok(body.query.includes('highway'), 'query filters to road ways');
  assert.ok(result, 'nearby road snaps');
  assert.equal(result.snapped, true);
  assert.ok(Math.abs(result.lat - 14.6) < 1e-4, `snapped onto the road lat (got ${result.lat})`);
  assert.ok(Math.abs(result.lng - 121.0) < 1e-4, `snapped onto the road lng (got ${result.lng})`);
  assert.ok(result.distM > 40 && result.distM < 70, `distM ≈55 m (got ${result.distM})`);
}

// 2. HTTP error → null (raw point kept).
{
  const result = await withFetch(async () => json({ error: 'busy' }, 504), () => snapToRoad(14.6005, 121.0));
  assert.equal(result, null, 'Overpass 5xx → null');
}

// 3. No roads nearby → null.
{
  const result = await withFetch(async () => json({ elements: [] }), () => snapToRoad(14.6005, 121.0));
  assert.equal(result, null, 'empty result → null');
}

// 4. Nearest road beyond the snap threshold → null (keep raw point).
{
  const result = await withFetch(
    async () => json({ elements: [roadAt(14.5, 120.999, 121.001)] }), // ~11 km away
    () => snapToRoad(14.6005, 121.0),
  );
  assert.equal(result, null, `road beyond ${ROAD_SNAPPING.snapThresholdM} m → null`);
}

// 5. Network failure → null (never throws at the caller).
{
  const result = await withFetch(async () => { throw new TypeError('fetch failed'); }, () => snapToRoad(14.6005, 121.0));
  assert.equal(result, null, 'fetch failure → null');
}

// 6. Batch snapping: successes snap, failures keep the original point.
{
  let call = 0;
  const result = await withFetch(async (_url, options) => {
    call += 1;
    const query = JSON.parse(options.body).query;
    if (query.includes('14.6005,121')) {
      return json({ elements: [roadAt(14.6, 120.999, 121.001)] }); // point A: near road
    }
    return json({ elements: [] }); // point B: nowhere near a road
  }, () => snapPointsToRoads([
    { lat: 14.6005, lng: 121.0 },
    { lat: 14.9, lng: 121.5 },
  ]));

  assert.equal(call, 2, 'processes points sequentially');
  assert.equal(result.length, 2);
  assert.equal(result[0].snapped, true, 'first point snapped');
  assert.ok(Math.abs(result[0].lat - 14.6) < 1e-4);
  assert.deepEqual(
    { lat: result[1].lat, lng: result[1].lng, snapped: result[1].snapped },
    { lat: 14.9, lng: 121.5, snapped: false },
    'failed point keeps its original coordinates',
  );
}

// The leaking-abort-timer in the failure path above is harmless; exit now so
// it never delays the suite.
// ------------------------------------------------ auto road/path routing

assert.equal(autoRoutingAvailable(), true, 'keyless OpenStreetMap road/path routing is available');

// ORS v2 payload schema check: continue_straight & radiuses MUST be top-level
// (never nested inside `options`, which causes ORS HTTP 400).
{
  const orsBody = buildOrsPayload([[14.6665, 121.0555], [14.6666, 121.062]]);
  assert.deepEqual(orsBody.coordinates, [[121.0555, 14.6665], [121.062, 14.6666]], 'flips [lat, lng] to ORS [lng, lat]');
  assert.equal(orsBody.continue_straight, false, 'continue_straight must be top-level false');
  assert.equal(orsBody.options, undefined, 'must not place continue_straight inside options');
  assert.deepEqual(orsBody.radiuses, [ROUTING.orsSnapRadiusM, ROUTING.orsSnapRadiusM], 'provides snap radius per waypoint');
}

// Helper: encode [[lat, lng], ...] with Valhalla precision-6 (1e6) so tests
// verify real polyline6 decoding without hand-copied magic strings.
function encodePolyline6(pts) {
  let lastLat = 0;
  let lastLng = 0;
  let out = '';
  const enc = (delta) => {
    let v = delta < 0 ? ~(delta << 1) : delta << 1;
    let s = '';
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lat, lng] of pts) {
    const iLat = Math.round(lat * 1e6);
    const iLng = Math.round(lng * 1e6);
    out += enc(iLat - lastLat) + enc(iLng - lastLng);
    lastLat = iLat;
    lastLng = iLng;
  }
  return out;
}

assert.deepEqual(decodePolyline6(''), []);
assert.deepEqual(decodePolyline6(null), []);
{
  const expected = [[14.651234, 121.064321], [14.654321, 121.068888], [14.658, 121.071]];
  const decoded = decodePolyline6(encodePolyline6(expected));
  assert.equal(decoded.length, 3);
  for (let i = 0; i < expected.length; i += 1) {
    assert.ok(Math.abs(decoded[i][0] - expected[i][0]) < 1e-6);
    assert.ok(Math.abs(decoded[i][1] - expected[i][1]) < 1e-6);
  }
}

// Route builders (Out & Back, Close Loop, Reverse, GeoJSON export)
{
  const a = [14.65, 121.06];
  const b = [14.66, 121.07];
  const c = [14.655, 121.08];
  const oab = outAndBackWaypoints([a, b, c]);
  assert.deepEqual(oab, [a, b, c, b, a], 'out & back mirrors back to start');
  oab[0][0] = 0;
  assert.equal(a[0], 14.65, 'out & back returns fresh copies');

  const loop = closeLoopWaypoints([a, b, c]);
  assert.deepEqual(loop, [a, b, c, a], 'close loop returns to start');
  assert.equal(isClosedLoop(loop), true, 'detects closed loop');
  assert.deepEqual(closeLoopWaypoints(loop), loop, 'already-closed loop is idempotent');

  const rev = reverseWaypoints([a, b, c]);
  assert.deepEqual(rev, [c, b, a], 'reverse flips start and destination');

  const gj = pathToGeoJson([a, b], 'ride');
  assert.equal(gj.type, 'FeatureCollection');
  assert.equal(gj.features[0].properties.activity_type, 'ride');
  assert.deepEqual(gj.features[0].geometry.coordinates, [[121.06, 14.65], [121.07, 14.66]]);
  assert.equal(pathToGeoJson([a]), null);
}

// Keyless road/path routing: OSRM foot/bike → Valhalla fallback → null
{
  const seen = [];
  const res = await withFetch(async (url) => {
    seen.push(url);
    return json({
      code: 'Ok',
      routes: [{ geometry: { coordinates: [[121.06, 14.65], [121.063, 14.652], [121.07, 14.66]] } }],
    });
  }, () => routeThroughRoads([[14.65, 121.06], [14.66, 121.07]], 'run', { allowKeyless: true }));

  assert.ok(seen.some((u) => u.startsWith(ROUTING.osrmUrls.run)), 'uses OSRM foot router for runs');
  assert.equal(res.provider, 'osrm');
  assert.deepEqual(res.path, [[14.65, 121.06], [14.652, 121.063], [14.66, 121.07]]);
}

{
  let usedBikeUrl = false;
  await withFetch(async (url) => {
    if (url.startsWith(ROUTING.osrmUrls.ride)) usedBikeUrl = true;
    return json({
      code: 'Ok',
      routes: [{ geometry: { coordinates: [[121.06, 14.65], [121.07, 14.66]] } }],
    });
  }, () => routeThroughRoads([[14.65, 121.06], [14.66, 121.07]], 'ride', { allowKeyless: true }));
  assert.equal(usedBikeUrl, true, 'uses OSRM bike router for rides');
}

// Valhalla fallback when OSRM fails (multi-leg seam deduplication + pedestrian costing)
{
  const leg1 = encodePolyline6([[14.65, 121.06], [14.655, 121.065]]);
  const leg2 = encodePolyline6([[14.655, 121.065], [14.66, 121.07]]);
  let valhallaBody = null;
  const res = await withFetch(async (url, opts) => {
    if (url.includes('routing.openstreetmap.de')) return json({ error: 'busy' }, 503);
    if (url === ROUTING.valhallaUrl) {
      valhallaBody = JSON.parse(opts.body);
      return json({ trip: { legs: [{ shape: leg1 }, { shape: leg2 }] } });
    }
    return json({}, 500);
  }, () => routeThroughRoads([[14.65, 121.06], [14.655, 121.065], [14.66, 121.07]], 'hike', { allowKeyless: true }));

  assert.equal(valhallaBody.costing, 'pedestrian', 'hike uses Valhalla pedestrian trail costing');
  assert.equal(res.provider, 'valhalla');
  assert.deepEqual(res.path, [[14.65, 121.06], [14.655, 121.065], [14.66, 121.07]], 'deduplicates shared seam vertex between legs');
}

// Total outage falls back cleanly to null
{
  const res = await withFetch(
    async () => { throw new TypeError('offline'); },
    () => routeThroughRoads([[14.65, 121.06], [14.66, 121.07]], 'run', { allowKeyless: true }),
  );
  assert.equal(res, null, 'total provider failure → null → straight-line fallback');
}

// Place search (Nominatim)
{
  let calls = 0;
  let requestedUrl = '';
  const results = await withFetch(async (url) => {
    calls += 1;
    requestedUrl = url;
    return json([
      { name: 'Academic Oval', display_name: 'Academic Oval, Diliman, Quezon City', lat: '14.6549', lon: '121.0685' },
    ]);
  }, async () => {
    assert.deepEqual(await searchPlaces('a'), [], '1-char search skips network');
    assert.equal(calls, 0);
    return searchPlaces('Academic Oval', { near: [14.65, 121.06] });
  });

  assert.equal(calls, 1);
  assert.ok(requestedUrl.includes('viewbox='), 'biases place search near current location');
  assert.deepEqual(results, [
    { label: 'Academic Oval, Diliman, Quezon City', shortName: 'Academic Oval', latitude: 14.6549, longitude: 121.0685 },
  ]);
}

console.log('draw smoke: ok (profiles, waypoints, auto-routing, builders, search, snapping)');
process.exit(0);
