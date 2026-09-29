/**
 * Annotation IPC: verse notes (set/list/export/import), single-verse bookmarks
 * and highlights, and the five colour-coded chapter bookmarks.
 *
 * List payloads are decorated with the book's display name; a note whose book
 * is missing from the content database still renders, falling back to the raw
 * book id.
 */
import fs from "node:fs";
import path from "node:path";
import electron from "electron";
import { parseNotesImport } from "../../shared/notesImport.js";
import { contentDb, getActiveProfileId, now, userDb } from "../state.js";

const { app, dialog } = electron;

const CHAPTER_BOOKMARK_COLORS = ["red", "gold", "green", "blue", "purple"];

/** Active profile id, or the same `Error` the handlers have always thrown. */
function requireProfileId(): number {
	const id = getActiveProfileId();
	if (!id) throw new Error("No profile");
	return id;
}

/** Attach the book's display name, falling back to the raw book id. */
function withBookName<T extends { bookId: string }>(row: T) {
	return {
		...row,
		bookName:
			(
				contentDb()
					.prepare("SELECT name FROM books WHERE id=?")
					.get(row.bookId) as { name: string } | undefined
			)?.name ?? row.bookId,
	};
}

type NoteRow = {
	bookId: string;
	chapter: number;
	verse: number;
	note: string;
	updatedAt: string;
};

export function setNote(p: any) {
	const profileId = requireProfileId();
	const note = String(p.note ?? "").trim();
	if (note)
		userDb()
			.prepare(
				"INSERT INTO verse_notes VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,book_id,chapter,verse) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at",
			)
			.run(profileId, p.bookId, p.chapter, p.verse, note, now());
	else
		userDb()
			.prepare(
				"DELETE FROM verse_notes WHERE profile_id=? AND book_id=? AND chapter=? AND verse=?",
			)
			.run(profileId, p.bookId, p.chapter, p.verse);
}

export function listNotes() {
	const profileId = requireProfileId();
	return (
		userDb()
			.prepare(
				"SELECT book_id bookId,chapter,verse,note,updated_at updatedAt FROM verse_notes WHERE profile_id=? ORDER BY updated_at DESC",
			)
			.all(profileId) as NoteRow[]
	).map(withBookName);
}

export async function exportNotes() {
	const profileId = requireProfileId();
	const notes = (
		userDb()
			.prepare(
				"SELECT book_id bookId,chapter,verse,note,updated_at updatedAt FROM verse_notes WHERE profile_id=? ORDER BY book_id,chapter,verse",
			)
			.all(profileId) as NoteRow[]
	).map(withBookName);
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const result = await dialog.showSaveDialog({
		title: "Export verse notes",
		defaultPath: path.join(
			app.getPath("documents"),
			`lamp-light-notes-${stamp}.json`,
		),
		filters: [{ name: "JSON", extensions: ["json"] }],
	});
	if (result.canceled || !result.filePath) return { canceled: true as const };
	fs.writeFileSync(
		result.filePath,
		JSON.stringify({ version: 1, exportedAt: now(), notes }, null, 2),
	);
	return { canceled: false as const, path: result.filePath, count: notes.length };
}

export async function importNotes() {
	const profileId = requireProfileId();
	const result = await dialog.showOpenDialog({
		title: "Import verse notes",
		properties: ["openFile"],
		filters: [{ name: "JSON", extensions: ["json"] }],
	});
	if (result.canceled || !result.filePaths[0]) return { canceled: true as const };
	const filePath = result.filePaths[0];
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		throw new Error("Could not read notes JSON file.");
	}
	const rows = parseNotesImport(parsed);
	if (!rows.length) throw new Error("No valid notes found in that file.");
	const upsert = userDb().prepare(
		"INSERT INTO verse_notes VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,book_id,chapter,verse) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at",
	);
	const stamp = now();
	const tx = userDb().transaction(() => {
		for (const row of rows) {
			// Skip references past the end of the book rather than failing the
			// whole import on one bad row.
			const book = contentDb()
				.prepare("SELECT chapters FROM books WHERE id=?")
				.get(row.bookId) as { chapters: number } | undefined;
			if (!book || row.chapter > book.chapters) continue;
			upsert.run(
				profileId,
				row.bookId,
				row.chapter,
				row.verse,
				row.note,
				stamp,
			);
		}
	});
	tx();
	// The count is what the *file* contained, not what landed: rows past the
	// end of a book are silently dropped, and the renderer reports both.
	return { canceled: false as const, path: filePath, count: rows.length };
}

