import {
	Check,
	Copy,
	Gamepad2,
	LockKeyhole,
	ShieldCheck,
	UserPlus,
	Wifi,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Book, Profile } from "../shared/types";
import {
	type AgeGroup,
	type FriendConnection,
	type GameInvitation,
	hasUploadedProfile,
	isUsernameAvailable,
	listFriendConnections,
	listGameInvitations,
	type OnlineAccount,
	onlineErrorMessage,
	removeFriendConnection,
	respondFriendRequest,
	restoreOnlineAccount,
	sendFriendRequest,
	sendPasswordRecovery,
	signInOnline,
	signOutOnline,
	signUpOnline,
	subscribeToOnlineUsers,
	syncReaderData,
	syncXpLedger,
	uploadInitialProfile,
} from "./onlineService";
import "./online.css";
import CustomGame from "./CustomGame";

type Section = "account" | "friends" | "games";
type SyncState = "offline" | "attention" | "syncing" | "synced";

function syncLabel(sync: SyncState) {
	if (sync === "syncing") return "Syncing…";
	if (sync === "synced") return "Up to date";
	if (sync === "attention") return "Needs sync";
	return "Offline";
}

async function pushOnlineData(onlineUserId: string) {
	if (!(await hasUploadedProfile(onlineUserId)))
		await uploadInitialProfile(onlineUserId);
	await syncXpLedger(onlineUserId);
	await syncReaderData(onlineUserId);
}

