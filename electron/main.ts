/**
 * Main-process composition root.
 *
 * This file owns *ordering* and nothing else:
 *
 *   1. process-level crash handlers, registered before anything can throw
 *   2. the `userData` path override that must happen before `whenReady`
 *   3. the `app.whenReady()` bootstrap sequence
 *   4. the complete list of IPC channels, one line each
 *   5. the app lifecycle hooks
 *
 * Everything else lives in a focused module: `window.ts` (window creation),
 * `store.ts` (databases), `lifecycle`-adjacent concerns in `presence.ts`,
 * `reminders.ts`, `updater.ts`, `service/*` (pure data access) and `ipc/*`
 * (handler bodies, grouped by concern).
 *
 * The channel list stays *here*, one `ipcMain.handle` per line, because
 * `preload-allowlist.test.ts` diffs these literals against the renderer's
 * allowlist in `preload.ts` — a channel list split across files is a channel
 * list nobody can diff.
 */
import electron from "electron";

const { app, BrowserWindow, ipcMain } = electron;

import fs from "node:fs";
import path from "node:path";
import { configureAboutPanel, focusOrShowWindow, installApplicationMenu } from "./macos.js";
import { startPresenceTicker } from "./presence.js";
import { syncDockBadge, tickDailyReminder } from "./reminders.js";
import { openDatabases, questionBankVersion } from "./store.js";
import {
	contentDb,
	getMainWindow,
	markInteraction,
	sendToRenderer,
	setDatabaseLocations,
	setDatabases,
} from "./state.js";
import {
	configureAutoUpdates,
	getUpdateStatus,
	isUpdaterQuitInProgress,
	runUpdateCheck,
} from "./updater.js";
import { openMainWindow } from "./window.js";
import * as appIpc from "./ipc/app.js";
import * as annotationIpc from "./ipc/annotations.js";
import * as profileIpc from "./ipc/profiles.js";
import * as quizIpc from "./ipc/quiz.js";
import * as readerIpc from "./ipc/reader.js";
import * as settingsIpc from "./ipc/settings.js";
import * as syncIpc from "./ipc/sync.js";
import {
	appendDiagnostic,
	exportDiagnosticBundle,
	readDiagnostics,
} from "./diagnostics.js";

// Process-level safety net. We attach these BEFORE the rest of main process
// setup runs so that any crash path (e.g. a stray uncaught error during
// `app.whenReady().then(...)`) is captured and surfaced to the user via a
// native error box instead of silently terminating the electron process.
process.on("uncaughtException", (err) => {
	console.error("[uncaughtException]", err);
	// Persist before the dialog: this is the one place we may be milliseconds
	// from the process going away, and the log is the only evidence a crash
	// report will ever have. Sync write, and it never throws.
	appendDiagnostic({
		level: "error",
		scope: "startup",
		message: "uncaughtException in main process",
		detail: err instanceof Error ? (err.stack ?? err.message) : String(err),
	});
	try {
		electron.dialog.showErrorBox(
			"Lamp & Light hit an unexpected error",
			`${err && err.stack ? err.stack : String(err)}\n\nThe app may need to restart.`,
		);
	} catch {
		/* dialog may not be ready */
	}
});
process.on(
	"unhandledRejection",
	(reason: unknown, _promise: Promise<unknown>) => {
		// We intentionally do NOT show a dialog on rejection — they fire often,
		// are usually already logged by the underlying call site, and a modal
		// per rejection would be hostile. Just record the reason for the logs.
		console.error("[unhandledRejection]", reason);
		appendDiagnostic({
			level: "warn",
			scope: "startup",
			message: "unhandledRejection in main process",
			detail:
				reason instanceof Error
					? (reason.stack ?? reason.message)
					: String(reason),
		});
	},
);
// Keep the original storage location across rebrands (Bible Trivia → Lamp & Light)
// so upgrades never strand offline profiles in a newly named Electron directory.
app.setPath(
	"userData",
	path.join(app.getPath("appData"), "bible-questions-app"),
);

