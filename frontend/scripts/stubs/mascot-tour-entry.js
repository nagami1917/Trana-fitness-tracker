import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import App from '../../src/App.svelte';
import { bootstrap, profile, session, activities, plans, goals } from '../../src/stores/index.js';
import { navigate, route } from '../../src/lib/router.js';
import { mascotTour } from '../../src/lib/mascotTour.svelte.js';

const target = document.getElementById('app');
let component = null;

window.__mascotTourTest = {
  mascotTour,
  getRoute: () => get(route),
  getProfile: () => get(profile),
  getSession: () => get(session),
  getActivities: () => get(activities),
  getPlans: () => get(plans),
  getGoals: () => get(goals),
  navigate,
  flush: flushSync,
  async mountApp() {
    if (component) await unmount(component);
    component = mount(App, { target });
    flushSync();
  },
  async rebootstrap() {
    mascotTour.resetForTests();
    await bootstrap();
    flushSync();
  },
  async destroy() {
    if (component) await unmount(component);
    mascotTour.resetForTests();
    component = null;
  },
};
