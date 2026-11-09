/** Laravel API facade. All account data is stored by the server, not seeded in the browser. */
import { resolveApiConfig } from './config.js';

const { base: BASE } = resolveApiConfig(import.meta.env);
const TOKEN_KEY = 'trana.token';
const unauthorizedListeners = new Set();

const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (token) => (token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY));

export function onUnauthorized(listener) {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

const safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the TRANA API. Check that the backend is running and try again.');
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    // Only an actual 401 invalidates the token. A network/server outage must
    // not sign the user out; also avoid clearing a newer token from a late reply.
    if (res.status === 401 && auth && token && getToken() === token) {
      setToken(null);
      unauthorizedListeners.forEach((listener) => listener());
    }
    const message = data?.message || (res.status >= 500
      ? 'The TRANA API is unavailable. Check that the backend and database are running.'
      : `Request failed (${res.status})`);
    const error = new Error(message);
    error.status = res.status;
    error.errors = data?.errors;
    throw error;
  }
  if (text && data === null) {
    throw new Error('The TRANA API returned an unexpected response. Check the API configuration.');
  }
  return data;
}

// Dashboard metrics use the full account history. Do not silently stop at the
// server's page limit (200 activities / 30 predictions by default).
async function listAll(path, limit) {
  const rows = [];
  let page = 1;
  let lastPage;
  do {
    const response = await request(`${path}?limit=${limit}&page=${page}`);
    if (!Array.isArray(response?.data) || response?.meta?.current_page !== page
      || !Number.isInteger(response?.meta?.last_page) || response.meta.last_page < 1) {
      throw new Error('The TRANA API is outdated or returned an invalid list. Update the backend and try again.');
    }
    rows.push(...response.data);
    lastPage = response.meta.last_page;
    page += 1;
  } while (page <= lastPage);
  return rows;
}

function saveSession(data) {
  if (!data?.token || !data?.user) {
    throw new Error('The TRANA API returned an invalid sign-in response.');
  }
  setToken(data.token);
  return data.user;
}

export const api = {
  mode: 'live',

  async health() {
    const data = await request('/health', { auth: false });
    if (data?.status !== 'ok') {
      throw new Error('The TRANA API returned an unexpected health response. Check the API configuration.');
    }
    return data;
  },

  auth: {
    async user() {
      if (!getToken()) return null;
      try {
        const data = await request('/auth/me');
        if (!data?.user) throw new Error('The TRANA API returned an invalid account response.');
        return data.user;
      } catch (error) {
        if (error.status === 401) return null;
        throw error;
      }
    },
    async login({ email, password }) {
      const data = await request('/auth/login', { method: 'POST', body: { email, password }, auth: false });
      return saveSession(data);
    },
    async register(payload) {
      const data = await request('/auth/register', { method: 'POST', body: payload, auth: false });
      return saveSession(data);
    },
    async logout() {
      try {
        if (getToken()) await request('/auth/logout', { method: 'POST' });
      } finally {
        setToken(null);
      }
    },
  },

  profile: {
    get: () => request('/profile').then((d) => d.data),
    // POST creates; the server answers 409 once a profile exists.
    create: (payload) => request('/profile', { method: 'POST', body: payload }).then((d) => d.data),
    update: (patch) => request('/profile', { method: 'PUT', body: patch }).then((d) => d.data),
    updateWeight: (weightKg) =>
      request('/profile/weight', { method: 'PATCH', body: { weight_kg: weightKg } }).then((d) => d.data),
    updateFitnessLevel: (level, source = 'user') =>
      request('/profile/fitness-level', { method: 'PATCH', body: { fitness_level: level, source } }).then((d) => d.data),
  },

  activities: {
    list: () => listAll('/activities', 500),
    create: (payload) => request('/activities', { method: 'POST', body: payload }).then((d) => d.data),
    remove: (id) => request(`/activities/${id}`, { method: 'DELETE' }),
  },

  predictions: {
    list: () => listAll('/predictions', 100),
    create: (payload) => request('/predictions', { method: 'POST', body: payload }).then((d) => d.data),
    remove: (id) => request(`/predictions/${id}`, { method: 'DELETE' }),
  },

  goals: {
    get: () => request('/goals').then((d) => d.data),
    update: (patch) => request('/goals', { method: 'PUT', body: patch }).then((d) => d.data),
  },
};
