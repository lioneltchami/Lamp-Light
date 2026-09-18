import electron from "electron";

const { app, BrowserWindow, ipcMain, nativeTheme, shell, dialog } = electron;

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronUpdater from "electron-updater";
import { readChapter, searchVerses } from "./bible.js";
import { ensureContent } from "./content.js";
import Database from "./db.js";
import {
	fullQuizQuestions,
	levelFromXp,
	medalFor,
	shuffled,
	streak,
} from "./domain.js";
import { isAllowedExternalUrl } from "../shared/externalLinks.js";
import {
	clampReminderHour,
	configureAboutPanel,
	copyShareToClipboard,
	focusOrShowWindow,
	installApplicationMenu,
	promptReminderPermission,
	type ReminderPrefs,
	refreshDockBadge,
	shouldFireDailyReminder,
	showDailyReminderNotification,
} from "./macos.js";
import { userMigrations } from "./migrations.js";

const { autoUpdater } = electronUpdater;
// Keep the original storage location across rebrands (Bible Trivia → Lamp & Light)
// so upgrades never strand offline profiles in a newly named Electron directory.
app.setPath(
	"userData",
	path.join(app.getPath("appData"), "bible-questions-app"),
);
const here = path.dirname(fileURLToPath(import.meta.url));
let user: Database,
	content: Database,
	userDbPath = path.join(app.getPath("userData"), "selah-user.sqlite");
let activeProfileId: number | null = null;
let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
let lastInteraction = Date.now(),
	accrued = 0;
const isoDay = () => new Date().toLocaleDateString("en-CA");
const now = () => new Date().toISOString();
const WINDOW_BG = { light: "#f5f0e6", dark: "#161b18" } as const;

