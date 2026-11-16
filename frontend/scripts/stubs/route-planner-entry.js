import { flushSync, mount, unmount } from 'svelte';
import { getCreatedMaps, getWorkerUrl } from 'maplibre-gl';
import RoutePlannerHarness from './RoutePlannerHarness.svelte';

const target = document.getElementById('app');
const component = mount(RoutePlannerHarness, { target });

window.__routePlannerTest = {
  flush: flushSync,
  setState: (next) => {
    component.setRouteState(next);
    flushSync();
  },
  getFollowing: () => component.getFollowing(),
  getMap: () => getCreatedMaps()[0] ?? null,
  getWorkerUrl,
  destroy: async () => {
    await unmount(component);
  },
};
