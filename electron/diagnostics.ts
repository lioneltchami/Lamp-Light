/**
 * Privacy-first, on-disk diagnostic log.
 *
 * WHY THIS EXISTS
 * The main process already shows a native error box for `uncaughtException`,
 * but nothing was persisted. When a user reports "it crashed" there was no
 * evidence to work from. This module is that evidence — and it stays on the
 * machine, because "stored only on this computer" is the product's whole
 * promise. No telemetry, no network calls, no third-party SDK: a plain JSONL
 * file the user can open, attach, or deliberately share.
 *
 * PRIVACY RULE (enforced by convention, plus a best-effort scrub in `redact`)
 * Log WHAT FAILED, never WHAT THE USER TYPED. No profile names, quiz answers,
 * Bible search queries, verse notes, Supabase tokens, or email addresses belong
 * in this file. When in doubt, log an id and a count, never a value. The file
 * header repeats this rule so anyone who opens the log sees it.
 *
 * DESIGN
 * - Pure core (`parseJsonl`, `trimBody`, `validateExportPath`) + a thin fs
 *   layer, so behaviour is testable against a real tmpdir sandbox.
 * - `appendDiagnostic` NEVER throws. It is called from crash handlers, where
 *   the disk may be full, read-only, or gone; a failed diagnostic write must
 *   not become a second crash.
 * - Bounded: JSONL (one entry per line) so a half-written final line after a
 *   hard kill cannot corrupt earlier entries, and a size cap with newest-first
 *   trimming so the log can never become its own support problem.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import electron from "electron";

export type DiagnosticLevel = "error" | "warn";
export type DiagnosticScope =
	| "startup"
	| "ipc"
	| "updater"
	| "db"
	| "online"
	| "render"
	| "lifecycle";
export type DiagnosticEntry = {
	/** ISO-8601 timestamp. */
	at: string;
	level: DiagnosticLevel;
	scope: DiagnosticScope;
	/** Short, human-readable one-liner. */
	message: string;
	/** Stack or context. Truncated. Never user content. */
	detail?: string;
};

export const DIAGNOSTICS_FILE_NAME = "diagnostics.log";

/** Hard ceiling for the log file. Trimmed down to TRIM_TARGET_BYTES when hit. */
const MAX_BYTES = 256 * 1024;
/**
 * Trim to half the cap rather than exactly to it. An unbounded log is a
 * support problem of its own; trimming to half means the (small) rewrite only
 * happens once per ~128 KB of new entries instead of on every append.
 */
const TRIM_TARGET_BYTES = MAX_BYTES / 2;
const MAX_MESSAGE_CHARS = 500;
const MAX_DETAIL_CHARS = 2000;

/**
 * Written once, at file creation. `#` lines are not valid JSON, and
 * `parseJsonl` skips them like any other unparseable line.
 */
const FILE_HEADER = [
	"# Lamp & Light - local diagnostic log (JSONL, one entry per line).",
	"#",
	"# PRIVACY: log what FAILED, never what the USER TYPED. This file must never",
	"# contain profile names, quiz answers, Bible search queries, verse notes,",
	"# account tokens or email addresses. When in doubt log an id, not a value.",
	"#",
	"# Nothing here leaves this computer unless the user exports a bundle and",
	"# chooses to share it.",
	"",
].join("\n");

const LEVELS: readonly DiagnosticLevel[] = ["error", "warn"];
const SCOPES: readonly DiagnosticScope[] = [
	"startup",
	"ipc",
	"updater",
	"db",
	"online",
	"render",
	"lifecycle",
];

/**
 * `electron` resolves to the binary path string (not the module) when this file
 * is loaded outside an Electron process, e.g. under vitest. So `app` is reached
 * lazily and structurally, never destructured at module scope.
 */
type AppLike = {
	getPath?: (name: string) => string;
	getVersion?: () => string;
	isPackaged?: boolean;
};
function appRef(): AppLike | undefined {
	return (electron as unknown as { app?: AppLike }).app;
}
function userDataDir(): string {
	try {
		const dir = appRef()?.getPath?.("userData");
		if (typeof dir === "string" && dir.length > 0) return dir;
	} catch {
		/* No Electron (tests, tooling) - fall through to a non-user dir. */
	}
	return path.join(os.tmpdir(), "lamp-light");
}
function appVersion(): string {
	try {
		const version = appRef()?.getVersion?.();
		if (typeof version === "string" && version.length > 0) return version;
	} catch {
		/* fall through */
	}
	return "unknown";
}
function isPackaged(): boolean {
	try {
		return appRef()?.isPackaged === true;
	} catch {
		return false;
	}
}

