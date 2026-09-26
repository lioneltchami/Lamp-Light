/**
 * Pure helpers for the auto-update dialog.
 *
 * Lives outside main.ts so the idempotency rules can be unit-tested without
 * mocking electron / electron-updater. Keeps the runtime decisions in
 * `configureAutoUpdates` small and obvious.
 */

export type UpdateDialogState =
	| "checking"
	| "up-to-date"
	| "available"
	| "downloaded"
	| "error";

export type UpdateStatus = {
	state: UpdateDialogState;
	version?: string;
};

export type DialogDecision = "show" | "suppress";

/**
 * Decide whether the "Restart and update" modal should appear for this
 * `update-downloaded` event.
 *
 * Background: electron-updater re-emits `update-downloaded` whenever
 * `checkForUpdates()` resolves to a cached pending update. Without a guard,
 * the dialog can re-appear after the user already chose Restart or Later.
 *
 * Rules:
 *  - If `quitInProgress` is true (user already chose Restart), do not re-show.
 *  - If the user has already been notified of this exact version, do not
 *    re-show unless `recheckRequested` is true (e.g. user clicked
 *    "Check for updates" in Settings).
 *  - If `info.version` is missing, fall back to "show" — better to over-notify
 *    than to swallow the only signal that an update exists.
 */
export function decideDialog(args: {
	version: string | undefined;
	lastNotifiedVersion: string | undefined;
	recheckRequested: boolean;
	quitInProgress: boolean;
}): DialogDecision {
	if (args.quitInProgress) return "suppress";
	if (args.recheckRequested) return "show";
	if (
		args.version &&
		args.lastNotifiedVersion &&
		args.version === args.lastNotifiedVersion
	) {
		return "suppress";
	}
	return "show";
}

/**
 * Decide whether `checkForUpdates()` should actually run, given the current
 * status and whether the caller asked for a forced check.
 *
 * Background: even when an update has already been downloaded and the user
 * has been notified, electron-updater's cache-hit path will re-emit
 * `update-downloaded` on every call. Re-checking in that state is wasted
 * work (and triggers the dialog guard above).
 *
 * Rules:
 *  - If not packaged (dev), never check.
 *  - If a check is already in flight, no-op.
 *  - If a downloaded update is pending AND the caller did not force a
 *    re-check, skip the network call. The renderer's `update:check` IPC
 *    will return the current status so the UI stays in sync.
 *  - Otherwise, run the check.
 */
export function shouldRunCheck(args: {
	isPackaged: boolean;
	checking: boolean;
	statusState: UpdateDialogState;
	forced: boolean;
}): boolean {
	if (!args.isPackaged) return false;
	if (args.checking) return false;
	if (args.statusState === "downloaded" && !args.forced) return false;
	return true;
}
