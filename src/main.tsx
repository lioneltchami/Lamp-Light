import {
	BookOpen,
	Coffee,
	ExternalLink,
	CheckCircle2,
	ChevronLeft,
	ChevronRight,
	FolderOpen,
	Home,
	LogOut,
	Medal as MedalIcon,
	RefreshCw,
	Settings,
	Share2,
	Trophy,
	Users,
	Volume2,
	VolumeX,
	X,
	XCircle,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
	Book,
	Bootstrap,
	Medal,
	Profile,
	QuizState,
	Verse,
} import { EXTERNAL_LINKS } from "../shared/externalLinks";
from "../shared/types";
import logo from "./assets/logo.png";
import Online from "./OnlineLive";
import {
	hasUploadedProfile,
	type OnlineAccount,
	onlineErrorMessage,
	restoreOnlineAccount,
	signOutOnline,
	syncReaderData,
	syncXpLedger,
	uploadInitialProfile,
} from "./onlineService";
import { getPrefs, playQuizSound, setPrefs, type TranslationId } from "./prefs";
import Reader from "./Reader";
import ThemeToggle from "./ThemeToggle";
import {
	applyTheme,
	getThemePreference,
	initTheme,
	type ThemePreference,
} from "./theme";
import { pickTodayVotd } from "./votd";
import "./theme.css";
import "./styles.css";
import "./avatar.css";
import "./session-exit.css";
import "./logo.css";
import "./update-status.css";
import "./theme-toggle.css";

type BibleFocus = {
	bookId: string;
	chapter: number;
	from: number;
	to: number;
};

const api = <T,>(c: string, p?: unknown) => window.lampLight.invoke<T>(c, p);

async function sharePayload(title: string, text: string) {
	const body = text.trim();
	const headline = title.trim() || "Lamp & Light";
	try {
		if (typeof navigator.share === "function") {
			await navigator.share({
				title: headline,
				text: body ? `${headline}\n\n${body}` : headline,
			});
			return;
		}
	} catch (e) {
		if (e instanceof DOMException && e.name === "AbortError") return;
		if (e instanceof Error && e.name === "AbortError") return;
	}
	await api("share:clipboard", { title: headline, text: body });
}

initTheme();
const medal = (p: number): Medal =>
	p >= 100
		? "diamond"
		: p >= 90
			? "gold"
			: p >= 80
				? "silver"
				: p >= 70
					? "bronze"
					: "none";

