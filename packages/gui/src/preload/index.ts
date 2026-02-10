import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';

// Custom API exposed to the renderer
const api = {
  // Directory picker
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectDirectory'),

  // Start the pipeline
  startPipeline: (options: {
    directory: string;
    apiKey: string;
    dryRun: boolean;
    recursive: boolean;
    language: string;
    autoAccept: boolean;
    minConfidence: number;
    template?: string;
    mediaType?: string;
  }): void => {
    ipcRenderer.send('pipeline:start', options);
  },

  // Listen for pipeline events from main process
  onProgress: (
    callback: (event: string, data: { message?: string }) => void,
  ): (() => void) => {
    const handlers = {
      start: (_e: unknown, data: { message: string }) => callback('start', data),
      update: (_e: unknown, data: { message: string }) => callback('update', data),
      succeed: (_e: unknown, data: { message?: string }) => callback('succeed', data),
      fail: (_e: unknown, data: { message?: string }) => callback('fail', data),
      stop: () => callback('stop', {}),
    };

    ipcRenderer.on('progress:start', handlers.start);
    ipcRenderer.on('progress:update', handlers.update);
    ipcRenderer.on('progress:succeed', handlers.succeed);
    ipcRenderer.on('progress:fail', handlers.fail);
    ipcRenderer.on('progress:stop', handlers.stop);

    return () => {
      ipcRenderer.removeListener('progress:start', handlers.start);
      ipcRenderer.removeListener('progress:update', handlers.update);
      ipcRenderer.removeListener('progress:succeed', handlers.succeed);
      ipcRenderer.removeListener('progress:fail', handlers.fail);
      ipcRenderer.removeListener('progress:stop', handlers.stop);
    };
  },

  // Listen for results display
  onResults: (callback: (data: { matches: unknown[]; scanDirectory: string }) => void): (() => void) => {
    const handler = (_e: unknown, data: { matches: unknown[]; scanDirectory: string }) => callback(data);
    ipcRenderer.on('results:display', handler);
    return () => ipcRenderer.removeListener('results:display', handler);
  },

  // Listen for summary
  onSummary: (
    callback: (data: { renamed: number; skipped: number; failed: number; dryRun: boolean }) => void,
  ): (() => void) => {
    const handler = (_e: unknown, data: { renamed: number; skipped: number; failed: number; dryRun: boolean }) => callback(data);
    ipcRenderer.on('results:summary', handler);
    return () => ipcRenderer.removeListener('results:summary', handler);
  },

  // Listen for rename confirmation prompt
  onConfirmRenames: (callback: (data: { matches: unknown[] }) => void): (() => void) => {
    const handler = (_e: unknown, data: { matches: unknown[] }) => callback(data);
    ipcRenderer.on('prompt:confirmRenames', handler);
    return () => ipcRenderer.removeListener('prompt:confirmRenames', handler);
  },

  // Send rename confirmation response
  respondConfirmRenames: (confirmed: unknown[]): void => {
    ipcRenderer.send('prompt:confirmRenames:response', { confirmed });
  },

  // Listen for show identification prompt
  onConfirmShow: (
    callback: (data: { showName: string; candidates: unknown[] }) => void,
  ): (() => void) => {
    const handler = (_e: unknown, data: { showName: string; candidates: unknown[] }) => callback(data);
    ipcRenderer.on('prompt:confirmShow', handler);
    return () => ipcRenderer.removeListener('prompt:confirmShow', handler);
  },

  // Send show identification response
  respondConfirmShow: (selected: unknown | null): void => {
    ipcRenderer.send('prompt:confirmShow:response', { selected });
  },

  // Listen for pipeline completion
  onPipelineComplete: (callback: (data: { success: boolean }) => void): (() => void) => {
    const handler = (_e: unknown, data: { success: boolean }) => callback(data);
    ipcRenderer.on('pipeline:complete', handler);
    return () => ipcRenderer.removeListener('pipeline:complete', handler);
  },

  // Listen for pipeline errors
  onPipelineError: (callback: (data: { message: string }) => void): (() => void) => {
    const handler = (_e: unknown, data: { message: string }) => callback(data);
    ipcRenderer.on('pipeline:error', handler);
    return () => ipcRenderer.removeListener('pipeline:error', handler);
  },

  // Menu events
  onMenuOpenDirectory: (callback: (directory: string) => void): (() => void) => {
    const handler = (_e: unknown, directory: string): void => callback(directory);
    ipcRenderer.on('menu:openDirectory', handler);
    return () => ipcRenderer.removeListener('menu:openDirectory', handler);
  },

  // Settings
  loadSettings: (): Promise<{ apiKey?: string; recentDirectories: string[] }> =>
    ipcRenderer.invoke('settings:load'),

  saveApiKey: (apiKey: string): Promise<void> =>
    ipcRenderer.invoke('settings:saveApiKey', apiKey),

  getRecentDirectories: (): Promise<string[]> =>
    ipcRenderer.invoke('settings:getRecentDirectories'),
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-expect-error fallback for non-isolated contexts
  window.electron = electronAPI;
  // @ts-expect-error fallback for non-isolated contexts
  window.api = api;
}
