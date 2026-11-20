/**
 * Theme preference (`light` | `dark`), persisted in `localStorage`.
 *
 * TRANA now ships a single dark identity (Midnight Navy surfaces with Electric
 * Lime accents), so both states resolve to the same appearance. The store, the
 * toggle and the localStorage key are kept as-is so no consumer component had
 * to change.
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
      meta.setAttribute('content', '#101b2d');
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
