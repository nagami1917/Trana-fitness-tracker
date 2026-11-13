/** Laravel API facade. All account data is stored by the server, not seeded in the browser. */
import { resolveApiConfig } from './config.js';
import { reportClientError } from '../lib/errorMonitor.js';

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

/** Skip empty values so query strings stay clean (`?q=&status=` → `?status=`). */
function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

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
    // 5xx = the server already recorded its own fault; mirror it from the
    // client's viewpoint (which request the user was on) for correlation.
    if (res.status >= 500) {
      reportClientError({
        message: `HTTP ${res.status} ${method} ${path}`,
        stack: data?.message || '',
      });
    }
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
  const validatePage = (response, expectedPage) => {
    if (!Array.isArray(response?.data) || response?.meta?.current_page !== expectedPage
      || !Number.isInteger(response?.meta?.last_page) || response.meta.last_page < 1) {
      throw new Error('The TRANA API is outdated or returned an invalid list. Update the backend and try again.');
    }
    return response;
  };

  const first = validatePage(await request(`${path}?limit=${limit}&page=1`), 1);
  const rows = [...first.data];
  const lastPage = first.meta.last_page;
  if (lastPage > 1) {
    const rest = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, index) => {
        const page = index + 2;
        return request(`${path}?limit=${limit}&page=${page}`).then((res) => validatePage(res, page).data);
      }),
    );
    for (const chunk of rest) rows.push(...chunk);
  }
  return rows;
}

// Authenticated file download (CSV export). Fetches as a blob so the bearer
// token never lands in a plain <a href>, then hands the file to the browser.
async function downloadFile(path, fallbackName) {
  const headers = { Accept: 'text/csv' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, { headers });
  } catch {
    throw new Error('Could not reach the TRANA API. Check that the backend is running and try again.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const data = safeJson(text);
    throw new Error(data?.message || `Export failed (${res.status}).`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fallbackName || path.split('/').pop() || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
  request: (path, options) => request(path.startsWith('/api/') ? path.slice(4) : path, options),

  async health() {
    const data = await request('/health', { auth: false });
    if (data?.status !== 'ok') {
      throw new Error('The TRANA API returned an unexpected health response. Check the API configuration.');
    }
    return data;
  },

  auth: {
    hasToken: () => Boolean(getToken()),
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

    // Password recovery — always server-answered with a generic message.
    forgotPassword: (email) => request('/password/forgot', { method: 'POST', body: { email }, auth: false }),
    resetPassword: (payload) => request('/password/reset', { method: 'POST', body: payload, auth: false }),

    // Email verification (resend uses the signed-in athlete's address).
    resendVerification: () => request('/email/verify/resend', { method: 'POST' }),
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
    update: (id, payload) => request(`/activities/${id}`, { method: 'PATCH', body: payload }).then((d) => d.data),
    remove: (id) => request(`/activities/${id}`, { method: 'DELETE' }),
    exportCsv: () => downloadFile('/activities/export', 'trana-activities.csv'),
  },

  // Data rights: export lives under activities; erasure removes everything.
  account: {
    delete: (password) => request('/account', { method: 'DELETE', body: { password } }),
  },

  // Body-weight timeline — one weigh-in per day, profile auto-synced.
  weightLogs: {
    list: (days = 180) => request(`/weight-logs?days=${days}`).then((d) => d.data),
    add: (payload) => request('/weight-logs', { method: 'POST', body: payload }).then((d) => d.data),
    remove: (id) => request(`/weight-logs/${id}`, { method: 'DELETE' }),
  },

  // In-app notification center — the server synthesizes reminders on read.
  notifications: {
    list: () =>
      request('/notifications').then((d) => ({
        items: Array.isArray(d?.data) ? d.data : [],
        unread: d?.meta?.unread ?? 0,
      })),
    read: (id) => request(`/notifications/${id}/read`, { method: 'POST' }),
    readAll: () => request('/notifications/read-all', { method: 'POST' }),
  },

  // Admin console — every call is server-side role-gated (admin middleware);
  // these methods exist for the operator UI, never for privilege itself.
  admin: {
    dashboard: () => request('/admin/dashboard').then((d) => d.data),
    users: (params = {}) => request(`/admin/users${queryString(params)}`),
    suspend: (id) => request(`/admin/users/${id}/suspend`, { method: 'PATCH' }).then((d) => d.data),
    reactivate: (id) => request(`/admin/users/${id}/reactivate`, { method: 'PATCH' }).then((d) => d.data),
    model: () => request('/admin/model').then((d) => d.data),
    errors: (params = {}) => request(`/admin/errors${queryString(params)}`),
    triage: (id, status) => request(`/admin/errors/${id}`, { method: 'PATCH', body: { status } }).then((d) => d.data),
  },

  predictions: {
    list: () => listAll('/predictions', 100),
    create: (payload) => request('/predictions', { method: 'POST', body: payload }).then((d) => d.data),
    remove: (id) => request(`/predictions/${id}`, { method: 'DELETE' }),
  },

  goals: {
    get: () => request('/goals').then((d) => d.data),
    update: (patch) => request('/goals', { method: 'PUT', body: patch }).then((d) => d.data),
    history: () => request('/goals/history').then((d) => d.data),
  },
};
