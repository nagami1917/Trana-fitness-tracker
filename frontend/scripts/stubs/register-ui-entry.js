import { flushSync, mount, unmount } from 'svelte';
import Register from '../../src/pages/Register/Register.svelte';

const component = mount(Register, { target: document.getElementById('app') });
window.flushRegisterTest = flushSync;
window.destroyRegisterTest = () => unmount(component);
