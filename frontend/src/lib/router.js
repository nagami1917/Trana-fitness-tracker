import { writable } from 'svelte/store';
import { prefetchRoute } from '../routes/index.js';

/** Minimal history-API router — no dependency, works with the PWA offline. */

function current() {
  return window.location.pathname.replace(/\/+$/, '') || '/';
}

export const route = writable(current());
export const query = writable(new URLSearchParams(window.location.search));

function sync() {
  route.set(current());
  query.set(new URLSearchParams(window.location.search));
}

window.addEventListener('popstate', sync);

export function navigate(to, { replace = false, scroll = true } = {}) {
  const [pathname, search = ''] = to.split('?');
  if (pathname === current() && search === window.location.search.slice(1)) return;
  prefetchRoute(to);
  if (replace) window.history.replaceState({}, '', to);
  else window.history.pushState({}, '', to);
  sync();
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** `use:link` on any <a href="/plan"> */
export function link(node) {
  const warm = () => {
    if (globalThis.navigator?.connection?.saveData) return;
    const href = node.getAttribute('href');
    if (href && href.startsWith('/')) prefetchRoute(href);
  };
  const handler = (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    const href = node.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#')) return;
    event.preventDefault();
    navigate(href);
  };
  node.addEventListener('click', handler);
  node.addEventListener('pointerenter', warm, { passive: true });
  node.addEventListener('focusin', warm, { passive: true });
  return {
    destroy: () => {
      node.removeEventListener('click', handler);
      node.removeEventListener('pointerenter', warm);
      node.removeEventListener('focusin', warm);
    },
  };
}

export function isActive(path, href, exact = false) {
  if (exact) return path === href;
  return path === href || (href !== '/' && path.startsWith(href));
}
