import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Clock,
  Copy,
  Play,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";
import type { Book } from "../shared/types";
import {
  MAX_GAME_PLAYERS,
  READING_BUFFER_SECONDS,
} from "../shared/multiplayer";
import {
  expireMultiplayerPhase,
  advanceMultiplayerGame,
  answerMultiplayerQuestion,
  createMultiplayerGame,
  getMultiplayerState,
  joinMultiplayerGame,
  onlineErrorMessage,
  type MultiplayerState,
  listFriendConnections,
  inviteFriendToGame,
  listGameInvitations,
  dismissGameInvitation,
  type FriendConnection,
  type GameInvitation,
} from "./onlineService";

type BookMode = "all" | "ot" | "nt" | "random" | "specific";

export default function CustomGame({
  books,
  onInviteCount,
}: {
  books: Book[];
  onInviteCount?: (n: number) => void;
}) {
  const [roomCode, setRoomCode] = useState<string | null>(null),
    [joinCode, setJoinCode] = useState(""),
    [error, setError] = useState("");
  const [mode, setMode] = useState<BookMode>("all"),
    [selected, setSelected] = useState<string[]>([]),
    [randomCount, setRandomCount] = useState(5),
    [questionCount, setQuestionCount] = useState(10),
    [seconds, setSeconds] = useState(20),
    [busy, setBusy] = useState(false);
  const chosen = useMemo(() => {
    if (mode === "all") return books.map((b) => b.id);
    if (mode === "ot")
      return books.filter((b) => b.testament === "OT").map((b) => b.id);
    if (mode === "nt")
      return books.filter((b) => b.testament === "NT").map((b) => b.id);
    if (mode === "specific") return selected;
    return books
      .map((b) => b.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, randomCount);
  }, [books, mode, selected, randomCount]);
  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError("");
    try {
      setRoomCode(await action());
    } catch (e) {
      setError(onlineErrorMessage(e, "Game setup failed."));
    } finally {
      setBusy(false);
    }
  };
  if (roomCode)
    return <GameRoom code={roomCode} leave={() => setRoomCode(null)} />;
  return (
    <section className="custom-game">
      <div className="game-heading">
        <div>
          <span className="eyebrow">LIVE CUSTOM QUIZ</span>
          <h2>Host a Kahoot-style Bible game</h2>
          <p>
            Invite up to {MAX_GAME_PLAYERS} signed-in friends, or share a
            six-character room code.
          </p>
        </div>
        <span className="game-badge">
          <Users size={16} /> Up to {MAX_GAME_PLAYERS} players
        </span>
      </div>
      <GameInvitations
        join={(code) => run(() => joinMultiplayerGame(code))}
        busy={busy}
        onCount={onInviteCount}
      />
      <div className="game-layout">
        <section className="game-builder card">
          <h3>Build your game</h3>
          <fieldset>
            <legend>Books in the quiz</legend>
            <div className="choice-pills">
              {(
                [
                  ["all", "All 66"],
                  ["ot", "Old Testament"],
                  ["nt", "New Testament"],
                  ["random", "Random books"],
                  ["specific", "Choose books"],
                ] as [BookMode, string][]
              ).map(([value, label]) => (
                <button
                  type="button"
                  className={mode === value ? "selected" : ""}
                  onClick={() => setMode(value)}
                  key={value}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          {mode === "random" && (
            <label className="game-number">
              Number of random books
              <select
                value={randomCount}
                onChange={(e) => setRandomCount(Number(e.target.value))}
              >
                {[1, 3, 5, 10, 15, 20].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          )}
          {mode === "specific" && (
            <div className="book-picker">
              <div>
                <b>{selected.length} selected</b>
                <button
                  type="button"
                  onClick={() => setSelected(books.map((b) => b.id))}
                >
                  Select all
                </button>
                <button type="button" onClick={() => setSelected([])}>
                  Clear
                </button>
              </div>
              <div>
                {books.map((book) => (
                  <label key={book.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(book.id)}
                      onChange={() =>
                        setSelected((current) =>
                          current.includes(book.id)
                            ? current.filter((id) => id !== book.id)
                            : [...current, book.id],
                        )
                      }
                    />
                    {book.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="game-options">
            <label>
              <span>
                <BookOpen size={16} />
                Questions
              </span>
              <select
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
              >
                {[5, 10, 15, 20].map((n) => (
                  <option value={n} key={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>
                <Clock size={16} />
                Answer time
              </span>
              <select
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
              >
                {[10, 15, 20, 30, 45, 60, 90, 120].map((n) => (
                  <option value={n} key={n}>
                    {n} seconds
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="game-summary">
            <span>
              {chosen.length} book{chosen.length === 1 ? "" : "s"}
            </span>
            <span>{questionCount} questions</span>
            <span>
              {READING_BUFFER_SECONDS}s reading + {seconds}s answering
            </span>
          </div>
          {error && <p className="form-error">{error}</p>}
          <button
            type="button"
            className="primary"
            disabled={busy || !chosen.length}
            onClick={() =>
              void run(() =>
                createMultiplayerGame(chosen, questionCount, seconds),
              )
            }
          >
            {busy ? "Creating…" : "Create game"}
          </button>
        </section>
        <aside className="game-side">
          <section className="join-game card">
            <h3>Join a game</h3>
            <p>Enter the host’s room code.</p>
            <div>
              <input
                maxLength={6}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
              />
              <button
                type="button"
                className="secondary"
                disabled={busy || joinCode.length !== 6}
                onClick={() => void run(() => joinMultiplayerGame(joinCode))}
              >
                Join
              </button>
            </div>
          </section>
          <section className="scoring-card card">
            <Trophy />
            <h3>Speed scoring</h3>
            <strong>1,000 → 300</strong>
            <p>
              Correct answers decrease evenly with time. Wrong answers earn
              zero.
            </p>
          </section>
        </aside>
      </div>
    </section>
  );
}

function GameRoom({ code, leave }: { code: string; leave: () => void }) {
  const [game, setGame] = useState<MultiplayerState | null>(null),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now()),
    [copied, setCopied] = useState(false);
  const load = () =>
    getMultiplayerState(code)
      .then(setGame)
      .catch((e) => setError(onlineErrorMessage(e, "Game disconnected.")));
  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), 750),
      clock = setInterval(() => setNow(Date.now()), 200);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [code]);
  const elapsed = game?.phaseStartedAt
    ? Math.max(0, (now - new Date(game.phaseStartedAt).getTime()) / 1000)
    : 0;
  const phaseLimit =
    game?.status === "reading"
      ? game.readingSeconds
      : game?.status === "answering"
        ? game.questionSeconds
        : 0;
  useEffect(() => {
    if (!game?.host || !phaseLimit || elapsed < phaseLimit) return;
    let active = true,
      inFlight = false;
    const expire = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await expireMultiplayerPhase(code, game.currentIndex, game.status);
        if (active) await load();
      } catch (e) {
        if (active) setError(onlineErrorMessage(e, "Could not advance game."));
      } finally {
        inFlight = false;
      }
    };
    void expire();
    const retry = setInterval(() => void expire(), 1000);
    return () => {
      active = false;
      clearInterval(retry);
    };
  }, [
    code,
    game?.host,
    game?.status,
    game?.currentIndex,
    phaseLimit,
    elapsed >= phaseLimit,
  ]);
  if (!game)
    return (
      <section className="full-lobby card">
        <span className="eyebrow">CONNECTING</span>
        <h2>Joining room {code}…</h2>
        {error && <p className="form-error">{error}</p>}
      </section>
    );
  const act = () =>
    advanceMultiplayerGame(code)
      .then(load)
      .catch((e) => setError(onlineErrorMessage(e, "Could not advance game.")));
  const copyCode = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  if (game.status === "lobby")
    return (
      <section className="full-lobby card">
        <div className="lobby-top">
          <div>
            <span className="eyebrow">GAME LOBBY</span>
            <p className={`lobby-role ${game.host ? "is-host" : "is-guest"}`}>
              {game.host
                ? "You’re the host — start when everyone’s ready"
                : "You’re a guest — waiting for the host to start"}
            </p>
          </div>
          <button type="button" className="secondary" onClick={leave}>
            Leave
          </button>
        </div>
        <div className="lobby-code-block">
          <span className="lobby-code-label">Room code</span>
          <strong className="lobby-code">{code}</strong>
          <button type="button" className="secondary" onClick={copyCode}>
            <Copy size={15} />
            {copied ? "Copied" : "Copy code"}
          </button>
        </div>
        <div className="lobby-count">
          <Users size={16} />
          {game.players.length}/{MAX_GAME_PLAYERS} players
        </div>
        {game.host && <InviteFriends code={code} players={game.players} />}
        <div className="lobby-grid">
          {game.players.map((player) => (
            <div key={player.userId}>
              <span>👤</span>
              <b>{player.username}</b>
              <small>
                <ShieldCheck size={13} />
                Ready
              </small>
            </div>
          ))}
        </div>
        <div className="lobby-actions">
          {game.host ? (
            <button
              type="button"
              className="primary"
              disabled={game.players.length < 1}
              onClick={() => void act()}
            >
              <Play size={16} /> Start game
            </button>
          ) : (
            <p className="lobby-wait">Waiting for host to start…</p>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
      </section>
    );
  if (game.status === "finished")
    return (
      <section className="game-results card">
        <Trophy />
        <span className="eyebrow">GAME OVER</span>
        <h1>Final standings</h1>
        <Standings game={game} />
        <button type="button" className="primary" onClick={leave}>
          Done
        </button>
      </section>
    );
  if (game.status === "result")
    return (
      <section className="round-result card">
        <span className="eyebrow">
          ROUND {game.currentIndex + 1}/{game.questionCount}
        </span>
        <span
          className={game.answer?.correct ? "round-correct" : "round-wrong"}
        >
          {game.answer?.correct ? "✓" : "×"}
        </span>
        <h1>{game.answer?.correct ? "Correct!" : "Round complete"}</h1>
        <strong>+{game.answer?.points ?? 0}</strong>
        {game.question?.correctIndex != null && game.question.choices && (
          <p>
            Correct answer: {game.question.choices[game.question.correctIndex]}
          </p>
        )}
        <Standings game={game} />
        {game.host ? (
          <button type="button" className="primary" onClick={() => void act()}>
            {game.currentIndex + 1 === game.questionCount
              ? "Show final results"
              : "Next question"}
          </button>
        ) : (
          <p className="lobby-wait">Waiting for host…</p>
        )}
      </section>
    );
  const remaining = Math.max(0, phaseLimit - elapsed),
    choices = game.question?.choices,
    answering = game.status === "answering";
  return (
    <section className={`live-game card phase-${game.status}`}>
      <div className="live-top">
        <span>
          Question {game.currentIndex + 1}/{game.questionCount}
        </span>
        <strong>
          <Clock size={18} /> {Math.ceil(remaining)}
        </strong>
      </div>
      <div className="timer-track">
        <i
          style={{
            width: `${phaseLimit ? (remaining / phaseLimit) * 100 : 0}%`,
          }}
        />
      </div>
      <span className={`live-phase ${answering ? "is-answer" : "is-read"}`}>
        {answering ? "Answer now" : "Read the question"}
      </span>
      <h2>{game.question?.text}</h2>
      {!answering && (
        <p className="live-hint">
          Choices unlock when the answer timer starts.
        </p>
      )}
      {game.answer ? (
        <p className="live-locked">Answer locked — waiting for the round…</p>
      ) : (
        <div className={`live-choices ${answering ? "is-open" : "is-locked"}`}>
          {choices?.map((choice, index) => (
            <button
              type="button"
              disabled={!answering}
              onClick={() =>
                void answerMultiplayerQuestion(code, index)
                  .then(load)
                  .catch((e) =>
                    setError(onlineErrorMessage(e, "Answer failed.")),
                  )
              }
              key={index}
            >
              <b>{String.fromCharCode(65 + index)}</b>
              {choice}
            </button>
          ))}
        </div>
      )}
      <small>
        {game.question?.bookName} {game.question?.chapter}:
        {game.question?.verseStart}
      </small>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}

function Standings({ game }: { game: MultiplayerState }) {
  return (
    <div className="mini-standings">
      {game.players.map((player, index) => (
        <div key={player.userId}>
          <b>{index + 1}</b>
          <span>{player.username}</span>
          <div className="standing-points">
            {game.status === "result" && (
              <small>
                +{(player.questionPoints ?? 0).toLocaleString()} this question
              </small>
            )}
            <strong>{player.score.toLocaleString()} pts</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

function InviteFriends({
  code,
  players,
}: {
  code: string;
  players: MultiplayerState["players"];
}) {
  const [friends, setFriends] = useState<FriendConnection[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [sent, setSent] = useState<string[]>([]),
    [pending, setPending] = useState<string | null>(null);
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setFriends(
        (await listFriendConnections()).filter((f) => f.direction === "friend"),
      );
    } catch (e) {
      setError(onlineErrorMessage(e, "Could not load friends."));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [code]);
  const invite = async (id: string) => {
    setPending(id);
    setError("");
    try {
      await inviteFriendToGame(code, id);
      setSent((current) => [...current, id]);
    } catch (e) {
      setError(onlineErrorMessage(e, "Could not send invitation."));
    } finally {
      setPending(null);
    }
  };
  return (
    <section className="game-friend-invites lobby-invites">
      <h3>Invite friends</h3>
      <p>They’ll see a Join button under Games.</p>
      {loading ? (
        <p>Loading friends…</p>
      ) : friends.length === 0 && !error ? (
        <p className="invite-empty">
          No friends yet. Add someone under Friends, then invite them here.
        </p>
      ) : (
        <div className="friend-list">
          {friends.map((friend) => {
            const joined = players.some((p) => p.userId === friend.userId),
              invited = sent.includes(friend.userId);
            return (
              <div key={friend.userId}>
                <div>
                  <b>{friend.username}</b>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    pending !== null ||
                    joined ||
                    invited ||
                    players.length >= MAX_GAME_PLAYERS
                  }
                  onClick={() => void invite(friend.userId)}
                >
                  {joined
                    ? "Joined"
                    : pending === friend.userId
                      ? "Sending…"
                      : invited
                        ? "Invited"
                        : "Invite"}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}{" "}
          <button
            type="button"
            className="secondary"
            onClick={() => void load()}
          >
            Refresh
          </button>
        </p>
      )}
    </section>
  );
}

function GameInvitations({
  join,
  busy,
  onCount,
}: {
  join: (code: string) => Promise<void>;
  busy: boolean;
  onCount?: (n: number) => void;
}) {
  const [items, setItems] = useState<GameInvitation[]>([]),
    [error, setError] = useState(""),
    [dismissing, setDismissing] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const invitations = await listGameInvitations();
        if (active) {
          setItems(invitations);
          onCount?.(invitations.length);
          setError("");
        }
      } catch (e) {
        if (active)
          setError(onlineErrorMessage(e, "Could not load game invitations."));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [onCount]);
  const dismiss = async (id: string) => {
    setDismissing(true);
    try {
      await dismissGameInvitation(id);
      setItems((current) => {
        const next = current.filter((i) => i.id !== id);
        onCount?.(next.length);
        return next;
      });
    } catch (e) {
      setError(onlineErrorMessage(e, "Could not dismiss invitation."));
    } finally {
      setDismissing(false);
    }
  };
  if (!items.length && !error) return null;
  return (
    <section className="game-friend-invites card invite-banner">
      <h3>
        Game invitations
        {items.length > 0 && <b>{items.length}</b>}
      </h3>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="friend-list">
        {items.map((item) => (
          <div key={item.id}>
            <div>
              <b>{item.username}</b>
              <small>Room {item.code}</small>
            </div>
            <button
              type="button"
              className="primary"
              disabled={busy || dismissing}
              onClick={() => void join(item.code)}
            >
              Join game
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy || dismissing}
              onClick={() => void dismiss(item.id)}
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
