import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import {
	createAsyncErrorCore,
	errorMessage,
	useAsyncError,
	type AsyncError,
	type ErrorSink,
} from "./useAsyncError";

// ---------------------------------------------------------------------------
// Minimal hook runtime
//
// Everything ABOVE the `describe("useAsyncError")` block tests the pure core,
// which is what the v1.2.23 refactor extracted. That left the hook adapter —
// the part `OnlineLive.tsx` and `Reader.tsx` actually call — completely
// uncovered, and its one documented invariant ("the returned object identity
// MUST stay stable across renders ... Do NOT drop the `useMemo`") went
// unguarded: deleting the `useMemo` outright, or replacing the whole hook
// with a stub that never records an error, left the entire suite green.
//
// Testing the hook properly wants a DOM renderer (`@testing-library/react` +
// `jsdom`), which this project deliberately does not depend on. So we stand in
// a ~40-line runtime for the three hooks the hook uses, with React's real
// semantics: slot-indexed state, lazy initialisers, referentially stable
// setters, and `Object.is` dep comparison. The `useMemo`/`useCallback`/`useState`
// contracts are asserted in "harness self-check" below, so if this stand-in
// ever stops behaving like React, those tests fail loudly rather than the
// hook tests quietly passing.
// ---------------------------------------------------------------------------

vi.mock("react", () => {
	const slots: unknown[] = [];
	let cursor = 0;

	const depsChanged = (a: readonly unknown[], b: readonly unknown[]): boolean =>
		a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));

	const useState = <T,>(initial: T | (() => T)) => {
		const i = cursor++;
		if (!(i in slots)) {
			slots[i] = typeof initial === "function" ? (initial as () => T)() : initial;
		}
		// Closures capture the slot index, not the array entry, so a setter
		// stashed in a `useCallback([])` from render 1 still writes slot `i`.
		const setState = (next: T | ((prev: T) => T)): void => {
			const prev = slots[i] as T;
			const value =
				typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
			if (!Object.is(value, prev)) slots[i] = value;
		};
		return [slots[i] as T, setState] as const;
	};

	const useMemo = <T,>(factory: () => T, deps?: readonly unknown[]): T => {
		const i = cursor++;
		const prev = slots[i] as { deps: readonly unknown[]; value: T } | undefined;
		if (prev && deps && !depsChanged(prev.deps, deps)) return prev.value;
		const value = factory();
		slots[i] = { deps: deps ?? [], value };
		return value;
	};

	const useCallback = <T,>(fn: T, deps?: readonly unknown[]): T =>
		useMemo(() => fn, deps);

	return {
		useState,
		useMemo,
		useCallback,
		__harness: {
			/** Unmount: drop all hook slots. */
			reset: (): void => {
				slots.length = 0;
				cursor = 0;
			},
			/** Start a re-render from slot 0. */
			beginRender: (): void => {
				cursor = 0;
			},
		},
	};
});

const harness = (
	React as unknown as {
		__harness: { reset(): void; beginRender(): void };
	}
).__harness;

/**
 * Renders `useAsyncError` the way React would: once on mount, then again on
 * demand, with hook state carried across renders.
 */
function renderAsyncError() {
	harness.reset();
	let latest = useAsyncError();
	const rerender = (): void => {
		harness.beginRender();
		latest = useAsyncError();
	};
	return { current: (): ReturnType<typeof useAsyncError> => latest, rerender };
}

/** Collects every value the core pushes at the sink, in order. */
function makeSink() {
	const seen: (AsyncError | null)[] = [];
	const sink: ErrorSink = (e) => {
		seen.push(e);
	};
	return { seen, sink };
}

