import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { profile, session, toast } from '../../src/stores/index.js';
import SessionDetail from '../../src/pages/Track/SessionDetail.svelte';
import { dailySessionApi } from '../../src/services/dailySessionService.js';

const target = document.getElementById('app');
let component = null;
let nextPayload = { data: null };

// Replace the network layer: the page must render from whatever the API returns.
dailySessionApi.get = async () => nextPayload;

window.__sessionDetailTest = {
  mount(payload) {
    nextPayload = payload;
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
    component = mount(SessionDetail, { target, props: { sessionId: 7 } });
    flushSync();
  },
  flush: flushSync,
  getToast: () => get(toast),
  destroy: async () => {
    if (component) await unmount(component);
    component = null;
  },
};
