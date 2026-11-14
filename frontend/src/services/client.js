/** Laravel API facade. All account data is stored by the server, not seeded in the browser. */
import { resolveApiConfig } from './config.js';
import { reportClientError } from '../lib/errorMonitor.js';

const { base: BASE } = resolveApiConfig(import.meta.env);
const LEGACY_TOKEN_KEY = 'trana.token';
const unauthorizedListeners = new Set();
let csrfToken = null;
let csrfPromise = null;
let sessionAvailable = false;

// Remove tokens issued by older releases; all new sessions are HttpOnly cookies.
try {
  globalThis.localStorage?.removeItem(LEGACY_TOKEN_KEY);
} catch {
  // Storage may be unavailable in private browsing or during SSR.
}

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

async function ensureCsrfToken() {
  if (csrfToken) return csrfToken;
  if (csrfPromise) return csrfPromise;

  csrfPromise = (async () => {
    let response;
    try {
      response = await fetch(`${BASE}/api/auth/csrf`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
    } catch {
      throw new Error('Could not reach the TRANA API. Check that the backend is running and try again.');
    }
    const text = await response.text();
    const data = text ? safeJson(text) : null;
    if (!response.ok || typeof data?.csrfToken !== 'string' || !/^[a-f0-9]{64}$/.test(data.csrfToken)) {
      const error = new Error(data?.message || 'Could not prepare a secure request. Refresh the page and try again.');
      error.status = response.status;
      throw error;
    }
    csrfToken = data.csrfToken;
    return csrfToken;
  })().finally(() => {
    csrfPromise = null;
  });

  return csrfPromise;
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const requestMethod = String(method).toUpperCase();
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(requestMethod)) {
    headers['X-CSRF-TOKEN'] = await ensureCsrfToken();
  }

  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method: requestMethod,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
    });
  } catch {
    throw new Error('Could not reach the TRANA API. Check that the backend is running and try again.');
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    if (res.status >= 500) {
      reportClientError({
        message: `HTTP ${res.status} ${requestMethod} ${path}`,
        stack: data?.message || '',
      });
    }
    if (res.status === 419) csrfToken = null;
    if (res.status === 401 && auth && sessionAvailable) {
      sessionAvailable = false;
      csrfToken = null;
      unauthorizedListeners.forEach((listener) => listener());
    }
    const message = data?.message || (res.status >= 500
      ? 'The TRANA API is unavailable. Check that the backend and database are running.'
      : `Request failed (${res.status})`);
    const error = new Error(message);
    error.status = res.status;
    error.errors = data?.errors;
    error.code = data?.code;
    error.email = data?.email;
    error.expires_in = data?.expires_in;
    error.resend_after = data?.resend_after;
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

// Authenticated file download uses the HttpOnly cookie; credentials never
// appear in a URL, localStorage value, or JavaScript-readable response.
async function downloadFile(path, fallbackName) {
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      headers: { Accept: 'text/csv' },
      credentials: 'include',
    });
  } catch {
    throw new Error('Could not reach the TRANA API. Check that the backend is running and try again.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const data = safeJson(text);
    if (res.status === 401 && sessionAvailable) {
      sessionAvailable = false;
      unauthorizedListeners.forEach((listener) => listener());
    }
    const error = new Error(data?.message || `Export failed (${res.status}).`);
    error.status = res.status;
    throw error;
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
  if (!data?.user || typeof data.csrfToken !== 'string') {
    throw new Error('The TRANA API returned an invalid sign-in response.');
  }
  sessionAvailable = true;
  csrfToken = data.csrfToken;
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
    // This is only an in-memory UI hint; the actual credential is HttpOnly.
    hasToken: () => sessionAvailable,
    hasSession: () => sessionAvailable,
    async user() {
      try {
        const data = await request('/auth/me', { auth: false });
        if (!data?.user) throw new Error('The TRANA API returned an invalid account response.');
        sessionAvailable = true;
        return data.user;
      } catch (error) {
        if (error.status === 401) {
          sessionAvailable = false;
          return null;
        }
        throw error;
      }
    },
    register: (payload) => request('/auth/register', { method: 'POST', body: payload, auth: false }),
    verifyEmail: (payload) => request('/auth/email/verify', { method: 'POST', body: payload, auth: false }),
    resendVerification: (email) => request('/auth/email/resend', { method: 'POST', body: { email }, auth: false }),
    async login(identifier, password) {
      const data = await request('/auth/login', {
        method: 'POST',
        body: { identifier, password },
        auth: false,
      });
      return saveSession(data);
    },
    forgotPassword: (email) => request('/auth/password/forgot', { method: 'POST', body: { email }, auth: false }),
    resetPassword: (payload) => request('/auth/password/reset', { method: 'POST', body: payload, auth: false }),
    async logout() {
      try {
        if (sessionAvailable) await request('/auth/logout', { method: 'POST' });
      } finally {
        sessionAvailable = false;
        csrfToken = null;
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
    update: (id, payload) => request(`/activities/${id}`, { method: 'PATCH', body: payload }).then((d) => d.data),
    remove: (id) => request(`/activities/${id}`, { method: 'DELETE' }),
    exportCsv: () => downloadFile('/activities/export', 'trana-activities.csv'),
  },

  // Data rights: export lives under activities; erasure removes everything.
  account: {
    requestDeleteCode: () => request('/account/delete-code', { method: 'POST' }),
    delete: (code) => request('/account', {
      method: 'DELETE',
      body: { code, confirmation: 'DELETE' },
    }),
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

  fuelItems: {
    list: () => request('/fuel-items').then((d) => d.data),
    create: (payload) => request('/fuel-items', { method: 'POST', body: payload }).then((d) => d.data),
    update: (id, payload) => request(`/fuel-items/${id}`, { method: 'PATCH', body: payload }).then((d) => d.data),
    remove: (id) => request(`/fuel-items/${id}`, { method: 'DELETE' }),
  },

  gear: {
    list: () => request('/gear').then((d) => d.data),
    create: (payload) => request('/gear', { method: 'POST', body: payload }).then((d) => d.data),
    update: (id, payload) => request(`/gear/${id}`, { method: 'PATCH', body: payload }).then((d) => d.data),
    remove: (id) => request(`/gear/${id}`, { method: 'DELETE' }),
  },

  raceEvents: {
    list: () => request('/race-events').then((d) => d.data),
    create: (payload) => request('/race-events', { method: 'POST', body: payload }).then((d) => d.data),
    update: (id, payload) => request(`/race-events/${id}`, { method: 'PATCH', body: payload }).then((d) => d.data),
    remove: (id) => request(`/race-events/${id}`, { method: 'DELETE' }),
  },

  push: {
    status: () => request('/push/subscription').then((d) => d.data),
    subscribe: (payload) => request('/push/subscribe', { method: 'POST', body: payload }).then((d) => d.data),
    updatePreferences: (prefs) => request('/push/preferences', { method: 'PUT', body: prefs }).then((d) => d.data),
    unsubscribe: (endpoint) => request('/push/unsubscribe', { method: 'DELETE', body: endpoint ? { endpoint } : {} }),
  },
};
