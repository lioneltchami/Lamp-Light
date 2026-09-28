/**
 * App-level IPC: native theme, app info, revealing the data directory,
 * opening external links, and whole-database backup export.
 *
 * Handler payloads are typed `any` on purpose: the preload bridge is the
 * renderer-facing contract and these signatures are unchanged by this split.
 */
import fs from "node:fs";
import path from "node:path";
import electron from "electron";
import { isAllowedExternalUrl } from "../../shared/externalLinks.js";
import { resolveWindowTheme } from "../theme.js";
import { userDb } from "../state.js";

const { app, nativeTheme, shell, dialog } = electron;

/**
 * Apply a theme preference to the native theme and every open window.
 *
 * The order matters: `themeSource` is assigned *before* `shouldUseDarkColors`
 * is read, so forcing `light`/`dark` resolves against the theme we just
 * applied rather than the previous one.
 */
export function applyNativeTheme(preference: string) {
	const mode =
		preference === "light" || preference === "dark" ? preference : "system";
	nativeTheme.themeSource = mode;
	const resolved = resolveWindowTheme(mode, nativeTheme.shouldUseDarkColors);
	for (const win of electron.BrowserWindow.getAllWindows()) {
		win.setBackgroundColor(resolved.background);
	}
	return resolved;
}

export function themeSet(preference: unknown) {
	return applyNativeTheme(String(preference ?? "system"));
}

export function appInfo() {
	return {
		version: app.getVersion(),
		userDataPath: app.getPath("userData"),
		name: app.getName(),
	};
}

export async function revealData() {
	const dir = app.getPath("userData");
	fs.mkdirSync(dir, { recursive: true });
	const error = await shell.openPath(dir);
	if (error) throw new Error(error);
	return dir;
}

export async function openExternal(url: unknown) {
	if (typeof url !== "string" || !isAllowedExternalUrl(url)) {
		throw new Error("That link is not allowed from the app.");
	}
	await shell.openExternal(url);
	return { ok: true as const };
}

export async function exportBackup() {
	const dataDir = app.getPath("userData");
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const result = await dialog.showSaveDialog({
		title: "Export Lamp & Light backup",
		defaultPath: path.join(app.getPath("documents"), `lamp-light-backup-${stamp}`),
		buttonLabel: "Export",
		properties: ["createDirectory", "showOverwriteConfirmation"],
	});
	if (result.canceled || !result.filePath) return { canceled: true as const };
	const destDir = result.filePath;
	fs.mkdirSync(destDir, { recursive: true });
	try {
		userDb().exec("PRAGMA wal_checkpoint(FULL)");
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
}
