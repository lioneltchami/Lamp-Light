/**
 * Custom profile-avatar file handling: extension allowlist, on-disk layout and
 * the data-URL read used by the renderer.
 *
 * Free of any `electron` import — the avatar directory is injected by
 * `state.getAvatarDir()` — so the path-traversal guard is unit-testable.
 */
import fs from "node:fs";
import path from "node:path";

export const CUSTOM_AVATAR_EXTS = new Set([
	".jpg",
	".jpeg",
	".png",
	".webp",
	".gif",
]);

/** Extension → MIME, without the leading dot. */
export const CUSTOM_AVATAR_MIME: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
	".gif": "image/gif",
};

/** Extension list for the native file picker (no leading dots). */
export const CUSTOM_AVATAR_DIALOG_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];

export const CUSTOM_AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** The on-disk name for a profile's avatar. One avatar per profile. */
export function avatarFileName(profileId: number, ext: string): string {
	return `${profileId}${ext}`;
}

/**
 * Existing avatar files belonging to `profileId` (e.g. `3.jpg`), so a newly
 * picked photo can replace the previous one of a different extension.
 */
export function avatarFilesFor(dir: string, profileId: number): string[] {
	return fs
		.readdirSync(dir)
		.filter((name) => name.startsWith(`${profileId}.`));
}

/**
 * Read a stored avatar into a `data:` URL for the renderer.
 *
 * Returns `null` — never throws — for a missing name, a name that is not a
 * plain filename (traversal, nested path), an unknown extension, an absent
 * file, or a read failure.
 */
export function avatarDataUrl(
	dir: string,
	fileName: string | null | undefined,
): string | null {
	if (!fileName) return null;
	const base = path.basename(String(fileName));
	if (base !== fileName || base.includes("..")) return null;
	const full = path.join(dir, base);
	if (!fs.existsSync(full)) return null;
	const ext = path.extname(full).toLowerCase();
	const mime = CUSTOM_AVATAR_MIME[ext];
	if (!mime) return null;
	try {
		const buf = fs.readFileSync(full);
		if (buf.length > CUSTOM_AVATAR_MAX_BYTES * 2) return null;
		return `data:${mime};base64,${buf.toString("base64")}`;
	} catch {
		return null;
	}
}
