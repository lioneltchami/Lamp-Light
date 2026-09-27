import { useCallback, useMemo, useState } from "react";

export type AsyncError = { message: string };

function errorMessage(e: unknown): string {
	if (e instanceof Error) return e.message;
	if (e && typeof e === "object" && "message" in e) {
		const m = (e as { message: unknown }).message;
		if (typeof m === "string") return m;
	}
	return String(e);
}

/**
 * Tracks the latest async error for inline display. The returned `wrap` runs
 * the promise, clears any prior error on success, and records a structured
 * `AsyncError` on failure. `clear` is exposed for explicit dismissal (e.g.
 * retry buttons).
 *
 * The returned object identity is stable across renders (memoized on `error`)
 * so consumers can safely use it in effect dependency arrays without
 * retriggering every render.
 */
export function useAsyncError(): {
	error: AsyncError | null;
	wrap: <T>(p: Promise<T>) => Promise<T | undefined>;
	clear: () => void;
} {
	const [error, setError] = useState<AsyncError | null>(null);
	const clear = useCallback(() => setError(null), []);
	const wrap = useCallback(
		async <T,>(p: Promise<T>): Promise<T | undefined> => {
			try {
				const result = await p;
				setError(null);
				return result;
			} catch (e) {
				setError({ message: errorMessage(e) });
				return undefined;
			}
		},
		[],
	);
	return useMemo(() => ({ error, wrap, clear }), [error, wrap, clear]);
}
