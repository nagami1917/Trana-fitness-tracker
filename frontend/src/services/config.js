/**
 * The app always uses the Laravel API. An empty value or `/` means same
 * origin; in development Vite proxies `/api` to the server-side target.
 * Database credentials must never be put in the frontend environment.
 */
export function resolveApiConfig(env = {}) {
  const configured = String(env?.VITE_API_BASE_URL ?? '').trim();
  return { base: configured.replace(/\/+$/, '') };
}
