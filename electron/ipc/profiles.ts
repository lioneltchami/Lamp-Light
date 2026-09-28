/**
 * Profile IPC: create/select/rename the local profile, pick a stock or custom
 * avatar, and link/unlink the local profile from a cloud account.
 *
 * Every mutation that changes which profile is active refreshes the dock
 * badge, and every one returns the full `bootstrap` payload so the renderer
 * re-renders from a single source of truth.
 */
import fs from "node:fs";
import path from "node:path";
import electron from "electron";
import { levelFromXp } from "../domain.js";
import { syncDockBadge } from "../reminders.js";
import {
	avatarFilesFor,
	avatarFileName,
	CUSTOM_AVATAR_DIALOG_EXTENSIONS,
	CUSTOM_AVATAR_EXTS,
	CUSTOM_AVATAR_MAX_BYTES,
} from "../service/avatar.js";
import { bootstrap, profile, touch } from "../service/profiles.js";
import {
	contentDb,
	getActiveProfileId,
	getAvatarDir,
	now,
	setActiveProfileId,
	userDb,
} from "../state.js";

const { app, dialog } = electron;

/** Re-read the whole app state after a profile mutation. */
function refresh() {
	return bootstrap(app.getVersion());
}

/** The active profile id, or the same `Error` the handlers have always thrown. */
function requireProfileId(): number {
	const id = getActiveProfileId();
	if (!id) throw new Error("No profile");
	return id;
}

export function bootstrapState() {
	return refresh();
}

export function createProfile(p: any) {
	const info = userDb()
		.prepare("INSERT INTO profiles(name,avatar_id,created_at) VALUES(?,?,?)")
		.run(String(p.name).trim().slice(0, 40), p.avatarId, now());
	const profileId = Number(info.lastInsertRowid);
	setActiveProfileId(profileId);
	touch(profileId);
	syncDockBadge();
	return refresh();
}

export function selectProfile(id: any) {
	const profileId = Number(id);
	setActiveProfileId(profileId);
	touch(profileId);
	syncDockBadge();
	return refresh();
}

export function currentProfile() {
	const id = getActiveProfileId();
	return id ? profile(id) : null;
}

export function setAvatar(avatarId: any) {
	const profileId = requireProfileId();
	const animal: any = contentDb()
		.prepare("SELECT id,unlock_level FROM animals WHERE id=?")
		.get(String(avatarId));
	if (!animal) throw new Error("Avatar not found.");
	const current: any = profile(profileId);
	if (levelFromXp(current.xp).level < animal.unlock_level)
		throw new Error(`This avatar unlocks at level ${animal.unlock_level}.`);
	userDb()
		.prepare("UPDATE profiles SET avatar_id=?, custom_avatar_path=NULL WHERE id=?")
		.run(animal.id, profileId);
	return refresh();
}

export async function setCustomAvatar() {
	const profileId = requireProfileId();
	const win =
		electron.BrowserWindow.getFocusedWindow() ??
		electron.BrowserWindow.getAllWindows()[0];
	const options: Electron.OpenDialogOptions = {
		title: "Choose a profile photo",
		buttonLabel: "Use photo",
		properties: ["openFile"],
		filters: [{ name: "Images", extensions: CUSTOM_AVATAR_DIALOG_EXTENSIONS }],
	};
	const result = win
		? await dialog.showOpenDialog(win, options)
		: await dialog.showOpenDialog(options);
	if (result.canceled || !result.filePaths[0]) return refresh();
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
	const dir = getAvatarDir();
	fs.mkdirSync(dir, { recursive: true });
	// Drop the previous avatar whatever its extension was, so a profile never
	// accumulates one file per format.
	for (const name of avatarFilesFor(dir, profileId)) {
		try {
			fs.unlinkSync(path.join(dir, name));
		} catch {
			/* ignore stale file */
		}
	}
	const destName = avatarFileName(profileId, ext);
	fs.copyFileSync(src, path.join(dir, destName));
	userDb()
		.prepare("UPDATE profiles SET custom_avatar_path=? WHERE id=?")
		.run(destName, profileId);
	return refresh();
}

export function renameProfile(name: any) {
	const profileId = requireProfileId();
	const next = String(name ?? "")
		.trim()
		.slice(0, 40);
	if (!next) throw new Error("Name cannot be empty.");
	userDb()
		.prepare("UPDATE profiles SET name=? WHERE id=?")
		.run(next, profileId);
	return refresh();
}

export function clearActiveProfile() {
	setActiveProfileId(null);
	syncDockBadge();
	return refresh();
}

export function unlinkOnline() {
	const profileId = requireProfileId();
	userDb()
		.prepare("UPDATE profiles SET online_user_id=NULL WHERE id=?")
		.run(profileId);
	return refresh();
}

export function linkOnline(onlineUserId: any) {
	const profileId = getActiveProfileId();
	if (!profileId) throw new Error("Select a local profile first.");
	const id = String(onlineUserId);
	userDb().transaction(() => {
		userDb()
			.prepare(
				"UPDATE profiles SET online_user_id=NULL WHERE online_user_id=? AND id<>?",
			)
			.run(id, profileId);
		userDb()
			.prepare("UPDATE profiles SET online_user_id=? WHERE id=?")
			.run(id, profileId);
	})();
	return true;
}
