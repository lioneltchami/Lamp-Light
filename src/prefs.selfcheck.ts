/** Assert prefs round-trip + translation allowlist. Run: npx tsx src/prefs.selfcheck.ts */
import assert from "node:assert/strict";
import { getPrefs, setPrefs } from "./prefs.ts";

const g = globalThis as { localStorage?: Storage };
const store = new Map<string, string>();
g.localStorage = {
	getItem: (k) => store.get(k) ?? null,
	setItem: (k, v) => {
		store.set(k, String(v));
	},
	removeItem: (k) => {
		store.delete(k);
	},
	clear: () => store.clear(),
	key: () => null,
	length: 0,
};

assert.equal(getPrefs().defaultTranslation, "BSB");
assert.equal(getPrefs().quizSound, true);

setPrefs({ defaultTranslation: "KJV", quizSound: false });
assert.equal(getPrefs().defaultTranslation, "KJV");
assert.equal(getPrefs().quizSound, false);

const reader = JSON.parse(store.get("bible-reader-preferences")!);
assert.equal(reader.translationId, "KJV");

store.set("lamp-light-prefs", JSON.stringify({ defaultTranslation: "NOPE" }));
assert.equal(getPrefs().defaultTranslation, "BSB");

console.log("prefs.selfcheck ok");
