import { useCallback, useMemo, useState } from "react";

export type AsyncError = { message: string };

/**
 * Normalizes anything a rejected promise can carry into a displayable string.
 *
 * `String()` is used (not template interpolation) on purpose: template
 * literals THROW on symbols, and a thrown error inside `errorMessage` would
 * escape the `catch` block that called it, turning a handled rejection into
 * an unhandled one.
 */
export function errorMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	if (e && typeof e === "object" && "message" in e) {
		const m = (e as { message: unknown }).message;
		if (typeof m === "string") return m;
	}
	return String(e);
}

/** Receives the new value on every state transition. */
export type ErrorSink = (e: AsyncError | null) => void;

export type AsyncErrorCore = {
	/** Last recorded error, or `null`. Authoritative source of truth. */
	get: () => AsyncError | null;
	/** Wipe the recorded error and notify the sink. */
	clear: () => void;
	/** Record `e` as an `AsyncError` and notify the sink. */
	record: (e: unknown) => void;
	/** Resolve to the value and clear, or record the error and resolve to `undefined`. */
	wrap: <T>(p: Promise<T>) => Promise<T | undefined>;
};

/**
 * Pure, React-free core of {@link useAsyncError}.
 *
 * State lives in a closure; the only way out is through `sink`. The methods
 * are bound closures rather than `this`-using methods, so destructuring
 * (`const { wrap } = createAsyncErrorCore(sink)`) keeps working — consumers
 * spread this object straight into effect dependency arrays.
 */
export function createAsyncErrorCore(sink: ErrorSink): AsyncErrorCore {
	let current: AsyncError | null = null;

	const get = (): AsyncError | null => current;

	const clear = (): void => {
		current = null;
		sink(null);
	};

	const record = (e: unknown): void => {
		current = { message: errorMessage(e) };
		sink(current);
	};

	const wrap = async <T,>(p: Promise<T>): Promise<T | undefined> => {
		try {
			const result = await p;
			clear();
			return result;
		} catch (e) {
			record(e);
			return undefined;
		}
	};

	return { get, clear, record, wrap };
}

/**
 * Tracks the latest async error for inline display. The returned `wrap` runs
 * the promise, clears any prior error on success, and records a structured
 * `AsyncError` on failure. `clear` is exposed for explicit dismissal (e.g.
 * retry buttons).
 *
 * The logic lives in {@link createAsyncErrorCore} so it can be unit-tested
 * without a renderer; this hook is a thin adapter that wires a `useState`
 * setter up as the core's sink.
 *
 * INVARIANT — the returned object identity MUST stay stable across renders
 * when `error` does not change. Consumers (Friends polling in `OnlineLive`,
 * the debounced search in `Reader`) put this object in `useEffect` dependency
 * arrays; an unstable identity re-runs those effects on every render, which
 * v1.2.23 fixed by memoizing. Do NOT drop the `useMemo` below: returning a
 * fresh `{ error, wrap, clear }` literal reintroduces infinite effect loops.
 */
export function useAsyncError(): {
	error: AsyncError | null;
	wrap: <T>(p: Promise<T>) => Promise<T | undefined>;
	clear: () => void;
} {
	const [error, setError] = useState<AsyncError | null>(null);
	const sink = useCallback<ErrorSink>((e) => setError(e), []);
	// Lazy initializer: the core is created exactly once and never replaced,
	// so its closure state survives every re-render. `setError` is referentially
	// stable, so the captured `sink` never goes stale.
	const [core] = useState<AsyncErrorCore>(() => createAsyncErrorCore(sink));
	const clear = useCallback(() => core.clear(), [core]);
	const wrap = useCallback(
		<T,>(p: Promise<T>): Promise<T | undefined> => core.wrap(p),
		[core],
	);
	return useMemo(() => ({ error, wrap, clear }), [error, wrap, clear]);
}
