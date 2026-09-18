import electron from "electron";

const { contextBridge, ipcRenderer } = electron;
contextBridge.exposeInMainWorld("lampLight", {
	invoke: (channel: string, payload?: unknown) =>
		ipcRenderer.invoke(channel, payload),
	activity: () => ipcRenderer.send("activity"),
	onUpdateStatus: (listener: (status: unknown) => void) => {
		const handler = (_: Electron.IpcRendererEvent, status: unknown) =>
			listener(status);
		ipcRenderer.on("update:status", handler);
		return () => ipcRenderer.removeListener("update:status", handler);
	},
	onNavigate: (listener: (page: string) => void) => {
		const handler = (_: Electron.IpcRendererEvent, page: unknown) =>
			listener(String(page));
		ipcRenderer.on("app:navigate", handler);
		return () => ipcRenderer.removeListener("app:navigate", handler);
	},
	onShareVotd: (listener: () => void) => {
		const handler = () => listener();
		ipcRenderer.on("app:share-votd", handler);
		return () => ipcRenderer.removeListener("app:share-votd", handler);
	},
});
