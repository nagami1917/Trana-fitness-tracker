/**
 * TRANA daily session service.
 *
 * Manages daily progress tracking that resets at midnight:
 * - calories burned (from activity map tracking)
 * - calories eaten (from food log: breakfast, lunch, dinner, snack)
 * - water intake
 * - net calories and surplus/deficit calculation
 *
 * Food names are free-text — no predefined dataset required.
 */

import { api } from './client.js';

function toQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

export const dailySessionApi = {
  /** List all daily sessions for the authenticated user. Supports ?from=&to=&limit=&page=. */
  list(params = {}) {
    return api.request(`/daily-sessions${toQuery(params)}`, { method: 'GET', auth: true });
  },

  /** Get today's session (`{ data: session | null }`). */
  today() {
    return api.request('/daily-sessions/today', { method: 'GET', auth: true });
  },

  /** Create or update today's session (`{ data: session }`). */
  saveToday(payload = {}) {
    return api.request('/daily-sessions/today', {
      method: 'POST',
      body: payload,
      auth: true,
    });
  },

  /** Get one session with all its foods (`{ data: session }`). */
  get(id) {
    return api.request(`/daily-sessions/${id}`, { method: 'GET', auth: true });
  },

  /** Update a session (`{ data: session }`). */
  update(id, payload) {
    return api.request(`/daily-sessions/${id}`, {
      method: 'PUT',
      body: payload,
      auth: true,
    });
  },

  /** Delete a session and all its foods. */
  remove(id) {
    return api.request(`/daily-sessions/${id}`, {
      method: 'DELETE',
      auth: true,
    });
  },

  /** Add a food item to a session (`{ data: food, session }`). */
  addFood(sessionId, payload) {
    return api.request(`/daily-sessions/${sessionId}/foods`, {
      method: 'POST',
      body: payload,
      auth: true,
    });
  },

  /** Update a food item (`{ data: food, session }`). */
  updateFood(sessionId, foodId, payload) {
    return api.request(`/daily-sessions/${sessionId}/foods/${foodId}`, {
      method: 'PUT',
      body: payload,
      auth: true,
    });
  },

  /** Delete a food item (`{ deleted: true, session }`). */
  removeFood(sessionId, foodId) {
    return api.request(`/daily-sessions/${sessionId}/foods/${foodId}`, {
      method: 'DELETE',
      auth: true,
    });
  },
};

/**
 * Helper: compute today's local date string in YYYY-MM-DD format.
 */
export function todayDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split('T')[0];
}

/**
 * Helper: format a YYYY-MM-DD or ISO session date safely without UTC day shifts.
 */
export function formatSessionDate(value, options = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!value) return '';
  const text = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00`) : new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString(undefined, options);
}

/**
 * Helper: summarize a session's macros from its foods.
 */
export function summarizeFoods(foods = []) {
  return foods.reduce(
    (acc, f) => {
      acc.calories += Number(f.calories) || 0;
      acc.carbs += Number(f.carbs_g) || 0;
      acc.protein += Number(f.protein_g) || 0;
      acc.fat += Number(f.fat_g) || 0;
      acc.count += 1;
      return acc;
    },
    { calories: 0, carbs: 0, protein: 0, fat: 0, count: 0 },
  );
}

/**
 * Group foods by meal type.
 */
export function groupFoodsByMeal(foods = []) {
  const meals = { breakfast: [], lunch: [], dinner: [], snack: [] };
  foods.forEach((f) => {
    if (meals[f.meal_type]) meals[f.meal_type].push(f);
  });
  return meals;
}
