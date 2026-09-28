/**
 * Profile reads and mutations shared by the profile, sync and quiz IPC groups:
 * the hydrated profile row, streak roll-over, XP awards and the `bootstrap`
 * payload the renderer requests on every profile change.
 *
 * Free of any `electron` import so it can be exercised against in-memory
 * databases in tests.
 */
import { randomUUID } from "node:crypto";
import { levelFromXp, streak } from "../domain.js";
import { avatarDataUrl } from "./avatar.js";
import {
	contentDb,
	getActiveProfileId,
	getAvatarDir,
	isoDay,
	now,
	setActiveProfileId,
	userDb,
} from "../state.js";

/** Columns every profile read returns, aliased to the renderer's camelCase. */
const PROFILE_COLUMNS =
	"id,name,avatar_id avatarId,xp,current_streak currentStreak," +
	"longest_streak longestStreak,last_active_date lastActiveDate," +
	"selected_banner selectedBanner,online_user_id onlineUserId," +
	"custom_avatar_path customAvatarPath";

/**
 * Normalise a raw `profiles` row: coerce the custom-avatar path to
 * `string | null` and attach the inlined image the renderer renders.
 */
export function hydrateProfile(row: unknown) {
	if (!row || typeof row !== "object") return null;
	const p = row as Record<string, unknown>;
	const customAvatarPath =
		typeof p.customAvatarPath === "string" ? p.customAvatarPath : null;
	return {
		...p,
		customAvatarPath,
		customAvatarUrl: avatarDataUrl(getAvatarDir(), customAvatarPath),
	};
}

/** One hydrated profile, or `null` when the id does not exist. */
export function profile(id: number) {
	return hydrateProfile(
		userDb()
			.prepare(`SELECT ${PROFILE_COLUMNS} FROM profiles WHERE id=?`)
			.get(id),
	);
}

/** Roll the streak forward for today, starting one if it was ever broken. */
export function touch(id: number) {
	const p: any = profile(id),
		s = streak(p.lastActiveDate, p.currentStreak, p.longestStreak, isoDay());
	userDb()
		.prepare(
			"UPDATE profiles SET current_streak=?,longest_streak=?,last_active_date=? WHERE id=?",
		)
		.run(s.current, s.longest, isoDay(), id);
}

/** Add XP to a profile and record the event in the unsynced-activity queue. */
export function awardXp(profileId: number, amount: number, source: string) {
	userDb().prepare("UPDATE profiles SET xp=xp+? WHERE id=?").run(amount, profileId);
	userDb()
		.prepare(
			"INSERT INTO xp_events(id,profile_id,amount,source,created_at) VALUES(?,?,?,?,?)",
		)
		.run(randomUUID(), profileId, amount, source, now());
}

/** Level gate for unlockable animals/banners, used by the profile handlers. */
export function levelFor(profile: { xp: number }): number {
	return levelFromXp(profile.xp).level;
}

/**
 * The full renderable app state, returned after any profile create/select/
 * avatar/rename. Also drops the active profile when its row has disappeared.
 */
export function bootstrap(appVersion: string) {
	const profiles = (
		userDb()
			.prepare(`SELECT ${PROFILE_COLUMNS} FROM profiles ORDER BY id`)
			.all() as unknown[]
	).map(hydrateProfile);
	const active = getActiveProfileId();
	if (active && !profiles.some((p: any) => p.id === active)) {
		setActiveProfileId(null);
	}
	const books = contentDb()
		.prepare(
			"SELECT id,name,testament,book_order `order`,chapters FROM books ORDER BY book_order",
		)
		.all();
	const animals = contentDb()
		.prepare(
			"SELECT id,name,emoji,unlock_level unlockLevel FROM animals ORDER BY sort_order",
		)
		.all();
	const current = getActiveProfileId();
	return {
		profiles,
		activeProfile: current ? profile(current) : null,
		books,
		animals,
		appVersion,
		bankVersion: (
			contentDb()
				.prepare("SELECT value FROM metadata WHERE key='question_bank_version'")
				.get() as any
		).value,
	};
}
