import { flushSync, mount, unmount } from 'svelte';
import PlanActivity from '../../src/pages/PlanActivity/PlanActivity.svelte';
import { profile, activities, goals, plans, session } from '../../src/stores/index.js';

const target = document.getElementById('app');
let component = null;

window.flushPlanTest = flushSync;
window.mountPlanTest = () => {
  component = mount(PlanActivity, { target });
};
window.destroyPlanTest = async () => {
  if (component) await unmount(component);
  component = null;
};
window.seedPlanTest = ({ profile: p, activities: a, goals: g, plans: pl }) => {
  if (p) profile.set(p);
  if (a) activities.set(a);
  if (g) goals.set(g);
  if (pl) plans.set(pl);
  session.set({ id: 1, name: 'Test Athlete', email: 'athlete@example.test' });
};
