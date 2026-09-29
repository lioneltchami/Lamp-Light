import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// WHY THIS FILE IS A SOURCE-LEVEL TEST
//
// v1.2.23 added process-level crash handlers and quit lifecycle hooks to
// `electron/main.ts`. That file wires the ~50 `ipcMain` channel registrations
// and touches `app`, `BrowserWindow` and native modules at import time, so it
// cannot be imported in a test without an Electron runtime. Rather than ship
// zero coverage for the two safety nets that are supposed to stop the app from
// dying silently, we assert the properties of the *source text*:
//
//   1. both `uncaughtException` and `unhandledRejection` are registered
//   2. the `uncaughtException` dialog call is inside a try/catch
//   3. `before-quit` and `will-quit` are registered
//   4. the preload allowlist has no wildcard and is actually enforced
//
// The properties are cheap to verify textually and expensive to lose: an
// unguarded `dialog.showErrorBox` inside the uncaughtException handler
// re-throws on a headless/early-startup path, turning a recoverable error
// into a hard crash with no dialog. Do not delete this file as "just string
// matching" — if you extract the handlers into a testable module, replace
// this with real unit tests and delete this.
//
// STILL VALID AFTER THE main.ts SPLIT (2f0dc56). main.ts is now a
// composition root: the IPC handler *bodies* moved to `electron/ipc/*.ts` and
// the auto-updater to `electron/updater.ts`. Every property asserted here was
// re-checked against the split tree and still resolves in `main.ts`:
//   - both `process.on` registrations: main.ts, lines 64 and 84
//   - the try/catch around `showErrorBox`: main.ts, lines 75-82
//   - `before-quit` / `will-quit`: main.ts, lines 290 and 297
//   - both still precede `app.whenReady()` (main.ts line 230)
// So the assertions remain meaningful rather than vacuous. If a future change
// moves any of these out of main.ts, re-point the matching assertion at the
// new home — a source-text guard that reads a file the code left is theatre.
// (`preload-allowlist.test.ts` had the opposite problem and was fixed: it
// scanned only main.ts and now scans every main-process source file.)
//
// Caveat: the brace matcher below is not a parser. It is balanced-safe for
// the current handler bodies (template-literal `${}` pairs are symmetric),
// but a reformat that unbalances braces inside a string would make it throw
// a clear error rather than silently pass.

const here = path.dirname(fileURLToPath(import.meta.url));

// See the note in `preload-allowlist.test.ts`: vitest also collects the
// compiled copies in `dist-electron/`, so anchor on the directory that really
// holds the sources rather than on the test's own directory.
function findRepoRoot(start: string): string {
	let dir = start;
	for (;;) {
		if (fs.existsSync(path.join(dir, "electron", "main.ts"))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) {
			throw new Error(`Could not locate electron/main.ts above ${start}`);
		}
		dir = parent;
	}
}

const root = findRepoRoot(here);
const mainSource = fs.readFileSync(path.join(root, "electron", "main.ts"), "utf8");
const preloadSource = fs.readFileSync(
	path.join(root, "electron", "preload.ts"),
	"utf8",
);
const preloadCjs = fs.readFileSync(
	path.join(root, "electron", "preload.cjs"),
	"utf8",
);

function registrationIndex(pattern: RegExp, file = "electron/main.ts"): number {
	const match = pattern.exec(mainSource);
	if (!match) {
		throw new Error(`Expected ${pattern} to be present in ${file}`);
	}
	return match.index;
}

/** The body of the arrow-function callback registered at `pattern`. */
function handlerBody(pattern: RegExp): string {
	const start = registrationIndex(pattern);
	const arrow = mainSource.indexOf("=>", start);
	if (arrow === -1) {
		throw new Error(`No arrow function found after ${pattern}`);
	}
	const open = mainSource.indexOf("{", arrow);
	let depth = 0;
	for (let i = open; i < mainSource.length; i++) {
		const ch = mainSource[i];
		if (ch === "{") depth++;
		else if (ch === "}" && --depth === 0) return mainSource.slice(open + 1, i);
	}
	throw new Error(`Unbalanced braces in the handler registered at ${pattern}`);
}