export default function OnlineLive({
	profile,
	books,
}: {
	profile: Profile;
	books: Book[];
}) {
	const [section, setSection] = useState<Section>("account");
	const [account, setAccount] = useState<OnlineAccount | null>(null);
	const [sync, setSync] = useState<SyncState>("offline");
	const [inviteCount, setInviteCount] = useState(0);
	const [requestCount, setRequestCount] = useState(0);
	const autoSynced = useRef(false);
	const reportInvites = useCallback((n: number) => setInviteCount(n), []);
	const reportRequests = useCallback((n: number) => setRequestCount(n), []);

	const applyAccount = (next: OnlineAccount | null, nextSync: SyncState) => {
		setAccount(next);
		setSync(nextSync);
		if (!next) {
			setSection("account");
			setInviteCount(0);
			setRequestCount(0);
		}
	};

	useEffect(() => {
		void restoreOnlineAccount()
			.then(async (restored) => {
				if (!restored) {
					applyAccount(null, "offline");
					return;
				}
				const ready = await hasUploadedProfile(restored.onlineUserId);
				applyAccount(restored, ready ? "synced" : "attention");
				setSection("games");
				if (!autoSynced.current) {
					autoSynced.current = true;
					setSync("syncing");
					try {
						await pushOnlineData(restored.onlineUserId);
						setSync("synced");
					} catch {
						setSync("attention");
					}
				}
			})
			.catch(() => setSync("attention"));
	}, []);

	useEffect(() => {
		if (!account) {
			setInviteCount(0);
			setRequestCount(0);
			return;
		}
		let active = true;
		const load = () => {
			void listGameInvitations()
				.then((items) => {
					if (active) setInviteCount(items.length);
				})
				.catch(() => {
					/* badge is best-effort */
				});
			void listFriendConnections()
				.then((items) => {
					if (active)
						setRequestCount(
							items.filter((i) => i.direction === "incoming").length,
						);
				})
				.catch(() => {
					/* badge is best-effort */
				});
		};
		load();
		const timer = setInterval(load, 5000);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, [account]);

	useEffect(() => {
		if (account)
			void window.lampLight.invoke("profile:link-online", account.onlineUserId);
	}, [account, profile.id]);

	return (
		<section className="page online-page">
			<div className="online-title">
				<div>
					<span className="eyebrow">ONLINE</span>
					<h1>Friends &amp; live games</h1>
					<p>
						Sign in to sync progress, add friends, and host Kahoot-style Bible
						quizzes. Local study still works offline.
					</p>
				</div>
				<span
					className={`preview-pill sync-${sync}`}
					title={account ? account.username : "Not signed in"}
				>
					<span />
					{account ? syncLabel(sync) : "Offline"}
				</span>
			</div>
			<nav className="online-nav" aria-label="Online sections">
				{(
					[
						["account", "Account", LockKeyhole],
						["friends", "Friends", UserPlus],
						["games", "Games", Gamepad2],
					] as const
				).map(([id, label, Icon]) => (
					<button
						type="button"
						key={id}
						className={section === id ? "active" : ""}
						onClick={() => setSection(id)}
					>
						<Icon size={16} />
						{label}
						{id === "friends" && requestCount > 0 && <b>{requestCount}</b>}
						{id === "games" && inviteCount > 0 && <b>{inviteCount}</b>}
					</button>
				))}
			</nav>
			<div className="online-section">
				{section === "account" && (
					<Account
						profile={profile}
						account={account}
						sync={sync}
						setSync={setSync}
						onSignedIn={(value, nextSync) => {
							applyAccount(value, nextSync);
							setSection("games");
							autoSynced.current = true;
							if (nextSync === "attention") {
								setSync("syncing");
								void pushOnlineData(value.onlineUserId)
									.then(() => setSync("synced"))
									.catch(() => setSync("attention"));
							}
						}}
						onSignedOut={() => applyAccount(null, "offline")}
					/>
				)}
				{section === "friends" &&
					(account ? (
						<Friends
							userId={account.onlineUserId}
							friendCode={account.friendCode}
							onRequestCount={reportRequests}
							onInviteCount={reportInvites}
							goGames={() => setSection("games")}
						/>
					) : (
						<SignInGate
							feature="Friends"
							detail="Friend codes and requests need an online account."
							goAccount={() => setSection("account")}
						/>
					))}
				{section === "games" &&
					(account ? (
						<CustomGame books={books} onInviteCount={reportInvites} />
					) : (
						<SignInGate
							feature="Games"
							detail="Host or join live quizzes with friends after you sign in."
							goAccount={() => setSection("account")}
						/>
					))}
			</div>
		</section>
	);
}

function SignInGate({
	feature,
	detail,
	goAccount,
}: {
	feature: string;
	detail: string;
	goAccount: () => void;
}) {
	return (
		<section className="online-gate card">
			<span className="online-icon large">
				<LockKeyhole />
			</span>
			<span className="eyebrow">SIGN IN REQUIRED</span>
			<h2>Sign in to use {feature}</h2>
			<p>{detail}</p>
			<button type="button" className="primary" onClick={goAccount}>
				Go to Account
			</button>
		</section>
	);
}

function Account({
	profile,
	account,
	sync,
	setSync,
	onSignedIn,
	onSignedOut,
}: {
	profile: Profile;
	account: OnlineAccount | null;
	sync: SyncState;
	setSync: (s: SyncState) => void;
	onSignedIn: (a: OnlineAccount, sync: SyncState) => void;
	onSignedOut: () => void;
}) {
	const [mode, setMode] = useState<"register" | "signin" | "recover">("signin");
	const [email, setEmail] = useState(""),
		[password, setPassword] = useState(""),
		[username, setUsername] = useState(
			profile.name.replace(/\W/g, "") || "BibleReader",
		),
		[age, setAge] = useState<AgeGroup>("18plus"),
		[message, setMessage] = useState(""),
		[available, setAvailable] = useState<boolean | null>(null);
	const fail = (e: unknown, fallback: string) =>
		setMessage(onlineErrorMessage(e, fallback));
	if (account) {
		const runSync = async () => {
			setSync("syncing");
			setMessage("");
			try {
				await pushOnlineData(account.onlineUserId);
				setSync("synced");
				setMessage("Points and Bible Reader data were safely updated online.");
			} catch (e) {
				setSync("attention");
				fail(e, "Synchronization failed.");
			}
		};
		return (
			<div className="account-layout">
				<section className="card account-profile">
					<div className="admin-avatar">🐑</div>
					<h2>
						{account.username}
						{account.admin && <span className="admin-tag">ADMIN</span>}
					</h2>
					<p>{account.email} · Verified</p>
					{account.admin && (
						<div className="admin-success">
							<ShieldCheck size={17} />
							Administrator account confirmed by Supabase
						</div>
					)}
					<div className="friend-code-card">
						<span className="friend-code-label">Your friend code</span>
						<strong className="friend-code-value">{account.friendCode}</strong>
						<button
							type="button"
							className="secondary"
							onClick={() =>
								void navigator.clipboard?.writeText(account.friendCode)
							}
						>
							<Copy size={15} /> Copy
						</button>
						<p>Share this on Friends so someone can add you.</p>
					</div>
					<button
						type="button"
						className="secondary"
						onClick={() =>
							void signOutOnline().then(() => {
								onSignedOut();
							})
						}
					>
						Sign out
					</button>
				</section>
				<section className="card settings-list">
					<span className="eyebrow">ACCOUNT & SYNC</span>
					<h2>Local profile connection</h2>
					<div className="sync-banner">
						<Wifi />
						<div>
							<b>{syncLabel(sync)}</b>
							<small>XP events are added once, even after offline play</small>
						</div>
						<button
							type="button"
							className="secondary"
							disabled={sync === "syncing"}
							onClick={() => void runSync()}
						>
							Sync now
						</button>
					</div>
					{message && (
						<p className={sync === "synced" ? "admin-success" : "form-error"}>
							{message}
						</p>
					)}
					<div className="setting">
						<b>This local profile</b>
						<small>{profile.name} · Current device</small>
					</div>
				</section>
			</div>
		);
	}
	const signIn = async () => {
		setMessage("");
		try {
			const value = await signInOnline(email, password);
			onSignedIn(
				value,
				(await hasUploadedProfile(value.onlineUserId)) ? "synced" : "attention",
			);
		} catch (e) {
			fail(e, "Sign-in failed.");
		}
	};
	const register = async () => {
		if (age === "under13") {
			setMessage(
				"Under-13 registration is unavailable until parental approval is implemented.",
			);
			return;
		}
		if (!email.includes("@") || username.length < 3 || password.length < 12) {
			setMessage(
				"Enter a valid email and username, and use at least 12 password characters.",
			);
			return;
		}
		try {
			const value = await signUpOnline({
				email,
				password,
				username,
				ageGroup: age,
			});
			if (value) {
				onSignedIn(value, "attention");
			} else {
				setMode("signin");
				setMessage("Verification email sent. Verify it, then sign in.");
			}
		} catch (e) {
			fail(e, "Account creation failed.");
		}
	};
	return (
		<section className="registration card auth-compact">
			<span className="eyebrow">
				{mode === "register"
					? "CREATE ONLINE ACCOUNT"
					: mode === "recover"
						? "ACCOUNT RECOVERY"
						: "WELCOME BACK"}
			</span>
			<h2>
				{mode === "register"
					? "Connect this local profile"
					: mode === "recover"
						? "Reset your password"
						: "Sign in to your online account"}
			</h2>
			{mode === "register" && (
				<>
					<label>
						Age category
						<select
							value={age}
							onChange={(e) => setAge(e.target.value as AgeGroup)}
						>
							<option value="18plus">18 or older</option>
							<option value="13to17">13–17</option>
							<option value="under13">Under 13</option>
						</select>
					</label>
					<label>
						Unique public username
						<div className="username-check">
							<input
								value={username}
								onChange={(e) => {
									setUsername(e.target.value);
									setAvailable(null);
								}}
							/>
							<button
								type="button"
								className="secondary"
								onClick={() =>
									void isUsernameAvailable(username)
										.then(setAvailable)
										.catch((e) => fail(e, "Check failed."))
								}
							>
								Check
							</button>
						</div>
						{available !== null && (
							<small className={available ? "available" : "unavailable"}>
								{available ? "Username is available" : "Try another username"}
							</small>
						)}
					</label>
				</>
			)}
			<label>
				Email
				<input
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
				/>
			</label>
			{mode !== "recover" && (
				<label>
					Password
					<input
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
					/>
				</label>
			)}
			{message && <p className="form-error">{message}</p>}
			{mode === "signin" && (
				<button type="button" className="primary" onClick={() => void signIn()}>
					Sign in
				</button>
			)}
			{mode === "register" && (
				<button
					type="button"
					className="primary"
					onClick={() => void register()}
				>
					Create account
				</button>
			)}
			{mode === "recover" && (
				<button
					type="button"
					className="primary"
					onClick={() =>
						void sendPasswordRecovery(email)
							.then(() => setMessage("Recovery email sent."))
							.catch((e) => fail(e, "Recovery failed."))
					}
				>
					Send recovery email
				</button>
			)}
			<button
				type="button"
				className="link-button"
				onClick={() => setMode(mode === "signin" ? "register" : "signin")}
			>
				{mode === "signin" ? "Create a new account" : "Back to sign in"}
			</button>
			{mode === "signin" && (
				<button
					type="button"
					className="link-button"
					onClick={() => setMode("recover")}
				>
					Forgot password?
				</button>
			)}
		</section>
	);
}

function Friends({
	userId,
	friendCode,
	onRequestCount,
	onInviteCount,
	goGames,
}: {
	userId: string;
	friendCode: string;
	onRequestCount?: (n: number) => void;
	onInviteCount?: (n: number) => void;
	goGames: () => void;
}) {
	const [items, setItems] = useState<FriendConnection[]>([]),
		[invites, setInvites] = useState<GameInvitation[]>([]),
		[code, setCode] = useState(""),
		[message, setMessage] = useState(""),
		[loading, setLoading] = useState(true),
		[copied, setCopied] = useState(false);
	const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(
		() => new Set(),
	);
	const load = () =>
		listFriendConnections()
			.then((list) => {
				setItems(list);
				onRequestCount?.(list.filter((i) => i.direction === "incoming").length);
			})
			.catch((e) =>
				setMessage(onlineErrorMessage(e, "Could not load friends.")),
			)
			.finally(() => setLoading(false));
	const loadInvites = () =>
		listGameInvitations()
			.then((list) => {
				setInvites(list);
				onInviteCount?.(list.length);
			})
			.catch(() => {
				/* optional strip */
			});
	useEffect(() => {
		void load();
		void loadInvites();
		const timer = setInterval(() => void loadInvites(), 5000);
		return () => clearInterval(timer);
	}, []);
	useEffect(() => subscribeToOnlineUsers(userId, setOnlineUserIds), [userId]);
	const act = async (action: () => Promise<void>, success: string) => {
		setMessage("");
		try {
			await action();
			setMessage(success);
			await load();
		} catch (e) {
			setMessage(onlineErrorMessage(e, "Friend action failed."));
		}
	};
	const friends = items.filter((i) => i.direction === "friend"),
		incoming = items.filter((i) => i.direction === "incoming"),
		outgoing = items.filter((i) => i.direction === "outgoing");
	const copyMine = () => {
		void navigator.clipboard?.writeText(friendCode).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};
	return (
		<div className="friends-page">
			<section className="friend-code-card card">
				<span className="friend-code-label">Your friend code</span>
				<strong className="friend-code-value">{friendCode}</strong>
				<button type="button" className="secondary" onClick={copyMine}>
					<Copy size={15} />
					{copied ? "Copied" : "Copy code"}
				</button>
				<p>Share this so a friend can send you a request.</p>
			</section>

			{invites.length > 0 && (
				<section className="friend-alert card invite-banner">
					<div>
						<span className="eyebrow">GAME INVITES</span>
						<h2>
							{invites.length} live game invite
							{invites.length === 1 ? "" : "s"}
						</h2>
						<p>Join from here, or open Games for the full lobby.</p>
					</div>
					<div className="friend-list">
						{invites.map((item) => (
							<div key={item.id}>
								<span>🎮</span>
								<div>
									<b>{item.username}</b>
									<small>Room {item.code}</small>
								</div>
								<button type="button" className="primary" onClick={goGames}>
									Open Games
								</button>
							</div>
						))}
					</div>
				</section>
			)}

			{incoming.length > 0 && (
				<section className="friend-alert card request-banner">
					<span className="eyebrow">INCOMING</span>
					<h2>
						{incoming.length} friend request
						{incoming.length === 1 ? "" : "s"}
					</h2>
					<div className="friend-list">
						{incoming.map((i) => (
							<div key={i.id}>
								<span>👤</span>
								<div>
									<b>{i.username}</b>
									<small>Wants to connect</small>
								</div>
								<button
									type="button"
									className="primary"
									onClick={() =>
										void act(
											() => respondFriendRequest(i.id, true),
											"Friend request accepted.",
										)
									}
								>
									<Check size={15} />
									Accept
								</button>
								<button
									type="button"
									className="secondary"
									onClick={() =>
										void act(
											() => respondFriendRequest(i.id, false),
											"Request declined.",
										)
									}
								>
									Decline
								</button>
							</div>
						))}
					</div>
				</section>
			)}

			<section className="friend-add card">
				<div>
					<span className="eyebrow">ADD A FRIEND</span>
					<h2>Enter their code</h2>
					<p>They must accept before you connect.</p>
				</div>
				<div className="friend-search">
					<UserPlus />
					<input
						value={code}
						onChange={(e) => setCode(e.target.value.toUpperCase())}
						placeholder="Friend code"
					/>
					<button
						type="button"
						className="primary"
						disabled={!code.trim()}
						onClick={() =>
							void act(
								() => sendFriendRequest(code),
								"Friend request sent.",
							).then(() => setCode(""))
						}
					>
						Send request
					</button>
				</div>
				{message && <p className="friend-flash">{message}</p>}
			</section>

			<section className="friends-directory card">
				<h2>Connections</h2>
				{loading ? (
					<p>Loading…</p>
				) : friends.length === 0 &&
					outgoing.length === 0 &&
					incoming.length === 0 ? (
					<div className="friend-loop">
						<ol>
							<li>
								<strong>Share</strong> your friend code above
							</li>
							<li>
								<strong>Or enter</strong> their code and send a request
							</li>
							<li>
								<strong>Accept</strong> when someone adds you
							</li>
							<li>
								<strong>Invite</strong> them to a live quiz from Games
							</li>
						</ol>
					</div>
				) : (
					<div className="friend-list">
						{outgoing.map((i) => (
							<div key={i.id}>
								<span>👤</span>
								<div>
									<b>{i.username}</b>
									<small>Request pending</small>
								</div>
								<button
									type="button"
									className="secondary"
									onClick={() =>
										void act(
											() => removeFriendConnection(i.id),
											"Request cancelled.",
										)
									}
								>
									Cancel
								</button>
							</div>
						))}
						{friends.map((i) => (
							<div key={i.id}>
								<span>
									👤
									<i
										className={onlineUserIds.has(i.userId) ? "online" : ""}
										title={onlineUserIds.has(i.userId) ? "Online" : "Offline"}
									/>
								</span>
								<div>
									<b>{i.username}</b>
									<small>
										{onlineUserIds.has(i.userId) ? "Online" : "Friend"}
									</small>
								</div>
								<button type="button" className="secondary" onClick={goGames}>
									Invite to game
								</button>
								<button
									type="button"
									className="danger"
									onClick={() =>
										void act(
											() => removeFriendConnection(i.id),
											"Friend removed.",
										)
									}
								>
									Remove
								</button>
							</div>
						))}
					</div>
				)}
			</section>
		</div>
	);
}
