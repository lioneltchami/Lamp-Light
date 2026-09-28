import { beforeEach, describe, expect, it } from "vitest";
import Database from "../db.js";
import { ensureContent } from "../content.js";
import { migrate } from "../store.js";
import { setActiveProfileId, setDatabases, isoDay, now, contentDb } from "../state.js";
import { createSession, currentSession, sessionState } from "./quiz.js";

/** The index, in the session's shuffled order, of the correct answer. */
function correctIndexGuess(state: any): number {
	const row = user.prepare("SELECT current_index,choice_orders FROM sessions WHERE id=?").get(
		state.sessionId,
	) as { current_index: number; choice_orders: string };
	const maps = JSON.parse(row.choice_orders);
	const correct = (
		contentDb()
			.prepare("SELECT correct_index FROM questions WHERE id=?")
			.get(state.current.id) as { correct_index: number }
	).correct_index;
	return maps[row.current_index].indexOf(correct);
}

let user: Database;
let profileId: number;

beforeEach(() => {
	user = new Database(":memory:");
	migrate(user);
	setDatabases(user, ensureContent(":memory:"));
	profileId = Number(
		user
			.prepare("INSERT INTO profiles(name,avatar_id,created_at) VALUES('R','lamb','now')")
			.run().lastInsertRowid,
	);
	setActiveProfileId(profileId);
});

/** Answer the current question correctly, as the renderer would. */
function answerCurrent(sessionId: number, selectedIndex: number) {
	const raw = user.prepare("SELECT * FROM sessions WHERE id=?").get(sessionId) as {
		id: number;
		current_index: number;
		choice_orders: string;
	};
	const state = sessionState(raw) as any;
	const maps = JSON.parse(raw.choice_orders);
	const correctIndex = maps[raw.current_index].indexOf(
		(
			contentDb()
				.prepare("SELECT correct_index FROM questions WHERE id=?")
				.get(state.current.id) as { correct_index: number }
		).correct_index,
	);
	user
		.prepare("INSERT INTO session_answers VALUES(?,?,?,?,?,?)")
		.run(
			raw.id,
			state.current.id,
			selectedIndex,
			correctIndex,
			selectedIndex === correctIndex ? 1 : 0,
			now(),
		);
	return { correctIndex, state };
}

describe("quiz session creation", () => {
	it("caps a full-book run at the standard question count", () => {
		const state = createSession(profileId, "full", "GEN") as any;
		expect(state.total).toBe(15);
		expect(state.title).toBe("Genesis — Full Quiz");
		expect(state.completed).toBe(false);
		expect(state.selectedIndex).toBeNull();
	});

	it("titles a chapter range as a single chapter or a span", () => {
		expect((createSession(profileId, "practice", "GEN", 1) as any).title).toBe(
			"Genesis Chapter 1",
		);
		expect((createSession(profileId, "practice", "GEN", 1, 2) as any).title).toBe(
			"Genesis Chapters 1–2",
		);
	});

	it("restricts a practice run to the requested chapter range", () => {
		const state = createSession(profileId, "practice", "GEN", 1) as any;
		const ids = JSON.parse(
			(
				user
					.prepare("SELECT question_order FROM sessions WHERE id=?")
					.get(state.sessionId) as { question_order: string }
			).question_order,
		) as string[];
		const chapters = ids.map(
			(id) =>
				(
					contentDb()
						.prepare("SELECT chapter FROM questions WHERE id=?")
						.get(id) as unknown as { chapter: number }
				).chapter,
		);
		expect(chapters.length).toBeGreaterThan(0);
		expect(chapters.every((chapter) => chapter === 1)).toBe(true);
	});

	it("refuses a selection with no questions", () => {
		expect(() => createSession(profileId, "full", "NOPE")).toThrow(
			/No questions are available/,
		);
	});

	it("gives a profile one daily question, stable within the day", () => {
		const first = createSession(profileId, "daily", "") as any;
		expect(first.total).toBe(1);
		expect(first.title).toBe("Today's Question");
		// Reopening the app must not reshuffle the day's question.
		const again = createSession(profileId, "daily", "") as any;
		expect(again.current.id).toBe(first.current.id);
		const rows = user
			.prepare("SELECT COUNT(*) count FROM daily_questions WHERE profile_id=?")
			.get(profileId) as unknown as { count: number };
		expect(rows.count).toBe(1);
	});

	it("gives different profiles a daily question drawn for them", () => {
		const other = Number(
			user
				.prepare("INSERT INTO profiles(name,avatar_id,created_at) VALUES('S','lamb','now')")
				.run().lastInsertRowid,
		);
		const mine = createSession(profileId, "daily", "") as any;
		const theirs = createSession(other, "daily", "") as any;
		expect(
			user
				.prepare("SELECT local_date FROM daily_questions WHERE profile_id=?")
				.get(profileId),
		).toEqual({ local_date: isoDay() });
		expect(typeof theirs.current.id).toBe("string");
		expect(theirs.total).toBe(1);
		// Different profiles may or may not collide; what must hold is that
		// neither row was overwritten by the other.
		const stored = user
			.prepare("SELECT question_id FROM daily_questions WHERE profile_id=?")
			.get(profileId) as unknown as { question_id: string };
		expect(stored.question_id).toBe(mine.current.id);
	});
});

