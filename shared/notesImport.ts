/** Parse a notes JSON export/import payload into upsert rows. */
export type NoteImportRow = {
	bookId: string;
	chapter: number;
	verse: number;
	note: string;
};

function asPositiveInt(value: unknown): number | null {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(n) || n < 1) return null;
	return n;
}

export function parseNotesImport(raw: unknown): NoteImportRow[] {
	const list = Array.isArray(raw)
		? raw
		: raw &&
			  typeof raw === "object" &&
			  Array.isArray((raw as { notes?: unknown }).notes)
			? (raw as { notes: unknown[] }).notes
			: null;
	if (!list) throw new Error("Notes file must be a JSON array (or { notes: [] }).");
	const out: NoteImportRow[] = [];
	for (const item of list) {
		if (!item || typeof item !== "object") continue;
		const row = item as Record<string, unknown>;
		const bookId = String(row.bookId ?? row.book_id ?? "").trim().toUpperCase();
		const chapter = asPositiveInt(row.chapter);
		const verse = asPositiveInt(row.verse);
		const note = String(row.note ?? "").trim();
		if (!bookId || chapter == null || verse == null || !note) continue;
		out.push({ bookId, chapter, verse, note });
	}
	return out;
}
