/**
 * Process-wide mutable state shared by the main-process modules.
 *
 * Deliberately free of any *runtime* `electron` import — both imports below
 * are type-only and erase on compile — so the accessors can be unit-tested
 * without an Electron runtime. `electron/main.ts` used to hold these as module
 * locals, which forced every IPC handler to live in the same file as them.
 *
 * Every holder is assigned during `app.whenReady()` before any IPC handler can
 * possibly run, so the accessors never observe a half-built app in practice.
 * The `userDb()`/`contentDb()` throws are a backstop for a future caller that
 * registers a handler too early; they are not reachable from the current
 * registration order.
 */
import type { BrowserWindow } from "electron";
import type Database from "./db.js";

let user: Database | null = null;
let content: Database | null = null;
let userDbPath = "";
let avatarDir = "";
let activeProfileId: number | null = null;
let mainWindow: BrowserWindow | null = null;
let lastInteraction = Date.now();

/** Local calendar day as `YYYY-MM-DD` — the key space for daily questions. */
export const isoDay = () => new Date().toLocaleDateString("en-CA");

/** ISO timestamp written to every `*_at` column. */
export const now = () => new Date().toISOString();

export function setDatabases(nextUser: Database, nextContent: Database): void {
	user = nextUser;
	content = nextContent;
}

export function userDb(): Database {
	if (!user) throw new Error("The user database is not open yet.");
	return user;
}

export function contentDb(): Database {
	if (!content) throw new Error("The content database is not open yet.");
	return content;
}

export function setDatabaseLocations(next: {
	userDbPath: string;
	avatarDir: string;
}): void {
	userDbPath = next.userDbPath;
	avatarDir = next.avatarDir;
}

/** Absolute path of `selah-user.sqlite` — the file cloud sync checkpoints. */
export function getUserDbPath(): string {
	return userDbPath;
}

/** Directory holding `<profileId>.<ext>` custom avatar files. */
export function getAvatarDir(): string {
	return avatarDir;
}

export function getActiveProfileId(): number | null {
	return activeProfileId;
}

export function setActiveProfileId(next: number | null): void {
	activeProfileId = next;
}

export function getMainWindow(): BrowserWindow | null {
	return mainWindow;
}

export function setMainWindow(next: BrowserWindow | null): void {
	mainWindow = next;
}

/** Push an event to the renderer, tolerating an absent or closed window. */
export function sendToRenderer(channel: string, payload?: unknown): void {
	const win = mainWindow;
	if (!win || win.isDestroyed()) return;
	win.webContents.send(channel, payload);
}

/** Reset by the renderer's `activity` ping; read by the presence ticker. */
export function markInteraction(): void {
	lastInteraction = Date.now();
}

export function getLastInteraction(): number {
	return lastInteraction;
}
