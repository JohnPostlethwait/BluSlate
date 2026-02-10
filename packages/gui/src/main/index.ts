import { app, shell, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import { join } from 'node:path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { runPipeline, buildConfig } from '@mediafetch/core';
import { createGuiAdapter } from './gui-adapter.js';
import { loadSettings, saveSettings, addRecentDirectory } from './settings.js';
import type { AppSettings } from './settings.js';

let currentSettings: AppSettings = { recentDirectories: [] };

function createWindow(): BrowserWindow {
  // Restore saved window bounds
  const bounds = currentSettings.windowBounds;
  const mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1100,
    height: bounds?.height ?? 750,
    x: bounds?.x,
    y: bounds?.y,
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

  // Save window bounds on resize/move
  const saveBounds = (): void => {
    if (!mainWindow.isMinimized() && !mainWindow.isMaximized()) {
      const b = mainWindow.getBounds();
      currentSettings.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      saveSettings(currentSettings).catch(() => {});
    }
  };
  mainWindow.on('resized', saveBounds);
  mainWindow.on('moved', saveBounds);

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

app.whenReady().then(async () => {
  // Load saved settings before creating the window
  currentSettings = await loadSettings();

  // Set app user model ID for Windows notifications
  electronApp.setAppUserModelId('com.mediafetch.app');

  // Default open/close shortcuts for dev
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  const mainWindow = createWindow();

  // --- App Menu ---
  const isMac = process.platform === 'darwin';
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Directory...',
          accelerator: 'CmdOrCtrl+O',
          click: async (): Promise<void> => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory'],
              title: 'Select media directory',
            });
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow.webContents.send('menu:openDirectory', result.filePaths[0]);
            }
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

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

  // Settings: load
  ipcMain.handle('settings:load', async () => {
    currentSettings = await loadSettings();
    return currentSettings;
  });

  // Settings: save API key
  ipcMain.handle('settings:saveApiKey', async (_event, apiKey: string) => {
    currentSettings.apiKey = apiKey;
    await saveSettings(currentSettings);
  });

  // Settings: get recent directories
  ipcMain.handle('settings:getRecentDirectories', () => {
    return currentSettings.recentDirectories;
  });

  // Run the rename pipeline
  ipcMain.on(
    'pipeline:start',
    async (_event, options: { directory: string; apiKey: string; dryRun: boolean; recursive: boolean; language: string; autoAccept: boolean; minConfidence: number; template?: string; mediaType?: string }) => {
      const ui = createGuiAdapter(mainWindow);

      // Save API key and add directory to recents
      if (options.apiKey) {
        currentSettings.apiKey = options.apiKey;
        await saveSettings(currentSettings);
      }
      currentSettings = await addRecentDirectory(options.directory);

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
