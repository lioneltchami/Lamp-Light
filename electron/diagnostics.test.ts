import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `electron` resolves to a binary path string outside a real Electron process,
// so the module under test gets a stub whose `app` points at a tmpdir sandbox.
const stub = vi.hoisted(() => ({ userData: "", version: "0.0.0-test", packaged: false }));
vi.mock("electron", () => ({
	default: {
		app: {
			getPath: (name: string) =>
				name === "userData" ? stub.userData : os.tmpdir(),
			getVersion: () => stub.version,
			get isPackaged() {
				return stub.packaged;
			},
		},
	},
}));

import {
	appendDiagnostic,
	clearDiagnostics,
	diagnosticsFilePath,
	DIAGNOSTICS_FILE_NAME,
	exportDiagnosticBundle,
	readDiagnostics,
	type DiagnosticEntry,
} from "./diagnostics.js";

const MAX_BYTES = 256 * 1024;

let sandbox: string;
/** A path that is a file, so anything under it can never be created. */
let blockerFile: string;

beforeEach(() => {
	sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-light-diagnostics-"));
	blockerFile = path.join(sandbox, "blocker");
	fs.writeFileSync(blockerFile, "not a directory");
	// userData is the sandbox itself, so the "never export into userData"
	// guard can be exercised against a known path.
	stub.userData = sandbox;
	stub.version = "9.9.9";
	stub.packaged = false;
});

afterEach(() => {
	clearDiagnostics();
	fs.rmSync(sandbox, { recursive: true, force: true });
});

const logPath = () => path.join(sandbox, DIAGNOSTICS_FILE_NAME);
const logSize = () => fs.statSync(logPath()).size;

