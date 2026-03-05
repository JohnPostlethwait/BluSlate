import { createWebApi } from './api-adapter.js';
import App from './App.svelte';
import { mount } from 'svelte';

const SESSION_KEY = 'bluslate_password';

/** Render a minimal login form, resolve with the submitted password. */
function promptPassword(): Promise<string> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:#0f172a;display:flex;align-items:center;justify-content:center;z-index:9999';

    overlay.innerHTML = `
      <form id="bs-login" style="background:#1e293b;padding:2rem;border-radius:8px;width:320px;display:flex;flex-direction:column;gap:1rem;color:#f1f5f9;font-family:sans-serif">
        <h2 style="margin:0;font-size:1.25rem">BluSlate — Sign in</h2>
        <label style="font-size:.875rem">
          Password
          <input id="bs-pw" type="password" autocomplete="current-password" required
            style="display:block;width:100%;margin-top:.25rem;padding:.5rem;border:1px solid #334155;border-radius:4px;background:#0f172a;color:#f1f5f9;box-sizing:border-box"/>
        </label>
        <div id="bs-err" style="color:#f87171;font-size:.8rem;display:none"></div>
        <button type="submit"
          style="padding:.6rem;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:1rem">
          Sign in
        </button>
      </form>`;

    document.body.appendChild(overlay);

    const form = overlay.querySelector('#bs-login') as HTMLFormElement;
    const input = overlay.querySelector('#bs-pw') as HTMLInputElement;
    input.focus();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const pw = input.value;
      if (!pw) return;
      overlay.remove();
      resolve(pw);
    });
  });
}

async function init(): Promise<void> {
  let password: string | undefined = sessionStorage.getItem(SESSION_KEY) ?? undefined;

  // Probe the server — 401 means auth is required
  const probe = await fetch('/api/ffprobe/check', password
    ? { headers: { Authorization: 'Basic ' + btoa(':' + password) } }
    : undefined);

  if (probe.status === 401) {
    // Saved password was wrong (or none stored) — ask the user
    sessionStorage.removeItem(SESSION_KEY);
    password = await promptPassword();

    // Verify the supplied password before proceeding
    const verify = await fetch('/api/ffprobe/check', {
      headers: { Authorization: 'Basic ' + btoa(':' + password) },
    });

    if (verify.status === 401) {
      // Wrong password — show error and retry by reloading
      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;background:#0f172a;display:flex;align-items:center;justify-content:center;z-index:9999;color:#f87171;font-family:sans-serif;font-size:1.1rem';
      overlay.textContent = 'Incorrect password — reloading…';
      document.body.appendChild(overlay);
      setTimeout(() => window.location.reload(), 1500);
      return;
    }

    sessionStorage.setItem(SESSION_KEY, password);
  } else {
    // No auth required or credentials are valid
    password = password ?? undefined;
  }

  window.api = createWebApi(password);

  mount(App, { target: document.getElementById('app')! });
}

init().catch((err) => {
  console.error('BluSlate init failed:', err);
});
