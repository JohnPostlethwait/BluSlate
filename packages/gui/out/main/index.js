import { ipcMain, app, dialog, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { buildConfig, runPipeline } from "@mediafetch/core";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
function createGuiAdapter(mainWindow) {
  return {
    progress: {
      start(message) {
        mainWindow.webContents.send("progress:start", { message });
      },
      update(message) {
        mainWindow.webContents.send("progress:update", { message });
      },
      succeed(message) {
        mainWindow.webContents.send("progress:succeed", { message });
      },
      fail(message) {
        mainWindow.webContents.send("progress:fail", { message });
      },
      stop() {
        mainWindow.webContents.send("progress:stop");
      }
    },
    prompts: {
      confirmRenames(matches, autoAccept, minConfidence, _template, _scanDirectory, _client) {
        if (autoAccept) {
          return Promise.resolve(
            matches.filter(
              (m) => m.status !== "unmatched" && m.newFilename !== m.mediaFile.fileName && m.confidence >= minConfidence
            )
          );
        }
        return new Promise((resolve) => {
          const renameable = matches.filter(
            (m) => m.status !== "unmatched" && m.newFilename !== m.mediaFile.fileName
          );
          mainWindow.webContents.send("prompt:confirmRenames", { matches: renameable });
          ipcMain.once("prompt:confirmRenames:response", (_event, { confirmed }) => {
            resolve(confirmed);
          });
        });
      },
      confirmShowIdentification(directoryShowName, candidates) {
        return new Promise((resolve) => {
          mainWindow.webContents.send("prompt:confirmShow", {
            showName: directoryShowName,
            candidates
          });
          ipcMain.once("prompt:confirmShow:response", (_event, { selected }) => {
            resolve(selected);
          });
        });
      }
    },
    display: {
      displayResults(matches, scanDirectory) {
        mainWindow.webContents.send("results:display", { matches, scanDirectory });
      },
      displaySummary(renamed, skipped, failed, dryRun) {
        mainWindow.webContents.send("results:summary", { renamed, skipped, failed, dryRun });
      }
    }
  };
}
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: "MediaFetch",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return mainWindow;
}
app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.mediafetch.app");
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });
  const mainWindow = createWindow();
  ipcMain.handle("dialog:selectDirectory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select media directory"
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.on(
    "pipeline:start",
    async (_event, options) => {
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
          type: options.mediaType ?? "auto"
        });
        await runPipeline(config, ui);
        mainWindow.webContents.send("pipeline:complete", { success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "An unexpected error occurred";
        mainWindow.webContents.send("pipeline:error", { message });
      }
    }
  );
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
