/**
 * Optional, user-initiated city/region detection. Coordinates are sent directly
 * from the browser to BigDataCloud's client-side reverse-geocoding service;
 * only the resulting place name is returned to the caller for manual review.
 */
const LOOKUP_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const POSITION_OPTIONS = { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 };

const MESSAGES = {
  unsupported: 'Location is unavailable in this browser. Use HTTPS or localhost, or enter it manually.',
  denied: 'Location permission was denied. Allow it in your browser settings or enter it manually.',
  unavailable: 'Your device could not find your location. Try again or enter it manually.',
  timeout: 'Finding your location timed out. Try again or enter it manually.',
  invalid: 'Your device returned an invalid location. Please enter it manually.',
  lookup: 'The city lookup is unavailable. Check your connection or enter your location manually.',
  lookup_timeout: 'The city lookup timed out. Try again or enter your location manually.',
  no_result: 'No city or region was found. Please enter your location manually.',
  ip_fallback: 'The lookup could not use your device location. Please enter your location manually.',
  too_long: 'The detected place name is too long. Please enter your location manually.',
};

export class LocationError extends Error {
  constructor(code) {
    super(MESSAGES[code] ?? MESSAGES.lookup);
    this.name = 'LocationError';
    this.code = code;
  }
}

function abortedError() {
  const error = new Error('Location detection was cancelled.');
  error.name = 'AbortError';
  return error;
}

function currentPosition(geolocation, signal) {
  if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
    return Promise.reject(new LocationError('unsupported'));
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError());
      return;
    }

    let finished = false;
    const done = (callback, value) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => done(reject, abortedError());
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      geolocation.getCurrentPosition(
        (position) => done(resolve, position?.coords),
        (error) => {
          const code = error?.code === 1 ? 'denied' : error?.code === 3 ? 'timeout' : 'unavailable';
          done(reject, new LocationError(code));
        },
        POSITION_OPTIONS,
      );
    } catch {
      done(reject, new LocationError('unavailable'));
    }
  });
}

function placePart(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

/** Build a short, editable city/region label without storing coordinates. */
export function cityRegionFromResult(result) {
  if (!result || typeof result !== 'object') throw new LocationError('no_result');
  if (result.lookupSource === 'ipGeolocation') throw new LocationError('ip_fallback');
  const city = placePart(result.city) || placePart(result.locality);
  const region = placePart(result.principalSubdivision);
  const parts = [city, region].filter(Boolean);
  const unique = parts.filter((part, index) => parts.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === index);
  const label = unique.join(', ');
  if (!label) throw new LocationError('no_result');
  if (label.length > 120) throw new LocationError('too_long');
  return label;
}

/**
 * Ask the device for its current position and look it up in the browser.
 * Never fall back to IP-only lookup, and never call the provider on denial.
 * Returns { label, latitude, longitude } — coords stay in the browser.
 */
export async function detectPlace({
  geolocation = globalThis.navigator?.geolocation,
  fetcher = globalThis.fetch,
  signal,
  onLookup = () => {},
  lookupTimeoutMs = 12000,
} = {}) {
  if (globalThis.isSecureContext === false) throw new LocationError('unsupported');
  const coords = await currentPosition(geolocation, signal);
  if (signal?.aborted) throw abortedError();
  const { latitude, longitude } = coords ?? {};
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new LocationError('invalid');
  }
  if (typeof fetcher !== 'function') throw new LocationError('lookup');

  const url = new URL(LOOKUP_URL);
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set('localityLanguage', 'en');
  onLookup();
  if (signal?.aborted) throw abortedError();

  const lookupController = new AbortController();
  const onAbort = () => lookupController.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  // The parent might have been aborted by onLookup().
  if (signal?.aborted) lookupController.abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    lookupController.abort();
  }, lookupTimeoutMs);
  try {
    const response = await fetcher(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: lookupController.signal,
    });
    if (signal?.aborted) throw abortedError();
    if (!response.ok) throw new LocationError('lookup');
    const result = await response.json();
    if (signal?.aborted) throw abortedError();
    const label = cityRegionFromResult(result);
    return { label, latitude, longitude };
  } catch (error) {
    if (signal?.aborted) throw abortedError();
    if (timedOut) throw new LocationError('lookup_timeout');
    if (error instanceof LocationError) throw error;
    throw new LocationError('lookup');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Label-only wrapper kept for CityRegionInput (same contract as before). */
export async function detectCityRegion(options = {}) {
  const place = await detectPlace(options);
  return place.label;
}

/* ---------------------------------------------------------- live cache */
// Short-lived cache so the dashboard indicator can show the GPS place
// without re-prompting / re-calling the geocoder on every visit.
const PLACE_CACHE_KEY = 'trana:live-place:v1';
const PLACE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** @returns {{label:string, latitude:number, longitude:number, at:number}|null} */
export function readCachedPlace(maxAgeMs = PLACE_CACHE_TTL_MS) {
  try {
    const raw = globalThis.localStorage?.getItem(PLACE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.label !== 'string' || !parsed.label) return null;
    if (!Number.isFinite(parsed.latitude) || !Number.isFinite(parsed.longitude)) return null;
    if (Date.now() - Number(parsed.at || 0) > maxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedPlace(place) {
  try {
    globalThis.localStorage?.setItem(
      PLACE_CACHE_KEY,
      JSON.stringify({
        label: place.label,
        latitude: place.latitude,
        longitude: place.longitude,
        at: Date.now(),
      }),
    );
  } catch {
    // storage unavailable (private mode) — detection simply runs again next time
  }
}
