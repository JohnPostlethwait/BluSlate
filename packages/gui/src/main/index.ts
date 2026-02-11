import { app, shell, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import { join, resolve, isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { runPipeline, buildConfig } from '@mediafetch/core';
import { createGuiAdapter } from './gui-adapter.js';
import { loadSettings, saveSettings, addRecentDirectory } from './settings.js';
import type { AppSettings } from './settings.js';

// --- IPC Input Validation ---

const VALID_MEDIA_TYPES = new Set(['auto', 'tv', 'movie']);
const VALID_LANGUAGE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;
const MAX_API_KEY_LENGTH = 1024;
const MAX_TEMPLATE_LENGTH = 500;

function validatePipelineOptions(options: unknown): {
  directory: string;
  apiKey: string;
  dryRun: boolean;
  recursive: boolean;
  language: string;
  autoAccept: boolean;
  minConfidence: number;
  template?: string;
  mediaType?: string;
} {
  if (typeof options !== 'object' || options === null) {
    throw new Error('Invalid pipeline options');
  }

  const opts = options as Record<string, unknown>;

  // Directory: must be a non-empty absolute path string
  if (typeof opts.directory !== 'string' || opts.directory.length === 0) {
    throw new Error('Directory must be a non-empty string');
  }
  const resolvedDir = resolve(opts.directory);
  if (!isAbsolute(resolvedDir)) {
    throw new Error('Directory must be an absolute path');
  }

  // API key: must be a reasonable-length string
  if (typeof opts.apiKey !== 'string' || opts.apiKey.length === 0) {
    throw new Error('API key must be a non-empty string');
  }
  if (opts.apiKey.length > MAX_API_KEY_LENGTH) {
    throw new Error(`API key too long (max ${MAX_API_KEY_LENGTH} characters)`);
  }

  // Booleans
  const dryRun = opts.dryRun === true;
  const recursive = opts.recursive === true;
  const autoAccept = opts.autoAccept === true;

  // Language: validate format
  const language = typeof opts.language === 'string' && VALID_LANGUAGE_RE.test(opts.language)
    ? opts.language
    : 'en-US';

  // Min confidence: must be a finite number in [0, 100]
  let minConfidence = 85;
  if (typeof opts.minConfidence === 'number' && Number.isFinite(opts.minConfidence)) {
    minConfidence = Math.max(0, Math.min(100, opts.minConfidence));
  }

  // Template: optional, length-limited
  let template: string | undefined;
  if (typeof opts.template === 'string' && opts.template.length > 0) {
    if (opts.template.length > MAX_TEMPLATE_LENGTH) {
      throw new Error(`Template too long (max ${MAX_TEMPLATE_LENGTH} characters)`);
    }
    template = opts.template;
  }

  // Media type: must be a known value
  const mediaType = typeof opts.mediaType === 'string' && VALID_MEDIA_TYPES.has(opts.mediaType)
    ? opts.mediaType
    : 'auto';

  return { directory: resolvedDir, apiKey: opts.apiKey, dryRun, recursive, language, autoAccept, minConfidence, template, mediaType };
}

/** Sanitize error messages before sending to renderer — strip file paths and sensitive data */
function sanitizeErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'An unexpected error occurred';

  // For authentication errors, pass through the user-friendly message
  if (err.name === 'AuthenticationError' || err.name === 'FatalError') {
    return err.message;
  }

  // Strip absolute paths from error messages
  return err.message.replace(/\/[^\s:]+/g, '<path>');
}

let currentSettings: AppSettings = { recentDirectories: [] };

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

  // Run the rename pipeline (with full input validation)
  ipcMain.on(
    'pipeline:start',
    async (_event, rawOptions: unknown) => {
      const ui = createGuiAdapter(mainWindow);

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
          type: options.mediaType ?? 'auto',
        });

        await runPipeline(config, ui);
        mainWindow.webContents.send('pipeline:complete', { success: true });
      } catch (err) {
        const message = sanitizeErrorMessage(err);
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
