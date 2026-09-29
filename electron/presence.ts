/**
 * Idle-time XP accrual ("active_seconds").
 *
 * The renderer pings the `activity` channel on interaction; every tick we add
 * a few seconds of credit and, once a full minute has accrued, grant it to the
 * active profile. Credit is *not* reset by idleness — it is earned, not
 * banked-per-session — so a user who alt-tabs for ten minutes keeps the 55
 * seconds they had banked.
 *
 * Free of any `electron` import; `tickPresence` takes the clock as a
 * parameter so the accrual arithmetic is testable.
 */
import { getActiveProfileId, getLastInteraction, userDb } from "./state.js";

/** Interaction older than this stops earning credit (5 minutes). */
const ACTIVE_WINDOW_MS = 300_000;
const TICK_MS = 5_000;
const CREDIT_PER_TICK = 5;
const GRANT_SECONDS = 60;

let accrued = 0;

/** Seconds banked so far, for tests and diagnostics. */
export function getAccruedSeconds(): number {
	return accrued;
}

/**
 * One accrual step. `nowMs` is injected rather than read from the clock so
 * tests can drive the active/inactive boundary.
 */
export function tickPresence(nowMs: number): void {
	const profileId = getActiveProfileId();
	if (!profileId || nowMs - getLastInteraction() >= ACTIVE_WINDOW_MS) return;
	accrued += CREDIT_PER_TICK;
	if (accrued < GRANT_SECONDS) return;
	userDb()
		.prepare(
			"UPDATE profiles SET xp=xp+0.08,active_seconds=active_seconds+60 WHERE id=?",
		)
		.run(profileId);
	accrued -= GRANT_SECONDS;
}

/** Start the 5-second accrual loop. Call once, from `app.whenReady()`. */
export function startPresenceTicker(): void {
	setInterval(() => tickPresence(Date.now()), TICK_MS);
}
