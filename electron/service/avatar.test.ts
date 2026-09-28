import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
	avatarDataUrl,
	avatarFileName,
	avatarFilesFor,
	CUSTOM_AVATAR_EXTS,
	CUSTOM_AVATAR_MAX_BYTES,
} from "./avatar.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-avatar-"));
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeEach(() => {
	for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
});

afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("custom avatar file naming", () => {
	it("stores one avatar per profile, named by profile id and extension", () => {
		expect(avatarFileName(3, ".png")).toBe("3.png");
	});

	it("accepts only the documented image extensions", () => {
		expect([...CUSTOM_AVATAR_EXTS].sort()).toEqual([
			".gif",
			".jpeg",
			".jpg",
			".png",
			".webp",
		]);
	});

	it("lists only the current profile's files for cleanup", () => {
		fs.writeFileSync(path.join(dir, "3.jpg"), PNG_HEADER);
		fs.writeFileSync(path.join(dir, "3.png"), PNG_HEADER);
		fs.writeFileSync(path.join(dir, "30.png"), PNG_HEADER);
		fs.writeFileSync(path.join(dir, "notes.txt"), "x");
		expect(avatarFilesFor(dir, 3).sort()).toEqual(["3.jpg", "3.png"]);
	});
});

describe("avatar data URLs", () => {
	it("inlines a stored image with its MIME type", () => {
		fs.writeFileSync(path.join(dir, "7.png"), PNG_HEADER);
		const url = avatarDataUrl(dir, "7.png");
		expect(url).toBe(
			`data:image/png;base64,${PNG_HEADER.toString("base64")}`,
		);
	});

	it("maps every supported extension to a MIME type", () => {
		const expected: Record<string, string> = {
			"a.jpg": "image/jpeg",
			"a.jpeg": "image/jpeg",
			"a.png": "image/png",
			"a.webp": "image/webp",
			"a.gif": "image/gif",
		};
		for (const [name, mime] of Object.entries(expected)) {
			fs.writeFileSync(path.join(dir, name), PNG_HEADER);
			expect(avatarDataUrl(dir, name)).toBe(
				`data:${mime};base64,${PNG_HEADER.toString("base64")}`,
			);
		}
	});

	it("rejects any name that is not a plain filename in the avatar dir", () => {
		// The value comes from the database, but a traversal here would inline
		// an arbitrary file from the user's home directory into the renderer.
		fs.writeFileSync(path.join(dir, "secret.txt"), "not an image");
		fs.writeFileSync(path.join(dir, "7.png"), PNG_HEADER);
		expect(avatarDataUrl(dir, "../7.png")).toBeNull();
		expect(avatarDataUrl(dir, "../../etc/passwd")).toBeNull();
		expect(avatarDataUrl(dir, "sub/7.png")).toBeNull();
		expect(avatarDataUrl(dir, "..")).toBeNull();
		expect(avatarDataUrl(dir, "a/../7.png")).toBeNull();
	});

	it("returns null for a missing name, missing file or unknown extension", () => {
		expect(avatarDataUrl(dir, null)).toBeNull();
		expect(avatarDataUrl(dir, undefined)).toBeNull();
		expect(avatarDataUrl(dir, "")).toBeNull();
		expect(avatarDataUrl(dir, "absent.png")).toBeNull();
		fs.writeFileSync(path.join(dir, "notes.txt"), "x");
		expect(avatarDataUrl(dir, "notes.txt")).toBeNull();
	});

	it("refuses to inline a file far larger than the upload cap", () => {
		// Uploads are capped at 2 MB, so anything much larger is a file that
		// did not come through the picker — do not base64 it into the payload.
		fs.writeFileSync(
			path.join(dir, "big.png"),
			Buffer.alloc(CUSTOM_AVATAR_MAX_BYTES * 2 + 1),
		);
		expect(avatarDataUrl(dir, "big.png")).toBeNull();
	});
});
