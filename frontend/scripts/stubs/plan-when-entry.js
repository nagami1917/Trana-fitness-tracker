import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { activities, goals, plans, profile, session, toast } from '../../src/stores/index.js';
import { route } from '../../src/lib/router.js';
import { toDatetimeLocal } from '../../src/lib/format.js';
import Calendar from '../../src/pages/Calendar/Calendar.svelte';
import PlanActivity from '../../src/pages/PlanActivity/PlanActivity.svelte';
import { getCreatedMaps } from './maplibre-gl-interactive.js';

const target = document.getElementById('app');
let component = null;

function seedBaseStores(initialActivities = [], initialPlans = []) {
  profile.set({
    id: 1,
    name: 'Test Athlete',
    email: 'athlete@example.test',
    weight_kg: 62,
    sweat_profile: 'normal',
    typical_temperature_c: 26,
    experience_level: 2,
    units: 'metric',
    onboarded: true,
  });
  session.set({ id: 1, name: 'Test Athlete', email: 'athlete@example.test' });
  activities.set(initialActivities);
  goals.set({});
  plans.set(initialPlans);
}

window.__planWhenTest = {
  toDatetimeLocal,
  async mountCalendar({ initialActivities = [], initialPlans = [] } = {}) {
    if (component) await unmount(component);
    seedBaseStores(initialActivities, initialPlans);
    component = mount(Calendar, { target });
    flushSync();
  },
  async mountPlan() {
    if (component) await unmount(component);
    component = mount(PlanActivity, { target });
    flushSync();
  },
  getRoute: () => get(route),
  getPlans: () => get(plans),
  getToast: () => get(toast),
  getLatestMap: () => getCreatedMaps().at(-1) ?? null,
  flush: flushSync,
  async destroy() {
    if (component) await unmount(component);
    component = null;
  },
};
