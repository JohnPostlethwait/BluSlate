import { app, shell, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { runPipeline, buildConfig, setFfprobePath, isFfprobeAvailable, renderTemplate, getTemplate, undoRenames } from '@mediafetch/core';

// Packaged macOS .app bundles inherit a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin)
// that doesn't include Homebrew paths where ffprobe typically lives.
// Prepend common binary locations as a fallback for system-installed ffprobe.
if (!is.dev) {
  const extraPaths =
    process.platform === 'darwin'
      ? ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin']
      : ['/usr/local/bin', '/snap/bin'];
  process.env.PATH = [...extraPaths, process.env.PATH].join(process.platform === 'win32' ? ';' : ':');
}

import { createGuiAdapter } from './gui-adapter.js';
import { loadSettings, saveSettings, addRecentDirectory } from './settings.js';
import type { AppSettings } from './settings.js';
import { validatePipelineOptions, sanitizeErrorMessage, MAX_API_KEY_LENGTH } from './validation.js';

/**
 * Resolve the ffprobe binary: bundled in app resources (production) →
 * npm package (dev) → system PATH (fallback).
 */
function resolveFfprobePath(): string | null {
  if (!is.dev) {
    // Packaged app: binary was copied to resources/bin/ by afterPack hook
    const ext = process.platform === 'win32' ? '.exe' : '';
    const bundledPath = join(process.resourcesPath, 'bin', `ffprobe${ext}`);
    if (existsSync(bundledPath)) {
      return bundledPath;
    }
  }

  // Dev mode or bundled binary missing: try resolving from npm package
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
    if (ffprobeInstaller.path && existsSync(ffprobeInstaller.path)) {
      return ffprobeInstaller.path;
    }
  } catch {
    // Package not installed — fall back to system PATH
  }

  return null;
}

let currentSettings: AppSettings = { recentDirectories: [] };
let ffprobeReady = false;

function createWindow(): BrowserWindow {
  // Restore saved window bounds
  const bounds = currentSettings.windowBounds;

  // Resolve icon path — macOS uses .icns from the app bundle automatically;
  // this sets the icon for Linux/Windows window decorations and taskbar.
  const iconPath = is.dev
    ? join(__dirname, '../../resources/icon.png')
    : join(process.resourcesPath, 'icon.png');

  const mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1100,
    height: bounds?.height ?? 750,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'MediaFetch',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
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

  // Open external links in the system browser (allowlist safe URL schemes)
  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(details.url);
      }
    } catch {
      // Malformed URL — silently reject
    }
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
  // Configure bundled ffprobe binary (must happen before any pipeline run)
  const ffprobeBinaryPath = resolveFfprobePath();
  if (ffprobeBinaryPath) {
    setFfprobePath(ffprobeBinaryPath);
  }
  ffprobeReady = await isFfprobeAvailable();

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
        ...(is.dev ? [{ role: 'toggleDevTools' as const }] : []),
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

  // ffprobe availability check (cached at startup)
  ipcMain.handle('ffprobe:check', () => ffprobeReady);

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

  // Settings: save API key (validated)
  ipcMain.handle('settings:saveApiKey', async (_event, apiKey: unknown) => {
    if (typeof apiKey !== 'string' || apiKey.length === 0 || apiKey.length > MAX_API_KEY_LENGTH) {
      throw new Error('Invalid API key');
    }
    currentSettings.apiKey = apiKey;
    await saveSettings(currentSettings);
  });

  // Settings: get recent directories
  ipcMain.handle('settings:getRecentDirectories', () => {
    return currentSettings.recentDirectories;
  });

  // Regenerate filenames after user reorder (uses core's renderTemplate + sanitizeFilename)
  ipcMain.handle(
    'reorder:regenerateFilenames',
    (_event, items: Array<{ tmdbMatch: Record<string, unknown>; extension: string }>) => {
      if (!Array.isArray(items)) return [];
      const template = getTemplate();
      return items.map((item) => {
        if (!item.tmdbMatch) return '';
        const tmdbMatch = item.tmdbMatch as Parameters<typeof renderTemplate>[1];
        return renderTemplate(template, tmdbMatch, item.extension);
      });
    },
  );

  // Undo renames using the .mediafetch-log.json file
  ipcMain.handle('undo:execute', (_event, directory: string) => {
    if (!directory || typeof directory !== 'string') {
      return { restored: 0, failed: 0 };
    }
    return undoRenames(directory);
  });

  // Run the rename pipeline (with full input validation)
  let pipelineRunning = false;
  let currentAdapter: import('./gui-adapter.js').CancellableGuiAdapter | null = null;

  ipcMain.on('pipeline:cancel', () => {
    if (currentAdapter) {
      currentAdapter.cancel();
    }
  });

  ipcMain.on(
    'pipeline:start',
    async (_event, rawOptions: unknown) => {
      if (pipelineRunning) return;
      pipelineRunning = true;

      const ui = createGuiAdapter(mainWindow);
      currentAdapter = ui;

      try {
        // Validate all inputs from the renderer
        const options = validatePipelineOptions(rawOptions);

        // Verify the directory actually exists before proceeding
        try {
          const dirStat = await stat(options.directory);
          if (!dirStat.isDirectory()) {
            throw new Error('Selected path is not a directory');
          }
        } catch (fsErr) {
          throw new Error('Directory does not exist or is not accessible');
        }

        // Save API key and add directory to recents
        if (options.apiKey) {
          currentSettings.apiKey = options.apiKey;
          await saveSettings(currentSettings);
        }
        currentSettings = await addRecentDirectory(options.directory);

        const config = await buildConfig({
          directory: options.directory,
          apiKey: options.apiKey,
          dryRun: options.dryRun,
          recursive: options.recursive,
          lang: options.language,
          yes: options.autoAccept,
          minConfidence: options.minConfidence,
          template: options.template,
        });

        await runPipeline(config, ui);
        mainWindow.webContents.send('pipeline:complete', { success: true });
      } catch (err) {
        if ((err as Error).name === 'PipelineCancelledError') {
          // User cancelled — send completion (not error) so renderer resets cleanly
          mainWindow.webContents.send('pipeline:complete', { success: false });
        } else {
          const message = sanitizeErrorMessage(err);
          mainWindow.webContents.send('pipeline:error', { message });
        }
      } finally {
        pipelineRunning = false;
        currentAdapter = null;
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
