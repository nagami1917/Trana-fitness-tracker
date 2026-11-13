import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { activities, goals, modelCard, plans, profile, session, toast } from '../../src/stores/index.js';
import { route } from '../../src/lib/router.js';
import { liveTracker } from '../../src/lib/liveTracker.svelte.js';
import Track from '../../src/pages/Track/Track.svelte';
import Dashboard from '../../src/pages/Dashboard/Dashboard.svelte';
import { getCreatedMaps } from './maplibre-gl-interactive.js';
import { getLeafletMaps } from './leaflet-interactive.js';

const target = document.getElementById('app');
let component = null;

function seedStores(initialActivities = []) {
  profile.set({
    id: 7,
    name: 'Test Athlete',
    email: 'athlete@example.test',
    weight_kg: 62,
    sweat_profile: 'normal',
    typical_temperature_c: 26,
    experience_level: 2,
    units: 'metric',
    city: 'Quezon City, PH',
    onboarded: true,
    daily_calorie_goal: 2400,
    daily_distance_goal_km: 10,
    daily_active_min_goal: 60,
  });
  session.set({ id: 7, name: 'Test Athlete', email: 'athlete@example.test' });
  activities.set(initialActivities);
  goals.set({ daily_calories: 2400, daily_distance_km: 10, daily_active_min: 60 });
  plans.set([]);
  modelCard.set({ training_source: 'synthetic', version: 'test' });
}

window.__dashboardTrackTest = {
  liveTracker,
  seedStores,
  signOutSession() {
    session.set(null);
    flushSync();
  },
  async mountDashboard() {
    if (component) await unmount(component);
    component = mount(Dashboard, { target });
    flushSync();
  },
  async mountTrack() {
    if (component) await unmount(component);
    component = mount(Track, { target });
    flushSync();
  },
  getRoute: () => get(route),
  getActivities: () => get(activities),
  getToast: () => get(toast),
  getMapLibreMaps: () => getCreatedMaps(),
  getLeafletMaps,
  flush: flushSync,
  async destroy() {
    if (component) await unmount(component);
    liveTracker.resetAll();
    component = null;
  },
};
