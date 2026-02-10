import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'node:path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { runPipeline, buildConfig } from '@mediafetch/core';
import { createGuiAdapter } from './gui-adapter.js';

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'MediaFetch',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Load renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}

app.whenReady().then(() => {
  // Set app user model ID for Windows notifications
  electronApp.setAppUserModelId('com.mediafetch.app');

  // Default open/close shortcuts for dev
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  const mainWindow = createWindow();

  // --- IPC Handlers ---

  // Directory picker
  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select media directory',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Run the rename pipeline
  ipcMain.on(
    'pipeline:start',
    async (_event, options: { directory: string; apiKey: string; dryRun: boolean; recursive: boolean; language: string; autoAccept: boolean; minConfidence: number; template?: string; mediaType?: string }) => {
      const ui = createGuiAdapter(mainWindow);

      try {
        const config = await buildConfig({
          directory: options.directory,
          apiKey: options.apiKey,
          dryRun: options.dryRun,
          recursive: options.recursive,
          lang: options.language,
          yes: options.autoAccept,
          minConfidence: options.minConfidence,
          template: options.template,
          type: options.mediaType ?? 'auto',
        });

        await runPipeline(config, ui);
        mainWindow.webContents.send('pipeline:complete', { success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred';
        mainWindow.webContents.send('pipeline:error', { message });
      }
    },
  );

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
