import { flushSync, mount, unmount } from 'svelte';
import Login from '../../src/pages/Login/Login.svelte';

const component = mount(Login, { target: document.getElementById('app') });
window.flushLoginTest = flushSync;
window.destroyLoginTest = () => unmount(component);