function getSetting(key: string): string | null {
	const row = user.prepare("SELECT value FROM settings WHERE key=?").get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? null;
}
function setSetting(key: string, value: string) {
	user
		.prepare(
			"INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
		)
		.run(key, value);
}
function readReminderPrefs(): ReminderPrefs {
	const enabledRaw = getSetting("daily_reminder_enabled");
	const enabled =
		enabledRaw === null ? process.platform === "darwin" : enabledRaw === "1";
	const hour = clampReminderHour(
		Number(getSetting("daily_reminder_hour") ?? "9"),
	);
	return {
		enabled,
		hour,
		lastNotified: getSetting("daily_reminder_last_notified"),
	};
}
function isDailyUnanswered(): boolean {
	if (!activeProfileId) return false;
	const row = user
		.prepare(
			"SELECT answered_at answeredAt FROM daily_questions WHERE profile_id=? AND local_date=?",
		)
		.get(activeProfileId, isoDay()) as
		| { answeredAt: string | null }
		| undefined;
	if (!row) return true;
	return row.answeredAt == null;
}
function syncDockBadge() {
	refreshDockBadge(Boolean(activeProfileId) && isDailyUnanswered());
}
function sendToRenderer(channel: string, payload?: unknown) {
	const win = mainWindow;
	if (!win || win.isDestroyed()) return;
	win.webContents.send(channel, payload);
}
function bankVersion(): string {
	try {
		return (
			(
				content
					.prepare(
						"SELECT value FROM metadata WHERE key='question_bank_version'",
					)
					.get() as { value: string } | undefined
			)?.value ?? ""
		);
	} catch {
		return "";
	}
}
function tickDailyReminder() {
	if (process.platform !== "darwin") return;
	const prefs = readReminderPrefs();
	const unanswered = Boolean(activeProfileId) && isDailyUnanswered();
	syncDockBadge();
	if (
		!shouldFireDailyReminder({
			enabled: prefs.enabled,
			unanswered,
			hour: prefs.hour,
			lastNotified: prefs.lastNotified,
			now: new Date(),
		})
	)
		return;
	const shown = showDailyReminderNotification(() => {
		focusOrShowWindow(mainWindow);
		sendToRenderer("app:navigate", "home");
	});
	if (shown) setSetting("daily_reminder_last_notified", isoDay());
}
function applyNativeTheme(preference: string) {
	const mode =
		preference === "light" || preference === "dark" ? preference : "system";
	nativeTheme.themeSource = mode;
	const resolved = nativeTheme.shouldUseDarkColors ? "dark" : "light";
	const background = WINDOW_BG[resolved];
	for (const win of BrowserWindow.getAllWindows()) {
		win.setBackgroundColor(background);
	}
	return { preference: mode, resolved, background };
}
ipcMain.handle("theme:set", (_event, preference) =>
	applyNativeTheme(String(preference ?? "system")),
);
ipcMain.handle("app:info", () => ({
	version: app.getVersion(),
	userDataPath: app.getPath("userData"),
	name: app.getName(),
}));
ipcMain.handle("app:reveal-data", async () => {
	const dir = app.getPath("userData");
	fs.mkdirSync(dir, { recursive: true });
	const error = await shell.openPath(dir);
	if (error) throw new Error(error);
	return dir;
});
ipcMain.handle("app:open-external", async (_event, url: unknown) => {
	if (typeof url !== "string" || !isAllowedExternalUrl(url)) {
		throw new Error("That link is not allowed from the app.");
	}
	await shell.openExternal(url);
	return { ok: true as const };
});
ipcMain.handle("app:export-backup", async () => {
	const dataDir = app.getPath("userData");
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const result = await dialog.showSaveDialog({
		title: "Export Lamp & Light backup",
		defaultPath: path.join(
			app.getPath("documents"),
			`lamp-light-backup-${stamp}`,
		),
		buttonLabel: "Export",
		properties: ["createDirectory", "showOverwriteConfirmation"],
	});
	if (result.canceled || !result.filePath) return { canceled: true as const };
	const destDir = result.filePath;
	fs.mkdirSync(destDir, { recursive: true });
	try {
		user.exec("PRAGMA wal_checkpoint(FULL)");
	} catch {
		/* DB may be mid-write */
	}
	const copies: string[] = [];
	for (const name of ["selah-user.sqlite", "selah-content.sqlite"] as const) {
		const src = path.join(dataDir, name);
		if (!fs.existsSync(src)) continue;
		const dest = path.join(destDir, name);
		fs.copyFileSync(src, dest);
		copies.push(name);
	}
	if (!copies.length) throw new Error("No database files found to export.");
	return { canceled: false as const, path: destDir, files: copies };
});
function awardXp(profileId: number, amount: number, source: string) {
	user.prepare("UPDATE profiles SET xp=xp+? WHERE id=?").run(amount, profileId);
	user
		.prepare(
			"INSERT INTO xp_events(id,profile_id,amount,source,created_at) VALUES(?,?,?,?,?)",
		)
		.run(randomUUID(), profileId, amount, source, now());
}
function configureAutoUpdates(win: InstanceType<typeof BrowserWindow>) {
	type UpdateState = {
		state: "checking" | "up-to-date" | "available" | "downloaded" | "error";
		version?: string;
	};
	let status: UpdateState = app.isPackaged
		? { state: "checking" }
		: { state: "up-to-date" };
	let checking = false;
	const publish = (next: UpdateState) => {
		status = next;
		if (!win.isDestroyed()) win.webContents.send("update:status", status);
	};
	const check = async () => {
		if (!app.isPackaged || checking) return status;
		checking = true;
		publish({ state: "checking" });
		try {
			await autoUpdater.checkForUpdates();
		} catch {
			/* The updater error event publishes the status. */
		} finally {
			checking = false;
		}
		return status;
	};
	ipcMain.handle("update:status", () => status);
	ipcMain.handle("update:check", () => check());
	if (!app.isPackaged) return;
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.on("checking-for-update", () => publish({ state: "checking" }));
	autoUpdater.on("update-available", (info) =>
		publish({ state: "available", version: info.version }),
	);
	autoUpdater.on("update-not-available", () =>
		publish({ state: "up-to-date" }),
	);
	autoUpdater.on("update-downloaded", async (info) => {
		publish({ state: "downloaded", version: info.version });
		const result = await electron.dialog.showMessageBox(win, {
			type: "info",
			title: "Update ready",
			message: `Lamp & Light ${info.version} is ready.`,
			detail:
				"Restart now to install it. Your profiles and progress will be preserved.",
			buttons: ["Restart and update", "Later"],
			defaultId: 0,
			cancelId: 1,
		});
		if (result.response === 0) autoUpdater.quitAndInstall(false, true);
	});
	autoUpdater.on("error", (error) => {
		publish({ state: "error" });
		console.error("Automatic update error:", error);
	});
	win.webContents.once("did-finish-load", () => void check());
	setInterval(() => void check(), 60 * 60 * 1000);
}
function registerBibleSearch() {
	ipcMain.handle("bible:translations", () =>
		content
			.prepare(
				"SELECT id,name,abbreviation,description,license FROM translations ORDER BY sort_order",
			)
			.all(),
	);
	ipcMain.handle("bible:search", (_, value) => {
		const query = String(value?.query ?? value ?? "");
		const translationId = String(value?.translationId ?? "BSB");
		return searchVerses(content, translationId, query);
	});
	ipcMain.handle("reading-position:get", () => {
		if (!activeProfileId) throw new Error("No profile");
		return (
			user
				.prepare(
					"SELECT book_id bookId,chapter FROM reading_positions WHERE profile_id=?",
				)
				.get(activeProfileId) ?? null
		);
	});
}
function registerAnnotations() {
	ipcMain.handle("note:set", (_, p) => {
		if (!activeProfileId) throw new Error("No profile");
		const note = String(p.note ?? "").trim();
		if (note)
			user
				.prepare(
					"INSERT INTO verse_notes VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,book_id,chapter,verse) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at",
				)
				.run(activeProfileId, p.bookId, p.chapter, p.verse, note, now());
		else
			user
				.prepare(
					"DELETE FROM verse_notes WHERE profile_id=? AND book_id=? AND chapter=? AND verse=?",
				)
				.run(activeProfileId, p.bookId, p.chapter, p.verse);
	});
	ipcMain.handle("bookmark:toggle", (_, p) => {
		if (!activeProfileId) throw new Error("No profile");
		const exists = user
			.prepare(
				"SELECT 1 FROM bookmarks WHERE profile_id=? AND book_id=? AND chapter=? AND verse=?",
			)
			.get(activeProfileId, p.bookId, p.chapter, p.verse);
		if (exists)
			user
				.prepare(
					"DELETE FROM bookmarks WHERE profile_id=? AND book_id=? AND chapter=? AND verse=?",
				)
				.run(activeProfileId, p.bookId, p.chapter, p.verse);
		else
			user
				.prepare("INSERT INTO bookmarks VALUES(?,?,?,?,?)")
				.run(activeProfileId, p.bookId, p.chapter, p.verse, now());
	});
	ipcMain.handle("chapter-bookmark:list", () => {
		if (!activeProfileId) throw new Error("No profile");
		return (
			user
				.prepare(
					"SELECT color,book_id bookId,chapter FROM chapter_bookmarks WHERE profile_id=?",
				)
				.all(activeProfileId) as {
				color: string;
				bookId: string;
				chapter: number;
			}[]
		).map((mark) => ({
			...mark,
			bookName:
				(
					content
						.prepare("SELECT name FROM books WHERE id=?")
						.get(mark.bookId) as { name: string } | undefined
				)?.name ?? mark.bookId,
		}));
	});
	ipcMain.handle("chapter-bookmark:set", (_, p) => {
		if (!activeProfileId) throw new Error("No profile");
		const allowed = new Set(["red", "gold", "green", "blue", "purple"]);
		if (!allowed.has(String(p.color)))
			throw new Error("Invalid bookmark color.");
		const book = content
			.prepare("SELECT chapters FROM books WHERE id=?")
			.get(String(p.bookId)) as { chapters: number } | undefined;
		if (!book || Number(p.chapter) < 1 || Number(p.chapter) > book.chapters)
			throw new Error("Invalid Bible location.");
		user
			.prepare(
				"INSERT INTO chapter_bookmarks(profile_id,color,book_id,chapter,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(profile_id,color) DO UPDATE SET book_id=excluded.book_id,chapter=excluded.chapter,updated_at=excluded.updated_at",
			)
			.run(activeProfileId, p.color, p.bookId, p.chapter, now());
	});
	ipcMain.handle("chapter-bookmark:clear", (_, color) => {
		if (!activeProfileId) throw new Error("No profile");
		user
			.prepare("DELETE FROM chapter_bookmarks WHERE profile_id=? AND color=?")
			.run(activeProfileId, String(color));
	});
}
function migrate(db: Database) {
	db.exec(
		"CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
	);
	const applied = new Set(
		(
			db.prepare("SELECT version FROM schema_migrations").all() as unknown as {
				version: number;
			}[]
		).map((x) => x.version),
	);
	userMigrations.forEach((sql, i) => {
		if (!applied.has(i + 1))
			db.transaction(() => {
				db.exec(sql);
				db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(
					i + 1,
					now(),
				);
			})();
	});
}
function profile(id: number) {
	return hydrateProfile(
		user
			.prepare(
				"SELECT id,name,avatar_id avatarId,xp,current_streak currentStreak,longest_streak longestStreak,last_active_date lastActiveDate,selected_banner selectedBanner,online_user_id onlineUserId,custom_avatar_path customAvatarPath FROM profiles WHERE id=?",
			)
			.get(id),
	);
}
const CUSTOM_AVATAR_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const CUSTOM_AVATAR_MIME: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
	".gif": "image/gif",
};
const CUSTOM_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
function customAvatarDir() {
	return path.join(app.getPath("userData"), "avatars");
}
function customAvatarDataUrl(fileName: string | null | undefined) {
	if (!fileName) return null;
	const base = path.basename(String(fileName));
	if (base !== fileName || base.includes("..")) return null;
	const full = path.join(customAvatarDir(), base);
	if (!fs.existsSync(full)) return null;
	const ext = path.extname(full).toLowerCase();
	const mime = CUSTOM_AVATAR_MIME[ext];
	if (!mime) return null;
	try {
		const buf = fs.readFileSync(full);
		if (buf.length > CUSTOM_AVATAR_MAX_BYTES * 2) return null;
		return `data:${mime};base64,${buf.toString("base64")}`;
	} catch {
		return null;
	}
}
function hydrateProfile(row: unknown) {
	if (!row || typeof row !== "object") return null;
	const p = row as Record<string, unknown>;
	const customAvatarPath =
		typeof p.customAvatarPath === "string" ? p.customAvatarPath : null;
	return {
		...p,
		customAvatarPath,
		customAvatarUrl: customAvatarDataUrl(customAvatarPath),
	};
}
function touch(id: number) {
	const p: any = profile(id),
		s = streak(p.lastActiveDate, p.currentStreak, p.longestStreak, isoDay());
	user
		.prepare(
			"UPDATE profiles SET current_streak=?,longest_streak=?,last_active_date=? WHERE id=?",
		)
		.run(s.current, s.longest, isoDay(), id);
}
function bootstrap() {
	const profiles = user
		.prepare(
			"SELECT id,name,avatar_id avatarId,xp,current_streak currentStreak,longest_streak longestStreak,last_active_date lastActiveDate,selected_banner selectedBanner,online_user_id onlineUserId,custom_avatar_path customAvatarPath FROM profiles ORDER BY id",
		)
		.all()
		.map(hydrateProfile);
	if (activeProfileId && !profiles.some((p: any) => p.id === activeProfileId))
		activeProfileId = null;
	const books = content
		.prepare(
			"SELECT id,name,testament,book_order `order`,chapters FROM books ORDER BY book_order",
		)
		.all();
	const animals = content
		.prepare(
			"SELECT id,name,emoji,unlock_level unlockLevel FROM animals ORDER BY sort_order",
		)
		.all();
	return {
		profiles,
		activeProfile: activeProfileId ? profile(activeProfileId) : null,
		books,
		animals,
		appVersion: app.getVersion(),
		bankVersion: (
			content
				.prepare("SELECT value FROM metadata WHERE key='question_bank_version'")
				.get() as any
		).value,
	};
}
function currentSession(id: number) {
	const s: any = user
		.prepare(
			"SELECT * FROM sessions WHERE profile_id=? AND status='active' ORDER BY id DESC LIMIT 1",
		)
		.get(id);
	return s ? sessionState(s) : null;
}
function sessionState(s: any) {
	const order: string[] = JSON.parse(s.question_order),
		choices: number[][] = JSON.parse(s.choice_orders),
		qid = order[s.current_index];
	const raw: any = qid
		? content
				.prepare(
					"SELECT q.*,b.name book_name FROM questions q JOIN books b ON b.id=q.book_id WHERE q.id=?",
				)
				.get(qid)
		: null;
	const ans: any = raw
		? user
				.prepare(
					"SELECT * FROM session_answers WHERE session_id=? AND question_id=?",
				)
				.get(s.id, qid)
		: null;
	const totals: any = user
		.prepare(
			"SELECT COUNT(*) answered,COALESCE(SUM(is_correct),0) correct FROM session_answers WHERE session_id=?",
		)
		.get(s.id);
	let current = null,
		correctIndex = null;
	if (raw) {
		const vals = [raw.answer_a, raw.answer_b, raw.answer_c, raw.answer_d],
			map = choices[s.current_index];
		current = {
			id: raw.id,
			bookId: raw.book_id,
			bookName: raw.book_name,
			chapter: raw.chapter,
			verseStart: raw.verse_start,
			verseEnd: raw.verse_end,
			text: raw.question_text,
			choices: map.map((i) => vals[i]),
		};
		correctIndex = map.indexOf(raw.correct_index);
	}
	return {
		sessionId: s.id,
		mode: s.mode,
		bookId: s.book_id,
		title: s.title,
		currentIndex: s.current_index,
		total: order.length,
		answered: totals.answered,
		correct: totals.correct,
		completed: s.status === "completed",
		current,
		selectedIndex: ans?.selected_choice ?? null,
		correctIndex: ans ? correctIndex : null,
		isCorrect: ans ? !!ans.is_correct : null,
	};
}
function createSession(
	profileId: number,
	mode: string,
	bookId: string = "",
	chapterStart: number = 1,
	chapterEnd: number = chapterStart,
) {
	let rows: any[];
	if (mode === "daily") {
		const date = isoDay();
		let d: any = user
			.prepare(
				"SELECT question_id FROM daily_questions WHERE profile_id=? AND local_date=?",
			)
			.get(profileId, date);
		if (!d) {
			const all = content.prepare("SELECT id FROM questions").all() as any[];
			const picked =
				all[
					Math.abs([...date].reduce((a, c) => a + c.charCodeAt(0), profileId)) %
						all.length
				];
			user
				.prepare(
					"INSERT INTO daily_questions(profile_id,local_date,question_id) VALUES(?,?,?)",
				)
				.run(profileId, date, picked.id);
			d = { question_id: picked.id };
		}
		rows = [{ id: d.question_id }];
	} else {
		rows = content
			.prepare(
				`SELECT id FROM questions WHERE book_id=? ${mode === "practice" ? "AND chapter BETWEEN ? AND ?" : ""}`,
			)
			.all(
				...(mode === "practice"
					? [bookId, chapterStart, chapterEnd]
					: [bookId]),
			) as any[];
	}
	if (!rows.length)
		throw new Error("No questions are available for this selection yet.");
	const available = rows.map((x) => x.id);
	const ids = fullQuizQuestions(available);
	const maps = ids.map(() => shuffled([0, 1, 2, 3]));
	const name = (
		content.prepare("SELECT name FROM books WHERE id=?").get(bookId) as any
	)?.name;
	const title =
		mode === "daily"
			? "Today's Question"
			: mode === "full"
				? `${name} — Full Quiz`
				: `${name} ${chapterStart === chapterEnd ? "Chapter " + chapterStart : `Chapters ${chapterStart}–${chapterEnd}`}`;
	const info = user
		.prepare(
			"INSERT INTO sessions(profile_id,mode,book_id,chapter_start,chapter_end,title,question_order,choice_orders,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
		)
		.run(
			profileId,
			mode,
			bookId || null,
			chapterStart,
			chapterEnd,
			title,
			JSON.stringify(ids),
			JSON.stringify(maps),
			now(),
		);
	return sessionState(
		user.prepare("SELECT * FROM sessions WHERE id=?").get(info.lastInsertRowid),
	);
}
function handlers() {
	ipcMain.handle("bootstrap", () => bootstrap());
	ipcMain.handle("profile:create", (_, p) => {
		const info = user
			.prepare("INSERT INTO profiles(name,avatar_id,created_at) VALUES(?,?,?)")
			.run(String(p.name).trim().slice(0, 40), p.avatarId, now());
		activeProfileId = Number(info.lastInsertRowid);
		touch(activeProfileId);
		syncDockBadge();
		return bootstrap();
	});
	ipcMain.handle("profile:select", (_, id) => {
		activeProfileId = Number(id);
		touch(activeProfileId);
		syncDockBadge();
		return bootstrap();
	});
	ipcMain.handle("profile:current", () =>
		activeProfileId ? profile(activeProfileId) : null,
	);
	ipcMain.handle("profile:avatar", (_, avatarId) => {
		if (!activeProfileId) throw new Error("No profile");
		const animal: any = content
			.prepare("SELECT id,unlock_level FROM animals WHERE id=?")
			.get(String(avatarId));
		if (!animal) throw new Error("Avatar not found.");
		const current: any = profile(activeProfileId);
		if (levelFromXp(current.xp).level < animal.unlock_level)
			throw new Error(`This avatar unlocks at level ${animal.unlock_level}.`);
		user
			.prepare(
				"UPDATE profiles SET avatar_id=?, custom_avatar_path=NULL WHERE id=?",
			)
			.run(animal.id, activeProfileId);
		return bootstrap();
	});
	ipcMain.handle("profile:custom-avatar", async () => {
		if (!activeProfileId) throw new Error("No profile");
		const win =
			BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
		const options: Electron.OpenDialogOptions = {
			title: "Choose a profile photo",
			buttonLabel: "Use photo",
			properties: ["openFile"],
			filters: [
				{
					name: "Images",
					extensions: ["jpg", "jpeg", "png", "webp", "gif"],
				},
			],
		};
		const result = win
			? await dialog.showOpenDialog(win, options)
			: await dialog.showOpenDialog(options);
		if (result.canceled || !result.filePaths[0]) return bootstrap();
		const src = result.filePaths[0];
		const ext = path.extname(src).toLowerCase();
		if (!CUSTOM_AVATAR_EXTS.has(ext))
			throw new Error("Use a JPG, PNG, WebP, or GIF photo.");
		let size = 0;
		try {
			size = fs.statSync(src).size;
		} catch {
			throw new Error("Could not read that photo.");
		}
		if (size > CUSTOM_AVATAR_MAX_BYTES)
			throw new Error("Photo must be 2 MB or smaller.");
		const dir = customAvatarDir();
		fs.mkdirSync(dir, { recursive: true });
		const destName = `${activeProfileId}${ext}`;
		const dest = path.join(dir, destName);
		for (const name of fs.readdirSync(dir)) {
			if (!name.startsWith(`${activeProfileId}.`)) continue;
			try {
				fs.unlinkSync(path.join(dir, name));
			} catch {
				/* ignore stale file */
			}
		}
		fs.copyFileSync(src, dest);
		user
			.prepare("UPDATE profiles SET custom_avatar_path=? WHERE id=?")
			.run(destName, activeProfileId);
		return bootstrap();
	});
	ipcMain.handle("profile:rename", (_, name) => {
		if (!activeProfileId) throw new Error("No profile");
		const next = String(name ?? "")
			.trim()
			.slice(0, 40);
		if (!next) throw new Error("Name cannot be empty.");
		user
			.prepare("UPDATE profiles SET name=? WHERE id=?")
			.run(next, activeProfileId);
		return bootstrap();
	});
	ipcMain.handle("profile:clear-active", () => {
		activeProfileId = null;
		syncDockBadge();
		return bootstrap();
	});
	ipcMain.handle("profile:unlink-online", () => {
		if (!activeProfileId) throw new Error("No profile");
		user
			.prepare("UPDATE profiles SET online_user_id=NULL WHERE id=?")
			.run(activeProfileId);
		return bootstrap();
	});
	ipcMain.handle("profile:link-online", (_, onlineUserId) => {
		if (!activeProfileId) throw new Error("Select a local profile first.");
		const id = String(onlineUserId);
		user.transaction(() => {
			user
				.prepare(
					"UPDATE profiles SET online_user_id=NULL WHERE online_user_id=? AND id<>?",
				)
				.run(id, activeProfileId);
			user
				.prepare("UPDATE profiles SET online_user_id=? WHERE id=?")
				.run(id, activeProfileId);
		})();
		return true;
	});
	ipcMain.handle("profile:sync-export", (_, onlineUserId) => {
		if (!activeProfileId) throw new Error("Select a local profile first.");
		const linked = user
			.prepare("SELECT online_user_id FROM profiles WHERE id=?")
			.get(activeProfileId) as { online_user_id: string | null } | undefined;
		if (linked?.online_user_id !== String(onlineUserId))
			throw new Error(
				"This local profile is not linked to the signed-in account.",
			);
		user.exec("PRAGMA wal_checkpoint(FULL)");
		const backupDir = path.join(path.dirname(userDbPath), "backups");
		fs.mkdirSync(backupDir, { recursive: true });
		const backupPath = path.join(
			backupDir,
			`selah-user-pre-sync-${Date.now()}.sqlite`,
		);
		fs.copyFileSync(userDbPath, backupPath);
		const profileId = activeProfileId;
		const sessions = user
			.prepare("SELECT * FROM sessions WHERE profile_id=?")
			.all(profileId) as { id: number }[];
		const sessionIds = sessions.map((item) => item.id);
		const sessionAnswers = sessionIds.length
			? user
					.prepare(
						`SELECT * FROM session_answers WHERE session_id IN (${sessionIds.map(() => "?").join(",")})`,
					)
					.all(...sessionIds)
			: [];
		return {
			schemaVersion: 1,
			sourceDeviceId: `desktop-${process.platform}-${profileId}`,
			backupPath,
			exportedAt: now(),
			data: {
				profile: user
					.prepare("SELECT * FROM profiles WHERE id=?")
					.get(profileId),
				sessions,
				sessionAnswers,
				bookStats: user
					.prepare("SELECT * FROM book_stats WHERE profile_id=?")
					.all(profileId),
				highlights: user
					.prepare("SELECT * FROM highlights WHERE profile_id=?")
					.all(profileId),
				readingPositions: user
					.prepare("SELECT * FROM reading_positions WHERE profile_id=?")
					.all(profileId),
				dailyQuestions: user
					.prepare("SELECT * FROM daily_questions WHERE profile_id=?")
					.all(profileId),
				unlockedBanners: user
					.prepare("SELECT * FROM unlocked_banners WHERE profile_id=?")
					.all(profileId),
				verseNotes: user
					.prepare("SELECT * FROM verse_notes WHERE profile_id=?")
					.all(profileId),
				bookmarks: user
					.prepare("SELECT * FROM bookmarks WHERE profile_id=?")
					.all(profileId),
				chapterBookmarks: user
					.prepare("SELECT * FROM chapter_bookmarks WHERE profile_id=?")
					.all(profileId),
			},
		};
	});
	ipcMain.handle("xp:sync-batch", (_, onlineUserId) => {
		if (!activeProfileId) throw new Error("Select a local profile first.");
		const linked = user
			.prepare("SELECT online_user_id,xp FROM profiles WHERE id=?")
			.get(activeProfileId) as { online_user_id: string | null; xp: number };
		if (linked.online_user_id !== String(onlineUserId))
			throw new Error(
				"This local profile is not linked to the signed-in account.",
			);
		const recorded = (
			user
				.prepare(
					"SELECT COALESCE(SUM(amount),0) total FROM xp_events WHERE profile_id=?",
				)
				.get(activeProfileId) as { total: number }
		).total;
		const initial = Math.max(0, linked.xp - recorded);
		if (initial > 0)
			user
				.prepare(
					"INSERT INTO xp_events(id,profile_id,amount,source,created_at) VALUES(?,?,?,?,?)",
				)
				.run(
					randomUUID(),
					activeProfileId,
					initial,
					"initial-local-balance",
					now(),
				);
		return user
			.prepare(
				"SELECT id,amount,source,created_at createdAt FROM xp_events WHERE profile_id=? AND synced_at IS NULL ORDER BY created_at",
			)
			.all(activeProfileId);
	});
	ipcMain.handle("xp:mark-synced", (_, ids) => {
		if (!activeProfileId) return;
		const values = Array.isArray(ids) ? ids.map(String) : [];
		if (!values.length) return;
		user
			.prepare(
				`UPDATE xp_events SET synced_at=? WHERE profile_id=? AND id IN (${values.map(() => "?").join(",")})`,
			)
			.run(now(), activeProfileId, ...values);
	});
	ipcMain.handle("xp:apply-remote", (_, events) => {
		if (!activeProfileId) throw new Error("Select a local profile first.");
		const insert = user.prepare(
			"INSERT OR IGNORE INTO xp_events(id,profile_id,amount,source,created_at,synced_at) VALUES(?,?,?,?,?,?)",
		);
		user.transaction(() => {
			for (const event of events as {
				id: string;
				amount: number;
				source: string;
				createdAt: string;
			}[]) {
				const result = insert.run(
					event.id,
					activeProfileId,
					event.amount,
					event.source,
					event.createdAt,
					now(),
				);
				if (Number(result.changes) > 0)
					user
						.prepare("UPDATE profiles SET xp=xp+? WHERE id=?")
						.run(event.amount, activeProfileId);
			}
		})();
		return profile(activeProfileId);
	});
	ipcMain.handle("reader:sync-export", (_, onlineUserId) => {
		if (!activeProfileId) throw new Error("Select a local profile first.");
		const linked = user
			.prepare("SELECT online_user_id FROM profiles WHERE id=?")
			.get(activeProfileId) as { online_user_id: string | null };
		if (linked.online_user_id !== String(onlineUserId))
			throw new Error(
				"This local profile is not linked to the signed-in account.",
			);
		return {
			sourceDeviceId: `desktop-${process.platform}-${activeProfileId}`,
			snapshot: {
				highlights: user
					.prepare(
						"SELECT book_id,chapter,verse,color,updated_at FROM highlights WHERE profile_id=?",
					)
					.all(activeProfileId),
				notes: user
					.prepare(
						"SELECT book_id,chapter,verse,note,updated_at FROM verse_notes WHERE profile_id=?",
					)
					.all(activeProfileId),
				chapterBookmarks: user
					.prepare(
						"SELECT color,book_id,chapter,updated_at FROM chapter_bookmarks WHERE profile_id=?",
					)
					.all(activeProfileId),
				readingPosition:
					user
						.prepare(
							"SELECT book_id,chapter,updated_at FROM reading_positions WHERE profile_id=?",
						)
						.get(activeProfileId) ?? null,
				exportedAt: now(),
			},
		};
	});
	ipcMain.handle("multiplayer:questions", (_, input) => {
		const bookIds = Array.isArray(input?.bookIds)
			? input.bookIds.map(String)
			: [];
		const count = Math.max(1, Math.min(20, Number(input?.count) || 10));
		if (!bookIds.length) throw new Error("Select at least one Bible book.");
		const placeholders = bookIds.map(() => "?").join(",");
		const rows = content
			.prepare(
				`SELECT q.id,q.book_id bookId,b.name bookName,q.chapter,q.verse_start verseStart,q.verse_end verseEnd,q.question_text text,q.answer_a answerA,q.answer_b answerB,q.answer_c answerC,q.answer_d answerD,q.correct_index correctIndex FROM questions q JOIN books b ON b.id=q.book_id WHERE q.book_id IN (${placeholders}) ORDER BY RANDOM() LIMIT ?`,
			)
			.all(...bookIds, count) as any[];
		if (rows.length < count)
			throw new Error(
				`Only ${rows.length} questions are available for those books. Choose more books or fewer questions.`,
			);
		return rows.map((row) => ({
			...row,
			choices: [row.answerA, row.answerB, row.answerC, row.answerD],
			answerA: undefined,
			answerB: undefined,
			answerC: undefined,
			answerD: undefined,
		}));
	});
	ipcMain.handle("session:active", () =>
		activeProfileId ? currentSession(activeProfileId) : null,
	);
	ipcMain.handle("session:start", (_, p) => {
		if (!activeProfileId) throw new Error("Select a profile first.");
		return createSession(
			activeProfileId,
			p.mode,
			p.bookId,
			p.chapterStart,
			p.chapterEnd,
		);
	});
	ipcMain.handle("session:answer", (_, p) => {
		if (!activeProfileId) throw new Error("No profile");
		const s: any = user
			.prepare("SELECT * FROM sessions WHERE id=? AND profile_id=?")
			.get(p.sessionId, activeProfileId);
		const state: any = sessionState(s);
		if (state.selectedIndex !== null) return state;
		const raw: any = content
			.prepare("SELECT correct_index FROM questions WHERE id=?")
			.get(state.current.id);
		const maps = JSON.parse(s.choice_orders);
		const correct = maps[s.current_index].indexOf(raw.correct_index);
		const ok = p.selectedIndex === correct;
		// A daily question may be reopened, but its question XP is awarded only once.
		const priorDaily: any =
			s.mode === "daily"
				? user
						.prepare(
							"SELECT answered_at FROM daily_questions WHERE profile_id=? AND local_date=?",
						)
						.get(activeProfileId, isoDay())
				: null;
		user.transaction(() => {
			user
				.prepare("INSERT INTO session_answers VALUES(?,?,?,?,?,?)")
				.run(
					s.id,
					state.current.id,
					p.selectedIndex,
					correct,
					ok ? 1 : 0,
					now(),
				);
			if (!priorDaily?.answered_at)
				awardXp(activeProfileId!, ok ? 2 : 1, "quiz-answer");
			if (s.mode === "daily" && !priorDaily?.answered_at)
				user
					.prepare(
						"UPDATE daily_questions SET selected_choice=?,correct_choice=?,is_correct=?,answered_at=? WHERE profile_id=? AND local_date=?",
					)
					.run(
						p.selectedIndex,
						correct,
						ok ? 1 : 0,
						now(),
						activeProfileId,
						isoDay(),
					);
		})();
		if (s.mode === "daily") syncDockBadge();
		return sessionState(s);
	});
	ipcMain.handle("session:next", (_, id) => {
		const s: any = user.prepare("SELECT * FROM sessions WHERE id=?").get(id);
		const st: any = sessionState(s);
		if (st.selectedIndex === null) throw new Error("Answer before continuing.");
		if (s.current_index + 1 >= st.total) {
			user.transaction(() => {
				user
					.prepare(
						"UPDATE sessions SET status='completed',completed_at=? WHERE id=?",
					)
					.run(now(), id);
				if (s.mode === "full") {
					const pct = st.total ? (st.correct / st.total) * 100 : 0;
					user
						.prepare(
							"INSERT INTO book_stats(profile_id,book_id,attempts,best_percent,last_question_count) VALUES(?,?,1,?,?) ON CONFLICT(profile_id,book_id) DO UPDATE SET attempts=attempts+1,best_percent=MAX(best_percent,excluded.best_percent),last_question_count=excluded.last_question_count",
						)
						.run(s.profile_id, s.book_id, pct, st.total);
				}
			})();
			return {
				...sessionState({ ...s, status: "completed" }),
				completed: true,
			};
		}
		user
			.prepare("UPDATE sessions SET current_index=current_index+1 WHERE id=?")
			.run(id);
		return sessionState(
			user.prepare("SELECT * FROM sessions WHERE id=?").get(id),
		);
	});
	ipcMain.handle("session:abandon", (_, id) => {
		if (!activeProfileId) throw new Error("No profile");
		const s: any = user
			.prepare("SELECT * FROM sessions WHERE id=? AND profile_id=?")
			.get(id, activeProfileId);
		if (!s) throw new Error("Session not found");
		if (s.status === "active") {
			user
				.prepare(
					"UPDATE sessions SET status='abandoned',completed_at=? WHERE id=?",
				)
				.run(now(), id);
		}
		return { ok: true as const };
	});
	ipcMain.handle("bible:chapter", (_, p) => {
		if (!activeProfileId) throw new Error("No profile");
		if (p.savePosition !== false) {
			user
				.prepare(
					"INSERT INTO reading_positions VALUES(?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET book_id=excluded.book_id,chapter=excluded.chapter,updated_at=excluded.updated_at",
				)
				.run(activeProfileId, p.bookId, p.chapter, now());
		}
		return readChapter(
			content,
			user,
			activeProfileId,
			p.translationId ?? "BSB",
			p.bookId,
			p.chapter,
		);
	});
	ipcMain.handle("highlight:set", (_, p) => {
		if (!activeProfileId) throw new Error("No profile");
		if (p.color)
			user
				.prepare(
					"INSERT INTO highlights VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,book_id,chapter,verse) DO UPDATE SET color=excluded.color,updated_at=excluded.updated_at",
				)
				.run(activeProfileId, p.bookId, p.chapter, p.verse, p.color, now());
		else
			user
				.prepare(
					"DELETE FROM highlights WHERE profile_id=? AND book_id=? AND chapter=? AND verse=?",
				)
				.run(activeProfileId, p.bookId, p.chapter, p.verse);
	});
	ipcMain.handle("stats", () => {
		if (!activeProfileId) return null;
		const books = (
			user
				.prepare("SELECT * FROM book_stats WHERE profile_id=?")
				.all(activeProfileId) as any[]
		).map((book) => {
			const current = (
				content
					.prepare("SELECT COUNT(*) count FROM questions WHERE book_id=?")
					.get(book.book_id) as { count: number }
			).count;
			const latest: any =
				book.last_question_count === null
					? user
							.prepare(
								"SELECT question_order FROM sessions WHERE profile_id=? AND book_id=? AND mode='full' AND status='completed' ORDER BY completed_at DESC LIMIT 1",
							)
							.get(activeProfileId, book.book_id)
					: null;
			const previous =
				book.last_question_count ??
				(latest ? JSON.parse(latest.question_order).length : null);
			return {
				...book,
				new_questions: previous === null ? 0 : Math.max(0, current - previous),
			};
		});
		const full: any = user
			.prepare(
				"SELECT COUNT(DISTINCT s.id) completed,COUNT(a.question_id) answered,COALESCE(SUM(a.is_correct),0) correct FROM sessions s LEFT JOIN session_answers a ON a.session_id=s.id WHERE s.profile_id=? AND s.mode='full' AND s.status='completed'",
			)
			.get(activeProfileId);
		const daily: any = user
			.prepare(
				"SELECT COUNT(*) answered,COALESCE(SUM(is_correct),0) correct FROM daily_questions WHERE profile_id=? AND answered_at IS NOT NULL",
			)
			.get(activeProfileId);
		return { books, full, daily };
	});
	ipcMain.handle("reminder:get", () => readReminderPrefs());
	ipcMain.handle("reminder:set", (_, patch) => {
		const wasEnabled = readReminderPrefs().enabled;
		if (patch && typeof patch === "object") {
			if ("enabled" in patch)
				setSetting("daily_reminder_enabled", patch.enabled ? "1" : "0");
			if ("hour" in patch)
				setSetting(
					"daily_reminder_hour",
					String(clampReminderHour(Number(patch.hour))),
				);
		}
		const prefs = readReminderPrefs();
		if (prefs.enabled && !wasEnabled) promptReminderPermission();
		tickDailyReminder();
		syncDockBadge();
		return prefs;
	});
	ipcMain.handle("share:clipboard", (_, payload) => {
		const title = String(payload?.title ?? "").trim() || "Lamp & Light";
		const text = String(payload?.text ?? "");
		copyShareToClipboard(title, text);
		return { ok: true as const };
	});
	ipcMain.on("activity", () => (lastInteraction = Date.now()));
}
function createMainWindow() {
	if (mainWindow && !mainWindow.isDestroyed()) {
		focusOrShowWindow(mainWindow);
		return mainWindow;
	}
	const win = new BrowserWindow({
		width: 1280,
		height: 820,
		minWidth: 900,
		minHeight: 650,
		title: "Lamp & Light",
		icon: path.join(
			process.cwd(),
			process.platform === "win32" ? "build/icon.ico" : "build/icon.icns",
		),
		backgroundColor: nativeTheme.shouldUseDarkColors
			? WINDOW_BG.dark
			: WINDOW_BG.light,
		webPreferences: {
			preload: path.join(app.getAppPath(), "electron", "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	mainWindow = win;
	win.on("closed", () => {
		if (mainWindow === win) mainWindow = null;
	});
	configureAutoUpdates(win);
	if (process.env.VITE_DEV_SERVER_URL)
		win.loadURL(process.env.VITE_DEV_SERVER_URL);
	else win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
	return win;
}

app.whenReady().then(() => {
	const data = app.getPath("userData");
	fs.mkdirSync(data, { recursive: true });
	user = new Database(path.join(data, "selah-user.sqlite"));
	user.pragma("foreign_keys=ON");
	user.pragma("journal_mode=WAL");
	migrate(user);
	const resourceRoot = app.isPackaged ? process.resourcesPath : process.cwd();
	content = ensureContent(path.join(data, "selah-content.sqlite"), [
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
	]);
	handlers();
	registerBibleSearch();
	registerAnnotations();
	setInterval(() => {
		if (activeProfileId && Date.now() - lastInteraction < 300000) {
			accrued += 5;
			if (accrued >= 60) {
				user
					.prepare(
						"UPDATE profiles SET xp=xp+0.08,active_seconds=active_seconds+60 WHERE id=?",
					)
					.run(activeProfileId);
				accrued -= 60;
			}
		}
	}, 5000);
	app.setName("Lamp & Light");
	configureAboutPanel(bankVersion());
	installApplicationMenu({
		getWindow: () => mainWindow,
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
	else focusOrShowWindow(mainWindow);
	syncDockBadge();
	tickDailyReminder();
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