/** Animal emoji, or custom photo when the profile has one. */
function AvatarFace({
	profile,
	animals,
	className,
}: {
	profile: Pick<Profile, "avatarId" | "customAvatarUrl">;
	animals: Bootstrap["animals"];
	className?: string;
}) {
	if (profile.customAvatarUrl) {
		return (
			<img
				src={profile.customAvatarUrl}
				alt=""
				className={`avatar-photo${className ? ` ${className}` : ""}`}
				draggable={false}
			/>
		);
	}
	return (
		<span className={className} aria-hidden>
			{animals.find((a) => a.id === profile.avatarId)?.emoji ?? "👤"}
		</span>
	);
}
function App() {
	const [boot, setBoot] = useState<Bootstrap | null>(null),
		[page, setPage] = useState("home"),
		[session, setSession] = useState<QuizState | null>(null),
		[quizActive, setQuizActive] = useState(false),
		[passage, setPassage] = useState(false),
		[bibleFocus, setBibleFocus] = useState<BibleFocus | null>(null),
		[studyIntent, setStudyIntent] = useState<"full" | "practice" | null>(null),
		[quizBookIntent, setQuizBookIntent] = useState<string | null>(null),
		[headerCompact, setHeaderCompact] = useState(false),
		[themePref, setThemePref] = useState<ThemePreference>(() =>
			getThemePreference(),
		);
	const navigateRef = useRef<(x: string) => void>(() => undefined);
	const shareVotdRef = useRef<() => void>(() => undefined);
	const setAppearance = (next: ThemePreference) => {
		setThemePref(next);
		applyTheme(next);
	};
	const refresh = () => api<Bootstrap>("bootstrap").then(setBoot);
	useEffect(() => {
		refresh();
		api<QuizState | null>("session:active").then(setSession);
		const f = () => window.lampLight.activity();
		for (const e of ["pointerdown", "keydown", "wheel"])
			window.addEventListener(e, f);
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onSystemTheme = () => {
			if (getThemePreference() === "system") applyTheme("system");
		};
		media.addEventListener("change", onSystemTheme);
		const onScroll = () => {
			const y = window.scrollY;
			setHeaderCompact((compact) => {
				if (!compact && y > 48) return true;
				if (compact && y < 12) return false;
				return compact;
			});
		};
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		const offNav = window.lampLight.onNavigate((next) =>
			navigateRef.current(next),
		);
		const offShare = window.lampLight.onShareVotd(() => shareVotdRef.current());
		return () => {
			for (const e of ["pointerdown", "keydown", "wheel"])
				window.removeEventListener(e, f);
			media.removeEventListener("change", onSystemTheme);
			window.removeEventListener("scroll", onScroll);
			offNav();
			offShare();
		};
	}, []);
	if (!boot) return <div className="loading">Opening Lamp &amp; Light…</div>;
	if (!boot.activeProfile)
		return (
			<ProfileGate
				boot={boot}
				refresh={refresh}
				themePref={themePref}
				setAppearance={setAppearance}
			/>
		);
	const p = boot.activeProfile;
	const level = levelAt(p.xp);
	const nav = [
		["home", "Home", Home],
		["quizzes", "Quizzes", Trophy],
		["bible", "Bible", BookOpen],
		["online", "Online", Users],
		["medals", "Medals", MedalIcon],
	] as const;
	const openQuizzes = (mode: "full" | "practice" = "full") => {
		setStudyIntent(mode);
		setPage("quizzes");
	};
	const openQuizBook = (bookId: string) => {
		setStudyIntent("full");
		setQuizBookIntent(bookId);
		setPage("quizzes");
	};
	const startBookQuiz = (bookId: string) => {
		api<QuizState>("session:start", { mode: "full", bookId })
			.then(beginSession)
			.catch((e) => alert(e instanceof Error ? e.message : String(e)));
	};
	const leaveQuizMessage =
		"Leave this quiz? This attempt will be lost. Medals only update when you finish a full quiz.";
	const beginSession = (next: QuizState) => {
		setSession(next);
		setQuizActive(true);
		setPassage(false);
	};
	const resumeQuiz = () => {
		if (session && !session.completed) setQuizActive(true);
	};
	const clearSessionUi = (target = "home") => {
		setPassage(false);
		setQuizActive(false);
		setSession(null);
		if (target !== "bible") setBibleFocus(null);
		setPage(target);
	};
	const abandonAndGo = async (target = "home") => {
		if (!session || session.completed) {
			clearSessionUi(target);
			return true;
		}
		if (!confirm(leaveQuizMessage)) return false;
		try {
			await api("session:abandon", session.sessionId);
		} catch {
			/* still leave UI even if abandon fails */
		}
		clearSessionUi(target);
		return true;
	};
	const exitSession = async (target = "home") => {
		if (session && !session.completed) {
			await abandonAndGo(target);
			return;
		}
		clearSessionUi(target);
	};
	const quizPlaying = Boolean(quizActive && session && !session.completed);
	const navigate = (x: string) => {
		if (quizPlaying) {
			void abandonAndGo(x);
			return;
		}
		if (quizActive && session?.completed) {
			clearSessionUi(x);
			return;
		}
		if (x !== "bible") setBibleFocus(null);
		else if (page !== "bible") setBibleFocus(null);
		setPage(x);
	};
	navigateRef.current = navigate;
	shareVotdRef.current = () => {
		void (async () => {
			const votd = pickTodayVotd();
			try {
				const verses = await api<Verse[]>("bible:chapter", {
					bookId: votd.bookId,
					chapter: votd.chapter,
					translationId: getPrefs().defaultTranslation,
					savePosition: false,
				});
				const text = verses
					.filter((v) => v.verse >= votd.from && v.verse <= votd.to)
					.map((v) => v.text.trim())
					.filter(Boolean)
					.join(" ");
				await sharePayload(votd.label, text);
			} catch {
				await sharePayload(votd.label, "");
			}
		})();
	};
	const openBible = (focus?: BibleFocus | null) => {
		setBibleFocus(focus ?? null);
		setPage("bible");
	};
	return (
		<div className="shell">
			<header className={`app-header${headerCompact ? " is-compact" : ""}`}>
				<button
					type="button"
					className="brand brand-logo-only"
					onClick={() => navigate("home")}
					aria-label="Lamp & Light home"
					title="Lamp & Light"
				>
					<img
						className="brandmark-img"
						src={logo}
						alt=""
						width={42}
						height={42}
					/>
				</button>
				<nav>
					{nav.map(([id, label, I]) => (
						<button
							type="button"
							className={page === id ? "active" : ""}
							onClick={() => navigate(id)}
							key={id}
							title={label}
						>
							<I size={18} />
							<span className="nav-label">{label}</span>
						</button>
					))}
				</nav>
				<div className="header-end">
					<ThemeToggle compact value={themePref} onChange={setAppearance} />
					<button
						type="button"
						className={`header-icon${page === "settings" ? " active" : ""}`}
						onClick={() => navigate("settings")}
						aria-label="Settings"
						title="Settings"
					>
						<Settings size={18} />
					</button>
					<button
						type="button"
						className={`profile-chip${page === "profile" ? " active" : ""}`}
						onClick={() => navigate("profile")}
						title="Profile"
						aria-label={`Profile, ${p.name}, level ${level.level}, streak ${p.currentStreak}`}
					>
						<span className="profile-chip-avatar" aria-hidden>
							<AvatarFace profile={p} animals={boot.animals} />
						</span>
						<b className="profile-chip-name">{p.name}</b>
						<small className="profile-chip-level">Lv {level.level}</small>
						<span className="profile-chip-streak" aria-hidden>
							<StreakFlame size={15} />
							{p.currentStreak}
						</span>
					</button>
				</div>
			</header>
			<main>
				{quizActive && session && page !== "bible" ? (
					<Quiz
						session={session}
						setSession={setSession}
						passage={passage}
						setPassage={setPassage}
						books={boot.books}
						refresh={refresh}
						exit={() => exitSession()}
					/>
				) : page === "home" ? (
					<Dashboard
						p={p}
						boot={boot}
						session={session}
						setSession={beginSession}
						resumeQuiz={resumeQuiz}
						openBible={openBible}
						openQuizzes={openQuizzes}
					/>
				) : page === "quizzes" ? (
					<Chooser
						boot={boot}
						setSession={beginSession}
						studyIntent={studyIntent}
						clearStudyIntent={() => setStudyIntent(null)}
						quizBookIntent={quizBookIntent}
						clearQuizBookIntent={() => setQuizBookIntent(null)}
					/>
				) : page === "bible" ? (
					<Reader
						key={
							bibleFocus
								? `${bibleFocus.bookId}-${bibleFocus.chapter}-${bibleFocus.from}-${bibleFocus.to}`
								: "resume"
						}
						books={boot.books}
						initial={bibleFocus ?? undefined}
					/>
				) : page === "online" ? (
					<Online profile={p} books={boot.books} />
				) : page === "medals" ? (
					<Medals
						books={boot.books}
						startBookQuiz={startBookQuiz}
						openQuizBook={openQuizBook}
						openQuizzes={() => openQuizzes("full")}
					/>
				) : page === "settings" ? (
					<SettingsPage
						boot={boot}
						themePref={themePref}
						setAppearance={setAppearance}
						refreshBoot={async () => {
							await refresh();
						}}
						onOpenOnline={() => setPage("online")}
						onProfileSwitched={async () => {
							await refresh();
							setPassage(false);
							setQuizActive(false);
							setSession(await api<QuizState | null>("session:active"));
							setPage("home");
						}}
					/>
				) : (
					<Profile
						p={p}
						boot={boot}
						refresh={refresh}
						onOpenSettings={() => navigate("settings")}
					/>
				)}
			</main>
		</div>
	);
}
function ProfileGate({
	boot,
	refresh,
	themePref,
	setAppearance,
}: {
	boot: Bootstrap;
	refresh: () => void;
	themePref: ThemePreference;
	setAppearance: (next: ThemePreference) => void;
}) {
	const [name, setName] = useState(""),
		[avatar, setAvatar] = useState("lamb");
	type UpdateStatus = {
		state: "checking" | "up-to-date" | "available" | "downloaded" | "error";
		version?: string;
	};
	const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
		state: "checking",
	});
	useEffect(() => {
		const started = Date.now();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const show = (value: UpdateStatus) => {
			const delay =
				value.state === "up-to-date"
					? Math.max(0, 3000 - (Date.now() - started))
					: 0;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => setUpdateStatus(value), delay);
		};
		const off = window.lampLight.onUpdateStatus((value) =>
			show(value as UpdateStatus),
		);
		void api<UpdateStatus>("update:status").then(show);
		void api<UpdateStatus>("update:check").then(show);
		return () => {
			off();
			if (timer) clearTimeout(timer);
		};
	}, []);
	const updateLabel =
		updateStatus.state === "checking"
			? "Checking for the latest update…"
			: updateStatus.state === "up-to-date"
				? "Up to date"
				: updateStatus.state === "available"
					? `Downloading update ${updateStatus.version ?? ""}…`
					: updateStatus.state === "downloaded"
						? `Update ${updateStatus.version ?? ""} ready`
						: "Update check unavailable";
	return (
		<div className="gate">
			<div className="gate-card">
				<img
					className="brandmark-img big"
					src={logo}
					alt=""
					width={88}
					height={88}
				/>
				<h1>Welcome to Lamp &amp; Light</h1>
				<p>A quiet place to read, learn, and remember.</p>
				<ThemeToggle
					className="gate-theme"
					value={themePref}
					onChange={setAppearance}
				/>
				<div
					className={`update-status ${updateStatus.state}`}
					role="status"
					aria-live="polite"
				>
					{updateStatus.state === "checking" && (
						<span className="update-spinner" aria-hidden="true" />
					)}
					{updateLabel}
				</div>
				{boot.profiles.length > 0 && (
					<div className="profiles">
						{boot.profiles.map((p) => (
							<button
								onClick={() => api("profile:select", p.id).then(refresh)}
								key={p.id}
							>
								<span className="gate-profile-face" aria-hidden>
									<AvatarFace profile={p} animals={boot.animals} />
								</span>{" "}
								{p.name}
							</button>
						))}
					</div>
				)}
				<hr />
				<h3>Create a local profile</h3>
				<input
					placeholder="Your name"
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
				<div className="animals">
					{boot.animals
						.filter((a) => a.unlockLevel === 1)
						.map((a) => (
							<button
								title={a.name}
								className={avatar === a.id ? "chosen" : ""}
								onClick={() => setAvatar(a.id)}
								key={a.id}
							>
								{a.emoji}
							</button>
						))}
				</div>
				<button
					className="primary"
					disabled={!name.trim()}
					onClick={() =>
						api("profile:create", { name, avatarId: avatar }).then(refresh)
					}
				>
					Begin
				</button>
				<small>Stored only on this computer</small>
			</div>
		</div>
	);
}
function Dashboard({
	p,
	boot,
	session,
	setSession,
	resumeQuiz,
	openBible,
	openQuizzes,
}: {
	p: Profile;
	boot: Bootstrap;
	session: QuizState | null;
	setSession: (s: QuizState) => void;
	resumeQuiz: () => void;
	openBible: (focus?: BibleFocus | null) => void;
	openQuizzes: (mode?: "full" | "practice") => void;
}) {
	const l = levelAt(p.xp);
	const hasContinue = Boolean(session && !session.completed);
	const votd = pickTodayVotd();
	const [votdText, setVotdText] = useState<string | null>(null);
	const [votdStatus, setVotdStatus] = useState<"loading" | "ready" | "empty">(
		"loading",
	);
	useEffect(() => {
		let cancelled = false;
		setVotdStatus("loading");
		api<Verse[]>("bible:chapter", {
			bookId: votd.bookId,
			chapter: votd.chapter,
			translationId: getPrefs().defaultTranslation,
			savePosition: false,
		})
			.then((verses) => {
				if (cancelled) return;
				const slice = verses.filter(
					(v) => v.verse >= votd.from && v.verse <= votd.to,
				);
				const text = slice
					.map((v) => v.text.trim())
					.filter(Boolean)
					.join(" ");
				if (!text) {
					setVotdText(null);
					setVotdStatus("empty");
					return;
				}
				setVotdText(text);
				setVotdStatus("ready");
			})
			.catch(() => {
				if (cancelled) return;
				setVotdText(null);
				setVotdStatus("empty");
			});
		return () => {
			cancelled = true;
		};
	}, [votd.bookId, votd.chapter, votd.from, votd.to]);
	return (
		<>
			<section className="hero hero-compact">
				<div className="hero-copy">
					<span className="eyebrow">WELCOME BACK, {p.name.toUpperCase()}</span>
					<p className="hero-line">
						Pick up where you left off, or answer today’s question.
					</p>
				</div>
				<div className="level-chip" aria-label={`Level ${l.level}`}>
					<span className="level-chip-face" aria-hidden>
						<AvatarFace profile={p} animals={boot.animals} />
					</span>
					<b>Level {l.level}</b>
				</div>
			</section>
			<section className="dashboard">
				<div className="dashboard-body">
					<div className="dashboard-main">
						{hasContinue && session && (
							<div className="continue card continue-primary">
								<span className="eyebrow">CONTINUE WHERE YOU LEFT OFF</span>
								<h2>{session.title}</h2>
								<p>
									{session.answered} of {session.total} answered
								</p>
								<button className="primary" onClick={resumeQuiz}>
									Continue
								</button>
							</div>
						)}
						<div className="daily card">
							<span className="eyebrow">TODAY'S DAILY QUESTION</span>
							<h2>A moment to reflect</h2>
							<p>
								One question for today. The passage opens after you commit your
								answer.
							</p>
							<button
								className={hasContinue ? "secondary" : "primary"}
								onClick={() =>
									api<QuizState>("session:start", { mode: "daily" }).then(
										setSession,
									)
								}
							>
								Answer today’s question
							</button>
						</div>
						<div className="home-stats card">
							<div className="home-stat">
								<StreakFlame size={18} />
								<strong>{p.currentStreak}</strong>
								<span>day streak</span>
								<small>Longest {p.longestStreak}</small>
							</div>
							<div className="home-stat">
								<strong>
									{Math.floor(l.into)} / {Math.ceil(l.needed)}
								</strong>
								<span>XP to next level</span>
								<div className="meter">
									<i style={{ width: `${(l.into / l.needed) * 100}%` }} />
								</div>
							</div>
						</div>
						<div className="home-links">
							<button
								type="button"
								className="secondary"
								onClick={() => openQuizzes("full")}
							>
								Quizzes
							</button>
							<button
								type="button"
								className="secondary"
								onClick={() => openQuizzes("practice")}
							>
								Practice
							</button>
							<button
								type="button"
								className="secondary"
								onClick={() => openBible(null)}
							>
								Open Bible
							</button>
						</div>
					</div>
					<aside className="votd card">
						<span className="eyebrow">VERSE OF THE DAY</span>
						<h2>{votd.label}</h2>
						<p
							className={
								votdStatus === "ready" ? "votd-text" : "votd-text is-muted"
							}
						>
							{votdStatus === "loading"
								? "Loading today’s verse…"
								: votdStatus === "ready" && votdText
									? votdText
									: "Verse text isn’t available yet for this translation."}
						</p>
						<button
							type="button"
							className="secondary"
							onClick={() =>
								openBible({
									bookId: votd.bookId,
									chapter: votd.chapter,
									from: votd.from,
									to: votd.to,
								})
							}
						>
							Read in Bible
						</button>
						<button
							type="button"
							className="secondary"
							disabled={votdStatus !== "ready" || !votdText}
							onClick={() => void sharePayload(votd.label, votdText ?? "")}
						>
							<Share2 size={16} /> Share
						</button>
					</aside>
				</div>
			</section>
		</>
	);
}
function Chooser({
	boot,
	setSession,
	studyIntent,
	clearStudyIntent,
	quizBookIntent,
	clearQuizBookIntent,
}: {
	boot: Bootstrap;
	setSession: (x: QuizState) => void;
	studyIntent: "full" | "practice" | null;
	clearStudyIntent: () => void;
	quizBookIntent: string | null;
	clearQuizBookIntent: () => void;
}) {
	const [studyMode, setStudyMode] = useState<"full" | "practice">(() => {
		if (studyIntent) return studyIntent;
		try {
			const saved = localStorage.getItem("quizzes-mode");
			return saved === "practice" ? "practice" : "full";
		} catch {
			return "full";
		}
	});
	const [book, setBook] = useState(boot.books[0]!.id),
		[from, setFrom] = useState(1),
		[to, setTo] = useState(1),
		[testament, setTestament] = useState<"OT" | "NT">(() => {
			try {
				const saved = localStorage.getItem("quizzes-testament");
				return saved === "NT" ? "NT" : "OT";
			} catch {
				return "OT";
			}
		}),
		[stats, setStats] = useState<{
			books: { book_id: string; best_percent?: number; attempts?: number }[];
		} | null>(null);
	const isPractice = studyMode === "practice";
	const filtered = boot.books.filter((x) => x.testament === testament);
	const selectedBook = boot.books.find((x) => x.id === book) ?? filtered[0];
	const chapters = selectedBook?.chapters ?? 1;

	useEffect(() => {
		if (!studyIntent) return;
		setStudyMode(studyIntent);
		try {
			localStorage.setItem("quizzes-mode", studyIntent);
		} catch {
			/* ignore */
		}
		clearStudyIntent();
	}, [studyIntent, clearStudyIntent]);

	useEffect(() => {
		if (!quizBookIntent) return;
		const target = boot.books.find((x) => x.id === quizBookIntent);
		if (target) {
			setStudyMode("full");
			setTestament(target.testament);
			setBook(target.id);
			try {
				localStorage.setItem("quizzes-mode", "full");
				localStorage.setItem("quizzes-testament", target.testament);
			} catch {
				/* ignore */
			}
		}
		clearQuizBookIntent();
	}, [quizBookIntent, boot.books, clearQuizBookIntent]);

	useEffect(() => {
		api<{
			books: { book_id: string; best_percent?: number; attempts?: number }[];
		}>("stats").then(setStats);
	}, []);

	useEffect(() => {
		const list = boot.books.filter((x) => x.testament === testament);
		if (!list.some((x) => x.id === book)) {
			setBook(list[0]?.id ?? boot.books[0]!.id);
		}
	}, [testament, book, boot.books]);

	useEffect(() => {
		if (!selectedBook) return;
		setFrom((f) => Math.min(Math.max(1, f), selectedBook.chapters));
		setTo((t) => Math.min(Math.max(1, t), selectedBook.chapters));
	}, [selectedBook?.id, selectedBook?.chapters]);

	const setMode = (m: "full" | "practice") => {
		setStudyMode(m);
		try {
			localStorage.setItem("quizzes-mode", m);
		} catch {
			/* ignore */
		}
	};

	const start = (bookId = book) => {
		const lo = Math.min(from, to);
		const hi = Math.max(from, to);
		const clampedLo = Math.min(Math.max(1, lo), chapters);
		const clampedHi = Math.min(Math.max(clampedLo, hi), chapters);
		api<QuizState>("session:start", {
			mode: studyMode,
			bookId,
			chapterStart: clampedLo,
			chapterEnd: clampedHi,
		})
			.then(setSession)
			.catch((e) => alert(e.message));
	};

	const bookStat = (id: string) => stats?.books.find((x) => x.book_id === id);
	const selectedStat = selectedBook ? bookStat(selectedBook.id) : undefined;
	const selectedMedal = medal(selectedStat?.best_percent ?? 0);
	const medalLabel = selectedMedal === "none" ? "Not earned" : selectedMedal;

	return (
		<section className="page quiz-chooser">
			<header className="quiz-chooser-head">
				<div className="study-mode-seg" role="tablist" aria-label="Quiz mode">
					{(
						[
							["full", "Book quiz"],
							["practice", "Practice"],
						] as const
					).map(([m, label]) => (
						<button
							type="button"
							role="tab"
							key={m}
							aria-selected={studyMode === m}
							className={studyMode === m ? "is-active" : undefined}
							onClick={() => setMode(m)}
						>
							{label}
						</button>
					))}
				</div>
				<div className="quiz-chooser-title">
					<h1>{isPractice ? "Practice a passage" : "Book quizzes"}</h1>
					<p>
						{isPractice
							? "Pick a book and chapter range. Earns XP, not medals."
							: "Up to 15 questions. Full quizzes earn medals."}
					</p>
				</div>
			</header>
			<div className="quiz-chooser-body">
				<div className="quiz-chooser-list card">
					<div className="testament-seg" role="tablist" aria-label="Testament">
						{(["OT", "NT"] as const).map((t) => (
							<button
								type="button"
								role="tab"
								key={t}
								aria-selected={testament === t}
								className={testament === t ? "is-active" : undefined}
								onClick={() => {
									setTestament(t);
									try {
										localStorage.setItem("quizzes-testament", t);
									} catch {
										/* ignore */
									}
								}}
							>
								{t === "OT" ? "Old Testament" : "New Testament"}
							</button>
						))}
					</div>
					<div className="book-list" role="listbox" aria-label="Books">
						{filtered.map((x) => {
							const s = bookStat(x.id);
							const m = medal(s?.best_percent ?? 0);
							const selected = book === x.id;
							return (
								<div
									role="option"
									aria-selected={selected}
									className={`book-row${selected ? " is-selected" : ""}`}
									key={x.id}
									tabIndex={0}
									onClick={() => {
										setBook(x.id);
										if (isPractice) {
											setFrom(1);
											setTo(1);
										}
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											setBook(x.id);
											if (isPractice) {
												setFrom(1);
												setTo(1);
											}
										}
									}}
								>
									<span className="book-row-name">{x.name}</span>
									<span className="book-row-meta">
										{selected ? (
											<button
												type="button"
												className="book-row-start"
												onClick={(e) => {
													e.stopPropagation();
													setBook(x.id);
													start(x.id);
												}}
											>
												Start
											</button>
										) : isPractice ? (
											<small>{x.chapters} ch</small>
										) : (
											<>
												<span className={`mini-medal ${m}`}>✦</span>
												<small>
													{m === "none" ? "Not earned" : m} · {s?.attempts ?? 0}
												</small>
											</>
										)}
									</span>
								</div>
							);
						})}
					</div>
				</div>
				<aside className="quiz-chooser-focus card">
					<span className="eyebrow">SELECTED BOOK</span>
					<h2>{selectedBook?.name ?? "—"}</h2>
					{isPractice ? (
						<>
							<p className="quiz-focus-meta">XP only · no medals</p>
							<p className="quiz-focus-blurb">
								Up to 15 questions from the chapter range below.
							</p>
							<div className="practice-range">
								<label>
									From
									<input
										type="number"
										min={1}
										max={chapters}
										value={from}
										onChange={(e) => {
											const v = Math.min(
												Math.max(1, +e.target.value || 1),
												chapters,
											);
											setFrom(v);
											if (to < v) setTo(v);
										}}
									/>
								</label>
								<label>
									Through
									<input
										type="number"
										min={1}
										max={chapters}
										value={to}
										onChange={(e) => {
											const v = Math.min(
												Math.max(1, +e.target.value || 1),
												chapters,
											);
											setTo(v);
											if (from > v) setFrom(v);
										}}
									/>
								</label>
							</div>
						</>
					) : (
						<>
							<p className="quiz-focus-meta">
								<span className={`mini-medal ${selectedMedal}`}>✦</span>
								{medalLabel}
								{selectedStat?.best_percent != null && selectedMedal !== "none"
									? ` · best ${Math.round(selectedStat.best_percent)}%`
									: ""}
								{" · "}
								{selectedStat?.attempts ?? 0} attempts
							</p>
							<p className="quiz-focus-blurb">
								{selectedBook?.testament === "NT" ? "New" : "Old"} Testament ·
								up to 15 questions from this book.
							</p>
						</>
					)}
					<button
						type="button"
						className="primary quiz-chooser-start"
						onClick={() => start()}
						disabled={!selectedBook}
					>
						{isPractice ? "Start practice" : "Start quiz"}
					</button>
				</aside>
			</div>
		</section>
	);
}
function Quiz({
	session,
	setSession,
	passage,
	setPassage,
	books,
	refresh,
	exit,
}: {
	session: QuizState;
	setSession: (s: QuizState | null) => void;
	passage: boolean;
	setPassage: (x: boolean) => void;
	books: Book[];
	refresh: () => Promise<void>;
	exit: () => Promise<void>;
}) {
	const [selected, setSelected] = useState<number | null>(
		session.selectedIndex,
	);
	useEffect(
		() => setSelected(session.selectedIndex),
		[session.currentIndex, session.selectedIndex],
	);
	if (session.completed)
		return <Results session={session} close={() => void exit()} />;
	if (passage && session.current)
		return (
			<Reader
				books={books}
				initial={{
					bookId: session.current.bookId,
					chapter: session.current.chapter,
					from: session.current.verseStart,
					to: session.current.verseEnd,
				}}
				back={() => setPassage(false)}
			/>
		);
	const q = session.current!;
	const submit = () =>
		api<QuizState>("session:answer", {
			sessionId: session.sessionId,
			selectedIndex: selected,
		}).then((next) => {
			if (next.isCorrect != null)
				playQuizSound(next.isCorrect ? "correct" : "wrong");
			setSession(next);
		});
	const next = () =>
		api<QuizState>("session:next", session.sessionId).then((x) => {
			setPassage(false);
			setSession(x);
			if (x.completed) void refresh();
		});
	return (
		<section className="quiz">
			<div className="quiz-top">
				<div>
					<span className="eyebrow">{session.mode.toUpperCase()}</span>
					<h2>{session.title}</h2>
				</div>
				<div className="quiz-top-end">
					<span>
						{session.answered} / {session.total}
					</span>
					<button
						type="button"
						className="secondary quiz-leave"
						onClick={() => void exit()}
					>
						Leave quiz
					</button>
				</div>
			</div>
			<div className="meter">
				<i style={{ width: `${(session.answered / session.total) * 100}%` }} />
			</div>
			<article className="question card">
				<span className="reference">Question {session.currentIndex + 1}</span>
				<h1>{q.text}</h1>
				<div className="choices">
					{q.choices.map((c, i) => (
						<button
							disabled={session.selectedIndex !== null}
							className={`${selected === i ? "selected " : ""}${session.selectedIndex !== null ? (i === session.correctIndex ? "correct" : i === session.selectedIndex ? "wrong" : "") : ""}`}
							onClick={() => setSelected(i)}
							key={i}
						>
							<b>{"ABCD"[i]}</b>
							{c}
						</button>
					))}
				</div>
				{session.selectedIndex === null ? (
					<button
						className="primary"
						disabled={selected === null}
						onClick={submit}
					>
						Submit answer
					</button>
				) : (
					<div className={`feedback ${session.isCorrect ? "yes" : "no"}`}>
						<button
							className="feedback-close"
							aria-label="Leave quiz"
							title="Leave quiz"
							onClick={() => void exit()}
						>
							<X size={18} />
						</button>
						{session.isCorrect ? <CheckCircle2 /> : <XCircle />}
						<div>
							<b>{session.isCorrect ? "Correct" : "Not quite"}</b>
							<span>
								The correct answer is {q.choices[session.correctIndex!]}
							</span>
						</div>
						<button className="secondary" onClick={() => setPassage(true)}>
							View passage
						</button>
						<button className="primary" onClick={next}>
							{session.currentIndex + 1 === session.total
								? "See results"
								: "Next question"}
						</button>
					</div>
				)}
			</article>
		</section>
	);
}
function Results({
	session,
	close,
}: {
	session: QuizState;
	close: () => void;
}) {
	const pct = session.total ? (session.correct / session.total) * 100 : 0,
		xp = session.total + session.correct,
		tier = medal(pct),
		isPractice = session.mode === "practice",
		isDaily = session.mode === "daily";
	return (
		<section className="results card">
			<span className="eyebrow">
				{isPractice ? "PRACTICE COMPLETE" : "QUIZ COMPLETE"}
			</span>
			<h1>{session.title}</h1>
			{!isPractice && !isDaily && (
				<div
					className={`medal ${tier}`}
					aria-label={tier === "none" ? "No medal earned" : `${tier} medal`}
				>
					✦
				</div>
			)}
			<h2>
				{session.correct} of {session.total} correct
			</h2>
			<strong>{pct.toFixed(1)}%</strong>
			{!isDaily && <p>+{xp} XP earned</p>}
			{session.mode === "full" && (
				<p className="medal-name">
					{tier === "none"
						? "No medal earned — keep learning!"
						: `${tier.toUpperCase()} MEDAL`}
				</p>
			)}
			{isPractice && <p className="medal-name">Practice complete · no medal</p>}
			<button className="primary" onClick={close}>
				Done
			</button>
		</section>
	);
}
function LegacyReader({
	books,
	initial,
	back,
}: {
	books: Book[];
	initial?: { bookId: string; chapter: number; from: number; to: number };
	back?: () => void;
}) {
	const [bookId, setBook] = useState(initial?.bookId ?? "GEN"),
		[chapter, setChapter] = useState(initial?.chapter ?? 1),
		[verses, setVerses] = useState<Verse[]>([]);
	const book = books.find((b) => b.id === bookId)!;
	const load = () =>
		api<Verse[]>("bible:chapter", { bookId, chapter }).then(setVerses);
	useEffect(() => {
		load();
	}, [bookId, chapter]);
	const move = (d: number) => {
		let c = chapter + d,
			b = book;
		if (c < 1) {
			const prev = books[book.order - 2];
			if (!prev) return;
			b = prev;
			c = prev.chapters;
		} else if (c > b.chapters) {
			const next = books[book.order];
			if (!next) return;
			b = next;
			c = 1;
		}
		setBook(b.id);
		setChapter(c);
	};
	return (
		<section className="reader">
			{back && (
				<button className="back" onClick={back}>
					<ChevronLeft /> Back to quiz
				</button>
			)}
			<div className="reader-head">
				<div>
					<span className="eyebrow">WORLD ENGLISH BIBLE</span>
					<h1>
						{book.name} {chapter}
					</h1>
				</div>
				<div>
					<select
						value={bookId}
						onChange={(e) => {
							setBook(e.target.value);
							setChapter(1);
						}}
					>
						{books.map((b) => (
							<option value={b.id} key={b.id}>
								{b.name}
							</option>
						))}
					</select>
					<select value={chapter} onChange={(e) => setChapter(+e.target.value)}>
						{Array.from({ length: book.chapters }, (_, i) => (
							<option key={i}>{i + 1}</option>
						))}
					</select>
				</div>
			</div>
			{verses.length ? (
				<article className="scripture">
					{verses.map((v) => (
						<p
							className={
								initial && v.verse >= initial.from && v.verse <= initial.to
									? "temporary"
									: ""
							}
							style={
								v.highlightColor
									? { background: `var(--${v.highlightColor})` }
									: undefined
							}
							key={v.verse}
						>
							<sup>{v.verse}</sup>
							{v.text}
							<span className="highlights">
								{["yellow", "green", "blue", "pink", "purple"].map((c) => (
									<button
										aria-label={`Highlight ${c}`}
										style={{ background: `var(--${c})` }}
										onClick={() =>
											api("highlight:set", {
												bookId,
												chapter,
												verse: v.verse,
												color: c,
											}).then(load)
										}
										key={c}
									/>
								))}
								<button
									onClick={() =>
										api("highlight:set", {
											bookId,
											chapter,
											verse: v.verse,
											color: null,
										}).then(load)
									}
								>
									×
								</button>
							</span>
						</p>
					))}
				</article>
			) : (
				<div className="empty card">
					<BookOpen />
					<h3>Text not imported yet</h3>
					<p>
						This clean V1 seed includes sample chapters. Run the WEB importer to
						populate all 66 books without changing user data.
					</p>
				</div>
			)}
			<div className="chapter-nav">
				<button onClick={() => move(-1)}>
					<ChevronLeft /> Previous
				</button>
				<button onClick={() => move(1)}>
					Next <ChevronRight />
				</button>
			</div>
		</section>
	);
}
const SETTINGS_SECTIONS = [
	{ id: "settings-profiles", label: "Profiles" },
	{ id: "settings-preferences", label: "Preferences" },
	{ id: "settings-account", label: "Account" },
	{ id: "settings-system", label: "System" },
	{ id: "settings-support", label: "Support" },
] as const;

