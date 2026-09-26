/**
 * Renderer-only types shared across the React layer.
 *
 * Cross-process (main ↔ renderer) types live in `../shared/types.ts`.
 * This file is for type aliases that are purely a renderer concern.
 */

/** Status payload pushed from the main process via the update-status IPC. */
export type UpdateStatus = {
	state: "checking" | "up-to-date" | "available" | "downloaded" | "error";
	version?: string;
	/** Optional diagnostic populated by the main process when state === "error". */
	reason?: string;
};
