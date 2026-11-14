/**
 * Central lazy route table — each page compiles into its own code-split chunk so
 * initial loads never download heavy map/chart engines (MapLibre, Leaflet, Chart.js)
 * until the route actually needs them. Resolved components stay cached in memory.
 */
const PAGE_LOADERS = {
  '/': () => import('../pages/Dashboard/Dashboard.svelte'),
  '/plan': () => import('../pages/PlanActivity/PlanActivity.svelte'),
  '/calendar': () => import('../pages/Calendar/Calendar.svelte'),
  '/track': () => import('../pages/Track/Track.svelte'),
  '/track/history': () => import('../pages/Track/History.svelte'),
  '/track/session': () => import('../pages/Track/SessionDetail.svelte'),
  '/activities': () => import('../pages/Activities/Activities.svelte'),
  '/analytics': () => import('../pages/Analytics/Analytics.svelte'),
  '/fueling': () => import('../pages/Fueling/Fueling.svelte'),
  '/goals': () => import('../pages/Goals/Goals.svelte'),
  '/profile': () => import('../pages/Profile/Profile.svelte'),
  '/settings': () => import('../pages/Settings/Settings.svelte'),
  '/admin': () => import('../pages/Admin/Admin.svelte'),
  '/preview': () => import('../pages/Preview/Preview.svelte'),
  '/privacy': () => import('../pages/Legal/Privacy.svelte'),
  '/terms': () => import('../pages/Legal/Terms.svelte'),
};

const VIEW_LOADERS = {
  login: () => import('../pages/Login/Login.svelte'),
  register: () => import('../pages/Register/Register.svelte'),
  onboarding: () => import('../pages/Onboarding/Onboarding.svelte'),
  'not-found': () => import('../pages/NotFound/NotFound.svelte'),
};

const componentCache = new Map();
const pendingLoads = new Map();

function normalizePath(path) {
  return (path || '/').split('?')[0].replace(/\/+$/, '') || '/';
}

function loadWithCache(key, loader) {
  if (componentCache.has(key)) return Promise.resolve(componentCache.get(key));
  if (pendingLoads.has(key)) return pendingLoads.get(key);
  const promise = loader()
    .then((mod) => {
      const component = mod?.default ?? mod;
      componentCache.set(key, component);
      return component;
    })
    .finally(() => {
      pendingLoads.delete(key);
    });
  pendingLoads.set(key, promise);
  return promise;
}

export function getCachedViewComponent(name) {
  const key = VIEW_LOADERS[name] ? `view:${name}` : 'view:not-found';
  return componentCache.get(key) ?? null;
}

export function loadViewComponent(name) {
  const validName = VIEW_LOADERS[name] ? name : 'not-found';
  return loadWithCache(`view:${validName}`, VIEW_LOADERS[validName]);
}

export function getCachedRouteComponent(path) {
  const clean = normalizePath(path);
  const key = PAGE_LOADERS[clean] ? `route:${clean}` : 'view:not-found';
  return componentCache.get(key) ?? null;
}

export function loadRouteComponent(path) {
  const clean = normalizePath(path);
  if (PAGE_LOADERS[clean]) return loadWithCache(`route:${clean}`, PAGE_LOADERS[clean]);
  return loadViewComponent('not-found');
}

export function prefetchRoute(to) {
  if (typeof to !== 'string' || !to.startsWith('/')) return;
  const clean = normalizePath(to);
  if (PAGE_LOADERS[clean] && !componentCache.has(`route:${clean}`)) {
    void loadRouteComponent(clean).catch(() => {});
  }
}
