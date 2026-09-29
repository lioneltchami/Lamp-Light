/**
 * Quiz IPC: multiplayer question draws, the answer/advance/abandon session
 * loop, and the per-book statistics board.
 */
import { syncDockBadge } from "../reminders.js";
import { awardXp } from "../service/profiles.js";
import { createSession, currentSession, sessionState } from "../service/quiz.js";
import {
	contentDb,
	getActiveProfileId,
	isoDay,
	now,
	userDb,
} from "../state.js";

/** Active profile id, or the same `Error` the handlers have always thrown. */
function requireProfileId(): number {
	const id = getActiveProfileId();
	if (!id) throw new Error("No profile");
	return id;
}

export function multiplayerQuestions(input: any) {
	const bookIds = Array.isArray(input?.bookIds)
		? input.bookIds.map(String)
		: [];
	const count = Math.max(1, Math.min(20, Number(input?.count) || 10));
	if (!bookIds.length) throw new Error("Select at least one Bible book.");
	const placeholders = bookIds.map(() => "?").join(",");
	const rows = contentDb()
		.prepare(
			`SELECT q.id,q.book_id bookId,b.name bookName,q.chapter,q.verse_start verseStart,q.verse_end verseEnd,q.question_text text,q.answer_a answerA,q.answer_b answerB,q.answer_c answerC,q.answer_d answerD,q.correct_index correctIndex FROM questions q JOIN books b ON b.id=q.book_id WHERE q.book_id IN (${placeholders}) ORDER BY RANDOM() LIMIT ?`,
		)
		.all(...bookIds, count) as any[];
	if (rows.length < count)
		throw new Error(
			`Only ${rows.length} questions are available for those books. Choose more books or fewer questions.`,
		);
	// `choices` is what the renderer shuffles; the per-letter answers are blanked
	// so the correct answer is not readable off the wire.
	return rows.map((row) => ({
		...row,
		choices: [row.answerA, row.answerB, row.answerC, row.answerD],
		answerA: undefined,
		answerB: undefined,
		answerC: undefined,
		answerD: undefined,
	}));
}

export function activeSession() {
	const id = getActiveProfileId();
	return id ? currentSession(id) : null;
}

export function startSession(p: any) {
	const profileId = getActiveProfileId();
	if (!profileId) throw new Error("Select a profile first.");
	return createSession(
		profileId,
		p.mode,
		p.bookId,
		p.chapterStart,
		p.chapterEnd,
	);
}

export function answerQuestion(p: any) {
	const profileId = requireProfileId();
	const s: any = userDb()
		.prepare("SELECT * FROM sessions WHERE id=? AND profile_id=?")
		.get(p.sessionId, profileId);
	const state: any = sessionState(s);
	if (state.selectedIndex !== null) return state;
	const raw: any = contentDb()
		.prepare("SELECT correct_index FROM questions WHERE id=?")
		.get(state.current.id);
	const maps = JSON.parse(s.choice_orders);
	const correct = maps[s.current_index].indexOf(raw.correct_index);
	const ok = p.selectedIndex === correct;
	// A daily question may be reopened, but its question XP is awarded only once.
	const priorDaily: any =
		s.mode === "daily"
			? userDb()
					.prepare(
						"SELECT answered_at FROM daily_questions WHERE profile_id=? AND local_date=?",
					)
					.get(profileId, isoDay())
			: null;
	userDb().transaction(() => {
		userDb()
			.prepare("INSERT INTO session_answers VALUES(?,?,?,?,?,?)")
			.run(
				s.id,
				state.current.id,
				p.selectedIndex,
				correct,
				ok ? 1 : 0,
				now(),
			);
		if (!priorDaily?.answered_at) awardXp(profileId, ok ? 2 : 1, "quiz-answer");
		if (s.mode === "daily" && !priorDaily?.answered_at)
			userDb()
				.prepare(
					"UPDATE daily_questions SET selected_choice=?,correct_choice=?,is_correct=?,answered_at=? WHERE profile_id=? AND local_date=?",
				)
				.run(
					p.selectedIndex,
					correct,
					ok ? 1 : 0,
					now(),
					profileId,
					isoDay(),
				);
	})();
	if (s.mode === "daily") syncDockBadge();
	return sessionState(s);
}

