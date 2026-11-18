import { flushSync, mount, unmount } from 'svelte';
import { profile } from '../../src/stores/index.js';
import PastSessions from '../../src/components/settings/PastSessions.svelte';

const target = document.getElementById('app');
let component = null;

window.__pastSessionsTest = {
  mount() {
    // unitSystem is derived from profile.units, not a writable store.
    profile.set({ id: 1, name: 'Test Athlete', units: 'metric', weight_kg: 62 });
    component = mount(PastSessions, { target });
    flushSync();
  },
  flush: flushSync,
  async destroy() {
    if (component) await unmount(component);
    component = null;
  },
};
