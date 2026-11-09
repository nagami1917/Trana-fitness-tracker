import { flushSync, mount, unmount } from 'svelte';
import { profile, session } from '../../src/stores/index.js';
import LocationInputHarness from './LocationInputHarness.svelte';
import Profile from '../../src/pages/Profile/Profile.svelte';
import Settings from '../../src/pages/Settings/Settings.svelte';
import Onboarding from '../../src/pages/Onboarding/Onboarding.svelte';

const target = document.getElementById('app');
let component = mount(LocationInputHarness, { target });
window.flushLocationTest = flushSync;
window.destroyLocationTest = async () => {
  if (component) await unmount(component);
  component = null;
};
window.mountLocationTestPage = async (name, data) => {
  await window.destroyLocationTest();
  profile.set(data);
  session.set({ id: data.id, name: data.name, email: data.email });
  component = mount({ Profile, Settings, Onboarding }[name], { target });
};
