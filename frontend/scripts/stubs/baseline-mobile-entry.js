import { flushSync, mount, unmount } from 'svelte';
import { goals, profile, session } from '../../src/stores/index.js';
import Onboarding from '../../src/pages/Onboarding/Onboarding.svelte';

const target = document.getElementById('app');
let component = null;

window.__baselineMobileTest = {
  mount() {
    profile.set({ id: 1, name: 'Test Athlete', units: 'metric', weight_kg: 62, sweat_profile: 'normal',
      typical_temperature_c: 26, experience_level: 3, onboarded: false });
    session.set({ id: 1, name: 'Test Athlete', email: 'athlete@example.test' });
    goals.set({});
    component = mount(Onboarding, { target });
    flushSync();
  },
  flush: flushSync,
  async destroy() {
    if (component) await unmount(component);
    component = null;
  },
};