describe("diagnostics log", () => {
	it("resolves the log path inside the app data directory", () => {
		expect(diagnosticsFilePath()).toBe(logPath());
	});

	it("round-trips an appended entry", () => {
		appendDiagnostic({
			level: "error",
			scope: "startup",
			message: "uncaughtException in main process",
			detail: "Error: boom\n    at main.js:1:1",
		});

		const entries = readDiagnostics();
		expect(entries).toHaveLength(1);
		expect(entries[0].level).toBe("error");
		expect(entries[0].scope).toBe("startup");
		expect(entries[0].message).toBe("uncaughtException in main process");
		expect(entries[0].detail).toContain("Error: boom");
		expect(entries[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it("writes line-delimited JSON with a privacy header", () => {
		appendDiagnostic({ level: "warn", scope: "ipc", message: "slow handler" });
		appendDiagnostic({ level: "error", scope: "updater", message: "update failed" });

		const lines = fs.readFileSync(logPath(), "utf8").split("\n").filter(Boolean);
		expect(lines[0].startsWith("#")).toBe(true);
		expect(lines.some((line) => line.includes("never what the USER TYPED"))).toBe(true);
		const jsonLines = lines.filter((line) => !line.startsWith("#"));
		expect(jsonLines).toHaveLength(2);
		for (const line of jsonLines) expect(() => JSON.parse(line)).not.toThrow();
	});

	it("returns entries oldest first and honours the limit from the newest end", () => {
		for (let index = 0; index < 5; index += 1) {
			appendDiagnostic({
				level: "warn",
				scope: "lifecycle",
				message: `entry-${index}`,
			});
		}

		const all = readDiagnostics();
		expect(all.map((entry) => entry.message)).toEqual([
			"entry-0",
			"entry-1",
			"entry-2",
			"entry-3",
			"entry-4",
		]);
		expect(readDiagnostics(2).map((entry) => entry.message)).toEqual([
			"entry-3",
			"entry-4",
		]);
	});

	it("never throws when the log path is unwritable", () => {
		stub.userData = path.join(blockerFile, "nested");

		expect(() =>
			appendDiagnostic({
				level: "error",
				scope: "db",
				message: "database open failed",
			}),
		).not.toThrow();
		// And the rest of the API stays usable on the same broken path.
		expect(readDiagnostics()).toEqual([]);
		expect(() => clearDiagnostics()).not.toThrow();
	});

	it("never throws on a garbage entry", () => {
		expect(() =>
			appendDiagnostic({
				level: "nonsense" as DiagnosticEntry["level"],
				scope: "nonsense" as DiagnosticEntry["scope"],
				message: "  ",
				detail: 42 as unknown as string,
			}),
		).not.toThrow();
		const [entry] = readDiagnostics();
		expect(entry.level).toBe("error");
		expect(entry.scope).toBe("startup");
		expect(entry.message).toBe("unknown error");
		expect(entry.detail).toBeUndefined();
	});

	it("redacts obvious email addresses and long tokens", () => {
		appendDiagnostic({
			level: "error",
			scope: "online",
			message: "sync failed for lionel@example.com",
			detail: "token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 rejected",
		});

		const [entry] = readDiagnostics();
		expect(entry.message).toBe("sync failed for [redacted-email]");
		expect(entry.message).not.toContain("example.com");
		expect(entry.detail).toContain("[redacted-token]");
		expect(entry.detail).not.toContain("ghp_");
	});

	it("truncates an oversized detail instead of storing it whole", () => {
		appendDiagnostic({
			level: "error",
			scope: "render",
			message: "renderer blew up",
			detail: "x".repeat(50_000),
		});

		const [entry] = readDiagnostics();
		expect((entry.detail ?? "").length).toBeLessThanOrEqual(2000);
	});

	it("survives a truncated final line", () => {
		appendDiagnostic({ level: "error", scope: "render", message: "first" });
		appendDiagnostic({ level: "error", scope: "render", message: "second" });
		// Simulate a hard kill mid-write: half a JSON object on the last line.
		fs.appendFileSync(logPath(), '{"at":"2026-09-27T00:00:00.000Z","level":"err');

		const messages = readDiagnostics().map((entry) => entry.message);
		expect(messages).toEqual(["first", "second"]);
	});

	it("skips garbage lines in the middle of the file", () => {
		appendDiagnostic({ level: "error", scope: "render", message: "first" });
		appendDiagnostic({ level: "error", scope: "render", message: "second" });
		const file = fs.readFileSync(logPath(), "utf8");
		fs.writeFileSync(logPath(), file.replace("\n", "\nnot json at all\n"));

		expect(readDiagnostics().map((entry) => entry.message)).toEqual([
			"first",
			"second",
		]);
	});

	it("returns an empty list when no log exists yet", () => {
		expect(readDiagnostics()).toEqual([]);
	});

	it("keeps the file bounded and preserves the newest entries", () => {
		for (let index = 0; index < 4000; index += 1) {
			appendDiagnostic({
				level: "warn",
				scope: "ipc",
				message: `entry-${index} ${"p".repeat(200)}`,
			});
		}

		expect(logSize()).toBeLessThanOrEqual(MAX_BYTES);
		const entries = readDiagnostics();
		expect(entries.length).toBeGreaterThan(0);
		expect(entries[entries.length - 1].message).toContain("entry-3999");
		// The oldest entries are the ones dropped.
		expect(entries[0].message).not.toContain("entry-0 ");
		// The privacy header survives every trim.
		expect(fs.readFileSync(logPath(), "utf8").startsWith("# Lamp & Light")).toBe(
			true,
		);
	});

	it("keeps appending cleanly after the cap has been enforced", () => {
		for (let index = 0; index < 1200; index += 1) {
			appendDiagnostic({
				level: "warn",
				scope: "ipc",
				message: `entry-${index} ${"p".repeat(200)}`,
			});
		}
		appendDiagnostic({
			level: "error",
			scope: "lifecycle",
			message: "after-trim",
		});

		expect(readDiagnostics().at(-1)?.message).toBe("after-trim");
		expect(logSize()).toBeLessThanOrEqual(MAX_BYTES);
	});

	it("clears every entry and starts a fresh log on the next append", () => {
		appendDiagnostic({ level: "error", scope: "db", message: "boom" });
		appendDiagnostic({ level: "warn", scope: "db", message: "again" });
		expect(readDiagnostics()).toHaveLength(2);

		clearDiagnostics();
		expect(readDiagnostics()).toEqual([]);

		appendDiagnostic({ level: "error", scope: "db", message: "after-clear" });
		expect(readDiagnostics().map((entry) => entry.message)).toEqual([
			"after-clear",
		]);
	});
});

describe("exportDiagnosticBundle", () => {
	it("includes version and platform information plus the log", async () => {
		appendDiagnostic({
			level: "error",
			scope: "updater",
			message: "autoUpdater error",
			detail: "Error: ENOTFOUND",
		});
		const dest = path.join(os.tmpdir(), `bundle-${process.pid}.txt`);

		const result = await exportDiagnosticBundle(dest);
		expect(result.ok).toBe(true);
		expect(result.path).toBe(dest);

		const bundle = fs.readFileSync(dest, "utf8");
		expect(bundle).toContain("Lamp & Light - diagnostic bundle");
		expect(bundle).toContain("9.9.9");
		expect(bundle).toMatch(new RegExp(`node:\\s+${process.versions.node}`));
		expect(bundle).toMatch(/electron:\s+\S+/);
		expect(bundle).toContain(os.arch());
		expect(bundle).toContain(os.platform());
		expect(bundle).toContain("packaged:");
		expect(bundle).toContain("autoUpdater error");
		expect(bundle).toContain("ENOTFOUND");

		fs.rmSync(dest, { force: true });
	});

	it("does not leak the log's own path into the bundle", async () => {
		appendDiagnostic({ level: "error", scope: "db", message: "boom" });
		const dest = path.join(os.tmpdir(), `bundle-path-${process.pid}.txt`);

		await exportDiagnosticBundle(dest);
		const bundle = fs.readFileSync(dest, "utf8");

		expect(bundle).not.toContain(sandbox);
		fs.rmSync(dest, { force: true });
	});

	it("exports an environment-only bundle when no log exists", async () => {
		const dest = path.join(os.tmpdir(), `bundle-empty-${process.pid}.txt`);

		const result = await exportDiagnosticBundle(dest);
		expect(result.ok).toBe(true);
		expect(fs.readFileSync(dest, "utf8")).toContain("(no entries recorded)");

		fs.rmSync(dest, { force: true });
	});

	it("accepts a .log extension", async () => {
		const dest = path.join(os.tmpdir(), `bundle-${process.pid}.log`);
		expect((await exportDiagnosticBundle(dest)).ok).toBe(true);
		fs.rmSync(dest, { force: true });
	});

	it("rejects a relative path", async () => {
		const result = await exportDiagnosticBundle("diagnostics-bundle.txt");
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/absolute path/i);
	});

	it("rejects a ~-prefixed path instead of expanding it", async () => {
		const result = await exportDiagnosticBundle("~/bundle.txt");
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/~|absolute/i);
	});

	it("rejects a '..' segment", async () => {
		// String-built on purpose: `path.join` would normalize the `..` away and
		// the test would pass without ever reaching the validator.
		const dest = `${sandbox}/../escape-${process.pid}.txt`;
		const result = await exportDiagnosticBundle(dest);
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/\.\./);
	});

	it("rejects a dotfile basename such as .env", async () => {
		const result = await exportDiagnosticBundle(path.join(os.tmpdir(), ".env"));
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/dotfile/i);
	});

	it("rejects an extension that is not .txt or .log", async () => {
		for (const name of ["bundle.sqlite", "bundle.png", "bundle", "bundle.json"]) {
			const result = await exportDiagnosticBundle(
				path.join(os.tmpdir(), name),
			);
			expect(result.ok, name).toBe(false);
			expect(result.error, name).toMatch(/\.txt or \.log/);
		}
	});

	it("rejects a directory rather than writing one file", async () => {
		const result = await exportDiagnosticBundle(`${os.tmpdir()}${path.sep}`);
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/file, not a directory/i);
	});

	it("rejects writing into the app data folder", async () => {
		for (const dest of [
			path.join(sandbox, "bundle.txt"),
			path.join(sandbox, "nested", "bundle.log"),
		]) {
			const result = await exportDiagnosticBundle(dest);
			expect(result.ok, dest).toBe(false);
			expect(result.error, dest).toMatch(/data folder/i);
		}
	});

	it("rejects a non-string payload", async () => {
		for (const value of [null, undefined, 42, {}, ""]) {
			const result = await exportDiagnosticBundle(
				value as unknown as string,
			);
			expect(result.ok, String(value)).toBe(false);
		}
	});

	it("reports a write failure instead of throwing", async () => {
		const result = await exportDiagnosticBundle(
			path.join(blockerFile, "bundle.txt"),
		);
		expect(result.ok).toBe(false);
		expect(typeof result.error).toBe("string");
	});
});
