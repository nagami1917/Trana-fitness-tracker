import { flushSync, mount, unmount } from 'svelte';
import Login from '../../src/pages/Login/Login.svelte';
import Register from '../../src/pages/Register/Register.svelte';

const mounts = [];
window.mountAuth = (which, props = {}) => {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const component = which === 'register'
    ? mount(Register, { target })
    : mount(Login, { target, props });
  mounts.push(component);
  flushSync();
  return target;
};
window.flushAuth = flushSync;
window.destroyAuth = () => { mounts.forEach((m) => unmount(m)); mounts.length = 0; document.body.innerHTML = ''; };