// ── IPC channels ────────────────────────────────────────────────────────────
// Registered at module load because none of them touch a database; the
// rest are registered inside `whenReady` once the databases are open.

ipcMain.handle("theme:set", (_event, preference) =>
	appIpc.themeSet(preference),
);
ipcMain.handle("app:info", appIpc.appInfo);
ipcMain.handle("app:reveal-data", appIpc.revealData);
ipcMain.handle("app:open-external", (_event, url: unknown) =>
	appIpc.openExternal(url),
);
ipcMain.handle("app:export-backup", appIpc.exportBackup);
ipcMain.handle("diagnostics:read", (_event, payload?: { limit?: number }) =>
	readDiagnostics(payload?.limit),
);
ipcMain.handle("diagnostics:export", async (_event, payload: unknown) =>
	exportDiagnosticBundle(
		typeof payload === "string"
			? payload
			: String(
					(payload as { destPath?: unknown } | null | undefined)?.destPath ?? "",
				),
	),
);

function registerProfileChannels() {
	ipcMain.handle("bootstrap", profileIpc.bootstrapState);
	ipcMain.handle("profile:create", (_event, p) => profileIpc.createProfile(p));
	ipcMain.handle("profile:select", (_event, id) => profileIpc.selectProfile(id));
	ipcMain.handle("profile:current", profileIpc.currentProfile);
	ipcMain.handle("profile:avatar", (_event, avatarId) =>
		profileIpc.setAvatar(avatarId),
	);
	ipcMain.handle("profile:custom-avatar", profileIpc.setCustomAvatar);
	ipcMain.handle("profile:rename", (_event, name) => profileIpc.renameProfile(name));
	ipcMain.handle("profile:clear-active", profileIpc.clearActiveProfile);
	ipcMain.handle("profile:unlink-online", profileIpc.unlinkOnline);
	ipcMain.handle("profile:link-online", (_event, onlineUserId) =>
		profileIpc.linkOnline(onlineUserId),
	);
}

function registerSyncChannels() {
	ipcMain.handle("profile:sync-export", (_event, onlineUserId) =>
		syncIpc.syncExport(onlineUserId),
	);
	ipcMain.handle("xp:sync-batch", (_event, onlineUserId) =>
		syncIpc.xpSyncBatch(onlineUserId),
	);
	ipcMain.handle("xp:mark-synced", (_event, ids) => syncIpc.xpMarkSynced(ids));
	ipcMain.handle("xp:apply-remote", (_event, events) =>
		syncIpc.xpApplyRemote(events),
	);
	ipcMain.handle("reader:sync-export", (_event, onlineUserId) =>
		syncIpc.readerSyncExport(onlineUserId),
	);
}

function registerQuizChannels() {
	ipcMain.handle("multiplayer:questions", (_event, input) =>
		quizIpc.multiplayerQuestions(input),
	);
	ipcMain.handle("session:active", quizIpc.activeSession);
	ipcMain.handle("session:start", (_event, p) => quizIpc.startSession(p));
	ipcMain.handle("session:answer", (_event, p) => quizIpc.answerQuestion(p));
	ipcMain.handle("session:next", (_event, id) => quizIpc.nextQuestion(id));
	ipcMain.handle("session:abandon", (_event, id) => quizIpc.abandonSession(id));
	ipcMain.handle("stats", quizIpc.stats);
}

function registerReaderChannels() {
	ipcMain.handle("bible:translations", readerIpc.translations);
	ipcMain.handle("bible:search", (_event, value) => readerIpc.searchBible(value));
	ipcMain.handle("reading-position:get", readerIpc.readingPosition);
	ipcMain.handle("bible:chapter", (_event, p) => readerIpc.chapter(p));
}