describe("session state projection", () => {
	it("shuffles the answers without losing or duplicating any", () => {
		// A session saves its own answer order, so the renderer must be handed
		// exactly the four answers, reordered.
		const state = createSession(profileId, "full", "GEN") as any;
		const row = contentDb()
			.prepare(
				"SELECT answer_a,answer_b,answer_c,answer_d FROM questions WHERE id=?",
			)
			.get(state.current.id) as Record<string, string>;
		expect([...state.current.choices].sort()).toEqual(
			[
				row.answer_a,
				row.answer_b,
				row.answer_c,
				row.answer_d,
			].sort(),
		);
	});

	it("hides the correct answer until the question has been answered", () => {
		// `correctIndex` is a scoring aid, not a leak: before an answer exists
		// it must be null.
		const state = createSession(profileId, "full", "GEN") as any;
		expect(state.correctIndex).toBeNull();
		expect(state.selectedIndex).toBeNull();
	});

	it("points `correctIndex` at the right choice in the shuffled order", () => {
		// The index is into the *shuffled* array, so verify it against the real
		// answer text rather than against the question's stored index.
		const state = createSession(profileId, "full", "GEN") as any;
		const row = contentDb()
			.prepare(
				"SELECT answer_a,answer_b,answer_c,answer_d,correct_index FROM questions WHERE id=?",
			)
			.get(state.current.id) as Record<string, string | number>;
		const truth = [row.answer_a, row.answer_b, row.answer_c, row.answer_d][
			Number(row.correct_index)
		];
		const { correctIndex } = answerCurrent(state.sessionId, 0);
		expect(state.current.choices[correctIndex]).toBe(truth);
	});

	it("counts answers and reports the previous one", () => {
		const state = createSession(profileId, "full", "GEN") as any;
		const { correctIndex } = answerCurrent(state.sessionId, correctIndexGuess(state));
		const after = sessionState(
			user.prepare("SELECT * FROM sessions WHERE id=?").get(state.sessionId),
		) as any;
		expect(after.answered).toBe(1);
		expect(after.correct).toBe(1);
		expect(after.selectedIndex).toBe(correctIndex);
		expect(after.isCorrect).toBe(true);
	});

	it("reports an incorrect answer as answered but not correct", () => {
		const state = createSession(profileId, "full", "GEN") as any;
		answerCurrent(state.sessionId, (correctIndexGuess(state) + 1) % 4);
		const after = sessionState(
			user.prepare("SELECT * FROM sessions WHERE id=?").get(state.sessionId),
		) as any;
		expect(after.answered).toBe(1);
		expect(after.correct).toBe(0);
		expect(after.isCorrect).toBe(false);
	});

	it("marks a session completed once its status flips", () => {
		const state = createSession(profileId, "full", "GEN") as any;
		expect((state as any).completed).toBe(false);
		user
			.prepare("UPDATE sessions SET status='completed' WHERE id=?")
			.run(state.sessionId);
		expect(
			(
				sessionState(
					user.prepare("SELECT * FROM sessions WHERE id=?").get(state.sessionId),
				) as any
			).completed,
		).toBe(true);
	});
});

describe("current session lookup", () => {
	it("returns null when the profile has no active session", () => {
		expect(currentSession(profileId)).toBeNull();
	});

	it("returns the most recent active session and ignores finished ones", () => {
		const first = createSession(profileId, "full", "GEN") as any;
		user
			.prepare("UPDATE sessions SET status='completed' WHERE id=?")
			.run(first.sessionId);
		expect(currentSession(profileId)).toBeNull();

		const second = createSession(profileId, "full", "GEN") as any;
		expect((currentSession(profileId) as any).sessionId).toBe(second.sessionId);
	});
});
