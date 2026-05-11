const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rssBridge", {
  fetchFeed: (url) => ipcRenderer.invoke("rss:fetch", url),
  runtime: "electron",
});
