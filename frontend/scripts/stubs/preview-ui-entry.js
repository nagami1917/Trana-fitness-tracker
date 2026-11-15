import { flushSync, mount, unmount } from 'svelte';
import Preview from '../../src/pages/Preview/Preview.svelte';

const component = mount(Preview, { target: document.getElementById('app') });
window.flushPreviewTest = flushSync;
window.destroyPreviewTest = () => unmount(component);
