import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { activities, goals, plans, profile, session, toast } from '../../src/stores/index.js';
import PlanActivity from '../../src/pages/PlanActivity/PlanActivity.svelte';

const target = document.getElementById('app');
let component = null;

window.__savedPlansTest = {
  mount(initialPlans) {
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
    activities.set([]);
    goals.set({});
    plans.set(initialPlans);
    component = mount(PlanActivity, { target });
    flushSync();
  },
  flush: flushSync,
  getPlans: () => get(plans),
  getToast: () => get(toast),
  destroy: async () => {
    if (component) await unmount(component);
    component = null;
  },
};
