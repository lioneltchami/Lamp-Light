import { beforeEach, describe, expect, it } from "vitest";
import Database from "./db.js";
import { migrate } from "./store.js";
import {
	getAccruedSeconds,
	tickPresence,
} from "./presence.js";
import { getLastInteraction, setActiveProfileId, setDatabases } from "./state.js";

let user: Database;
let profileId: number;

beforeEach(() => {
	user = new Database(":memory:");
	migrate(user);
	const content = new Database(":memory:");
	setDatabases(user, content);
	profileId = Number(
		user
			.prepare("INSERT INTO profiles(name,avatar_id,created_at) VALUES('R','lamb','now')")
			.run().lastInsertRowid,
	);
	setActiveProfileId(profileId);
});

function activeSeconds(): number {
	return Number(
		(
			user.prepare("SELECT active_seconds FROM profiles WHERE id=?").get(profileId) as {
				active_seconds: number;
			}
		).active_seconds,
	);
}

/** Run `count` ticks as if the user interacted `count` ticks ago. */
function activeTicks(count: number): void {
	const now = Date.now();
	for (let i = 0; i < count; i++) tickPresence(now);
}

describe("idle-time XP accrual", () => {
	it("earns nothing without an active profile", () => {
		setActiveProfileId(null);
		const before = getAccruedSeconds();
		activeTicks(20);
		expect(getAccruedSeconds()).toBe(before);
		expect(activeSeconds()).toBe(0);
	});

	it("earns nothing once the last interaction is older than five minutes", () => {
		const stale = getLastInteraction() + 300_000;
		const before = getAccruedSeconds();
		tickPresence(stale);
		expect(getAccruedSeconds()).toBe(before);
		expect(activeSeconds()).toBe(0);
	});

	it("grants a minute of active time after twelve active ticks", () => {
		const before = getAccruedSeconds();
		activeTicks(12);
		expect(activeSeconds()).toBe(60);
		// Credit is spent in whole minutes, never lost to rounding.
		expect(getAccruedSeconds()).toBe(before);
	});

	it("keeps the fractional remainder across the grant boundary", () => {
		activeTicks(14);
		expect(activeSeconds()).toBe(60);
		expect(getAccruedSeconds() - 0).toBe(10);
	});

	it("keeps banked credit through an idle stretch instead of resetting it", () => {
		// Credit is earned, not banked per session: a user who alt-tabs for
		// ten minutes must not lose the 55 seconds they had earned.
		activeTicks(11);
		const banked = getAccruedSeconds();
		tickPresence(getLastInteraction() + 600_000);
		expect(getAccruedSeconds()).toBe(banked);
		activeTicks(1);
		expect(activeSeconds()).toBe(60);
	});

	it("adds only idle-time XP, not real wall-clock time", () => {
		// The grant is 0.08 XP per credited minute, not proportional to how long
		// the process was actually open.
		const banked = getAccruedSeconds();
		user.prepare("UPDATE profiles SET xp=100 WHERE id=?").run(profileId);
		activeTicks(Math.ceil((60 - banked) / 5));
		expect(
			Number(
				(user.prepare("SELECT xp FROM profiles WHERE id=?").get(profileId) as { xp: number })
					.xp,
			),
		).toBeCloseTo(100.08, 6);
		// A partial minute must not grant anything.
		activeTicks(1);
		expect(
			Number(
				(user.prepare("SELECT xp FROM profiles WHERE id=?").get(profileId) as { xp: number })
					.xp,
			),
		).toBeCloseTo(100.08, 6);
	});
});