function registerAnnotationChannels() {
	ipcMain.handle("note:set", (_event, p) => annotationIpc.setNote(p));
	ipcMain.handle("notes:list", annotationIpc.listNotes);
	ipcMain.handle("notes:export", annotationIpc.exportNotes);
	ipcMain.handle("notes:import", annotationIpc.importNotes);
	ipcMain.handle("bookmark:toggle", (_event, p) => annotationIpc.toggleBookmark(p));
	ipcMain.handle("bookmarks:list", annotationIpc.listBookmarks);
	ipcMain.handle("highlights:list", annotationIpc.listHighlights);
	ipcMain.handle("highlight:set", (_event, p) => annotationIpc.setHighlight(p));
	ipcMain.handle("chapter-bookmark:list", annotationIpc.listChapterBookmarks);
	ipcMain.handle("chapter-bookmark:set", (_event, p) =>
		annotationIpc.setChapterBookmark(p),
	);
	ipcMain.handle("chapter-bookmark:clear", (_event, color) =>
		annotationIpc.clearChapterBookmark(color),
	);
}

function registerSettingsChannels() {
	ipcMain.handle("reminder:get", settingsIpc.getReminder);
	ipcMain.handle("reminder:set", (_event, patch) => settingsIpc.setReminder(patch));
	ipcMain.handle("share:clipboard", (_event, payload) =>
		settingsIpc.shareToClipboard(payload),
	);
	// Fire-and-forget interaction ping that keeps the idle-XP ticker honest.
	ipcMain.on("activity", () => markInteraction());
}

/**
 * Create (or focus) the main window, wiring per-window concerns exactly once.
 * The update channels are registered here rather than inside `updater.ts` so
 * that every `ipcMain.handle` literal stays in this file.
 */
function createMainWindow() {
	return openMainWindow((win) => {
		ipcMain.handle("update:status", getUpdateStatus);
		ipcMain.handle("update:check", (_event, payload?: { force?: boolean }) =>
			runUpdateCheck(win, Boolean(payload?.force)),
		);
		configureAutoUpdates(win);
	});
}

app.whenReady().then(() => {
	const dataDir = app.getPath("userData");
	fs.mkdirSync(dataDir, { recursive: true });
	const userDbPath = path.join(dataDir, "selah-user.sqlite");
	setDatabaseLocations({
		userDbPath,
		avatarDir: path.join(dataDir, "avatars"),
	});
	const resourceRoot = app.isPackaged ? process.resourcesPath : process.cwd();
	const { user, content } = openDatabases({
		userDbPath,
		contentDbPath: path.join(dataDir, "selah-content.sqlite"),
		contentSources: [
			{
				translationId: "BSB",
				file: path.join(resourceRoot, "content", "engbsb_vpl.txt"),
			},
			{
				translationId: "WEB",
				file: path.join(resourceRoot, "content", "engwebp_vpl.txt"),
			},
			{
				translationId: "KJV",
				file: path.join(resourceRoot, "content", "engkjv_vpl.txt"),
			},
		],
	});
	setDatabases(user, content);
	registerProfileChannels();
	registerSyncChannels();
	registerQuizChannels();
	registerReaderChannels();
	registerAnnotationChannels();
	registerSettingsChannels();
	startPresenceTicker();
	app.setName("Lamp & Light");
	configureAboutPanel(questionBankVersion(contentDb()));
	installApplicationMenu({
		getWindow: getMainWindow,
		sendNavigate: (page) => sendToRenderer("app:navigate", page),
		sendShareVotd: () => sendToRenderer("app:share-votd"),
	});
	createMainWindow();
	syncDockBadge();
	tickDailyReminder();
	setInterval(tickDailyReminder, 60_000);
});
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
	else focusOrShowWindow(getMainWindow());
	syncDockBadge();
	tickDailyReminder();
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

// Lifecycle hooks. `lastQuitReason` is captured for downstream telemetry so
// we can later tell user-initiated quits apart from auto-update restarts.
let lastQuitReason: "user" | "update" | "quit-forced" = "user";
app.on("before-quit", () => {
	if (isUpdaterQuitInProgress()) {
		lastQuitReason = "update";
		return; // let it through
	}
	// Allow future hooks (telemetry flush, etc.) to run here.
});
app.on("will-quit", () => {
	// Best-effort cleanup logging. Real telemetry hook is a future PR.
	console.info(`[lifecycle] will-quit (reason=${lastQuitReason})`);
});
