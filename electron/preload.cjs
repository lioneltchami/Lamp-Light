// AUTO-GENERATED from electron/preload.ts — do not edit by hand. Run `npm run build` to regenerate.
// Source of truth: electron/preload.ts (see scripts/generate-preload-cjs.mjs).
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = __importDefault(require("electron"));
const { contextBridge, ipcRenderer } = electron_1.default;
// Allow-list of `ipcMain.handle` channels the renderer is permitted to invoke.
// Mirrors the `ipcMain.handle(...)` declarations in `electron/main.ts` —
// every entry here MUST correspond to a real handler there, or the renderer
// will start failing with "Channel not allowed". When in doubt, add a new
// channel to both sides in the same change.
//
// `ipcMain.on` channels are intentionally NOT in this set: they are
// send-only / fire-and-forget and are handled in preload.ts via `send()`
// (or dedicated `on*` event subscriptions).
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
        const handler = (_, status) => listener(status);
        ipcRenderer.on("update:status", handler);
        return () => ipcRenderer.removeListener("update:status", handler);
    },
    onNavigate: (listener) => {
        const handler = (_, page) => listener(String(page));
        ipcRenderer.on("app:navigate", handler);
        return () => ipcRenderer.removeListener("app:navigate", handler);
    },
    onShareVotd: (listener) => {
        const handler = () => listener();
        ipcRenderer.on("app:share-votd", handler);
        return () => ipcRenderer.removeListener("app:share-votd", handler);
    },
});
