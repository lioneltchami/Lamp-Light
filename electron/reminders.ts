/**
 * Daily-question state and the macOS surfaces derived from it: the dock badge
 * and the once-a-day reminder notification.
 *
 * Imports `electron/macos.js` (and therefore an Electron runtime) for the
 * badge, notification and focus helpers. The decision predicates those helpers
 * use — `shouldFireDailyReminder`, `clampReminderHour` — are pure and already
 * covered by `macos.test.ts`.
 */
import {
	clampReminderHour,
	focusOrShowWindow,
	promptReminderPermission,
	refreshDockBadge,
	shouldFireDailyReminder,
	showDailyReminderNotification,
	type ReminderPrefs,
} from "./macos.js";
import {
	getActiveProfileId,
	getMainWindow,
	isoDay,
	sendToRenderer,
	userDb,
} from "./state.js";

export function getSetting(key: string): string | null {
	const row = userDb()
		.prepare("SELECT value FROM settings WHERE key=?")
		.get(key) as { value: string } | undefined;
	return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
	userDb()
		.prepare(
			"INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
		)
		.run(key, value);
}

/** Reminder prefs, defaulting `enabled` to on for macOS. */
export function readReminderPrefs(): ReminderPrefs {
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

/** True while today's question has not been answered (or none exists yet). */
export function isDailyUnanswered(): boolean {
	const profileId = getActiveProfileId();
	if (!profileId) return false;
	const row = userDb()
		.prepare(
			"SELECT answered_at answeredAt FROM daily_questions WHERE profile_id=? AND local_date=?",
		)
		.get(profileId, isoDay()) as { answeredAt: string | null } | undefined;
	if (!row) return true;
	return row.answeredAt == null;
}

/** Paint the dock badge to match today's question state. */
export function syncDockBadge(): void {
	refreshDockBadge(Boolean(getActiveProfileId()) && isDailyUnanswered());
}

/**
 * Fire the daily reminder if it is due, and refresh the badge either way.
 * Only records `lastNotified` when a notification was actually shown, so a
 * machine that cannot display one retries on the next tick.
 */
export function tickDailyReminder(): void {
	if (process.platform !== "darwin") return;
	const prefs = readReminderPrefs();
	const unanswered = Boolean(getActiveProfileId()) && isDailyUnanswered();
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
		focusOrShowWindow(getMainWindow());
		sendToRenderer("app:navigate", "home");
	});
	if (shown) setSetting("daily_reminder_last_notified", isoDay());
}

/**
 * Apply a partial reminder patch and return the resulting prefs. Prompts for
 * notification permission only on the disabled → enabled transition, so the
 * user is asked exactly once.
 */
export function updateReminderPrefs(
	patch: unknown,
): ReminderPrefs {
	const wasEnabled = readReminderPrefs().enabled;
	if (patch && typeof patch === "object") {
		const p = patch as { enabled?: unknown; hour?: unknown };
		if ("enabled" in p) setSetting("daily_reminder_enabled", p.enabled ? "1" : "0");
		if ("hour" in p)
			setSetting("daily_reminder_hour", String(clampReminderHour(Number(p.hour))));
	}
	const prefs = readReminderPrefs();
	if (prefs.enabled && !wasEnabled) promptReminderPermission();
	tickDailyReminder();
	syncDockBadge();
	return prefs;
}
