/**
 * Auto-update wiring for the packaged app.
 *
 * The `update:status` / `update:check` channels are registered by
 * `main.ts` (the composition root) so the full channel list stays greppable in
 * one place; they delegate to `getUpdateStatus` / `runUpdateCheck` here.
 *
 * Listener and interval registration is guarded by `updaterWired` so it happens
 * exactly once for the process lifetime — reopening the app from the Dock
 * calls `openMainWindow` again, and re-arming the recheck timer on every
 * `activate` would stack up timers and re-fire `update-downloaded`.
 *
 * The pure decision logic lives in `updater-state.ts` and is unit-tested there.
 */
import electron, { type BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import { appendDiagnostic } from "./diagnostics.js";
import { decideDialog, shouldRunCheck, type UpdateStatus } from "./updater-state.js";

const { app } = electron;
const { autoUpdater } = electronUpdater;

let updaterWired = false;
let updaterStatus: UpdateStatus = { state: "up-to-date" };
let updaterChecking = false;
let updaterLastNotifiedVersion: string | undefined;
let updaterRecheckRequested = false;
let updaterQuitInProgress = false;
let updaterRecheckTimer: NodeJS.Timeout | undefined;

/** Current published status; also backs the `update:status` channel. */
export function getUpdateStatus(): UpdateStatus {
	return updaterStatus;
}

/** True once the user accepted a restart, so `before-quit` can tell it apart. */
export function isUpdaterQuitInProgress(): boolean {
	return updaterQuitInProgress;
}

function publishStatus(win: BrowserWindow, next: UpdateStatus): void {
	updaterStatus = next;
	if (!win.isDestroyed()) win.webContents.send("update:status", next);
}

/** Run a check unless one is already in flight or the state forbids it. */
export async function runUpdateCheck(
	win: BrowserWindow,
	forced: boolean,
): Promise<UpdateStatus> {
	if (
		!shouldRunCheck({
			isPackaged: app.isPackaged,
			checking: updaterChecking,
			statusState: updaterStatus.state,
			forced,
		})
	) {
		return updaterStatus;
	}
	updaterChecking = true;
	publishStatus(win, { state: "checking" });
	try {
		await autoUpdater.checkForUpdates();
	} catch {
		/* The updater error event publishes the status. */
	} finally {
		updaterChecking = false;
	}
	return updaterStatus;
}

function armRecheck(win: BrowserWindow): void {
	if (updaterRecheckTimer) clearTimeout(updaterRecheckTimer);
	updaterRecheckTimer = setTimeout(() => {
		void runUpdateCheck(win, false).finally(() => armRecheck(win));
	}, 60 * 60 * 1000);
}

export function configureAutoUpdates(win: BrowserWindow): void {
	updaterStatus = app.isPackaged ? { state: "checking" } : { state: "up-to-date" };

	const publish = (next: UpdateStatus) => publishStatus(win, next);

	if (!app.isPackaged) return;
	if (updaterWired) return;
	updaterWired = true;

	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.on("checking-for-update", () => publish({ state: "checking" }));
	autoUpdater.on("update-available", (info) =>
		publish({ state: "available", version: info.version }),
	);
	autoUpdater.on("update-not-available", () => publish({ state: "up-to-date" }));
	autoUpdater.on("update-downloaded", async (info) => {
		publish({ state: "downloaded", version: info.version });

		const decision = decideDialog({
			version: info.version,
			lastNotifiedVersion: updaterLastNotifiedVersion,
			recheckRequested: updaterRecheckRequested,
			quitInProgress: updaterQuitInProgress,
		});
		// Consume the recheck request regardless — it was either honored now
		// or explicitly suppressed by a quit in progress.
		updaterRecheckRequested = false;
		if (decision === "suppress") return;

		updaterLastNotifiedVersion = info.version;
		const result = await electron.dialog.showMessageBox(win, {
			type: "info",
			title: "Update ready",
			message: `Lamp & Light ${info.version} is ready.`,
			detail:
				"Restart now to install it. Your profiles and progress will be preserved.",
			buttons: ["Restart and update", "Later"],
			defaultId: 0,
			cancelId: 1,
		});
		if (result.response !== 0) return;

		updaterQuitInProgress = true;
		autoUpdater.quitAndInstall(false, true);

		// macOS safety net: `MacUpdater.quitAndInstall()` can silently no-op
		// when Squirrel.Mac hasn't finished its internal download yet (the
		// `squirrelDownloadedUpdate` flag is false at click time in the
		// common case). If the window is still alive a few seconds later,
		// force-quit so we don't strand the user on the old version with a
		// pending cached update that re-fires the dialog on next launch.
		setTimeout(() => {
			if (!win.isDestroyed() && updaterQuitInProgress) {
				console.warn(
					"[updater] quitAndInstall did not terminate the app; forcing app.quit()",
				);
				app.quit();
			}
		}, 4000);
	});
	autoUpdater.on("error", (error) => {
		const reason =
			(error && (error as { message?: string }).message) || String(error);
		publish({ state: "error", reason });
		console.error("Automatic update error:", error);
		// Same as before this module existed: an update failure is exactly the
		// event a user will report, so it has to survive in the diagnostic log
		// and not only on the console.
		appendDiagnostic({
			level: "error",
			scope: "updater",
			message: "autoUpdater error",
			detail: error instanceof Error ? error.stack : String(error),
		});
	});

	// Kick off an initial check on the next tick so the renderer can subscribe
	// first. We deliberately do NOT piggy-back on `did-finish-load`: that
	// listener fires on every renderer navigation, and a `checkForUpdates`
	// during the cache-hit window would re-fire `update-downloaded` and (with
	// our new guard) just no-op, but it's wasted work and noisy.
	setImmediate(() => {
		void runUpdateCheck(win, false);
		armRecheck(win);
	});
}