export function toggleBookmark(p: any) {
	const profileId = requireProfileId();
	const exists = userDb()
		.prepare(
			"SELECT 1 FROM bookmarks WHERE profile_id=? AND book_id=? AND chapter=? AND verse=?",
		)
		.get(profileId, p.bookId, p.chapter, p.verse);
	if (exists)
		userDb()
			.prepare(
				"DELETE FROM bookmarks WHERE profile_id=? AND book_id=? AND chapter=? AND verse=?",
			)
			.run(profileId, p.bookId, p.chapter, p.verse);
	else
		userDb()
			.prepare("INSERT INTO bookmarks VALUES(?,?,?,?,?)")
			.run(profileId, p.bookId, p.chapter, p.verse, now());
}

export function listBookmarks() {
	const profileId = requireProfileId();
	return (
		userDb()
			.prepare(
				"SELECT book_id bookId,chapter,verse,created_at createdAt FROM bookmarks WHERE profile_id=? ORDER BY created_at DESC",
			)
			.all(profileId) as {
			bookId: string;
			chapter: number;
			verse: number;
			createdAt: string;
		}[]
	).map(withBookName);
}

export function listHighlights() {
	const profileId = requireProfileId();
	return (
		userDb()
			.prepare(
				"SELECT book_id bookId,chapter,verse,color,updated_at updatedAt FROM highlights WHERE profile_id=? ORDER BY updated_at DESC",
			)
			.all(profileId) as {
			bookId: string;
			chapter: number;
			verse: number;
			color: string;
			updatedAt: string;
		}[]
	).map(withBookName);
}

export function setHighlight(p: any) {
	const profileId = requireProfileId();
	if (p.color)
		userDb()
			.prepare(
				"INSERT INTO highlights VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,book_id,chapter,verse) DO UPDATE SET color=excluded.color,updated_at=excluded.updated_at",
			)
			.run(profileId, p.bookId, p.chapter, p.verse, p.color, now());
	else
		userDb()
			.prepare(
				"DELETE FROM highlights WHERE profile_id=? AND book_id=? AND chapter=? AND verse=?",
			)
			.run(profileId, p.bookId, p.chapter, p.verse);
}

export function listChapterBookmarks() {
	const profileId = requireProfileId();
	return (
		userDb()
			.prepare(
				"SELECT color,book_id bookId,chapter FROM chapter_bookmarks WHERE profile_id=?",
			)
			.all(profileId) as {
			color: string;
			bookId: string;
			chapter: number;
		}[]
	).map(withBookName);
}

export function setChapterBookmark(p: any) {
	const profileId = requireProfileId();
	if (!CHAPTER_BOOKMARK_COLORS.includes(String(p.color)))
		throw new Error("Invalid bookmark color.");
	const book = contentDb()
		.prepare("SELECT chapters FROM books WHERE id=?")
		.get(String(p.bookId)) as { chapters: number } | undefined;
	if (!book || Number(p.chapter) < 1 || Number(p.chapter) > book.chapters)
		throw new Error("Invalid Bible location.");
	userDb()
		.prepare(
			"INSERT INTO chapter_bookmarks(profile_id,color,book_id,chapter,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(profile_id,color) DO UPDATE SET book_id=excluded.book_id,chapter=excluded.chapter,updated_at=excluded.updated_at",
		)
		.run(profileId, p.color, p.bookId, p.chapter, now());
}

export function clearChapterBookmark(color: unknown) {
	const profileId = requireProfileId();
	userDb()
		.prepare("DELETE FROM chapter_bookmarks WHERE profile_id=? AND color=?")
		.run(profileId, String(color));
}
