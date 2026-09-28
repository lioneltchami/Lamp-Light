import { describe, expect, it } from "vitest";
import {
	getActiveProfileId,
	getAvatarDir,
	getLastInteraction,
	getMainWindow,
	getUserDbPath,
	markInteraction,
	sendToRenderer,
	setActiveProfileId,
	setDatabaseLocations,
	setMainWindow,
	contentDb,
	isoDay,
	now,
	userDb,
} from "./state.js";

/** A window stub with just the surface `sendToRenderer` touches. */
function fakeWindow(destroyed = false) {
	const sent: { channel: string; payload: unknown }[] = [];
	return {
		sent,
		isDestroyed: () => destroyed,
		webContents: {
			send: (channel: string, payload?: unknown) => sent.push({ channel, payload }),
		},
	};
}

describe("shared main-process state", () => {
	it("round-trips the active profile id", () => {
		setActiveProfileId(null);
		expect(getActiveProfileId()).toBeNull();
		setActiveProfileId(7);
		expect(getActiveProfileId()).toBe(7);
		setActiveProfileId(null);
		expect(getActiveProfileId()).toBeNull();
	});

	it("round-trips the database locations set during bootstrap", () => {
		setDatabaseLocations({
			userDbPath: "/tmp/u/selah-user.sqlite",
			avatarDir: "/tmp/u/avatars",
		});
		expect(getUserDbPath()).toBe("/tmp/u/selah-user.sqlite");
		expect(getAvatarDir()).toBe("/tmp/u/avatars");
	});

	it("refuses to hand out a database before whenReady has opened it", () => {
		// Ordering contract: `ipcMain.handle` registrations that run before
		// `app.whenReady()` must not read a database.
		expect(() => userDb()).toThrow(/not open yet/);
		expect(() => contentDb()).toThrow(/not open yet/);
	});

	it("delivers renderer events to the live window", () => {
		const win = fakeWindow();
		setMainWindow(win as never);
		expect(getMainWindow()).toBe(win as never);
		sendToRenderer("app:navigate", "home");
		expect(win.sent).toEqual([{ channel: "app:navigate", payload: "home" }]);
	});

	it("drops renderer events when the window is gone", () => {
		// Every caller is a fire-and-forget push; throwing here would take down
		// the caller (a reminder tick, a session answer) for no user benefit.
		setMainWindow(fakeWindow(true) as never);
		expect(() => sendToRenderer("app:navigate", "home")).not.toThrow();

		setMainWindow(null);
		expect(() => sendToRenderer("app:navigate", "home")).not.toThrow();
	});
});

describe("interaction clock", () => {
	it("advances only when the renderer reports interaction", () => {
		markInteraction();
		const after = getLastInteraction();
		expect(after).toBeGreaterThan(0);
		expect(after).toBeLessThanOrEqual(Date.now());
	});
});

describe("time helpers", () => {
	it("formats the local day as YYYY-MM-DD", () => {
		// `toLocaleDateString("en-CA")` is the canonical YYYY-MM-DD form and is
		// what `daily_questions.local_date` is keyed on.
		expect(isoDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it("formats timestamps as ISO 8601", () => {
		expect(now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
	});
});
