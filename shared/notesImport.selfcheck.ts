import assert from "node:assert/strict";
import { parseNotesImport } from "./notesImport.ts";

const rows = parseNotesImport([
	{ bookId: "jas", chapter: 2, verse: 1, note: " Favoritism " },
	{ book_id: "ROM", chapter: "1", verse: 16, note: "Not ashamed" },
	{ bookId: "GEN", chapter: 0, verse: 1, note: "bad" },
	{ bookId: "EXO", chapter: 1, verse: 1, note: "" },
]);
assert.equal(rows.length, 2);
assert.deepEqual(rows[0], {
	bookId: "JAS",
	chapter: 2,
	verse: 1,
	note: "Favoritism",
});
assert.deepEqual(rows[1], {
	bookId: "ROM",
	chapter: 1,
	verse: 16,
	note: "Not ashamed",
});

const wrapped = parseNotesImport({
	notes: [{ bookId: "JHN", chapter: 3, verse: 16, note: "Love" }],
});
assert.equal(wrapped.length, 1);

assert.throws(() => parseNotesImport({}), /JSON array/);
console.log("notesImport.selfcheck OK");
