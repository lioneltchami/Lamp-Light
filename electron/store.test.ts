import { describe, expect, it } from "vitest";
import Database from "./db.js";
import { userMigrations } from "./migrations.js";
import { migrate, questionBankVersion } from "./store.js";
import { ensureContent } from "./content.js";

function freshUserDb(): Database {
	const db = new Database(":memory:");
	migrate(db);
	return db;
}

describe("user database migrations", () => {
	it("records one bookkeeping row per migration", () => {
		const db = freshUserDb();
		const versions = (
			db
				.prepare("SELECT version FROM schema_migrations ORDER BY version")
				.all() as unknown as { version: number }[]
		).map((row) => row.version);
		expect(versions).toEqual(userMigrations.map((_sql, i) => i + 1));
		db.close();
	});

	it("is idempotent — a second migrate applies nothing", () => {
		// `app.whenReady()` runs on every launch, and a partially-applied
		// migration must be retried rather than skipped, so the guard has to be
		// both "don't reapply" and "reapply what is missing".
		const db = freshUserDb();
		db.prepare("UPDATE schema_migrations SET applied_at='tampered'").run();
		migrate(db);
		expect(
			(db.prepare("SELECT COUNT(*) count FROM schema_migrations").get() as unknown as {
				count: number;
			}).count,
		).toBe(userMigrations.length);
		expect(
			(db.prepare("SELECT applied_at FROM schema_migrations").get() as unknown as {
				applied_at: string;
			}).applied_at,
		).toBe("tampered");
		db.close();
	});

	it("refuses a database whose bookkeeping claims migrations that cannot apply", () => {
		// A hand-edited `schema_migrations` claiming version 1 while `profiles`
		// is absent makes the *next* `ALTER TABLE profiles` fail. Surfacing that
		// loudly at startup beats a half-migrated database that fails later, on
		// the first query. This state is unreachable in practice because the
		// bookkeeping row is written in the same transaction as the schema
		// change — this test pins the loud failure as the chosen behaviour.
		const db = new Database(":memory:");
		db.exec(
			"CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
		);
		db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(1, "then");
		expect(() => migrate(db)).toThrow();
		db.close();
	});

	it("creates the tables the renderer depends on", () => {
		const db = freshUserDb();
		const tables = (
			db
				.prepare("SELECT name FROM sqlite_master WHERE type='table'")
				.all() as unknown as { name: string }[]
		).map((row) => row.name);
		expect(tables).toEqual(
			expect.arrayContaining([
				"profiles",
				"sessions",
				"session_answers",
				"book_stats",
				"highlights",
				"reading_positions",
				"daily_questions",
				"verse_notes",
				"bookmarks",
				"chapter_bookmarks",
				"xp_events",
			]),
		);
		db.close();
	});
});

describe("question bank version", () => {
	it("reports the seeded bank version", () => {
		const content = ensureContent(":memory:");
		expect(questionBankVersion(content)).toBeTruthy();
	});

	it("falls back to an empty string when the row is unreadable", () => {
		// The About panel must never be the reason the app fails to start.
		expect(questionBankVersion(new Database(":memory:"))).toBe("");
	});
});