export function diagnosticsFilePath(): string {
	try {
		return path.join(userDataDir(), DIAGNOSTICS_FILE_NAME);
	} catch {
		return path.join(os.tmpdir(), DIAGNOSTICS_FILE_NAME);
	}
}

/** Best-effort scrub. Call sites must still avoid passing user content. */
function redact(value: string): string {
	return value
		.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted-email]")
		.replace(/[A-Za-z0-9_-]{40,}/g, "[redacted-token]");
}

function clampMessage(value: unknown): string {
	if (typeof value !== "string") return "unknown error";
	const flat = redact(value).replace(/\s+/g, " ").trim();
	if (!flat) return "unknown error";
	return flat.length > MAX_MESSAGE_CHARS
		? `${flat.slice(0, MAX_MESSAGE_CHARS - 1)}…`
		: flat;
}

function clampDetail(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = redact(value).trim();
	if (!trimmed) return undefined;
	return trimmed.length > MAX_DETAIL_CHARS
		? `${trimmed.slice(0, MAX_DETAIL_CHARS - 1)}…`
		: trimmed;
}

function normalizeEntry(input: {
	level: DiagnosticLevel;
	scope: DiagnosticScope;
	message: string;
	detail?: string;
}): DiagnosticEntry {
	const level = LEVELS.includes(input.level) ? input.level : "error";
	const scope = SCOPES.includes(input.scope) ? input.scope : "startup";
	const entry: DiagnosticEntry = {
		at: new Date().toISOString(),
		level,
		scope,
		message: clampMessage(input.message),
	};
	// `exactOptionalPropertyTypes` is off, but keep `detail` absent rather than
	// `undefined` so the JSONL line stays small and stable.
	const detail = clampDetail(input.detail);
	if (detail) entry.detail = detail;
	return entry;
}

/** Pure: newest entries, unparseable lines skipped, header comments skipped. */
function parseJsonl(raw: string): DiagnosticEntry[] {
	const entries: DiagnosticEntry[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			// A truncated final line after a hard kill is expected, not an error.
			continue;
		}
		if (!parsed || typeof parsed !== "object") continue;
		const candidate = parsed as Partial<DiagnosticEntry>;
		if (typeof candidate.message !== "string") continue;
		entries.push(
			normalizeEntry({
				level: candidate.level as DiagnosticLevel,
				scope: candidate.scope as DiagnosticScope,
				message: candidate.message,
				detail: typeof candidate.detail === "string" ? candidate.detail : undefined,
			}),
		);
	}
	return entries;
}

/** Pure: keep the newest lines that fit the byte budget; always keep the last. */
function trimBody(lines: string[], targetBytes: number): string[] {
	const kept: string[] = [];
	let used = 0;
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const cost = Buffer.byteLength(lines[index], "utf8") + 1;
		if (kept.length > 0 && used + cost > targetBytes) break;
		used += cost;
		kept.unshift(lines[index]);
	}
	return kept;
}

function enforceCap(file: string): void {
	const size = fs.statSync(file).size;
	if (size <= MAX_BYTES) return;
	const lines = fs.readFileSync(file, "utf8").split("\n");
	const header: string[] = [];
	let cursor = 0;
	while (cursor < lines.length && lines[cursor].startsWith("#")) {
		header.push(lines[cursor]);
		cursor += 1;
	}
	const body = lines.slice(cursor).filter((line) => line.length > 0);
	const kept = trimBody(body, TRIM_TARGET_BYTES);
	fs.writeFileSync(file, [...header, ...kept].join("\n") + "\n", "utf8");
}

/**
 * Append one entry. MUST NOT THROW - callers include `uncaughtException`.
 */
