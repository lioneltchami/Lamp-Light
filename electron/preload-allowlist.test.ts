import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Drift guard for the preload allowlist.
//
// `electron/preload.ts` and `electron/preload.cjs` are two files that must
// enumerate exactly the `ipcMain.handle` channels registered by the main
// process. They have already drifted once, and drift is invisible at runtime
// until the renderer hits "Channel ... is not allowed". This test parses the
// main-process sources and the two preload files and asserts the sets agree,
// so a mismatch fails in CI instead of in the app.
//
// SCOPE: this deliberately scans *every* main-process source file under
// `electron/`, not just `electron/main.ts`. `main.ts` is a composition root
// and the handler bodies now live in `electron/ipc/*.ts`; a channel
// registered in one of those modules is just as real as one registered in
// `main.ts`, and a single-file scan would let it escape the allowlist diff
// silently. Every registration currently lives in `main.ts`, so the scan
// finds the same set — it just keeps finding it if that changes.
//
// `electron/preload.cjs` is generated from `electron/preload.ts` by
// `scripts/generate-preload-cjs.mjs` — never hand-edit it. These assertions
// still check it directly because it ships as a committed file inside the
// asar: if someone forgets to regenerate and commit, this fails here and the
// "Verify committed preload.cjs is not stale" CI step fails too.

// Resolve paths relative to this file, then walk up to the directory that
// actually holds `electron/main.ts`. The walk matters because `tsc -p
// tsconfig.electron.json` emits a compiled copy of this test into
// `dist-electron/electron/`, and vitest collects those too — anchoring on the
// test's own directory would make the build-output copy read a non-existent
// `dist-electron/electron/main.ts` and fail.
const here = path.dirname(fileURLToPath(import.meta.url));

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
const read = (file: string): string =>
	fs.readFileSync(path.join(root, file), "utf8");

/**
 * Every main-process source file that could hold an `ipcMain` registration.
 *
 * Test files are excluded: temporary probe/attack harnesses and fixtures
 * legitimately call `ipcMain.handle` against a stub, and counting those would
 * make the allowlist diff meaningless. `dist-electron/` is never reached —
 * `root` is the repo root, not the test's own directory (see above), and we
 * only walk `root/electron`.
 */
function mainProcessSources(start: string): string[] {
	const found: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const abs = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(abs);
			} else if (
				entry.name.endsWith(".ts") &&
				!entry.name.endsWith(".test.ts")
			) {
				found.push(path.relative(root, abs));
			}
		}
	};
	walk(start);
	return found.sort();
}

const mainSources = mainProcessSources(path.join(root, "electron"));
const preloadTs = read("electron/preload.ts");
const preloadCjs = read("electron/preload.cjs");

/** All `ipcMain.handle("chan"` / `ipcMain.on("chan"` channels in the sources. */
function extractIpcChannels(sources: string[], method: "handle" | "on"): string[] {
	const pattern = new RegExp(`ipcMain\\.${method}\\(\\s*["'\`]([^"'\`]+)["'\`]`, "g");
	return sources.flatMap((source) =>
		[...source.matchAll(pattern)].map((match) => match[1]),
	);
}

/** The string entries of the `ALLOWED_INVOKE_CHANNELS` set literal. */
function extractAllowlist(source: string, file: string): string[] {
	const start = source.indexOf("ALLOWED_INVOKE_CHANNELS");
	if (start === -1) {
		throw new Error(`${file}: ALLOWED_INVOKE_CHANNELS is missing entirely`);
	}
	const open = source.indexOf("[", start);
	const close = source.indexOf("]", open);
	if (open === -1 || close === -1) {
		throw new Error(`${file}: could not locate the ALLOWED_INVOKE_CHANNELS array`);
	}
	return [...source.slice(open + 1, close).matchAll(/["']([^"']+)["']/g)].map(
		(match) => match[1],
	);
}

const mainTexts = mainSources.map(read);
const handleChannels = extractIpcChannels(mainTexts, "handle");
const onChannels = extractIpcChannels(mainTexts, "on");
const allowlistTs = extractAllowlist(preloadTs, "preload.ts");
const allowlistCjs = extractAllowlist(preloadCjs, "preload.cjs");

const diff = (left: string[], right: string[]): string[] =>
	[...new Set([...left, ...right])]
		.filter((value) => !left.includes(value) || !right.includes(value))
		.sort();

