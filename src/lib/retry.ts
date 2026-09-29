// ---------------------------------------------------------------------------
// withRetry — exponential backoff with full jitter, for the Supabase layer.
//
// Why this exists
// ---------------
// The online code is full of reads that a transient blip can kill: a 750ms
// `multiplayer_game_state` poll, a 5s `list_game_invitations` badge poll, a
// one-shot `has_uploaded_profile` check on the sync banner. Each of those
// currently has exactly one shot at the network. When Supabase has a 30-second
// wobble, one failed request just loses that poll cycle — the badge reads 0,
// the game screen shows "Game disconnected.", and the user is never told why.
//
// WHAT THIS IS NOT FOR
// --------------------
// Retrying is only safe for operations that are *idempotent reads*. A retried
// write is a correctness bug waiting to happen: a POST that times out may well
// have been applied server-side, so the retry double-applies it. That is how
// you end up with two multiplayer games for one click, or an answer scored
// twice. `withRetry` is therefore applied in `onlineService.ts` ONLY to pure
// reads, and deliberately NOT to the writes. See the call-site comments there.
//
// The one thing that can be retried everywhere is a failure that is provably
// pre-flight — the request never left the machine — but this codebase has no
// reliable way to tell those apart from a mid-flight timeout, so the writes
// stay un-retried rather than risk corrupting game state.
// ---------------------------------------------------------------------------

export type RetryOptions = {
	/**
	 * Total attempts, including the first one. `1` disables retrying.
	 * Values below 1 are clamped to 1. Default `3`.
	 */
	attempts?: number;
	/** Ceiling of the *first* backoff, in ms. Default `300`. */
	baseDelayMs?: number;
	/** Hard ceiling on any single backoff, in ms. Default `4000`. */
	maxDelayMs?: number;
	/** Cancels the whole operation, including an in-flight backoff sleep. */
	signal?: AbortSignal;
	/**
	 * Return `true` to retry after the failure on `attempt` (1-based, the
	 * attempt that just threw). Default: retry everything except `AbortError`.
	 *
	 * NOTE: the default is deliberately broad, and it will happily re-send a
	 * request that is guaranteed to fail again — a 401 from an expired token,
	 * a 403 from RLS, a validation error. Beating on a Supabase project during
	 * an auth outage costs a round trip and buys nothing, so callers retrying
	 * anything auth-shaped should opt out:
	 *
	 *     withRetry(fn, { shouldRetry: (e) => !isAuthError(e) })
	 */
	shouldRetry?: (error: unknown, attempt: number) => boolean;
	/** Called after a retryable failure, before the backoff sleep. */
	onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
	/**
	 * Injectable sleep, so tests run in milliseconds. Must reject on abort and
	 * must not leave a pending timer behind. Default `defaultSleep`.
	 */
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_MAX_DELAY_MS = 4000;

/**
 * Ceiling on the backoff exponent. `2 ** 20` is ~3e5, which is already ~7
 * orders of magnitude past `maxDelayMs`, so the cap never bites in practice —
 * it exists so a caller passing `attempts: 5000` cannot make `2 ** attempt`
 * reach `Infinity` (and then `Infinity` scaled by 0 → `NaN`).
 */
const MAX_EXPONENT = 20;

/**
 * True for `AbortError` from any source. Deliberately duck-typed rather than
 * `instanceof Error`: `DOMException` only became an `Error` subclass in
 * modern runtimes, and the abort may equally come from `fetch`, from an
 * injected `sleep`, or from a signal reason.
 */
export function isAbortError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		(error as { name?: unknown }).name === "AbortError"
	);
}

/** The abort error for a signal, preferring whatever `controller.abort(reason)` supplied. */
function abortError(signal: AbortSignal): Error {
	const reason: unknown = signal.reason;
	if (reason instanceof Error) return reason;
	if (typeof DOMException === "function")
		return new DOMException("The operation was aborted.", "AbortError");
	const error = new Error("The operation was aborted.");
	error.name = "AbortError";
	return error;
}

/**
 * Default sleep: one `setTimeout`, cleared on both paths.
 *
 * The abort listener is registered for the duration of the sleep and removed
 * when the timer fires, so a long-lived signal doesn't accumulate one listener
 * per retry. The `clearTimeout` on the abort path is the difference between a
 * cancelled backoff and a pending timer that keeps the Node/Electron process
 * alive (or, in the renderer, wakes the process up for nothing).
 */
export const defaultSleep = (
	ms: number,
	signal?: AbortSignal,
): Promise<void> => {
	if (signal?.aborted) return Promise.reject(abortError(signal));
	return new Promise<void>((resolve, reject) => {
		function cleanup() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		}
		function onAbort() {
			cleanup();
			reject(abortError(signal as AbortSignal));
		}
		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
};

/**
 * Full jitter: `random(0, min(maxDelayMs, baseDelayMs * 2 ** priorFailures))`.
 *
 * Not a fixed exponential curve. A Supabase outage takes down every client at
 * once, so clients that all wait exactly 300ms, then exactly 600ms, then
 * exactly 1200ms arrive back at the restored project in lockstep and knock it
 * over again. Full jitter (AWS's "Exponential Backoff and Jitter") spreads each
 * client uniformly across the whole window instead, so the retry storm is
 * smeared rather than spiking.
 */
function jitterDelayMs(
	priorFailures: number,
	baseDelayMs: number,
	maxDelayMs: number,
): number {
	const exponent = Math.min(Math.max(0, priorFailures - 1), MAX_EXPONENT);
	const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
	if (!(ceiling > 0)) return 0;
	return Math.random() * ceiling;
}

/**
 * Runs `fn`, retrying on failure with full-jitter exponential backoff.
 *
 * Rejects with the **last real error**, unwrapped — callers already render
 * failures through `onlineErrorMessage(e, fallback)`, and a wrapper would only
 * add a second error format to route around.
 */
export function withRetry<T>(
	fn: () => Promise<T>,
	opts: RetryOptions = {},
): Promise<T> {
	const attempts = Math.max(1, Math.floor(opts.attempts ?? DEFAULT_ATTEMPTS));
	const baseDelayMs = Math.max(0, opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
	const maxDelayMs = Math.max(0, opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
	const sleep = opts.sleep ?? defaultSleep;
	const signal = opts.signal;
	const shouldRetry =
		opts.shouldRetry ??
		((error: unknown) => !isAbortError(error));

	return (async () => {
		let lastError: unknown;
		for (let attempt = 1; attempt <= attempts; attempt++) {
			// Abort is checked before every attempt, so an already-aborted
			// signal never reaches the network at all.
			if (signal?.aborted) throw abortError(signal);
			try {
				return await fn();
			} catch (error) {
				lastError = error;
				// Out of attempts: hand back the last real error.
				if (attempt >= attempts) break;
				// Aborted while `fn` was in flight — that is the more
				// informative error, and retrying is pointless.
				if (signal?.aborted) throw abortError(signal);
				if (!shouldRetry(error, attempt)) break;
				const delayMs = jitterDelayMs(attempt, baseDelayMs, maxDelayMs);
				opts.onRetry?.({ attempt, delayMs, error });
				// The only thing that can throw here is an abort during the
				// sleep, which clears the timer on its way out.
				await sleep(delayMs, signal);
			}
		}
		throw lastError;
	})();
}