describe("errorMessage", () => {
	it("uses Error.message for an Error instance", () => {
		expect(errorMessage(new Error("boom"))).toBe("boom");
	});

	it("keeps an empty Error message rather than falling back to the name", () => {
		expect(errorMessage(new Error(""))).toBe("");
	});

	it('accepts an Error subclass with a custom message', () => {
		class HttpError extends Error {
			constructor(message: string) {
				super(message);
				this.name = "HttpError";
			}
		}
		expect(errorMessage(new HttpError("404 not found"))).toBe("404 not found");
	});

	it('uses a string "message" property on a plain object', () => {
		expect(errorMessage({ message: "offline" })).toBe("offline");
	});

	it('falls back to String() when "message" is not a string', () => {
		// Documented existing behaviour: a non-string message is not coerced.
		expect(errorMessage({ message: 42 })).toBe("[object Object]");
	});

	it("passes a plain string through unchanged", () => {
		expect(errorMessage("rejected")).toBe("rejected");
	});

	it("stringifies null, undefined, numbers and booleans", () => {
		expect(errorMessage(null)).toBe("null");
		expect(errorMessage(undefined)).toBe("undefined");
		expect(errorMessage(0)).toBe("0");
		expect(errorMessage(503)).toBe("503");
		expect(errorMessage(false)).toBe("false");
	});

	it("stringifies a symbol instead of throwing", () => {
		// A template literal would throw a TypeError on a symbol; `String()`
		// is what keeps the `catch` block from re-throwing.
		expect(errorMessage(Symbol("nope"))).toBe("Symbol(nope)");
	});

	it("never throws on any rejected-promise payload shape", () => {
		for (const value of [null, undefined, 0, "", [], {}, Symbol("s"), () => {}]) {
			expect(() => errorMessage(value)).not.toThrow();
		}
	});
});

describe("createAsyncErrorCore — wrap", () => {
	it("returns the resolved value on success", async () => {
		const { sink, seen } = makeSink();
		const core = createAsyncErrorCore(sink);

		await expect(core.wrap(Promise.resolve("data"))).resolves.toBe("data");
		expect(core.get()).toBeNull();
		expect(seen).toEqual([null]);
	});

	it("preserves falsy resolved values (0, \"\", false) without becoming undefined", async () => {
		const { sink } = makeSink();
		const core = createAsyncErrorCore(sink);

		await expect(core.wrap(Promise.resolve(0))).resolves.toBe(0);
		await expect(core.wrap(Promise.resolve(""))).resolves.toBe("");
		await expect(core.wrap(Promise.resolve(false))).resolves.toBe(false);
	});

	it("resolves to undefined and records the error on rejection", async () => {
		const { sink, seen } = makeSink();
		const core = createAsyncErrorCore(sink);

		await expect(core.wrap(Promise.reject(new Error("nope")))).resolves.toBe(
			undefined,
		);
		expect(core.get()).toEqual({ message: "nope" });
		expect(seen).toEqual([{ message: "nope" }]);
	});

	it("clears a prior error when a later wrap succeeds", async () => {
		const { sink, seen } = makeSink();
		const core = createAsyncErrorCore(sink);

		await core.wrap(Promise.reject(new Error("first")));
		expect(core.get()).toEqual({ message: "first" });

		await expect(core.wrap(Promise.resolve("second"))).resolves.toBe("second");
		expect(core.get()).toBeNull();
		expect(seen).toEqual([{ message: "first" }, null]);
	});

	it("leaves no error recorded when a later wrap rejects again", async () => {
		const { sink } = makeSink();
		const core = createAsyncErrorCore(sink);

		await core.wrap(Promise.reject(new Error("first")));
		await core.wrap(Promise.reject(new Error("second")));

		expect(core.get()).toEqual({ message: "second" });
	});

	it("normalizes a non-Error rejection payload", async () => {
		const { sink } = makeSink();
		const core = createAsyncErrorCore(sink);

		await core.wrap(Promise.reject({ message: "structured" }));
		expect(core.get()).toEqual({ message: "structured" });
	});

	it("exposes wrap as a destructurable, this-free method", async () => {
		const { sink } = makeSink();
		const { wrap } = createAsyncErrorCore(sink);

		await expect(wrap(Promise.resolve(7))).resolves.toBe(7);
		await expect(wrap(Promise.reject(new Error("detached")))).resolves.toBe(
			undefined,
		);
	});
});