describe("preload allowlist", () => {
	it("scans every main-process source file, not just the composition root", () => {
		// The scan is the guard. If it ever narrows back to `main.ts` alone, a
		// handler registered in `electron/ipc/*.ts` would bypass the allowlist
		// diff without a single test going red.
		expect(mainSources).toContain(
			["electron", "main.ts"].join(path.sep),
		);
		expect(mainSources.some((f) => f.startsWith(`electron${path.sep}ipc${path.sep}`))).toBe(
			true,
		);
	});

	it("parses a non-trivial number of channels out of the sources", () => {
		// Guards the regexes themselves: if the registrations are reformatted
		// (template literals, `ipcMain.handle (`, a helper wrapper) these go to
		// zero and every assertion below would pass vacuously.
		expect(handleChannels.length).toBeGreaterThan(20);
		expect(new Set(handleChannels).size).toBe(handleChannels.length);
	});

	it("has no duplicate entries in either allowlist", () => {
		expect(new Set(allowlistTs).size).toBe(allowlistTs.length);
		expect(new Set(allowlistCjs).size).toBe(allowlistCjs.length);
	});

	it("lists every ipcMain.handle channel in electron/preload.ts", () => {
		const missing = handleChannels.filter((c) => !allowlistTs.includes(c));
		expect(
			missing,
			`These ipcMain.handle channels have no entry in electron/preload.ts's ` +
				`ALLOWED_INVOKE_CHANNELS, so the renderer gets "Channel <x> is not ` +
				`allowed". Add them to preload.ts, then run 'npm run gen:preload' and ` +
				`commit the regenerated preload.cjs — never edit preload.cjs by hand.\n` +
				`Missing: ${missing.join(", ") || "(none)"}`,
		).toEqual([]);
	});

	it("lists every ipcMain.handle channel in electron/preload.cjs", () => {
		const missing = handleChannels.filter((c) => !allowlistCjs.includes(c));
		expect(
			missing,
			`These ipcMain.handle channels have no entry in electron/preload.cjs's ` +
				`ALLOWED_INVOKE_CHANNELS, so a packaged build rejects them at the ` +
				`contextBridge.\nMissing: ${missing.join(", ") || "(none)"}`,
		).toEqual([]);
	});

	it("has no dead allowlist entries with no matching ipcMain.handle", () => {
		const deadTs = allowlistTs.filter((c) => !handleChannels.includes(c));
		expect(
			deadTs,
			`electron/preload.ts allows channels that no longer exist in the main ` +
				`process. ` +
				`A stale entry is dead weight that hides real drift — remove it.\n` +
				`Dead: ${deadTs.join(", ") || "(none)"}`,
		).toEqual([]);

		const deadCjs = allowlistCjs.filter((c) => !handleChannels.includes(c));
		expect(
			deadCjs,
			`electron/preload.cjs allows channels that no longer exist in the main ` +
				`process. ` +
				`Remove the stale entry and regenerate.\nDead: ${deadCjs.join(", ") || "(none)"}`,
		).toEqual([]);
	});

	it("keeps electron/preload.cjs identical to electron/preload.ts", () => {
		// preload.cjs is the CJS preload the packaged app loads, while
		// preload.ts is what the dev build uses. Any divergence means the dev
		// build and the shipped build enforce different IPC policies.
		const onlyTs = allowlistTs.filter((c) => !allowlistCjs.includes(c));
		const onlyCjs = allowlistCjs.filter((c) => !allowlistTs.includes(c));
		expect(
			diff(allowlistTs, allowlistCjs),
			`electron/preload.cjs has drifted from electron/preload.ts. ` +
				`Only in preload.ts: ${onlyTs.join(", ") || "(none)"} | ` +
				`only in preload.cjs: ${onlyCjs.join(", ") || "(none)"}`,
		).toEqual([]);
	});

	it("keeps send-only ipcMain.on channels out of the invoke allowlist", () => {
		// `ipcMain.on` channels are fire-and-forget via `send()`. Allowing them
		// through `invoke()` would be a no-op at best and a silent runtime
		// "No handler registered for X" at worst.
		const leaked = onChannels.filter((c) => allowlistTs.includes(c));
		expect(
			leaked,
			`ipcMain.on channels are send-only and must not be in ALLOWED_INVOKE_CHANNELS: ` +
				`${leaked.join(", ")}`,
		).toEqual([]);
	});
});
