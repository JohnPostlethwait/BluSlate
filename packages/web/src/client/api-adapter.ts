/**
 * Web API adapter — implements the same window.api interface as the Electron
 * preload script, but uses Socket.IO for real-time events and fetch for
 * request/response operations.
 *
 * When a password is provided (BLUSLATE_PASSWORD is set on the server) it:
 *  - Passes it as the Socket.IO auth handshake token
 *  - Adds an Authorization: Basic header to every fetch request
 */

import { io, type Socket } from 'socket.io-client';

/** Pending directory selection resolve callback, set by DirectoryPicker */
let directoryResolve: ((path: string | null) => void) | null = null;

export function resolveDirectorySelection(path: string | null): void {
  if (directoryResolve) {
    directoryResolve(path);
    directoryResolve = null;
  }
}

function buildAuthHeader(password: string): string {
  // RFC 7617: Basic auth — username is empty, password only
  return 'Basic ' + btoa(':' + password);
}

async function authFetch(url: string, password: string | undefined, init: RequestInit = {}): Promise<Response> {
  const headers = password ? new Headers(init.headers) : undefined;
  if (headers && password) {
    headers.set('Authorization', buildAuthHeader(password));
  }
  const res = await fetch(url, headers ? { ...init, headers } : init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `Request failed: ${res.status} ${res.statusText}`);
  }
  return res;
}

export function createWebApi(password?: string): Window['api'] {
  const socketOpts = password
    ? { transports: ['websocket'], auth: { password } }
    : { transports: ['websocket'] };

  const socket: Socket = io(socketOpts);

  function on<T>(event: string, callback: (data: T) => void): () => void {
    socket.on(event, callback);
    return () => { socket.off(event, callback); };
  }

  return {
    // --- Directory selection (handled by DirectoryBrowser modal) ---
    selectDirectory(): Promise<string | null> {
      return new Promise((resolve) => {
        directoryResolve = resolve;
        window.dispatchEvent(new CustomEvent('bluslate:openDirectoryBrowser'));
      });
    },

    // --- Pipeline control (fire-and-forget via Socket.IO) ---
    startPipeline(options) {
      socket.emit('pipeline:start', options);
    },
    cancelPipeline() {
      socket.emit('pipeline:cancel');
    },

    // --- Event listeners (Socket.IO → callback, return unsubscribe) ---
    onProgress(callback) {
      const handlers = {
        start: (data: { message?: string }) => callback('start', data),
        update: (data: { message?: string }) => callback('update', data),
        succeed: (data: { message?: string }) => callback('succeed', data),
        fail: (data: { message?: string }) => callback('fail', data),
        stop: () => callback('stop', {}),
      };
      socket.on('progress:start', handlers.start);
      socket.on('progress:update', handlers.update);
      socket.on('progress:succeed', handlers.succeed);
      socket.on('progress:fail', handlers.fail);
      socket.on('progress:stop', handlers.stop);
      return () => {
        socket.off('progress:start', handlers.start);
        socket.off('progress:update', handlers.update);
        socket.off('progress:succeed', handlers.succeed);
        socket.off('progress:fail', handlers.fail);
        socket.off('progress:stop', handlers.stop);
      };
    },
    onResults(callback) {
      return on('results:display', callback);
    },
    onSummary(callback) {
      return on('results:summary', callback);
    },
    onConfirmRenames(callback) {
      return on('prompt:confirmRenames', callback);
    },
    onConfirmShow(callback) {
      return on('prompt:confirmShow', callback);
    },
    onConfirmDvdCompare(callback) {
      return on('prompt:confirmDvdCompare', callback);
    },
    onPipelineComplete(callback) {
      return on('pipeline:complete', callback);
    },
    onPipelineError(callback) {
      return on('pipeline:error', callback);
    },
    onMenuOpenDirectory(_callback) {
      // No menu in web — noop, return noop unsubscribe
      return () => {};
    },

    // --- Response senders (user answers prompts) ---
    respondConfirmRenames(confirmed) {
      socket.emit('prompt:confirmRenames:response', { confirmed });
    },
    respondConfirmShow(selected) {
      socket.emit('prompt:confirmShow:response', { selected });
    },
    respondConfirmDvdCompare(selected) {
      socket.emit('prompt:confirmDvdCompare:response', { selected });
    },

    // --- Request/response via HTTP fetch ---
    async regenerateFilenames(items) {
      const res = await authFetch('/api/regenerate-filenames', password, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      return data.filenames;
    },
    async undoRenames(directory) {
      const res = await authFetch('/api/undo', password, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory }),
      });
      return res.json();
    },
    async checkFfprobe() {
      const res = await authFetch('/api/ffprobe/check', password);
      const data = await res.json();
      return data.available;
    },
    async loadSettings() {
      const res = await authFetch('/api/settings', password);
      return res.json();
    },
    async saveApiKey(apiKey) {
      await authFetch('/api/settings/api-key', password, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
    },
    async getRecentDirectories() {
      const res = await authFetch('/api/settings/recent-directories', password);
      const data = await res.json();
      return data.directories;
    },
  };
}
