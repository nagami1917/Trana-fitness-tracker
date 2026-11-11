/**
 * Global error monitoring: uncaught JS errors and unhandled promise
 * rejections are fingerprinted, rate-limited and POSTed to
 * `/api/client-errors`, where the server groups them by fingerprint.
 *
 * Reporting is strictly fire-and-forget — the monitor must never throw,
 * never block the UI, and never leak page contents (only message, stack
 * and route path are sent).
 */
import { resolveApiConfig } from '../services/config.js';

const MAX_PER_SESSION = 40;
const DEDUPE_WINDOW_MS = 5000;
const MAX_MESSAGE = 1000;
const MAX_STACK = 4000;

/** @type {null | ((payload: object) => void | Promise<void>)} */
let activePost = null;
let installed = false;
let sentThisSession = 0;
let sessionLimit = MAX_PER_SESSION;
/** @type {Map<string, number>} fingerprint → last send time */
const recentSends = new Map();

function clip(value, max) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Cheap stable hash (FNV-1a) — enough to group identical faults client-side. */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function fingerprintOf(message, stack) {
  const origin = String(stack || '').split('\n').find((line) => line.trim()) || '';
  return fnv1a(`${message}|${origin}`);
}

async function defaultPost(payload) {
  const { base } = resolveApiConfig(import.meta.env);
  try {
    await fetch(`${base}/api/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      // Keep-alive lets the report survive a page teardown/navigation.
      keepalive: true,
    });
  } catch {
    // Monitoring is best-effort: a failed report must not surface anywhere.
  }
}

function currentRoute() {
  try {
    return typeof location !== 'undefined' ? location.pathname : undefined;
  } catch {
    return undefined;
  }
}

function readVersion() {
  try {
    return import.meta.env?.VITE_APP_VERSION || 'dev';
  } catch {
    return 'dev';
  }
}

/**
 * Report a known fault (also used by the API client for HTTP 5xx replies).
 * Safe to call from anywhere — including catch blocks of other monitors.
 * Deduplicates identical faults within a short window and caps the total
 * per page session so a broken page cannot flood the intake.
 */
export function reportClientError({ message, stack, route, appVersion } = {}) {
  const text = clip(message || 'Unknown client error', MAX_MESSAGE);
  const stackText = clip(stack || '', MAX_STACK);
  const fingerprint = fingerprintOf(text, stackText);

  if (sentThisSession >= sessionLimit) return;
  const last = recentSends.get(fingerprint) || 0;
  if (Date.now() - last < DEDUPE_WINDOW_MS) return;
  recentSends.set(fingerprint, Date.now());
  sentThisSession += 1;

  const payload = {
    kind: 'client',
    message: text,
    stack: stackText || undefined,
    route: clip(route || currentRoute(), 200),
    app_version: clip(appVersion || readVersion(), 40) || undefined,
  };

  const post = activePost || defaultPost;
  try {
    const result = post(payload);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // Never let the monitor itself throw.
  }
}

function toErrorLike(reason) {
  if (reason && typeof reason === 'object' && typeof reason.message === 'string') {
    return { message: reason.message, stack: reason.stack };
  }
  return { message: String(reason ?? 'Unhandled rejection'), stack: '' };
}

/**
 * Wire the monitor into a window-like target. Returns the handlers so
 * tests (and exotic hosts) can drive them directly.
 *
 * @param {{ target?: any, post?: (payload: object) => void | Promise<void>, maxPerSession?: number }} [options]
 */
export function installErrorMonitor({ target, post, maxPerSession } = {}) {
  const win = target ?? (typeof window !== 'undefined' ? window : undefined);
  if (!win || typeof win.addEventListener !== 'function') {
    return { handleError: () => {}, handleRejection: () => {} };
  }

  if (post) activePost = post;
  if (typeof maxPerSession === 'number') sessionLimit = maxPerSession;

  const handleError = (event) => {
    const source = event?.error || event;
    reportClientError({
      message: event?.message || source?.message || 'Uncaught error',
      stack: source?.stack || '',
    });
  };

  const handleRejection = (event) => {
    const { message, stack } = toErrorLike(event?.reason ?? event);
    reportClientError({ message, stack });
  };

  if (!installed) {
    win.addEventListener('error', handleError);
    win.addEventListener('unhandledrejection', handleRejection);
    installed = true;
  }

  return { handleError, handleRejection };
}
