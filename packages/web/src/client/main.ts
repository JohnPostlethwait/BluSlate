import { createWebApi } from './api-adapter.js';
import App from './App.svelte';
import { mount } from 'svelte';

// Set up window.api using Socket.IO + fetch (replaces Electron preload)
window.api = createWebApi();

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
