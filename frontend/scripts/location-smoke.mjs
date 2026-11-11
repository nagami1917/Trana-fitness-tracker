/** Location detection tests with fake device and HTTP responses; no real coordinates leave the machine. */
import assert from 'node:assert/strict';
import { cityRegionFromResult, detectCityRegion, watchPosition } from '../src/lib/location.js';

const coords = { latitude: 12.34, longitude: 56.78 };
const place = { city: 'Test City', locality: 'Test Village', principalSubdivision: 'Test Region', lookupSource: 'reverseGeocoding' };
const geo = (position = coords) => ({
  getCurrentPosition(success, _error, options) {
    // Slow-mobile-friendly options (PR #30): 25 s timeout, 60 s cached fix.
    assert.deepEqual(options, { enableHighAccuracy: false, timeout: 25000, maximumAge: 60000 });
    queueMicrotask(() => success({ coords: position }));
  },
});
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const hasCode = (code) => (error) => error.code === code;
let calls = 0;
let lookedUp = false;
const fetcher = async (rawUrl, options) => {
  calls += 1;
  const url = new URL(rawUrl);
  assert.equal(url.origin, 'https://api.bigdatacloud.net');
  assert.equal(url.pathname, '/data/reverse-geocode-client');
  assert.equal(url.searchParams.get('latitude'), '12.34');
  assert.equal(url.searchParams.get('longitude'), '56.78');
  assert.equal(url.searchParams.get('localityLanguage'), 'en');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.ok(options.signal instanceof AbortSignal);
  return json(place);
};

assert.equal(await detectCityRegion({ geolocation: geo(), fetcher, onLookup: () => { lookedUp = true; } }), 'Test City, Test Region');
assert.equal(calls, 1);
assert.equal(lookedUp, true);
assert.equal(cityRegionFromResult({ city: '  Same  ', principalSubdivision: 'same' }), 'Same');
assert.equal(cityRegionFromResult({ locality: '  Test   Village ', principalSubdivision: 'Test Region' }), 'Test Village, Test Region');
assert.equal(cityRegionFromResult({ principalSubdivision: 'Test Region' }), 'Test Region');
assert.throws(() => cityRegionFromResult({ countryName: 'Country only' }), hasCode('no_result'));
assert.equal(cityRegionFromResult({ city: 'x'.repeat(120) }).length, 120);
assert.throws(() => cityRegionFromResult({ city: 'x'.repeat(121) }), hasCode('too_long'));
assert.throws(() => cityRegionFromResult({ ...place, lookupSource: 'ipGeolocation' }), hasCode('ip_fallback'));

for (const [number, code] of [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']]) {
  let sent = false;
  const denied = { getCurrentPosition(_success, error) { error({ code: number }); } };
  await assert.rejects(detectCityRegion({ geolocation: denied, fetcher: () => { sent = true; } }), hasCode(code));
  assert.equal(sent, false, 'Never send an IP-only lookup after location is denied or unavailable.');
}
await assert.rejects(detectCityRegion({ geolocation: null, fetcher }), hasCode('unsupported'));
const originalSecureContext = globalThis.isSecureContext;
try {
  globalThis.isSecureContext = false;
  let requested = false;
  await assert.rejects(detectCityRegion({
    geolocation: { getCurrentPosition() { requested = true; } }, fetcher,
  }), hasCode('unsupported'));
  assert.equal(requested, false, 'Insecure origins cannot request geolocation');
} finally {
  if (originalSecureContext === undefined) delete globalThis.isSecureContext;
  else globalThis.isSecureContext = originalSecureContext;
}
let invalidRequestSent = false;
await assert.rejects(detectCityRegion({
  geolocation: geo({ latitude: NaN, longitude: 0 }),
  fetcher: () => { invalidRequestSent = true; },
}), hasCode('invalid'));
assert.equal(invalidRequestSent, false);
await assert.rejects(detectCityRegion({ geolocation: geo(), fetcher: async () => json({}, 503) }), hasCode('lookup'));
await assert.rejects(detectCityRegion({ geolocation: geo(), fetcher: async () => { throw new Error('network down'); } }), hasCode('lookup'));
await assert.rejects(detectCityRegion({ geolocation: geo(), fetcher: async () => new Response('not json') }), hasCode('lookup'));
await assert.rejects(detectCityRegion({ geolocation: geo(), fetcher: async () => json({}) }), hasCode('no_result'));

// A cancelled or unmounted control must not send a late location lookup.
let finishPosition;
let sentAfterCancel = false;
const controller = new AbortController();
const cancelled = detectCityRegion({
  geolocation: { getCurrentPosition(success) { finishPosition = success; } },
  fetcher: () => { sentAfterCancel = true; },
  signal: controller.signal,
});
controller.abort();
await assert.rejects(cancelled, { name: 'AbortError' });
finishPosition({ coords });
assert.equal(sentAfterCancel, false);

// Cancellation immediately after receiving coordinates must not start a fetch.
const abortOnLookup = new AbortController();
let sentOnAbort = false;
await assert.rejects(detectCityRegion({
  geolocation: geo(),
  signal: abortOnLookup.signal,
  onLookup: () => abortOnLookup.abort(),
  fetcher: () => { sentOnAbort = true; },
}), { name: 'AbortError' });
assert.equal(sentOnAbort, false);

const pendingFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
  if (signal.aborted) return reject(new Error('aborted'));
  signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
});
await assert.rejects(detectCityRegion({ geolocation: geo(), fetcher: pendingFetch, lookupTimeoutMs: 5 }), hasCode('lookup_timeout'));
const lookupController = new AbortController();
const inFlight = detectCityRegion({
  geolocation: geo(), fetcher: pendingFetch, signal: lookupController.signal,
  onLookup: () => queueMicrotask(() => lookupController.abort()),
});
await assert.rejects(inFlight, { name: 'AbortError' });

// watchPosition (follow-me blue dot): emits fixes, cancel stops the watch.
{
  const seen = [];
  let cleared = null;
  const watching = {
    watchPosition(success) {
      queueMicrotask(() => success({ coords: { ...coords, accuracy: 5 } }));
      return 42;
    },
    clearWatch(id) {
      cleared = id;
    },
  };
  const stop = watchPosition({ geolocation: watching, onUpdate: (p) => seen.push(p) });
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].latitude, 12.34);
  assert.equal(seen[0].longitude, 56.78);
  assert.equal(seen[0].accuracy, 5);
  stop();
  assert.equal(cleared, 42, 'Cancel must clear the geolocation watch.');

  let watchError = null;
  const stopUnsupported = watchPosition({ geolocation: null, onError: (e) => { watchError = e; } });
  assert.equal(watchError?.code, 'unavailable');
  stopUnsupported(); // no-op cancel must not throw

  // Regression guard: watchPosition error callback must translate GeolocationPositionError codes cleanly.
  for (const [number, code] of [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']]) {
    let seenErr = null;
    const stopErr = watchPosition({
      geolocation: {
        watchPosition(_success, error) {
          queueMicrotask(() => error({ code: number }));
          return 77;
        },
        clearWatch() {},
      },
      onError: (e) => { seenErr = e; },
    });
    await new Promise((resolve) => queueMicrotask(resolve));
    assert.equal(seenErr?.code, code);
    stopErr();
  }
}

console.log('Location detection, privacy, cancellation and error checks passed');
