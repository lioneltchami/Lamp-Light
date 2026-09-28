/**
 * Creation of the single main window.
 *
 * `openMainWindow` is idempotent: if a live window already exists it is
 * focused and returned without re-running `afterCreate`, so per-window wiring
 * (the auto-updater) stays registered exactly once.
 */
import path from "node:path";
import electron, { type BrowserWindow } from "electron";
import { focusOrShowWindow } from "./macos.js";
import { getMainWindow, setMainWindow } from "./state.js";
import { WINDOW_BG } from "./theme.js";

const { app, nativeTheme } = electron;

export function openMainWindow(
	afterCreate: (win: BrowserWindow) => void,
): BrowserWindow {
	const existing = getMainWindow();
	if (existing && !existing.isDestroyed()) {
		focusOrShowWindow(existing);
		return existing;
	}
	const win = new electron.BrowserWindow({
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
	setMainWindow(win);
	win.on("closed", () => {
		if (getMainWindow() === win) setMainWindow(null);
	});
	afterCreate(win);
	loadRenderer(win);
	return win;
}

/** Point the window at the Vite dev server, or the built `dist/index.html`. */
function loadRenderer(win: BrowserWindow): void {
	if (process.env.VITE_DEV_SERVER_URL) {
		win.loadURL(process.env.VITE_DEV_SERVER_URL);
		return;
	}
	win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
}
