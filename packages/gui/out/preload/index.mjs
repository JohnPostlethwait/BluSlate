import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
const api = {
  // Directory picker
  selectDirectory: () => ipcRenderer.invoke("dialog:selectDirectory"),
  // Start the pipeline
  startPipeline: (options) => {
    ipcRenderer.send("pipeline:start", options);
  },
  // Listen for pipeline events from main process
  onProgress: (callback) => {
    const handlers = {
      start: (_e, data) => callback("start", data),
      update: (_e, data) => callback("update", data),
      succeed: (_e, data) => callback("succeed", data),
      fail: (_e, data) => callback("fail", data),
      stop: () => callback("stop", {})
    };
    ipcRenderer.on("progress:start", handlers.start);
    ipcRenderer.on("progress:update", handlers.update);
    ipcRenderer.on("progress:succeed", handlers.succeed);
    ipcRenderer.on("progress:fail", handlers.fail);
    ipcRenderer.on("progress:stop", handlers.stop);
    return () => {
      ipcRenderer.removeListener("progress:start", handlers.start);
      ipcRenderer.removeListener("progress:update", handlers.update);
      ipcRenderer.removeListener("progress:succeed", handlers.succeed);
      ipcRenderer.removeListener("progress:fail", handlers.fail);
      ipcRenderer.removeListener("progress:stop", handlers.stop);
    };
  },
  // Listen for results display
  onResults: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on("results:display", handler);
    return () => ipcRenderer.removeListener("results:display", handler);
  },
  // Listen for summary
  onSummary: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on("results:summary", handler);
    return () => ipcRenderer.removeListener("results:summary", handler);
  },
  // Listen for rename confirmation prompt
  onConfirmRenames: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on("prompt:confirmRenames", handler);
    return () => ipcRenderer.removeListener("prompt:confirmRenames", handler);
  },
  // Send rename confirmation response
  respondConfirmRenames: (confirmed) => {
    ipcRenderer.send("prompt:confirmRenames:response", { confirmed });
  },
  // Listen for show identification prompt
  onConfirmShow: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on("prompt:confirmShow", handler);
    return () => ipcRenderer.removeListener("prompt:confirmShow", handler);
  },
  // Send show identification response
  respondConfirmShow: (selected) => {
    ipcRenderer.send("prompt:confirmShow:response", { selected });
  },
  // Listen for pipeline completion
  onPipelineComplete: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on("pipeline:complete", handler);
    return () => ipcRenderer.removeListener("pipeline:complete", handler);
  },
  // Listen for pipeline errors
  onPipelineError: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on("pipeline:error", handler);
    return () => ipcRenderer.removeListener("pipeline:error", handler);
  }
};
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.electron = electronAPI;
  window.api = api;
}
