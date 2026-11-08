/**
 * API facade.
 *
 * Set `VITE_API_BASE_URL` to your Laravel deployment (e.g.
 * `https://trana-api.vercel.app`) and the app talks to the real REST API with a
 * Sanctum bearer token. With no env var it falls back to the local demo
 * backend, which keeps the PWA fully usable offline.
 *
 * Requests are always sent to a relative `/api/...` path when the base URL is
 * empty so nothing browser-side ever calls localhost.
 */

import { demoApi, subscribe as demoSubscribe } from './demo.js';

const BASE = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'trana.token';

export const isLive = Boolean(BASE);

const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (token) => (token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY));

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const message = data?.message || `Request failed (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    error.errors = data?.errors;
    throw error;
  }
  return data;
}

const safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const liveApi = {
  mode: 'live',

  auth: {
    async user() {
      if (!getToken()) return null;
      try {
        const data = await request('/auth/me');
        return data.user;
      } catch {
        setToken(null);
        return null;
      }
    },
    async login({ email, password }) {
      const data = await request('/auth/login', { method: 'POST', body: { email, password }, auth: false });
      setToken(data.token);
      return data.user;
    },
    async register(payload) {
      const data = await request('/auth/register', { method: 'POST', body: payload, auth: false });
      setToken(data.token);
      return data.user;
    },
    async demo() {
      const data = await request('/auth/demo', { method: 'POST', auth: false });
      setToken(data.token);
      return data.user;
    },
    async logout() {
      try {
        await request('/auth/logout', { method: 'POST' });
      } finally {
        setToken(null);
      }
    },
  },

  profile: {
    get: () => request('/profile').then((d) => d.data),
    update: (patch) => request('/profile', { method: 'PUT', body: patch }).then((d) => d.data),
  },

  activities: {
    list: () => request('/activities').then((d) => d.data),
    create: (payload) => request('/activities', { method: 'POST', body: payload }).then((d) => d.data),
    remove: (id) => request(`/activities/${id}`, { method: 'DELETE' }),
  },

  predictions: {
    list: () => request('/predictions').then((d) => d.data),
    create: (payload) => request('/predictions', { method: 'POST', body: payload }).then((d) => d.data),
    remove: (id) => request(`/predictions/${id}`, { method: 'DELETE' }),
  },

  goals: {
    get: () => request('/goals').then((d) => d.data),
    update: (patch) => request('/goals', { method: 'PUT', body: patch }).then((d) => d.data),
  },

  reset: () => request('/demo/reset', { method: 'POST' }),
};

export const api = isLive ? liveApi : demoApi;

/** Subscribe to local data changes (demo mode). Live mode relies on explicit refetches. */
export function onDataChange(fn) {
  if (isLive) return () => {};
  return demoSubscribe(fn);
}