describe("createAsyncErrorCore — record and clear", () => {
	it("starts empty and never notifies the sink on construction", () => {
		const { sink, seen } = makeSink();
		const core = createAsyncErrorCore(sink);

		expect(core.get()).toBeNull();
		expect(seen).toEqual([]);
	});

	it("record() sets the error and notifies the sink once", () => {
		const { sink, seen } = makeSink();
		const core = createAsyncErrorCore(sink);

		core.record(new Error("bad"));

		expect(core.get()).toEqual({ message: "bad" });
		expect(seen).toHaveLength(1);
	});

	it("clear() resets to null and notifies the sink", () => {
		const { sink, seen } = makeSink();
		const core = createAsyncErrorCore(sink);
		core.record(new Error("bad"));

		core.clear();

		expect(core.get()).toBeNull();
		expect(seen).toEqual([{ message: "bad" }, null]);
	});

	it("clearing an already-clear core is a no-op state-wise but still notifies", () => {
		// Matches the pre-refactor behaviour (`setError(null)` was always
		// called). React bails out of the re-render via Object.is(null, null).
		const { sink, seen } = makeSink();
		const core = createAsyncErrorCore(sink);

		core.clear();
		core.clear();

		expect(core.get()).toBeNull();
		expect(seen).toEqual([null, null]);
	});

	it("hands the sink the very object stored as current", () => {
		const { sink, seen } = makeSink();
		const core = createAsyncErrorCore(sink);

		core.record(new Error("bad"));

		expect(seen[0]).toBe(core.get());
	});
});

describe("createAsyncErrorCore — sequential wraps", () => {
	it("error then success leaves the core clean", async () => {
		const { sink } = makeSink();
		const core = createAsyncErrorCore(sink);

		await core.wrap(Promise.reject(new Error("transient")));
		await core.wrap(Promise.resolve("ok"));

		expect(core.get()).toBeNull();
	});

	it("alternating failures never accumulate into a list", async () => {
		const { sink, seen } = makeSink();
		const core = createAsyncErrorCore(sink);

		await core.wrap(Promise.reject(new Error("e1")));
		await core.wrap(Promise.reject(new Error("e2")));
		await core.wrap(Promise.reject(new Error("e3")));

		expect(core.get()).toEqual({ message: "e3" });
		expect(seen).toEqual([
			{ message: "e1" },
			{ message: "e2" },
			{ message: "e3" },
		]);
	});

	it("a success after a long run of failures still reports a single clean state", async () => {
		const { sink, seen } = makeSink();
		const core = createAsyncErrorCore(sink);

		for (let i = 0; i < 5; i++) {
			await core.wrap(Promise.reject(new Error(`e${i}`)));
		}
		await core.wrap(Promise.resolve(42));

		expect(core.get()).toBeNull();
		expect(seen.at(-1)).toBeNull();
	});
});

describe("createAsyncErrorCore — concurrency", () => {
	it("keeps the sink's last value in agreement with get() when writes interleave", async () => {
		const { sink, seen } = makeSink();
		const core = createAsyncErrorCore(sink);

		// Interleaved so a naive implementation can leave the sink holding a
		// value that no longer matches the core's own state.
		await Promise.all([
			core.wrap(Promise.reject(new Error("a"))),
			core.wrap(Promise.resolve("b")),
			core.wrap(Promise.reject(new Error("c"))),
		]);

		expect(seen.at(-1)).toBe(core.get());
		expect(core.get()).toEqual({ message: "c" });
	});

	it("last settled wrap wins regardless of declaration order", async () => {
		const { sink, seen } = makeSink();
		const core = createAsyncErrorCore(sink);

		// The rejection settles last even though it is declared first, so it
		// must win the slot.
		const slow = core.wrap(
			new Promise((_resolve, reject) =>
				setTimeout(() => reject(new Error("late")), 5),
			),
		);
		const fast = core.wrap(Promise.resolve("early"));

		await expect(fast).resolves.toBe("early");
		await expect(slow).resolves.toBe(undefined);

		expect(core.get()).toEqual({ message: "late" });
		expect(seen).toEqual([null, { message: "late" }]);
	});

	it("two cores sharing one sink stay independent", async () => {
		const { sink } = makeSink();
		const a = createAsyncErrorCore(sink);
		const b = createAsyncErrorCore(sink);

		await a.wrap(Promise.reject(new Error("from a")));

		expect(a.get()).toEqual({ message: "from a" });
		expect(b.get()).toBeNull();
	});
});

