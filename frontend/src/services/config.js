/**
 * An empty setting intentionally means local demo mode. `/` opts into a
 * same-origin Laravel API without sending the browser to localhost; in dev,
 * Vite forwards those requests to VITE_PROXY_TARGET on the server side.
 */
export function resolveApiConfig(env = {}) {
  const configured = String(env?.VITE_API_BASE_URL ?? '').trim();
  return {
    isLive: configured !== '',
    base: configured.replace(/\/+$/, ''),
  };
}
