/**
 * Reader IPC: translation list, verse search, reading position, and the merged
 * chapter payload (verses + this profile's highlights, notes and bookmarks).
 */
import { readChapter, searchVerses } from "../bible.js";
import { contentDb, getActiveProfileId, now, userDb } from "../state.js";

export function translations() {
	return contentDb()
		.prepare(
			"SELECT id,name,abbreviation,description,license FROM translations ORDER BY sort_order",
		)
		.all();
}

export function searchBible(value: any) {
	const query = String(value?.query ?? value ?? "");
	const translationId = String(value?.translationId ?? "BSB");
	return searchVerses(contentDb(), translationId, query);
}

export function readingPosition() {
	const profileId = getActiveProfileId();
	if (!profileId) throw new Error("No profile");
	return (
		userDb()
			.prepare(
				"SELECT book_id bookId,chapter FROM reading_positions WHERE profile_id=?",
			)
			.get(profileId) ?? null
	);
}

export function chapter(p: any) {
	const profileId = getActiveProfileId();
	if (!profileId) throw new Error("No profile");
	if (p.savePosition !== false) {
		userDb()
			.prepare(
				"INSERT INTO reading_positions VALUES(?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET book_id=excluded.book_id,chapter=excluded.chapter,updated_at=excluded.updated_at",
			)
			.run(profileId, p.bookId, p.chapter, now());
	}
	return readChapter(
		contentDb(),
		userDb(),
		profileId,
		p.translationId ?? "BSB",
		p.bookId,
		p.chapter,
	);
}