function SettingsPage({
	boot,
	themePref,
	setAppearance,
	refreshBoot,
	onOpenOnline,
	onProfileSwitched,
}: {
	boot: Bootstrap;
	themePref: ThemePreference;
	setAppearance: (next: ThemePreference) => void;
	refreshBoot: () => Promise<void>;
	onOpenOnline: () => void;
	onProfileSwitched: () => Promise<void>;
}) {
	type UpdateStatus = {
		state: "checking" | "up-to-date" | "available" | "downloaded" | "error";
		version?: string;
	};

	const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
		state: "up-to-date",
	});
	const [dataPath, setDataPath] = useState("");
	const [busy, setBusy] = useState(false);
	const [flash, setFlash] = useState<{ text: string; ok?: boolean } | null>(
		null,
	);
	const [newName, setNewName] = useState("");
	const [newAvatar, setNewAvatar] = useState("lamb");
	const [showCreate, setShowCreate] = useState(false);
	const [activeSection, setActiveSection] = useState<string>(
		SETTINGS_SECTIONS[0].id,
	);
	const [renameValue, setRenameValue] = useState(
		() => boot.activeProfile?.name ?? "",
	);
	const [prefs, setPrefsState] = useState(() => getPrefs());
	const [reminder, setReminder] = useState<{
		enabled: boolean;
		hour: number;
	}>({ enabled: false, hour: 9 });
	const [onlineAccount, setOnlineAccount] = useState<OnlineAccount | null>(
		null,
	);
	const [syncBusy, setSyncBusy] = useState(false);
	const active = boot.activeProfile;
	const linked =
		Boolean(onlineAccount && active?.onlineUserId) &&
		onlineAccount?.onlineUserId === active?.onlineUserId;

	useEffect(() => {
		setRenameValue(active?.name ?? "");
	}, [active?.id, active?.name]);

	useEffect(() => {
		if (!flash) return;
		const timer = window.setTimeout(() => setFlash(null), 4500);
		return () => window.clearTimeout(timer);
	}, [flash]);

	useEffect(() => {
		void api<{ version: string; userDataPath: string }>("app:info").then(
			(info) => setDataPath(info.userDataPath),
		);
		void api<{ enabled: boolean; hour: number }>("reminder:get").then((prefs) =>
			setReminder({ enabled: prefs.enabled, hour: prefs.hour }),
		);
		const off = window.lampLight.onUpdateStatus((value) =>
			setUpdateStatus(value as UpdateStatus),
		);
		void api<UpdateStatus>("update:status").then(setUpdateStatus);
		void restoreOnlineAccount()
			.then(setOnlineAccount)
			.catch(() => setOnlineAccount(null));
		return off;
	}, []);

	useEffect(() => {
		const nodes = SETTINGS_SECTIONS.map((section) =>
			document.getElementById(section.id),
		).filter((node): node is HTMLElement => Boolean(node));
		if (nodes.length === 0) return;

		const observer = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((entry) => entry.isIntersecting)
					.sort(
						(a, b) =>
							(a.target as HTMLElement).offsetTop -
							(b.target as HTMLElement).offsetTop,
					);
				const top = visible[0]?.target as HTMLElement | undefined;
				if (top?.id) setActiveSection(top.id);
			},
			{ rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.25, 0.5] },
		);
		for (const node of nodes) observer.observe(node);
		return () => observer.disconnect();
	}, []);

	const updateLabel =
		updateStatus.state === "checking"
			? "Checking for updates…"
			: updateStatus.state === "up-to-date"
				? "You're on the latest version"
				: updateStatus.state === "available"
					? `Downloading ${updateStatus.version ?? "update"}…`
					: updateStatus.state === "downloaded"
						? `Update ${updateStatus.version ?? ""} ready — restart when prompted`
						: "Could not check for updates (normal in development)";

	const run = async (fn: () => Promise<void>) => {
		setBusy(true);
		setFlash(null);
		try {
			await fn();
		} catch (error) {
			setFlash({
				text:
					error instanceof Error
						? onlineErrorMessage(error, error.message)
						: String(error),
			});
		} finally {
			setBusy(false);
		}
	};

	const scrollToSection = (id: string) => {
		setActiveSection(id);
		document
			.getElementById(id)
			?.scrollIntoView({ behavior: "smooth", block: "start" });
	};

	const switchTo = async (id: number) => {
		if (id === active?.id) return;
		await run(async () => {
			await api("profile:select", id);
			await onProfileSwitched();
		});
	};

	const createProfile = async () => {
		const name = newName.trim();
		if (!name) return;
		await run(async () => {
			await api("profile:create", { name, avatarId: newAvatar });
			setNewName("");
			setShowCreate(false);
			await onProfileSwitched();
		});
	};

	const renameProfile = async () => {
		const name = renameValue.trim();
		if (!name || name === active?.name) return;
		await run(async () => {
			await api("profile:rename", name);
			await refreshBoot();
			setFlash({ text: "Profile renamed.", ok: true });
		});
	};

	const leaveProfile = async () => {
		if (
			!window.confirm(
				"Leave this profile and return to the welcome screen?\n\nYour XP, quizzes, and notes stay on this computer — you can switch back anytime.",
			)
		)
			return;
		await run(async () => {
			await api("profile:clear-active");
			await onProfileSwitched();
		});
	};

	const signOutAccount = async () => {
		if (
			!window.confirm(
				"Sign out of your online account?\n\nFriends and cloud sync pause until you sign in again. Local progress on this device stays.",
			)
		)
			return;
		await run(async () => {
			await signOutOnline();
			await api("profile:unlink-online");
			setOnlineAccount(null);
			await refreshBoot();
			setFlash({ text: "Signed out of online account.", ok: true });
		});
	};

	const unlinkOnly = async () => {
		if (
			!window.confirm(
				"Unlink this local profile from the online account?\n\nYou stay signed in online. This profile stops sharing sync with that account until you link again from Online.",
			)
		)
			return;
		await run(async () => {
			await api("profile:unlink-online");
			await refreshBoot();
			setFlash({
				text: "Local profile unlinked from online account.",
				ok: true,
			});
		});
	};

	const syncOnlineNow = async () => {
		if (!onlineAccount) return;
		setSyncBusy(true);
		setFlash(null);
		try {
			const id = onlineAccount.onlineUserId;
			if (!(await hasUploadedProfile(id))) await uploadInitialProfile(id);
			await syncXpLedger(id);
			await syncReaderData(id);
			setFlash({ text: "Online sync complete.", ok: true });
		} catch (error) {
			setFlash({
				text:
					error instanceof Error
						? onlineErrorMessage(error, error.message)
						: String(error),
			});
		} finally {
			setSyncBusy(false);
		}
	};

	const exportBackup = async () => {
		await run(async () => {
			const result = await api<{
				canceled: boolean;
				path?: string;
				files?: string[];
			}>("app:export-backup");
			if (result.canceled) return;
			setFlash({ text: `Backup saved to ${result.path}`, ok: true });
		});
	};

	const patchPrefs = (patch: Partial<typeof prefs>) => {
		setPrefsState(setPrefs(patch));
	};

	return (
		<section className="page settings-page">
			<header className="settings-head">
				<span className="eyebrow">PREFERENCES</span>
				<h1>Settings</h1>
				<p>
					Profiles, preferences, online account, and local data on this device.
				</p>
			</header>

			<div className="settings-sticky">
				{flash && (
					<div
						className={`settings-toast ${flash.ok ? "ok" : "err"}`}
						role="status"
					>
						<span>{flash.text}</span>
						<button
							type="button"
							className="settings-toast-dismiss"
							aria-label="Dismiss"
							onClick={() => setFlash(null)}
						>
							<X size={14} />
						</button>
					</div>
				)}

				<nav className="settings-rail" aria-label="Settings sections">
					{SETTINGS_SECTIONS.map((section) => (
						<button
							key={section.id}
							type="button"
							className={activeSection === section.id ? "active" : ""}
							aria-current={activeSection === section.id ? "true" : undefined}
							onClick={() => scrollToSection(section.id)}
						>
							{section.label}
						</button>
					))}
				</nav>
			</div>

			<div id="settings-profiles" className="card settings-block">
				<h2>Profiles</h2>
				<p className="settings-copy">
					Each profile keeps its own XP, streaks, quizzes, and Bible notes on
					this computer. Switch anytime — progress stays with that profile.
				</p>

				{active && (
					<div className="settings-profile-current-card">
						<div className="settings-profile-current-top">
							<span className="settings-profile-emoji" aria-hidden>
								<AvatarFace profile={active} animals={boot.animals} />
							</span>
							<span className="settings-profile-meta">
								<b>{active.name}</b>
								<small>Level {levelAt(active.xp).level}</small>
							</span>
							<span className="settings-profile-current">Current</span>
						</div>
						<div className="settings-rename">
							<h3>Rename</h3>
							<div className="settings-row">
								<input
									value={renameValue}
									maxLength={40}
									aria-label="Profile name"
									onChange={(e) => setRenameValue(e.target.value)}
								/>
								<button
									className="secondary"
									disabled={
										busy ||
										!renameValue.trim() ||
										renameValue.trim() === active.name
									}
									onClick={() => void renameProfile()}
								>
									Save
								</button>
							</div>
						</div>
						<div className="settings-row settings-danger-row">
							<button
								className="danger"
								disabled={busy}
								onClick={() => void leaveProfile()}
							>
								<LogOut size={16} /> Leave profile
							</button>
							<span className="settings-status">
								Returns to welcome — data stays on this device
							</span>
						</div>
					</div>
				)}

				{boot.profiles.some((p) => p.id !== active?.id) && (
					<>
						<p className="settings-others-label">Switch profile</p>
						<div className="settings-profiles">
							{boot.profiles
								.filter((profile) => profile.id !== active?.id)
								.map((profile) => (
									<button
										key={profile.id}
										type="button"
										className="settings-profile-row"
										disabled={busy}
										onClick={() => void switchTo(profile.id)}
									>
										<span className="settings-profile-emoji" aria-hidden>
											<AvatarFace profile={profile} animals={boot.animals} />
										</span>
										<span className="settings-profile-meta">
											<b>{profile.name}</b>
											<small>Level {levelAt(profile.xp).level}</small>
										</span>
										<span className="settings-profile-switch">Switch</span>
									</button>
								))}
						</div>
					</>
				)}

				{!showCreate ? (
					<button
						type="button"
						className="secondary settings-add-profile"
						disabled={busy}
						onClick={() => setShowCreate(true)}
					>
						Add profile
					</button>
				) : (
					<div className="settings-create">
						<div className="settings-create-head">
							<h3>New profile</h3>
							<button
								type="button"
								className="secondary"
								disabled={busy}
								onClick={() => {
									setShowCreate(false);
									setNewName("");
								}}
							>
								Cancel
							</button>
						</div>
						<input
							placeholder="Name"
							value={newName}
							maxLength={40}
							onChange={(e) => setNewName(e.target.value)}
						/>
						<div className="animals">
							{boot.animals
								.filter((a) => a.unlockLevel === 1)
								.map((a) => (
									<button
										type="button"
										title={a.name}
										className={newAvatar === a.id ? "chosen" : ""}
										onClick={() => setNewAvatar(a.id)}
										key={a.id}
									>
										{a.emoji}
									</button>
								))}
						</div>
						<button
							className="primary"
							disabled={busy || !newName.trim()}
							onClick={() => void createProfile()}
						>
							Create profile
						</button>
					</div>
				)}
			</div>

			<div id="settings-preferences" className="card settings-block">
				<h2>Preferences</h2>
				<p className="settings-copy">
					Defaults for the Bible reader, quiz feedback, and appearance on this
					device.
				</p>
				<div className="settings-pref-list">
					<label className="settings-pref-row">
						<span className="settings-pref-label">
							<strong>Default translation</strong>
							<small>Opens in the Bible reader</small>
						</span>
						<select
							value={prefs.defaultTranslation}
							onChange={(e) =>
								patchPrefs({
									defaultTranslation: e.target.value as TranslationId,
								})
							}
						>
							<option value="BSB">BSB — Berean Standard Bible</option>
							<option value="WEB">WEB — World English Bible</option>
							<option value="KJV">KJV — King James Version</option>
						</select>
					</label>
					<div className="settings-pref-row">
						<span className="settings-pref-label">
							<strong>Quiz sounds</strong>
							<small>Correct and incorrect answer feedback</small>
						</span>
						<button
							type="button"
							className={`secondary settings-sound ${prefs.quizSound ? "on" : ""}`}
							onClick={() => {
								const next = !prefs.quizSound;
								patchPrefs({ quizSound: next });
								if (next) playQuizSound("correct");
							}}
						>
							{prefs.quizSound ? <Volume2 size={16} /> : <VolumeX size={16} />}
							{prefs.quizSound ? "On" : "Off"}
						</button>
					</div>
					<div className="settings-pref-row">
						<span className="settings-pref-label">
							<strong>Appearance</strong>
							<small>Also available from the header</small>
						</span>
						<ThemeToggle value={themePref} onChange={setAppearance} />
					</div>
					<div className="settings-pref-row">
						<span className="settings-pref-label">
							<strong>Daily reminder</strong>
							<small>
								macOS notification when today’s question is still open. Fires
								while the app is running (or at next launch).
							</small>
						</span>
						<button
							type="button"
							className={`secondary settings-sound ${reminder.enabled ? "on" : ""}`}
							onClick={() => {
								const enabled = !reminder.enabled;
								void api<{ enabled: boolean; hour: number }>("reminder:set", {
									enabled,
									hour: reminder.hour,
								}).then((next) =>
									setReminder({ enabled: next.enabled, hour: next.hour }),
								);
							}}
						>
							{reminder.enabled ? "On" : "Off"}
						</button>
					</div>
					{reminder.enabled && (
						<label className="settings-pref-row">
							<span className="settings-pref-label">
								<strong>Remind after</strong>
								<small>Local time on this Mac</small>
							</span>
							<select
								value={reminder.hour}
								onChange={(e) => {
									const hour = Number(e.target.value);
									void api<{ enabled: boolean; hour: number }>("reminder:set", {
										enabled: true,
										hour,
									}).then((next) =>
										setReminder({ enabled: next.enabled, hour: next.hour }),
									);
								}}
							>
								{Array.from({ length: 24 }, (_, hour) => (
									<option value={hour} key={hour}>
										{String(hour).padStart(2, "0")}:00
									</option>
								))}
							</select>
						</label>
					)}
				</div>
			</div>

			<div id="settings-account" className="card settings-block">
				<h2>Online account</h2>
				<p className="settings-copy">
					Optional cloud sign-in for friends and sync. Local progress never
					depends on being signed in.
				</p>
				{onlineAccount ? (
					<>
						<div className="settings-account-status">
							<div className="settings-account-who">
								<strong>{onlineAccount.username}</strong>
								<small>{onlineAccount.email}</small>
							</div>
							<span
								className={`settings-link-chip ${linked ? "linked" : "unlinked"}`}
							>
								{linked
									? "Linked to this profile"
									: "Not linked to this profile"}
							</span>
						</div>
						{onlineAccount.friendCode &&
							onlineAccount.friendCode !== "Pending" && (
								<p className="settings-status">
									Friend code <strong>{onlineAccount.friendCode}</strong>
								</p>
							)}
						<div className="settings-row">
							<button
								className="secondary"
								disabled={busy || syncBusy}
								onClick={() => void syncOnlineNow()}
							>
								<RefreshCw size={16} />
								{syncBusy ? "Syncing…" : "Sync now"}
							</button>
							<button
								type="button"
								className="secondary"
								onClick={onOpenOnline}
							>
								Manage on Online
							</button>
						</div>
						<div className="settings-row settings-danger-row">
							<button
								className="danger"
								disabled={busy || syncBusy}
								onClick={() => void signOutAccount()}
							>
								Sign out
							</button>
							{linked && (
								<button
									className="danger"
									disabled={busy || syncBusy}
									onClick={() => void unlinkOnly()}
								>
									Unlink profile
								</button>
							)}
						</div>
					</>
				) : (
					<div className="settings-row">
						<button type="button" className="primary" onClick={onOpenOnline}>
							Open Online
						</button>
						<span className="settings-status">
							Create an account or sign in from the Online page
						</span>
					</div>
				)}
			</div>

			<div id="settings-system" className="card settings-block">
				<h2>System</h2>
				<p className="settings-copy">
					Updates and where your local data lives on this device.
				</p>

				<div className="settings-subblock">
					<h3>Updates</h3>
					<p className="settings-copy">
						Installed builds check GitHub Releases automatically.
					</p>
					<div className="settings-row">
						<button
							className="secondary"
							disabled={busy}
							onClick={() =>
								void run(async () => {
									const status = await api<UpdateStatus>("update:check");
									setUpdateStatus(status);
								})
							}
						>
							<RefreshCw size={16} /> Check for updates
						</button>
						<span className="settings-status">{updateLabel}</span>
					</div>
				</div>

				<div className="settings-subblock">
					<h3>Local data</h3>
					<p className="settings-copy">
						Profiles, XP, quizzes, highlights, and notes live in a private
						folder outside the app install — safe across updates.
					</p>
					<code className="settings-path">{dataPath || "Loading…"}</code>
					<div className="settings-row">
						<button
							className="secondary"
							onClick={() =>
								void run(async () => {
									await api("app:reveal-data");
								})
							}
						>
							<FolderOpen size={16} /> Open data folder
						</button>
						<button
							className="secondary"
							disabled={busy}
							onClick={() => void exportBackup()}
						>
							Export backup
						</button>
					</div>
				</div>
			</div>


			<div id="settings-support" className="card settings-block">
				<h2>Support</h2>
				<p className="settings-copy">
					Lamp &amp; Light is free. A coffee helps keep this desk and related
					work going. Opens in your browser.
				</p>

				<div className="settings-subblock">
					<h3>Donate</h3>
					<div className="settings-row">
						<button
							className="secondary"
							type="button"
							onClick={() =>
								void run(async () => {
									await api("app:open-external", EXTERNAL_LINKS.coffee);
								})
							}
						>
							<Coffee size={16} /> Buy a coffee
						</button>
						<button
							className="secondary"
							type="button"
							onClick={() =>
								void run(async () => {
									await api("app:open-external", EXTERNAL_LINKS.supportMore);
								})
							}
						>
							<ExternalLink size={16} /> More ways to support
						</button>
					</div>
				</div>

				<div className="settings-subblock">
					<h3>Also from this desk</h3>
					<p className="settings-copy">
						Apologia Library — Christian apologetics articles and tools. Source
						library for the Apologia Defense app.
					</p>
					<div className="settings-row">
						<button
							className="secondary"
							type="button"
							onClick={() =>
								void run(async () => {
									await api(
										"app:open-external",
										EXTERNAL_LINKS.apologiaLibrary,
									);
								})
							}
						>
							<ExternalLink size={16} /> Open Apologia Library
						</button>
						<button
							className="secondary"
							type="button"
							onClick={() =>
								void run(async () => {
									await api("app:open-external", EXTERNAL_LINKS.site);
								})
							}
						>
							<ExternalLink size={16} /> Lamp &amp; Light website
						</button>
					</div>
				</div>
			</div>

			<p className="settings-meta">
				{boot.bankVersion ? ` · question bank ${boot.bankVersion}` : ""}
			</p>
		</section>
	);
}

