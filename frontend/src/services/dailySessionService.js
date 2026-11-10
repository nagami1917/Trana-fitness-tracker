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

export const dailySessionApi = {
  /** List all daily sessions for the authenticated user. Supports ?from=&to= date range. */
  list(params = {}) {
    return api.request('/api/daily-sessions', { method: 'GET', auth: true }).then((d) => d.data);
  },

  /** Get or create today's session. POST to create/update. */
  today() {
    return api.request('/api/daily-sessions/today', { method: 'GET', auth: true }).then((d) => d.data);
  },

  /** Save/update today's session (calories burned/eaten, water, notes). */
  saveToday(payload) {
    return api.request('/api/daily-sessions/today', {
      method: 'POST',
      body: payload,
      auth: true,
    }).then((d) => d.data);
  },

  /** Get one session with all its foods. */
  get(id) {
    return api.request(`/api/daily-sessions/${id}`, { method: 'GET', auth: true }).then((d) => d.data);
  },

  /** Update a session. */
  update(id, payload) {
    return api.request(`/api/daily-sessions/${id}`, {
      method: 'PUT',
      body: payload,
      auth: true,
    }).then((d) => d.data);
  },

  /** Delete a session and all its foods. */
  remove(id) {
    return api.request(`/api/daily-sessions/${id}`, {
      method: 'DELETE',
      auth: true,
    }).then((d) => d.data);
  },

  /** Add a food item to a session. */
  addFood(sessionId, payload) {
    return api.request(`/api/daily-sessions/${sessionId}/foods`, {
      method: 'POST',
      body: payload,
      auth: true,
    }).then((d) => d.data);
  },

  /** Update a food item. */
  updateFood(sessionId, foodId, payload) {
    return api.request(`/api/daily-sessions/${sessionId}/foods/${foodId}`, {
      method: 'PUT',
      body: payload,
      auth: true,
    }).then((d) => d.data);
  },

  /** Delete a food item. */
  removeFood(sessionId, foodId) {
    return api.request(`/api/daily-sessions/${sessionId}/foods/${foodId}`, {
      method: 'DELETE',
      auth: true,
    }).then((d) => d.data);
  },
};

/**
 * Helper: compute today's date string in YYYY-MM-DD format.
 */
export function todayDate() {
  return new Date().toISOString().split('T')[0];
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
