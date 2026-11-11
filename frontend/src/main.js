import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { installErrorMonitor } from './lib/errorMonitor.js';

// Capture uncaught faults app-wide before anything else can throw.
installErrorMonitor();

// Ensure returning visitors automatically refresh into newly deployed PWA
// builds instead of remaining on an older precached bundle.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) {
      reloaded = true;
      window.location.reload();
    }
  });
}

const app = mount(App, { target: document.getElementById('app') });

export default app;
