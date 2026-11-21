import { flushSync, mount, unmount } from 'svelte';
import { activities, goals, modelCard, plans, profile, session } from '../../src/stores/index.js';
import Analytics from '../../src/pages/Analytics/Analytics.svelte';

const target = document.getElementById('app');
let component = null;

function seedStores(card) {
  profile.set({
    id: 7, name: 'Test Athlete', email: 'athlete@example.test', weight_kg: 62,
    sweat_profile: 'normal', typical_temperature_c: 26, experience_level: 2,
    units: 'metric', city: 'Quezon City, PH', onboarded: true,
    daily_calorie_goal: 2400, daily_distance_goal_km: 10, daily_active_min_goal: 60,
  });
  session.set({ id: 7, name: 'Test Athlete', email: 'athlete@example.test' });
  activities.set([]);
  plans.set([]);
  goals.set({ daily_calories: 2400, daily_distance_km: 10, daily_active_min: 60 });
  modelCard.set(card);
}

window.__analyticsTest = {
  seedStores,
  async mountAnalytics() {
    if (component) await unmount(component);
    component = mount(Analytics, { target });
    flushSync();
  },
  flush: flushSync,
  async destroy() {
    if (component) await unmount(component);
    component = null;
  },
};
