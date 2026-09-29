/**
 * Database bootstrap: open `selah-user.sqlite` / `selah-content.sqlite` and
 * apply pending user migrations.
 *
 * Takes its paths as arguments (rather than reading `app.getPath`) so the
 * migration bookkeeping is unit-testable without an Electron runtime.
 */
import Database from "./db.js";
import { ensureContent } from "./content.js";
import { userMigrations } from "./migrations.js";
import { now } from "./state.js";

/** One source verse file to seed into the content database. */
export type ContentSource = { translationId: string; file: string };

/**
 * Apply every `userMigrations` entry this database has not recorded yet.
 * Each entry runs inside its own transaction together with the bookkeeping
 * row, so an interrupted migration is retried on the next launch rather than
 * being silently skipped.
 */
export function migrate(db: Database): void {
	db.exec(
		"CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
	);
	const applied = new Set(
		(
			db.prepare("SELECT version FROM schema_migrations").all() as unknown as {
				version: number;
			}[]
		).map((x) => x.version),
	);
	userMigrations.forEach((sql, i) => {
		if (!applied.has(i + 1))
			db.transaction(() => {
				db.exec(sql);
				db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(
					i + 1,
					now(),
				);
			})();
	});
}

/**
 * Version of the seeded question bank, for the About panel. Falls back to an
 * empty string if the row is unreadable — a missing version must not stop the
 * app from starting. (The `bootstrap` payload reads the same row strictly;
 * that one is a renderer contract, not a startup path.)
 */
export function questionBankVersion(content: Database): string {
	try {
		return (
			(
				content
					.prepare(
						"SELECT value FROM metadata WHERE key='question_bank_version'",
					)
					.get() as { value: string } | undefined
			)?.value ?? ""
		);
	} catch {
		return "";
	}
}

/** Open both databases, migrate the user one, seed the content one. */
export function openDatabases(options: {
	userDbPath: string;
	contentDbPath: string;
	contentSources: ContentSource[];
}): { user: Database; content: Database } {
	const user = new Database(options.userDbPath);
	user.pragma("foreign_keys=ON");
	user.pragma("journal_mode=WAL");
	migrate(user);
	const content = ensureContent(options.contentDbPath, options.contentSources);
	return { user, content };
}
