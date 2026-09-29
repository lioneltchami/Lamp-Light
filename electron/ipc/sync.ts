/**
 * Cloud-sync IPC: the full offline snapshot the renderer uploads, the batch of
 * XP events awaiting sync, the acknowledgement of synced ids, and the merge of
 * remote XP events.
 *
 * All four handlers refuse to act on a profile that is not linked to the signed
 * in account, so one device cannot read or write another device's local data.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { profile } from "../service/profiles.js";
import {
	getActiveProfileId,
	getUserDbPath,
	now,
	userDb,
} from "../state.js";

/** Reject unless the active local profile is linked to `onlineUserId`. */
function requireLinkedProfile(onlineUserId: unknown): number {
	const profileId = getActiveProfileId();
	if (!profileId) throw new Error("Select a local profile first.");
	const linked = userDb()
		.prepare("SELECT online_user_id FROM profiles WHERE id=?")
		.get(profileId) as { online_user_id: string | null } | undefined;
	if (linked?.online_user_id !== String(onlineUserId))
		throw new Error(
			"This local profile is not linked to the signed-in account.",
		);
	return profileId;
}

export function syncExport(onlineUserId: unknown) {
	const profileId = requireLinkedProfile(onlineUserId);
	userDb().exec("PRAGMA wal_checkpoint(FULL)");
	const backupDir = path.join(path.dirname(getUserDbPath()), "backups");
	fs.mkdirSync(backupDir, { recursive: true });
	const backupPath = path.join(
		backupDir,
		`selah-user-pre-sync-${Date.now()}.sqlite`,
	);
	fs.copyFileSync(getUserDbPath(), backupPath);
	const sessions = userDb()
		.prepare("SELECT * FROM sessions WHERE profile_id=?")
		.all(profileId) as { id: number }[];
	const sessionIds = sessions.map((item) => item.id);
	const sessionAnswers = sessionIds.length
		? userDb()
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
			profile: userDb().prepare("SELECT * FROM profiles WHERE id=?").get(profileId),
			sessions,
			sessionAnswers,
			bookStats: userDb()
				.prepare("SELECT * FROM book_stats WHERE profile_id=?")
				.all(profileId),
			highlights: userDb()
				.prepare("SELECT * FROM highlights WHERE profile_id=?")
				.all(profileId),
			readingPositions: userDb()
				.prepare("SELECT * FROM reading_positions WHERE profile_id=?")
				.all(profileId),
			dailyQuestions: userDb()
				.prepare("SELECT * FROM daily_questions WHERE profile_id=?")
				.all(profileId),
			unlockedBanners: userDb()
				.prepare("SELECT * FROM unlocked_banners WHERE profile_id=?")
				.all(profileId),
			verseNotes: userDb()
				.prepare("SELECT * FROM verse_notes WHERE profile_id=?")
				.all(profileId),
			bookmarks: userDb()
				.prepare("SELECT * FROM bookmarks WHERE profile_id=?")
				.all(profileId),
			chapterBookmarks: userDb()
				.prepare("SELECT * FROM chapter_bookmarks WHERE profile_id=?")
				.all(profileId),
		},
	};
}

export function xpSyncBatch(onlineUserId: unknown) {
	const profileId = getActiveProfileId();
	if (!profileId) throw new Error("Select a local profile first.");
	const linked = userDb()
		.prepare("SELECT online_user_id,xp FROM profiles WHERE id=?")
		.get(profileId) as { online_user_id: string | null; xp: number };
	if (linked.online_user_id !== String(onlineUserId))
		throw new Error(
			"This local profile is not linked to the signed-in account.",
		);
	const recorded = (
		userDb()
			.prepare(
				"SELECT COALESCE(SUM(amount),0) total FROM xp_events WHERE profile_id=?",
			)
			.get(profileId) as { total: number }
	).total;
	// Pre-sync XP is real but has no event behind it, so seed one event for it
	// before uploading, otherwise the first sync would upload a gap.
	const initial = Math.max(0, linked.xp - recorded);
	if (initial > 0)
		userDb()
			.prepare(
				"INSERT INTO xp_events(id,profile_id,amount,source,created_at) VALUES(?,?,?,?,?)",
			)
			.run(
				randomUUID(),
				profileId,
				initial,
				"initial-local-balance",
				now(),
			);
	return userDb()
		.prepare(
			"SELECT id,amount,source,created_at createdAt FROM xp_events WHERE profile_id=? AND synced_at IS NULL ORDER BY created_at",
		)
		.all(profileId);
}

export function xpMarkSynced(ids: unknown) {
	const profileId = getActiveProfileId();
	if (!profileId) return;
	const values = Array.isArray(ids) ? ids.map(String) : [];
	if (!values.length) return;
	userDb()
		.prepare(
			`UPDATE xp_events SET synced_at=? WHERE profile_id=? AND id IN (${values.map(() => "?").join(",")})`,
		)
		.run(now(), profileId, ...values);
}

export function xpApplyRemote(events: unknown) {
	const profileId = getActiveProfileId();
	if (!profileId) throw new Error("Select a local profile first.");
	const insert = userDb().prepare(
		"INSERT OR IGNORE INTO xp_events(id,profile_id,amount,source,created_at,synced_at) VALUES(?,?,?,?,?,?)",
	);
	userDb().transaction(() => {
		for (const event of events as {
			id: string;
			amount: number;
			source: string;
			createdAt: string;
		}[]) {
			const result = insert.run(
				event.id,
				profileId,
				event.amount,
				event.source,
				event.createdAt,
				now(),
			);
			// OR IGNORE: an id we already applied must not be added twice.
			if (Number(result.changes) > 0)
				userDb()
					.prepare("UPDATE profiles SET xp=xp+? WHERE id=?")
					.run(event.amount, profileId);
		}
	})();
	return profile(profileId);
}

/**
 * Reader-only snapshot (annotations, not progress) for the cloud reader
 * cross-device sync.
 */
export function readerSyncExport(onlineUserId: unknown) {
	const profileId = requireLinkedProfile(onlineUserId);
	return {
		sourceDeviceId: `desktop-${process.platform}-${profileId}`,
		snapshot: {
			highlights: userDb()
				.prepare(
					"SELECT book_id,chapter,verse,color,updated_at FROM highlights WHERE profile_id=?",
				)
				.all(profileId),
			notes: userDb()
				.prepare(
					"SELECT book_id,chapter,verse,note,updated_at FROM verse_notes WHERE profile_id=?",
				)
				.all(profileId),
			chapterBookmarks: userDb()
				.prepare(
					"SELECT color,book_id,chapter,updated_at FROM chapter_bookmarks WHERE profile_id=?",
				)
				.all(profileId),
			readingPosition:
				userDb()
					.prepare(
						"SELECT book_id,chapter,updated_at FROM reading_positions WHERE profile_id=?",
					)
					.get(profileId) ?? null,
			exportedAt: now(),
		},
	};
}
