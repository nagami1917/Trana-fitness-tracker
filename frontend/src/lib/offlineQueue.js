/**
 * Offline activity save queue (`localStorage` backed).
 *
 * When an athlete finishes a workout in a trail dead zone or while offline,
 * the finished payload is saved here and automatically flushed to `/api/activities`
 * once connectivity returns.
 */

import { get, writable } from 'svelte/store';
import { api } from '../services/client.js';
import { notify, upsertActivity } from '../stores/index.js';

const STORAGE_KEY = 'trana:pending_activities:v1';

function readQueue() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items) {
  try {
    if (!items.length) globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore quota failures
  }
}

export const pendingActivities = writable(readQueue());
export const syncingOfflineQueue = writable(false);

export function queueActivitySave(payload) {
  const item = {
    localId: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    queuedAt: new Date().toISOString(),
    payload,
  };
  const next = [...readQueue(), item];
  writeQueue(next);
  pendingActivities.set(next);
  return item;
}

export function removePendingActivity(localId) {
  const next = readQueue().filter((entry) => entry.localId !== localId);
  writeQueue(next);
  pendingActivities.set(next);
}

let flushingPromise = null;

export async function flushPendingActivities({ silent = false } = {}) {
  if (flushingPromise) return flushingPromise;
  const items = readQueue();
  if (!items.length || !api.auth.hasToken()) return { synced: 0, remaining: items.length };

  flushingPromise = (async () => {
    syncingOfflineQueue.set(true);
    let synced = 0;
    const remaining = [];
    for (const item of items) {
      try {
        const saved = await api.activities.create(item.payload);
        upsertActivity(saved);
        synced += 1;
      } catch (err) {
        // Validation/401 errors shouldn't trap in infinite retries unless connectivity issue
        if (err?.status >= 400 && err?.status < 500 && err?.status !== 408 && err?.status !== 429) {
          if (!silent) notify(err.message || 'An offline workout could not be validated.', 'error');
        } else {
          remaining.push(item);
        }
      }
    }
    writeQueue(remaining);
    pendingActivities.set(remaining);
    syncingOfflineQueue.set(false);
    if (synced > 0 && !silent) {
      notify(`Synced ${synced} offline workout${synced > 1 ? 's' : ''} to your log.`);
    }
    return { synced, remaining: remaining.length };
  })().finally(() => {
    flushingPromise = null;
  });

  return flushingPromise;
}

let listenerBound = false;
export function bindOfflineSyncListener() {
  if (listenerBound || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  listenerBound = true;
  window.addEventListener('online', () => {
    void flushPendingActivities();
  });
}
