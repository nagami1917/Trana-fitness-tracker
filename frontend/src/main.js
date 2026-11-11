import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { installErrorMonitor } from './lib/errorMonitor.js';

// Capture uncaught faults app-wide before anything else can throw.
installErrorMonitor();

const app = mount(App, { target: document.getElementById('app') });

export default app;
