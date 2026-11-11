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
import { routingEnabled, profileFor, waypointsFromPath, routeThroughRoads } from '../src/services/roadRoutingService.js';
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
console.log('draw smoke: ok (profiles, waypoints, fallbacks, snapping)');
process.exit(0);
