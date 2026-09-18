import { describe, expect, it } from "vitest";
import {
	badgeForDailyUnanswered,
	clampReminderHour,
	shouldFireDailyReminder,
} from "./macos.js";

describe("macos helpers", () => {
	it("maps unanswered daily to dock badge text", () => {
		expect(badgeForDailyUnanswered(true)).toBe("1");
		expect(badgeForDailyUnanswered(false)).toBe("");
	});

	it("clamps reminder hour to 0–23", () => {
		expect(clampReminderHour(9)).toBe(9);
		expect(clampReminderHour(-3)).toBe(0);
		expect(clampReminderHour(30)).toBe(23);
		expect(clampReminderHour(Number.NaN)).toBe(9);
	});

	it("fires reminder once past preferred hour when still unanswered", () => {
		const now = new Date("2026-09-18T10:00:00");
		expect(
			shouldFireDailyReminder({
				enabled: true,
				unanswered: true,
				hour: 9,
				lastNotified: null,
				now,
			}),
		).toBe(true);
		expect(
			shouldFireDailyReminder({
				enabled: true,
				unanswered: true,
				hour: 9,
				lastNotified: "2026-09-18",
				now,
			}),
		).toBe(false);
		expect(
			shouldFireDailyReminder({
				enabled: true,
				unanswered: true,
				hour: 11,
				lastNotified: null,
				now,
			}),
		).toBe(false);
		expect(
			shouldFireDailyReminder({
				enabled: false,
				unanswered: true,
				hour: 9,
				lastNotified: null,
				now,
			}),
		).toBe(false);
	});
});
