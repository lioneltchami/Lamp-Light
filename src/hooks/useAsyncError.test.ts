import { describe, expect, it } from "vitest";
import {
	createAsyncErrorCore,
	errorMessage,
	type AsyncError,
	type ErrorSink,
} from "./useAsyncError";

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