export function appendDiagnostic(entry: {
	level: DiagnosticLevel;
	scope: DiagnosticScope;
	message: string;
	detail?: string;
}): void {
	try {
		const file = diagnosticsFilePath();
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const line = JSON.stringify(normalizeEntry(entry)) + "\n";
		// The privacy header is written once, on creation, so a reader always
		// sees the rule above the first entry.
		fs.appendFileSync(file, fs.existsSync(file) ? line : FILE_HEADER + line, "utf8");
		enforceCap(file);
	} catch {
		// A full disk, a read-only volume, a missing directory - none of these
		// are worth escalating from a diagnostic sink into a second crash.
	}
}

/**
 * Newest entries last. `limit` returns the newest N; a non-positive or
 * non-finite `limit` returns everything.
 */
export function readDiagnostics(limit?: number): DiagnosticEntry[] {
	let entries: DiagnosticEntry[];
	try {
		entries = parseJsonl(fs.readFileSync(diagnosticsFilePath(), "utf8"));
	} catch {
		// Missing or unreadable log is the normal state before the first error.
		return [];
	}
	if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) {
		return entries;
	}
	return entries.slice(-Math.max(1, Math.floor(limit)));
}

export function clearDiagnostics(): void {
	try {
		fs.rmSync(diagnosticsFilePath(), { force: true });
	} catch {
		/* nothing to clear, or the file is held open - not worth failing over */
	}
}

type ExportPathCheck = { ok: true; path: string } | { ok: false; error: string };

