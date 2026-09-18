const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lampLight", {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  activity: () => ipcRenderer.send("activity"),
  onUpdateStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on("update:status", handler);
    return () => ipcRenderer.removeListener("update:status", handler);
  },
  onNavigate: (listener) => {
    const handler = (_event, page) => listener(String(page));
    ipcRenderer.on("app:navigate", handler);
    return () => ipcRenderer.removeListener("app:navigate", handler);
  },
  onShareVotd: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("app:share-votd", handler);
    return () => ipcRenderer.removeListener("app:share-votd", handler);
  },
});
