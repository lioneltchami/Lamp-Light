const { contextBridge, ipcRenderer } = require("electron");

// Allow-list of `ipcMain.handle` channels the renderer is permitted to invoke.
// MUST stay in sync with `electron/preload.ts`. When the source file changes,
// regenerate this file via `npm run build`.
const ALLOWED_INVOKE_CHANNELS = new Set([
	"app:export-backup",
	"app:info",
	"app:open-external",
	"app:reveal-data",
	"bible:chapter",
	"bible:search",
	"bible:translations",
	"bookmark:toggle",
	"bookmarks:list",
	"bootstrap",
	"chapter-bookmark:clear",
	"chapter-bookmark:list",
	"chapter-bookmark:set",
	"highlight:set",
	"highlights:list",
	"multiplayer:questions",
	"note:set",
	"notes:export",
	"notes:import",
	"notes:list",
	"profile:avatar",
	"profile:clear-active",
	"profile:create",
	"profile:current",
	"profile:custom-avatar",
	"profile:link-online",
	"profile:rename",
	"profile:select",
	"profile:sync-export",
	"profile:unlink-online",
	"reader:sync-export",
	"reading-position:get",
	"reminder:get",
	"reminder:set",
	"session:abandon",
	"session:active",
	"session:answer",
	"session:next",
	"session:start",
	"share:clipboard",
	"stats",
	"theme:set",
	"update:check",
	"update:status",
	"xp:apply-remote",
	"xp:mark-synced",
	"xp:sync-batch",
]);

contextBridge.exposeInMainWorld("lampLight", {
  invoke: (channel, payload) => {
    if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`Channel "${channel}" is not allowed`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
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