export function nextQuestion(id: any) {
	const s: any = userDb().prepare("SELECT * FROM sessions WHERE id=?").get(id);
	const st: any = sessionState(s);
	if (st.selectedIndex === null) throw new Error("Answer before continuing.");
	if (s.current_index + 1 >= st.total) {
		userDb().transaction(() => {
			userDb()
				.prepare("UPDATE sessions SET status='completed',completed_at=? WHERE id=?")
				.run(now(), id);
			if (s.mode === "full") {
				// A full-book run records its score once, keeping the best.
				const pct = st.total ? (st.correct / st.total) * 100 : 0;
				userDb()
					.prepare(
						"INSERT INTO book_stats(profile_id,book_id,attempts,best_percent,last_question_count) VALUES(?,?,1,?,?) ON CONFLICT(profile_id,book_id) DO UPDATE SET attempts=attempts+1,best_percent=MAX(best_percent,excluded.best_percent),last_question_count=excluded.last_question_count",
					)
					.run(s.profile_id, s.book_id, pct, st.total);
			}
		})();
		return {
			...sessionState({ ...s, status: "completed" }),
			completed: true,
		};
	}
	userDb()
		.prepare("UPDATE sessions SET current_index=current_index+1 WHERE id=?")
		.run(id);
	return sessionState(userDb().prepare("SELECT * FROM sessions WHERE id=?").get(id));
}

export function abandonSession(id: any) {
	const profileId = requireProfileId();
	const s: any = userDb()
		.prepare("SELECT * FROM sessions WHERE id=? AND profile_id=?")
		.get(id, profileId);
	if (!s) throw new Error("Session not found");
	if (s.status === "active") {
		userDb()
			.prepare("UPDATE sessions SET status='abandoned',completed_at=? WHERE id=?")
			.run(now(), id);
	}
	return { ok: true as const };
}

export function stats() {
	const profileId = getActiveProfileId();
	if (!profileId) return null;
	const books = (
		userDb()
			.prepare("SELECT * FROM book_stats WHERE profile_id=?")
			.all(profileId) as any[]
	).map((book) => {
		const current = (
			contentDb()
				.prepare("SELECT COUNT(*) count FROM questions WHERE book_id=?")
				.get(book.book_id) as { count: number }
		).count;
		// Pre-`last_question_count` rows have no recorded question count, so
		// fall back to the last completed full-book session.
		const latest: any =
			book.last_question_count === null
				? userDb()
						.prepare(
							"SELECT question_order FROM sessions WHERE profile_id=? AND book_id=? AND mode='full' AND status='completed' ORDER BY completed_at DESC LIMIT 1",
						)
						.get(profileId, book.book_id)
				: null;
		const previous =
			book.last_question_count ??
			(latest ? JSON.parse(latest.question_order).length : null);
		return {
			...book,
			new_questions: previous === null ? 0 : Math.max(0, current - previous),
		};
	});
	const full: any = userDb()
		.prepare(
			"SELECT COUNT(DISTINCT s.id) completed,COUNT(a.question_id) answered,COALESCE(SUM(a.is_correct),0) correct FROM sessions s LEFT JOIN session_answers a ON a.session_id=s.id WHERE s.profile_id=? AND s.mode='full' AND s.status='completed'",
		)
		.get(profileId);
	const daily: any = userDb()
		.prepare(
			"SELECT COUNT(*) answered,COALESCE(SUM(is_correct),0) correct FROM daily_questions WHERE profile_id=? AND answered_at IS NOT NULL",
		)
		.get(profileId);
	return { books, full, daily };
}
