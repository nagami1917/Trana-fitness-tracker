/**
 * Theme preference (`light` | `dark`), persisted in `localStorage`.
 * Outdoor high-contrast dark mode eases night running & harsh sunlight contrast.
 */

import { writable } from 'svelte/store';

const THEME_KEY = 'trana:theme';

function readTheme() {
  try {
    return globalThis.localStorage?.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(mode) {
  if (typeof document !== 'undefined') {
    const isDark = mode === 'dark';
    document.documentElement.classList.toggle('theme-dark', isDark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', isDark ? '#0f131d' : '#db2777');
    }
  }
}

export const theme = writable(readTheme());

export function setTheme(mode) {
  const next = mode === 'dark' ? 'dark' : 'light';
  try {
    globalThis.localStorage?.setItem(THEME_KEY, next);
  } catch {
    // ignore storage failures
  }
  applyTheme(next);
  theme.set(next);
}

export function toggleTheme() {
  let current = 'light';
  const unsub = theme.subscribe((v) => (current = v));
  unsub();
  setTheme(current === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
  applyTheme(readTheme());
}
