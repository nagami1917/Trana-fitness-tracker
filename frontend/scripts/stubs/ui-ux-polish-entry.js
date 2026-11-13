import { flushSync, mount, unmount } from 'svelte';
import { activities, notify, plans, profile, session } from '../../src/stores/index.js';
import Settings from '../../src/pages/Settings/Settings.svelte';
import Onboarding from '../../src/pages/Onboarding/Onboarding.svelte';
import Toaster from '../../src/components/common/Toaster.svelte';
import AppShell from '../../src/components/common/AppShell.svelte';
import TrackActivityPrompt from '../../src/components/dashboard/TrackActivityPrompt.svelte';
import ModalHarness from './ModalHarness.svelte';

const target = document.getElementById('app');
let component = null;

window.__polishTest = {
  flush: flushSync,
  notify,
  setActivities(list) {
    activities.set(list);
  },
  async mountView(name, props = {}) {
    if (component) {
      await unmount(component);
      component = null;
    }
    profile.set({
      id: 1,
      name: 'Aria',
      email: 'aria@example.test',
      weight_kg: 60,
      units: 'metric',
      onboarded: true,
      sweat_profile: 'normal',
      experience_level: 3,
      typical_temperature_c: 26,
      total_activities: 4,
    });
    session.set({ id: 1, name: 'Aria', email: 'aria@example.test', role: 'user' });
    plans.set([]);
    const map = { Settings, Onboarding, Toaster, AppShell, TrackActivityPrompt, ModalHarness };
    component = mount(map[name], { target, props });
    flushSync();
    return component;
  },
};
