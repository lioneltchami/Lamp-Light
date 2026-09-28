/**
 * Quiz session lifecycle: building a question set, projecting a `sessions` row
 * into the state the renderer renders, and starting a new run.
 *
 * Free of any `electron` import, so the whole session round-trip is covered by
 * `quiz.test.ts` against in-memory databases.
 */
import { fullQuizQuestions, shuffled } from "../domain.js";
import { contentDb, isoDay, now, userDb } from "../state.js";

/**
 * Project a raw `sessions` row into renderer state: the question at the
 * current index (with its answers reshuffled per the session's saved order),
 * the running totals, and whether this question has been answered.
 */
export function sessionState(s: any) {
	const order: string[] = JSON.parse(s.question_order),
		choices: number[][] = JSON.parse(s.choice_orders),
		qid = order[s.current_index];
	const raw: any = qid
		? contentDb()
				.prepare(
					"SELECT q.*,b.name book_name FROM questions q JOIN books b ON b.id=q.book_id WHERE q.id=?",
				)
				.get(qid)
		: null;
	const ans: any = raw
		? userDb()
				.prepare(
					"SELECT * FROM session_answers WHERE session_id=? AND question_id=?",
				)
				.get(s.id, qid)
		: null;
	const totals: any = userDb()
		.prepare(
			"SELECT COUNT(*) answered,COALESCE(SUM(is_correct),0) correct FROM session_answers WHERE session_id=?",
		)
		.get(s.id);
	let current = null,
		correctIndex = null;
	if (raw) {
		const vals = [raw.answer_a, raw.answer_b, raw.answer_c, raw.answer_d],
			map = choices[s.current_index];
		current = {
			id: raw.id,
			bookId: raw.book_id,
			bookName: raw.book_name,
			chapter: raw.chapter,
			verseStart: raw.verse_start,
			verseEnd: raw.verse_end,
			text: raw.question_text,
			choices: map.map((i) => vals[i]),
		};
		correctIndex = map.indexOf(raw.correct_index);
	}
	return {
		sessionId: s.id,
		mode: s.mode,
		bookId: s.book_id,
		title: s.title,
		currentIndex: s.current_index,
		total: order.length,
		answered: totals.answered,
		correct: totals.correct,
		completed: s.status === "completed",
		current,
		selectedIndex: ans?.selected_choice ?? null,
		correctIndex: ans ? correctIndex : null,
		isCorrect: ans ? !!ans.is_correct : null,
	};
}

/** The profile's in-progress session, or `null` if it has none. */
export function currentSession(id: number) {
	const s: any = userDb()
		.prepare(
			"SELECT * FROM sessions WHERE profile_id=? AND status='active' ORDER BY id DESC LIMIT 1",
		)
		.get(id);
	return s ? sessionState(s) : null;
}

/**
 * Start a session. `mode` is `daily` (one question per profile per local day),
 * `full` (every question in the book) or `practice` (a chapter range).
 */
export function createSession(
	profileId: number,
	mode: string,
	bookId: string = "",
	chapterStart: number = 1,
	chapterEnd: number = chapterStart,
) {
	let rows: any[];
	if (mode === "daily") {
		const date = isoDay();
		let d: any = userDb()
			.prepare(
				"SELECT question_id FROM daily_questions WHERE profile_id=? AND local_date=?",
			)
			.get(profileId, date);
		if (!d) {
			const all = contentDb().prepare("SELECT id FROM questions").all() as any[];
			// Deterministic per profile + day, so reopening the app shows the
			// same daily question.
			const picked =
				all[
					Math.abs([...date].reduce((a, c) => a + c.charCodeAt(0), profileId)) %
						all.length
				];
			userDb()
				.prepare(
					"INSERT INTO daily_questions(profile_id,local_date,question_id) VALUES(?,?,?)",
				)
				.run(profileId, date, picked.id);
			d = { question_id: picked.id };
		}
		rows = [{ id: d.question_id }];
	} else {
		rows = contentDb()
			.prepare(
				`SELECT id FROM questions WHERE book_id=? ${mode === "practice" ? "AND chapter BETWEEN ? AND ?" : ""}`,
			)
			.all(
				...(mode === "practice"
					? [bookId, chapterStart, chapterEnd]
					: [bookId]),
			) as any[];
	}
	if (!rows.length)
		throw new Error("No questions are available for this selection yet.");
	const available = rows.map((x) => x.id);
	const ids = fullQuizQuestions(available);
	const maps = ids.map(() => shuffled([0, 1, 2, 3]));
	const name = (
		contentDb()
			.prepare("SELECT name FROM books WHERE id=?")
			.get(bookId) as any
	)?.name;
	const title =
		mode === "daily"
			? "Today's Question"
			: mode === "full"
				? `${name} — Full Quiz`
				: `${name} ${chapterStart === chapterEnd ? "Chapter " + chapterStart : `Chapters ${chapterStart}–${chapterEnd}`}`;
	const info = userDb()
		.prepare(
			"INSERT INTO sessions(profile_id,mode,book_id,chapter_start,chapter_end,title,question_order,choice_orders,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
		)
		.run(
			profileId,
			mode,
			bookId || null,
			chapterStart,
			chapterEnd,
			title,
			JSON.stringify(ids),
			JSON.stringify(maps),
			now(),
		);
	return sessionState(
		userDb()
			.prepare("SELECT * FROM sessions WHERE id=?")
			.get(info.lastInsertRowid),
	);
}
