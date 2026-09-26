import { describe, expect, it } from "vitest";
import { decideDialog, shouldRunCheck } from "./updater-state.js";

describe("decideDialog", () => {
	it("shows the dialog the first time a version is downloaded", () => {
		expect(
			decideDialog({
				version: "1.2.13",
				lastNotifiedVersion: undefined,
				recheckRequested: false,
				quitInProgress: false,
			}),
		).toBe("show");
	});

	it("suppresses the dialog for the same version we already notified about", () => {
		expect(
			decideDialog({
				version: "1.2.13",
				lastNotifiedVersion: "1.2.13",
				recheckRequested: false,
				quitInProgress: false,
			}),
		).toBe("suppress");
	});

	it("shows the dialog again when a NEW version is downloaded", () => {
		expect(
			decideDialog({
				version: "1.2.14",
				lastNotifiedVersion: "1.2.13",
				recheckRequested: false,
				quitInProgress: false,
			}),
		).toBe("show");
	});

	it("always suppresses while a quitAndInstall is in flight", () => {
		expect(
			decideDialog({
				version: "1.2.13",
				lastNotifiedVersion: "1.2.13",
				recheckRequested: true,
				quitInProgress: true,
			}),
		).toBe("suppress");
	});

	it("respects an explicit user re-check request even after the dialog was dismissed", () => {
		expect(
			decideDialog({
				version: "1.2.13",
				lastNotifiedVersion: "1.2.13",
				recheckRequested: true,
				quitInProgress: false,
			}),
		).toBe("show");
	});

	it("shows the dialog when version is missing (better to over-notify)", () => {
		expect(
			decideDialog({
				version: undefined,
				lastNotifiedVersion: "1.2.13",
				recheckRequested: false,
				quitInProgress: false,
			}),
		).toBe("show");
	});
});

describe("shouldRunCheck", () => {
	it("never checks when not packaged (dev mode)", () => {
		expect(
			shouldRunCheck({
				isPackaged: false,
				checking: false,
				statusState: "up-to-date",
				forced: true,
			}),
		).toBe(false);
	});

	it("skips when a check is already in flight", () => {
		expect(
			shouldRunCheck({
				isPackaged: true,
				checking: true,
				statusState: "up-to-date",
				forced: false,
			}),
		).toBe(false);
	});

	it("skips when an update is downloaded, unless forced", () => {
		expect(
			shouldRunCheck({
				isPackaged: true,
				checking: false,
				statusState: "downloaded",
				forced: false,
			}),
		).toBe(false);
		expect(
			shouldRunCheck({
				isPackaged: true,
				checking: false,
				statusState: "downloaded",
				forced: true,
			}),
		).toBe(true);
	});

	it("runs when state is anything other than downloaded", () => {
		for (const state of ["checking", "up-to-date", "available", "error"] as const) {
			expect(
				shouldRunCheck({
					isPackaged: true,
					checking: false,
					statusState: state,
					forced: false,
				}),
			).toBe(true);
		}
	});
});