function isInside(child: string, parent: string): boolean {
	const relative = path.relative(parent, child);
	return (
		relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

/**
 * `diagnostics:export` takes its destination from the renderer. The renderer is
 * a trusted local surface, but it is still a JS context - a bundle dependency,
 * a future "open file" flow, or a plain bug could hand us a hostile string. So
 * this treats the payload as untrusted and refuses anything that could clobber
 * app state or escape the folder the user picked:
 *  - absolute only, and no `~`: never resolve a path against a different base
 *    (cwd, home, or `app.getPath`) than the one the user actually chose;
 *  - `.txt` / `.log` only: the bundle is a text file, and refusing other
 *    extensions means an export can never land on a database, a keychain item,
 *    or an image the user did not mean to touch;
 *  - no dotfile basename: never `~/.env`, `~/.bashrc`, `~/.npmrc`;
 *  - no `..` segment and no trailing separator: reject directory-as-file and
 *    parent traversal outright;
 *  - no backslash: the checks below already treat `\` as a separator, so a
 *    path that means something different to each of those checks (a Windows
 *    payload on a POSIX host) is refused rather than half-interpreted;
 *  - never inside `userData`: the app's SQLite profile lives there, and a log
 *    exported over `selah-user.sqlite` would destroy the user's progress. This
 *    is checked three ways, because each closes a hole the others leave:
 *      1. the literal path (cheap, catches the obvious case);
 *      2. the realpath of the destination's PARENT, which catches a symlinked
 *         parent directory that points into `userData`;
 *      3. the realpath of `userData` itself, which catches a user who moved
 *         or relinked their app data so the returned path is not the real one;
 *    and the destination may not itself BE a symlink, because `writeFile`
 *    follows one. A `bundle.txt` symlinked at the userData profile database
 *    passes every string check above and still destroys the profile.
 */
function validateExportPath(raw: unknown): ExportPathCheck {
	const reject = (error: string): ExportPathCheck => ({ ok: false, error });
	if (typeof raw !== "string" || raw.trim().length === 0) {
		return reject("Destination must be a non-empty file path.");
	}
	const dest = raw.trim();
	if (dest.startsWith("~")) {
		return reject("Use an absolute path - '~' is not expanded.");
	}
	if (dest.includes("\0")) {
		return reject("Destination contains an invalid character.");
	}
	if (!path.isAbsolute(dest)) {
		return reject("Destination must be an absolute path.");
	}
	if (dest.endsWith("/") || dest.endsWith(path.sep)) {
		return reject("Destination must be a file, not a directory.");
	}
	if (dest.split(/[\\/]+/).includes("..")) {
		return reject("Destination may not contain '..'.");
	}
	// We split on both separators above, so refuse the ambiguous input outright
	// rather than let a Windows-shaped payload mean one thing to `path` and
	// another to the `..` scan.
	if (dest.includes("\\")) {
		return reject("Destination may not contain a backslash.");
	}
	const base = path.basename(dest);
	if (!base || base === "." || base === "..") {
		return reject("Destination must include a file name.");
	}
	if (base.startsWith(".")) {
		return reject("Destination may not be a dotfile.");
	}
	const extension = path.extname(base).toLowerCase();
	if (extension !== ".txt" && extension !== ".log") {
		return reject("Destination must end in .txt or .log.");
	}
	const resolved = path.resolve(dest);
	// `userData` is a real directory the user may have relocated, so the
	// literal path from `app.getPath` is not necessarily the path the
	// filesystem resolves to. Compare against both.
	const data = userDataDir();
	let realData = data;
	try {
		realData = fs.realpathSync(data);
	} catch {
		/* userData may not exist yet; the literal check below still applies. */
	}
	for (const forbidden of new Set([data, realData])) {
		if (isInside(resolved, forbidden)) {
			return reject("Destination may not be inside the app's data folder.");
		}
	}
	// A symlink AT the destination is followed by the write, so a
	// `notes.txt` pointing at the profile database passes every check above
	// (its parent is fine, its name is fine) and then clobbers the file it
	// points at. Refuse it here and again at open time via O_NOFOLLOW, so the
	// check cannot be raced between validation and write.
	try {
		if (fs.lstatSync(resolved).isSymbolicLink()) {
			return reject("Destination may not be a symbolic link.");
		}
	} catch {
		// Destination does not exist yet - nothing to follow.
	}
	try {
		const parent = fs.realpathSync(path.dirname(resolved));
		for (const forbidden of new Set([data, realData])) {
			if (isInside(path.join(parent, base), forbidden)) {
				return reject("Destination may not be inside the app's data folder.");
			}
		}
	} catch {
		// Parent does not exist yet; the resolved-path check above still applied.
	}
	return { ok: true, path: resolved };
}

function versionLine(label: string, value: unknown): string {
	return `${label.padEnd(14)}${typeof value === "string" && value ? value : "unknown"}`;
}

function buildBundle(log: string): string {
	const entryCount = parseJsonl(log).length;
	return [
		"Lamp & Light - diagnostic bundle",
		`Generated:        ${new Date().toISOString()}`,
		"",
		"This file contains a short local error log and version information.",
		"It contains no profile names, quiz answers, Bible searches, verse notes,",
		"or account details.",
		"",
		"--- environment ---",
		versionLine("app version:", appVersion()),
		versionLine("electron:", process.versions.electron),
		versionLine("node:", process.versions.node),
		versionLine("chromium:", process.versions.chrome),
		versionLine("os:", `${os.platform()} ${os.release()}`),
		versionLine("arch:", os.arch()),
		versionLine("packaged:", String(isPackaged())),
		versionLine("log entries:", String(entryCount)),
		"",
		"--- diagnostic log (JSONL) ---",
		log.trimEnd() || "# (no entries recorded)",
		"",
	].join("\n");
}

/**
 * Write a single shareable text file: the log plus environment info. Never
 * includes the log's own path, which on macOS embeds the user's account name.
 */
export async function exportDiagnosticBundle(destPath: string): Promise<{
	ok: boolean;
	path?: string;
	error?: string;
}> {
	const check = validateExportPath(destPath);
	if (!check.ok) return { ok: false, error: check.error };
	try {
		let log = "";
		try {
			log = fs.readFileSync(diagnosticsFilePath(), "utf8");
		} catch {
			// No log yet - still export the environment section.
		}
		// Write through an explicit fd with O_NOFOLLOW rather than
		// `fs.promises.writeFile`, so a symlink swapped in after the lstat
		// check still fails (ELOOP) instead of silently redirecting the bundle
		// onto the file it points at. 0o600 because the bundle carries error
		// text that need not be world-readable.
		const flags =
			fs.constants.O_WRONLY |
			fs.constants.O_CREAT |
			fs.constants.O_TRUNC |
			// Undefined on Windows, where there is no symlink-following
			// equivalent to guard with; the lstat check above is the guard
			// there.
			(fs.constants.O_NOFOLLOW ?? 0);
		const handle = await fs.promises.open(check.path, flags, 0o600);
		try {
			await handle.writeFile(buildBundle(log), "utf8");
		} finally {
			await handle.close();
		}
		return { ok: true, path: check.path };
	} catch (error) {
		return { ok: false, error: String(error) };
	}
}
