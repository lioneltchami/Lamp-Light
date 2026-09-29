/**
 * Settings-shaped IPC: the daily-reminder preferences and the clipboard
 * fallback for sharing a verse of the day.
 */
import { copyShareToClipboard } from "../macos.js";
import { readReminderPrefs, updateReminderPrefs } from "../reminders.js";

export function getReminder() {
	return readReminderPrefs();
}

export function setReminder(patch: unknown) {
	return updateReminderPrefs(patch);
}

export function shareToClipboard(payload: any) {
	const title = String(payload?.title ?? "").trim() || "Lamp & Light";
	const text = String(payload?.text ?? "");
	copyShareToClipboard(title, text);
	return { ok: true as const };
}