function Medals({
	books,
	startBookQuiz,
	openQuizBook,
	openQuizzes,
}: {
	books: Book[];
	startBookQuiz: (bookId: string) => void;
	openQuizBook: (bookId: string) => void;
	openQuizzes: () => void;
}) {
	type StatusFilter = "all" | "earned" | "progress" | "none";
	type SortKey = "name" | "best" | "attempts" | "tier";
	type BookStatRow = {
		book_id: string;
		attempts?: number;
		best_percent?: number;
		new_questions?: number;
	};
	type StatsPayload = { books: BookStatRow[] };

	const TIER_LEGEND = [
		["diamond", "Diamond", "100%"],
		["gold", "Gold", "90%+"],
		["silver", "Silver", "80%+"],
		["bronze", "Bronze", "70%+"],
	] as const;

	const [stats, setStats] = useState<StatsPayload | null>(null);
	const [testament, setTestament] = useState<"OT" | "NT">(() => {
		try {
			const saved = localStorage.getItem("medals-testament");
			return saved === "NT" ? "NT" : "OT";
		} catch {
			return "OT";
		}
	});
	const [status, setStatus] = useState<StatusFilter>(() => {
		try {
			const saved = localStorage.getItem("medals-status");
			if (
				saved === "earned" ||
				saved === "progress" ||
				saved === "none" ||
				saved === "all"
			)
				return saved;
		} catch {
			/* ignore */
		}
		return "all";
	});
	const [sort, setSort] = useState<SortKey>(() => {
		try {
			const saved = localStorage.getItem("medals-sort");
			if (
				saved === "best" ||
				saved === "attempts" ||
				saved === "tier" ||
				saved === "name"
			)
				return saved;
		} catch {
			/* ignore */
		}
		return "tier";
	});

	useEffect(() => {
		api<StatsPayload>("stats")
			.then(setStats)
			.catch(() => setStats({ books: [] }));
	}, []);

	const tierRank: Record<Medal, number> = {
		none: 0,
		bronze: 1,
		silver: 2,
		gold: 3,
		diamond: 4,
	};

	const persist = (key: string, value: string) => {
		try {
			localStorage.setItem(key, value);
		} catch {
			/* ignore */
		}
	};

	const testamentBooks = books.filter((b) => b.testament === testament);
	const rows = testamentBooks.map((b) => {
		const s = stats?.books.find((x) => x.book_id === b.id);
		const best = s?.best_percent ?? 0;
		const attempts = s?.attempts ?? 0;
		const newQuestions = s?.new_questions ?? 0;
		const tier = medal(best);
		const bucket: StatusFilter =
			tier !== "none" ? "earned" : attempts > 0 ? "progress" : "none";
		return { book: b, best, attempts, newQuestions, tier, bucket };
	});

	const summary = {
		total: rows.length,
		earned: rows.filter((r) => r.bucket === "earned").length,
		progress: rows.filter((r) => r.bucket === "progress").length,
		none: rows.filter((r) => r.bucket === "none").length,
		bronze: rows.filter((r) => r.tier === "bronze").length,
		silver: rows.filter((r) => r.tier === "silver").length,
		gold: rows.filter((r) => r.tier === "gold").length,
		diamond: rows.filter((r) => r.tier === "diamond").length,
	};
	const masteryPct = summary.total
		? Math.round((summary.earned / summary.total) * 100)
		: 0;

	const visible = rows
		.filter((r) => (status === "all" ? true : r.bucket === status))
		.sort((a, b) => {
			if (sort === "best")
				return b.best - a.best || a.book.name.localeCompare(b.book.name);
			if (sort === "attempts")
				return (
					b.attempts - a.attempts || a.book.name.localeCompare(b.book.name)
				);
			if (sort === "tier")
				return (
					tierRank[b.tier] - tierRank[a.tier] ||
					b.best - a.best ||
					a.book.name.localeCompare(b.book.name)
				);
			return a.book.name.localeCompare(b.book.name);
		});

	const statusLabel = (s: StatusFilter) =>
		s === "all"
			? "All"
			: s === "earned"
				? "Earned"
				: s === "progress"
					? "In progress"
					: "Not started";

	const noMedalsYet = summary.earned === 0;
	const neverTried = noMedalsYet && summary.progress === 0;
	const firstOpen = rows.find((r) => r.bucket === "none")?.book.id;

	return (
		<section className="page medals-page">
			<header className="medals-head">
				<span className="eyebrow">BOOK MASTERY</span>
				<h1>Your medals</h1>
				<p>
					Earn medals by finishing full book quizzes. Practice does not count.
				</p>
				<ul className="medals-legend" aria-label="Medal thresholds">
					{TIER_LEGEND.map(([tier, label, threshold]) => (
						<li key={tier} className={tier}>
							<span className={`mini-medal ${tier}`} aria-hidden>
								✦
							</span>
							<span>
								{label} <small>{threshold}</small>
							</span>
						</li>
					))}
				</ul>
			</header>

			<div className="medals-summary card">
				<div className="medals-summary-main">
					<strong>{masteryPct}%</strong>
					<span>
						{summary.earned} of {summary.total}{" "}
						{testament === "OT" ? "Old" : "New"} Testament books medaled
					</span>
				</div>
				<div className="medals-tallies" aria-label="Medal counts">
					{TIER_LEGEND.map(([tier]) => (
						<span key={tier} className={`medals-tally ${tier}`}>
							<span className={`mini-medal ${tier}`}>✦</span>
							{summary[tier]}
						</span>
					))}
					<span className="medals-tally muted">{summary.progress} trying</span>
					<span className="medals-tally muted">{summary.none} open</span>
				</div>
			</div>

			{stats && noMedalsYet && (
				<div className={`medals-empty card${neverTried ? " is-hero" : ""}`}>
					<span className="eyebrow">GET STARTED</span>
					<h2>
						{neverTried ? "No medals yet" : "Keep going — no medal earned yet"}
					</h2>
					<p>
						{neverTried
							? "Finish a full book quiz at 70% or higher to earn Bronze. Higher scores unlock Silver, Gold, and Diamond."
							: "You’ve started some books. Hit 70% on a finished full quiz to claim your first medal."}
					</p>
					<div className="medals-empty-actions">
						<button
							type="button"
							className="primary"
							onClick={() =>
								firstOpen ? startBookQuiz(firstOpen) : openQuizzes()
							}
						>
							{firstOpen ? "Start a book quiz" : "Open Quizzes"}
						</button>
						<button type="button" className="secondary" onClick={openQuizzes}>
							Browse Quizzes
						</button>
					</div>
				</div>
			)}

			<div className="medals-toolbar">
				<div className="testament-seg" role="tablist" aria-label="Testament">
					{(["OT", "NT"] as const).map((t) => (
						<button
							type="button"
							role="tab"
							key={t}
							aria-selected={testament === t}
							className={testament === t ? "is-active" : undefined}
							onClick={() => {
								setTestament(t);
								persist("medals-testament", t);
							}}
						>
							{t === "OT" ? "Old Testament" : "New Testament"}
						</button>
					))}
				</div>
				<div className="medals-filters" role="tablist" aria-label="Status">
					{(["all", "earned", "progress", "none"] as const).map((s) => (
						<button
							type="button"
							role="tab"
							key={s}
							aria-selected={status === s}
							className={status === s ? "is-active" : undefined}
							onClick={() => {
								setStatus(s);
								persist("medals-status", s);
							}}
						>
							{statusLabel(s)}
							<small>
								{s === "all"
									? summary.total
									: s === "earned"
										? summary.earned
										: s === "progress"
											? summary.progress
											: summary.none}
							</small>
						</button>
					))}
				</div>
				<label className="medals-sort">
					Sort
					<select
						value={sort}
						onChange={(e) => {
							const next = e.target.value as SortKey;
							setSort(next);
							persist("medals-sort", next);
						}}
					>
						<option value="tier">Highest medal</option>
						<option value="best">Best score</option>
						<option value="attempts">Most attempts</option>
						<option value="name">A–Z</option>
					</select>
				</label>
			</div>

			{!stats ? (
				<p className="medals-loading">Loading medals…</p>
			) : visible.length === 0 ? (
				<div className="medals-empty card">
					<h2>No books here</h2>
					<p>
						Nothing matches {statusLabel(status).toLowerCase()} in the{" "}
						{testament === "OT" ? "Old" : "New"} Testament. Try All or another
						filter.
					</p>
					<button
						type="button"
						className="secondary"
						onClick={() => {
							setStatus("all");
							persist("medals-status", "all");
						}}
					>
						Show all books
					</button>
				</div>
			) : (
				<div className="medal-list" role="list">
					{visible.map((r) => (
						<div
							className={`medal-row${r.tier !== "none" ? " has-medal" : ""}`}
							role="listitem"
							key={r.book.id}
						>
							<span
								className={`mini-medal ${r.tier}`}
								aria-label={r.tier === "none" ? "No medal" : `${r.tier} medal`}
							>
								✦
							</span>
							<div className="medal-row-text">
								<div className="medal-row-title">
									<span className="medal-row-name">{r.book.name}</span>
									{r.newQuestions > 0 && (
										<span
											className="medal-new"
											title="Question bank grew since your last full quiz"
										>
											{r.newQuestions} new
										</span>
									)}
								</div>
								<small>
									{r.tier === "none"
										? r.attempts > 0
											? "In progress"
											: "Not started"
										: r.tier}
									{r.best > 0 ? ` · best ${Math.round(r.best)}%` : ""}
									{" · "}
									{r.attempts} attempt{r.attempts === 1 ? "" : "s"}
								</small>
							</div>
							<div className="medal-row-actions">
								{r.bucket === "none" && (
									<button
										type="button"
										className="secondary"
										onClick={() => openQuizBook(r.book.id)}
									>
										Browse
									</button>
								)}
								<button
									type="button"
									className="primary medal-row-start"
									onClick={() => startBookQuiz(r.book.id)}
								>
									{r.bucket === "none"
										? "Start"
										: r.bucket === "progress"
											? "Continue"
											: "Retake"}
								</button>
							</div>
						</div>
					))}
				</div>
			)}
		</section>
	);
}
function Profile({
	p,
	boot,
	refresh,
	onOpenSettings,
}: {
	p: Profile;
	boot: Bootstrap;
	refresh: () => Promise<void>;
	onOpenSettings: () => void;
}) {
	type ProfileStats = {
		full: { completed: number; answered: number; correct: number };
		daily: { answered: number; correct: number };
	};
	const [stats, setStats] = useState<ProfileStats | null>(null);
	const [flash, setFlash] = useState<{ text: string; ok?: boolean } | null>(
		null,
	);
	useEffect(() => {
		api<ProfileStats>("stats")
			.then(setStats)
			.catch(() => setStats(null));
	}, []);

	useEffect(() => {
		if (!flash) return;
		const timer = window.setTimeout(() => setFlash(null), 3500);
		return () => window.clearTimeout(timer);
	}, [flash]);

	const l = levelAt(p.xp);
	const remaining = Math.max(0, l.needed - l.into);
	const meterPct = Math.min(100, Math.max(0, (l.into / l.needed) * 100));
	const answered = stats?.full.answered ?? 0;
	const correct = stats?.full.correct ?? 0;
	const accuracy =
		answered > 0 ? `${((correct / answered) * 100).toFixed(1)}%` : "—";

	const unlockedAnimals = boot.animals.filter((a) => l.level >= a.unlockLevel);
	const nextUnlock = boot.animals
		.filter((a) => a.unlockLevel > l.level)
		.sort((a, b) => a.unlockLevel - b.unlockLevel)[0];
	const levelsToNext = nextUnlock ? nextUnlock.unlockLevel - l.level : null;

	const choose = async (id: string) => {
		if (id === p.avatarId && !p.customAvatarUrl) return;
		const animal = boot.animals.find((a) => a.id === id);
		try {
			await api<Bootstrap>("profile:avatar", id);
			await refresh();
			setFlash({
				text: `${animal?.emoji ?? ""} ${animal?.name ?? "Avatar"} selected.`.trim(),
				ok: true,
			});
		} catch (e) {
			setFlash({
				text: e instanceof Error ? e.message : String(e),
			});
		}
	};

	const chooseCustom = async () => {
		try {
			const next = await api<Bootstrap>("profile:custom-avatar");
			await refresh();
			if (next.activeProfile?.customAvatarUrl) {
				setFlash({ text: "Custom photo set.", ok: true });
			}
		} catch (e) {
			setFlash({
				text: e instanceof Error ? e.message : String(e),
			});
		}
	};

	const usingCustom = Boolean(p.customAvatarUrl);

	return (
		<section className="page profile-page">
			<header className="profile-head">
				<span className="eyebrow">YOUR PROGRESS</span>
				<h1>{p.name}</h1>
				<p>Level, streak, quiz stats, and avatars unlocked on this profile.</p>
			</header>

			{flash && (
				<div
					className={`settings-toast ${flash.ok ? "ok" : "err"}`}
					role="status"
				>
					<span>{flash.text}</span>
					<button
						type="button"
						className="settings-toast-dismiss"
						aria-label="Dismiss"
						onClick={() => setFlash(null)}
					>
						<X size={14} />
					</button>
				</div>
			)}

			<div className="profile-hero card">
				<span className="avatar-large" aria-hidden>
					<AvatarFace profile={p} animals={boot.animals} />
				</span>
				<div className="profile-hero-copy">
					<div className="profile-hero-meta">
						<strong>Level {l.level}</strong>
						<span>{p.xp.toFixed(1)} lifetime XP</span>
					</div>
					<p className="profile-xp-next">
						{remaining < 0.05
							? "Ready for the next level"
							: `${remaining.toFixed(1)} XP to level ${l.level + 1}`}
					</p>
					<div
						className="meter"
						role="progressbar"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(meterPct)}
						aria-label={`Level progress ${Math.round(meterPct)} percent`}
					>
						<i style={{ width: `${meterPct}%` }} />
					</div>
				</div>
			</div>

			<div className="card profile-stats" aria-label="Progress stats">
				<div className="profile-stat">
					<StreakFlame size={16} />
					<strong>{p.currentStreak}</strong>
					<span>Streak</span>
					<small>Best {p.longestStreak}</small>
				</div>
				<div className="profile-stat">
					<strong>{stats?.full.completed ?? 0}</strong>
					<span>Quizzes</span>
					<small>Full completed</small>
				</div>
				<div className="profile-stat">
					<strong>{accuracy}</strong>
					<span>Accuracy</span>
					<small>
						{answered
							? `${correct} hit · ${answered - correct} miss`
							: "No full quizzes yet"}
					</small>
				</div>
				<div className="profile-stat">
					<strong>{stats?.daily.answered ?? 0}</strong>
					<span>Dailies</span>
					<small>{stats?.daily.correct ?? 0} correct</small>
				</div>
			</div>

			<section className="avatar-picker card">
				<span className="eyebrow">CHOOSE YOUR AVATAR</span>
				<h2>Avatar collection</h2>
				<p>
					{unlockedAnimals.length} of {boot.animals.length} unlocked
					{nextUnlock
						? ` · next: ${nextUnlock.emoji} ${nextUnlock.name} at level ${nextUnlock.unlockLevel}`
						: " · collection complete"}
					. Or set a custom photo anytime.
				</p>
				{nextUnlock && (
					<div className="profile-next-unlock">
						<span aria-hidden>{nextUnlock.emoji}</span>
						<div>
							<strong>Next unlock</strong>
							<small>
								{nextUnlock.name} · level {nextUnlock.unlockLevel}
								{levelsToNext != null
									? ` · ${levelsToNext} level${levelsToNext === 1 ? "" : "s"} to go`
									: ""}
							</small>
						</div>
					</div>
				)}
				<div className="avatar-grid">
					<button
						type="button"
						className={`avatar-custom${usingCustom ? " selected" : ""}`}
						onClick={() => void chooseCustom()}
						aria-label="Choose a custom photo"
					>
						{usingCustom && p.customAvatarUrl ? (
							<img
								src={p.customAvatarUrl}
								alt=""
								className="avatar-photo"
								draggable={false}
							/>
						) : (
							<span aria-hidden>+</span>
						)}
						<b>Custom</b>
						<small>{usingCustom ? "Selected" : "Your photo"}</small>
					</button>
					{boot.animals.map((a) => {
						const locked = l.level < a.unlockLevel;
						const selected = !usingCustom && p.avatarId === a.id;
						return (
							<button
								type="button"
								className={`${locked ? "locked " : ""}${selected ? "selected" : ""}`}
								disabled={locked}
								onClick={() => choose(a.id)}
								key={a.id}
								aria-label={
									locked
										? `${a.name}, unlocks at level ${a.unlockLevel}`
										: `Choose ${a.name}`
								}
							>
								<span>{a.emoji}</span>
								<b>{a.name}</b>
								<small>
									{locked
										? `Lv ${a.unlockLevel}`
										: selected
											? "Selected"
											: "Unlocked"}
								</small>
							</button>
						);
					})}
				</div>
			</section>

			<p className="profile-settings-link">
				<button type="button" className="secondary" onClick={onOpenSettings}>
					Manage profiles in Settings
				</button>
				<span>Switch, rename, or create another profile</span>
			</p>
		</section>
	);
}
function StreakFlame({ size = 16 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden
			className="streak-flame"
		>
			<path
				fill="currentColor"
				d="M12.2 2.1c.4 2.2-.2 3.7-1.3 5.1-.9 1.1-2 2.1-2.4 3.6-.5 1.7.1 3.4 1.4 4.5-.9-.2-1.7-.8-2.2-1.6-.3 2.2.7 4.3 2.6 5.4 1.9 1.1 4.3 1 6.1-.2 2-1.4 2.9-3.9 2.3-6.2-.4-1.7-1.5-3-2.4-4.4C14.9 6.4 14.4 4.7 14 2.8c-.1-.5-.8-.7-1.1-.2-.2.3-.4.7-.7 1.1z"
			/>
			<path
				fill="var(--paper, #fff)"
				opacity="0.35"
				d="M11.6 14.2c.1 1.3.9 2.2 2 2.6-.7.4-1.6.4-2.4 0-1.2-.6-1.9-1.9-1.7-3.2.6.4 1.4.6 2.1.6z"
			/>
		</svg>
	);
}
function levelAt(xp: number) {
	let level = 1,
		into = xp,
		needed = 25;
	while (into + 1e-9 >= needed) {
		into -= needed;
		level++;
		needed = 25 * 1.0003 ** (level - 1);
	}
	return { level, into, needed };
}
try {
	if (!window.lampLight)
		throw new Error("The secure desktop bridge did not load.");
	createRoot(document.getElementById("root")!).render(<App />);
} catch (error) {
	const root = document.getElementById("root");
	if (root)
		root.innerHTML = `<main style="font-family:Segoe UI,sans-serif;padding:40px;color:#7b2d2d"><h1>Lamp &amp; Light could not start</h1><p>${error instanceof Error ? error.message : String(error)}</p></main>`;
	console.error(error);
}
