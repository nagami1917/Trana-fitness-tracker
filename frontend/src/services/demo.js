/**
 * Demo API — a local stand-in for the Laravel backend.
 *
 * Everything is persisted to localStorage and shaped exactly like the JSON the
 * real API returns. Predictions run through the same ported ML engine that the
 * offline PWA uses, so demo mode is a genuine end-to-end exercise of the
 * product rather than a mock-up of numbers.
 */

import { createSeedState } from './seed.js';
import { predictPlan } from '../ml/index.js';

const KEY = 'trana.demo.v1';

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = () => listeners.forEach((fn) => fn());

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* corrupted storage — fall through to a fresh seed */
  }
  const fresh = createSeedState();
  persist(fresh);
  return fresh;
}

function persist(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked — demo keeps working in memory */
  }
}

let state = load();

const clone = (value) => JSON.parse(JSON.stringify(value));
const nextId = (rows) => (rows.length ? Math.max(...rows.map((r) => r.id)) + 1 : 1);

export const demoApi = {
  mode: 'demo',

  auth: {
    async user() {
      return state.session ? clone(state.session) : null;
    },
    async login({ email }) {
      const name = email?.split('@')[0] || 'Nagami';
      state.profile.name = name.charAt(0).toUpperCase() + name.slice(1);
      state.session = { id: 1, name: state.profile.name, email: email || 'you@trana.app' };
      persist(state);
      emit();
      return clone(state.session);
    },
    async demo() {
      state.session = { id: 1, name: state.profile.name, email: state.profile.email };
      persist(state);
      emit();
      return clone(state.session);
    },
    async logout() {
      state.session = null;
      persist(state);
      emit();
    },
  },

  profile: {
    async get() {
      return clone(state.profile);
    },
    async update(patch) {
      state.profile = { ...state.profile, ...patch };
      if (state.session) state.session.name = state.profile.name;
      persist(state);
      emit();
      return clone(state.profile);
    },
  },

  activities: {
    async list() {
      return clone(state.activities).sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
    },
    async create(payload) {
      const row = {
        id: nextId(state.activities),
        source: 'manual',
        notes: null,
        route: null,
        ...payload,
      };
      state.activities.push(row);
      persist(state);
      emit();
      return clone(row);
    },
    async remove(id) {
      state.activities = state.activities.filter((a) => a.id !== id);
      persist(state);
      emit();
      return { deleted: true };
    },
  },

  predictions: {
    async create(payload) {
      const result = await predictPlan({
        activity: payload,
        profile: state.profile,
        activities: state.activities,
      });
      const row = {
        id: nextId(state.plans),
        ...result,
        status: payload.status || 'planned',
        planned_for: payload.planned_for || null,
        created_at: new Date().toISOString(),
      };
      state.plans.unshift(row);
      persist(state);
      emit();
      return clone(row);
    },
    async list() {
      return clone(state.plans);
    },
    async remove(id) {
      state.plans = state.plans.filter((p) => p.id !== id);
      persist(state);
      emit();
      return { deleted: true };
    },
  },

  goals: {
    async get() {
      return clone(state.goals);
    },
    async update(patch) {
      state.goals = { ...state.goals, ...patch };
      persist(state);
      emit();
      return clone(state.goals);
    },
  },

  async reset() {
    state = createSeedState();
    persist(state);
    emit();
    return { reset: true };
  },
};