describe("harness self-check", () => {
	// If these ever fail, the stand-in runtime above has stopped behaving like
	// React and every `useAsyncError` test below is measuring the wrong thing.
	beforeEach(() => harness.reset());

	it("reuses a useMemo value when deps are equal and recomputes when they change", () => {
		harness.beginRender();
		const first = React.useMemo(() => ({}), ["a"]);
		harness.beginRender();
		const same = React.useMemo(() => ({}), ["a"]);
		const changed = React.useMemo(() => ({}), ["b"]);
		expect(same).toBe(first);
		expect(changed).not.toBe(first);
	});

	it("runs a useState lazy initialiser exactly once across renders", () => {
		let inits = 0;
		harness.beginRender();
		React.useState(() => ++inits);
		harness.beginRender();
		React.useState(() => ++inits);
		expect(inits).toBe(1);
	});

	it("keeps a useCallback'd setter working from a later render", () => {
		// React setters are referentially stable, so a callback memoised with
		// `[]` in render 1 must still be able to write state on render 3.
		harness.beginRender();
		const [, setValue] = React.useState(0);
		const memoised = React.useCallback(() => setValue(7), []);
		harness.beginRender();
		const read = () => {
			harness.beginRender();
			return React.useState(0)[0];
		};
		expect(read()).toBe(0);
		memoised();
		expect(read()).toBe(7);
	});
});

describe("useAsyncError", () => {
	beforeEach(() => harness.reset());

	it("returns a referentially stable object across re-renders", () => {
		// THE guard. Consumers (the 5s Friends poll in OnlineLive, the debounced
		// search in Reader) put this object in effect dependency arrays. A fresh
		// literal per render re-runs those effects on every render; v1.2.23 fixed
		// that with `useMemo` and the fix must not silently regress.
		const view = renderAsyncError();
		const first = view.current();
		view.rerender();
		view.rerender();
		expect(view.current()).toBe(first);
	});

	it("keeps a fresh identity once the error actually changes", async () => {
		// Proves the guard above is not passing merely because `useMemo` is
		// called with a frozen/empty dep list, which would freeze the UI at the
		// first error forever.
		const view = renderAsyncError();
		const before = view.current();
		await view.current().wrap(Promise.reject(new Error("boom")));
		view.rerender();
		expect(view.current().error).toEqual({ message: "boom" });
		expect(view.current()).not.toBe(before);
	});

	it("starts with no error", () => {
		expect(renderAsyncError().current().error).toBeNull();
	});

	it("resolves the value and leaves error null on success", async () => {
		const view = renderAsyncError();
		await expect(view.current().wrap(Promise.resolve("ok"))).resolves.toBe("ok");
		view.rerender();
		expect(view.current().error).toBeNull();
	});

	it("records the error message and returns undefined on rejection", async () => {
		const view = renderAsyncError();
		await expect(
			view.current().wrap(Promise.reject(new Error("network down"))),
		).resolves.toBeUndefined();
		view.rerender();
		expect(view.current().error).toEqual({ message: "network down" });
	});

	it("clear() dismisses the error", async () => {
		const view = renderAsyncError();
		await view.current().wrap(Promise.reject(new Error("gone soon")));
		view.rerender();
		expect(view.current().error).not.toBeNull();
		view.current().clear();
		view.rerender();
		expect(view.current().error).toBeNull();
	});

	it("a later success clears a previously recorded error", async () => {
		const view = renderAsyncError();
		await view.current().wrap(Promise.reject(new Error("first")));
		view.rerender();
		await expect(view.current().wrap(Promise.resolve("second"))).resolves.toBe(
			"second",
		);
		view.rerender();
		expect(view.current().error).toBeNull();
	});

	it("exposes a stable wrap and clear across re-renders", () => {
		// Both are spread into effect dependency arrays, so an unstable `wrap`
		// re-runs every effect that awaits it — the same failure mode as an
		// unstable returned object.
		const view = renderAsyncError();
		const { wrap, clear } = view.current();
		view.rerender();
		expect(view.current().wrap).toBe(wrap);
		expect(view.current().clear).toBe(clear);
	});

	it("carries recorded error state across re-renders", async () => {
		// Guards the `useState(() => createAsyncErrorCore(sink))` lazy
		// initialiser: recreating the core every render would drop the error
		// state and the hook would never surface anything.
		const view = renderAsyncError();
		await view.current().wrap(Promise.reject(new Error("persisted")));
		view.rerender();
		view.rerender();
		expect(view.current().error).toEqual({ message: "persisted" });
	});
});