describe("main process lifecycle safety nets", () => {
	it("registers a process-level uncaughtException handler", () => {
		expect(mainSource).toMatch(/process\.on\(\s*["']uncaughtException["']/);
	});

	it("registers a process-level unhandledRejection handler", () => {
		expect(mainSource).toMatch(/process\.on\(\s*["']unhandledRejection["']/);
	});

	it("registers both handlers before app.whenReady() so early crashes are caught", () => {
		// Anchored to the start of a line: the file's own comment about
		// `app.whenReady()` sits above the handlers and would match unanchored.
		const ready = registrationIndex(/^app\.whenReady\(\)/m);
		expect(
			registrationIndex(/process\.on\(\s*["']uncaughtException["']/),
		).toBeLessThan(ready);
		expect(
			registrationIndex(/process\.on\(\s*["']unhandledRejection["']/),
		).toBeLessThan(ready);
	});

	it("wraps the uncaughtException dialog call in try/catch", () => {
		// `dialog` is unavailable until the app is ready on some paths; an
		// unguarded call inside this handler throws a *second* error while
		// already handling one, which Node treats as a fatal crash.
		const body = handlerBody(/process\.on\(\s*["']uncaughtException["']/);
		const tryAt = body.search(/\btry\s*\{/);
		const dialogAt = body.indexOf("showErrorBox(");
		const catchAt = body.indexOf("catch");

		expect(
			dialogAt,
			"uncaughtException handler should surface the error to the user",
		).toBeGreaterThan(-1);
		expect(tryAt, "uncaughtException handler must open a try block").toBeGreaterThan(
			-1,
		);
		expect(
			catchAt,
			"uncaughtException handler must have a catch block",
		).toBeGreaterThan(-1);
		expect(
			tryAt,
			"the `try` must open before the dialog call, not after it",
		).toBeLessThan(dialogAt);
		expect(
			catchAt,
			"the `catch` must close after the dialog call, not before it",
		).toBeGreaterThan(dialogAt);
	});

	it("does not pop a modal dialog for unhandled rejections", () => {
		// Rejections fire often and are usually already logged at the call
		// site; a modal per rejection is hostile and can wedge the app.
		const body = handlerBody(/process\.on\(\s*["']unhandledRejection["']/);
		expect(body).not.toMatch(/show(ErrorBox|MessageBox)/);
	});

	it("registers app before-quit and will-quit hooks", () => {
		expect(mainSource).toMatch(/app\.on\(\s*["']before-quit["']/);
		expect(mainSource).toMatch(/app\.on\(\s*["']will-quit["']/);
	});

	it("keeps the before-quit handler side-effect free outside the updater path", () => {
		// A synchronous, non-async before-quit handler must never await or
		// block, or the quit hangs forever.
		const body = handlerBody(/app\.on\(\s*["']before-quit["']/);
		expect(body).not.toMatch(/\bawait\b/);
	});
});

describe("preload allowlist enforcement", () => {
	const allowlists = [
		["electron/preload.ts", preloadSource],
		["electron/preload.cjs", preloadCjs],
	] as const;

	it.each(allowlists)("%s contains no wildcard channel", (file, source) => {
		// A single `*` entry would make the entire allowlist a no-op and
		// silently re-open every channel the renderer previously could not
		// reach.
		const start = source.indexOf("ALLOWED_INVOKE_CHANNELS");
		expect(
			start,
			`${file} should still declare ALLOWED_INVOKE_CHANNELS`,
		).toBeGreaterThan(-1);
		const open = source.indexOf("[", start);
		const close = source.indexOf("]", open);
		const entries = [
			...source.slice(open + 1, close).matchAll(/["']([^"']+)["']/g),
		];

		expect(entries.length, "allowlist should not be empty").toBeGreaterThan(0);
		const wildcards = entries
			.map((match) => match[1])
			.filter((channel) => channel.includes("*") || channel.includes("?"));
		expect(
			wildcards,
			`${file} must not allow pattern channels — the allowlist is an exact-match Set: ${wildcards.join(", ")}`,
		).toEqual([]);
	});

	it.each(allowlists)("%s still enforces the allowlist on invoke()", (file, source) => {
		expect(source).toMatch(/ALLOWED_INVOKE_CHANNELS\.has\(\s*channel\s*\)/);
		expect(source).toMatch(/is not allowed/);
		expect(source).toMatch(/ipcRenderer\.invoke\(\s*channel/);
	});
});
