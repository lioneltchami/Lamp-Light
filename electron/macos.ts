/**
 * macOS desktop chrome: menu, About, dock badge, daily reminder, share helpers.
 * Safe to call on other platforms — Darwin-only bits no-op.
 */

import type { BrowserWindow } from "electron";
import electron from "electron";

const { Menu, Notification, app, clipboard, shell } = electron;

export const RELEASES_URL =
	"https://github.com/lioneltchami/Lamp-Light/releases/latest";

export type ReminderPrefs = {
	enabled: boolean;
	hour: number;
	lastNotified: string | null;
};

/** Pure: dock badge string for unanswered daily. */
export function badgeForDailyUnanswered(unanswered: boolean): string {
	return unanswered ? "1" : "";
}

export function clampReminderHour(hour: number): number {
	if (!Number.isFinite(hour)) return 9;
	return Math.min(23, Math.max(0, Math.floor(hour)));
}

export function shouldFireDailyReminder(args: {
	enabled: boolean;
	unanswered: boolean;
	hour: number;
	lastNotified: string | null;
	now: Date;
}): boolean {
	if (!args.enabled || !args.unanswered) return false;
	const today = args.now.toLocaleDateString("en-CA");
	if (args.lastNotified === today) return false;
	if (args.now.getHours() < clampReminderHour(args.hour)) return false;
	return true;
}

export function configureAboutPanel(bankVersion: string) {
	if (typeof app.setAboutPanelOptions !== "function") return;
	app.setAboutPanelOptions({
		applicationName: "Lamp & Light",
		applicationVersion: app.getVersion(),
		version: bankVersion,
		copyright: "© Lamp & Light",
		credits:
			"Offline Bible trivia with public-domain translations (BSB, WEB, KJV).",
	});
}

export function refreshDockBadge(unanswered: boolean) {
	if (process.platform !== "darwin" || !app.dock) return;
	app.dock.setBadge(badgeForDailyUnanswered(unanswered));
}

type MenuDeps = {
	getWindow: () => BrowserWindow | null;
	sendNavigate: (page: string) => void;
	sendShareVotd: () => void;
};

export function installApplicationMenu(deps: MenuDeps) {
	const isMac = process.platform === "darwin";
	const template: Electron.MenuItemConstructorOptions[] = [
		...(isMac
			? [
					{
						label: app.name,
						submenu: [
							{ role: "about" as const },
							{ type: "separator" as const },
							{
								label: "Preferences…",
								accelerator: "CmdOrCtrl+,",
								click: () => deps.sendNavigate("settings"),
							},
							{ type: "separator" as const },
							{ role: "services" as const },
							{ type: "separator" as const },
							{ role: "hide" as const },
							{ role: "hideOthers" as const },
							{ role: "unhide" as const },
							{ type: "separator" as const },
							{ role: "quit" as const },
						],
					},
				]
			: []),
		{
			label: "File",
			submenu: [
				{
					label: "Share Verse of the Day…",
					click: () => deps.sendShareVotd(),
				},
				{ type: "separator" },
				isMac ? { role: "close" } : { role: "quit" },
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				...(isMac
					? [
							{ role: "pasteAndMatchStyle" as const },
							{ role: "delete" as const },
							{ role: "selectAll" as const },
						]
					: [
							{ role: "delete" as const },
							{ type: "separator" as const },
							{ role: "selectAll" as const },
						]),
			],
		},
		{
			label: "View",
			submenu: [
				{
					label: "Home",
					accelerator: "CmdOrCtrl+1",
					click: () => deps.sendNavigate("home"),
				},
				{
					label: "Quizzes",
					accelerator: "CmdOrCtrl+2",
					click: () => deps.sendNavigate("quizzes"),
				},
				{
					label: "Bible",
					accelerator: "CmdOrCtrl+3",
					click: () => deps.sendNavigate("bible"),
				},
				{
					label: "Online",
					accelerator: "CmdOrCtrl+4",
					click: () => deps.sendNavigate("online"),
				},
				{
					label: "Medals",
					accelerator: "CmdOrCtrl+5",
					click: () => deps.sendNavigate("medals"),
				},
				{
					label: "Profile",
					accelerator: "CmdOrCtrl+6",
					click: () => deps.sendNavigate("profile"),
				},
				{ type: "separator" },
				...(!isMac
					? [
							{
								label: "Preferences…",
								accelerator: "CmdOrCtrl+,",
								click: () => deps.sendNavigate("settings"),
							},
							{ type: "separator" as const },
						]
					: []),
				{ role: "reload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{
			label: "Window",
			submenu: [
				{ role: "minimize" },
				{ role: "zoom" },
				...(isMac
					? [{ type: "separator" as const }, { role: "front" as const }]
					: [{ role: "close" as const }]),
			],
		},
		{
			label: "Help",
			submenu: [
				{
					label: "Release Notes",
					click: () => {
						void shell.openExternal(RELEASES_URL);
					},
				},
			],
		},
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function showDailyReminderNotification(onClick: () => void) {
	if (!Notification.isSupported()) return false;
	const n = new Notification({
		title: "Lamp & Light",
		body: "Today’s daily question is waiting for you.",
	});
	n.on("click", onClick);
	n.show();
	return true;
}

/** One-shot so macOS asks for notification permission when enabling reminders. */
export function promptReminderPermission() {
	if (process.platform !== "darwin" || !Notification.isSupported()) return;
	new Notification({
		title: "Daily reminders on",
		body: "We’ll nudge you when today’s question is still waiting.",
		silent: true,
	}).show();
}

/** Clipboard fallback when Web Share is unavailable. */
export function copyShareToClipboard(title: string, text: string) {
	const body = text.trim() ? `${title.trim()}\n\n${text.trim()}` : title.trim();
	clipboard.writeText(body);
	if (Notification.isSupported()) {
		new Notification({
			title: "Copied to clipboard",
			body: title.trim() || "Ready to paste",
			silent: true,
		}).show();
	}
}

export function focusOrShowWindow(win: BrowserWindow | null) {
	if (!win || win.isDestroyed()) return;
	if (win.isMinimized()) win.restore();
	win.show();
	win.focus();
}
