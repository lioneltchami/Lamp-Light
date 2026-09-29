import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	defaultSleep,
	isAbortError,
	withRetry,
	type RetryOptions,
} from "./retry";

// ---------------------------------------------------------------------------
// All of the behavioural tests run against an INJECTED `sleep`, so the suite
// finishes in milliseconds and never depends on wall-clock timing. The only
// describe block that touches real timers is "defaultSleep" at the bottom,
// which uses fake timers to prove the cancellation contract.
// ---------------------------------------------------------------------------

/** An error shaped like the ones `fetch`/supabase-js produce on abort. */
function abortError(message = "The operation was aborted."): Error {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}

type SleepCall = { ms: number; signal?: AbortSignal };

/**
 * A `sleep` that records its delays and returns immediately, so the whole
 * backoff schedule is asserted in microseconds. It still honours an aborted
 * signal the way the real one does; the one test that needs a backoff to stay
 * *pending* (so it can abort mid-sleep) supplies its own sleep.
 */
function makeSleep() {
	const calls: SleepCall[] = [];
	const sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
		calls.push({ ms, signal });
		if (signal?.aborted) return Promise.reject(abortError());
		return Promise.resolve();
	};
	return { calls, sleep, delays: () => calls.map((c) => c.ms) };
}

/** An `fn` that fails `failures` times, then resolves with `value`. */
function flaky<T>(failures: number, value: T, errorFor?: (n: number) => unknown) {
	const seen: unknown[] = [];
	let calls = 0;
	const fn = async (): Promise<T> => {
		const error = errorFor?.(calls) ?? new Error(`fail #${calls}`);
		seen.push(error);
		calls++;
		if (calls <= failures) throw error;
		return value;
	};
	return { fn, seen, callCount: () => calls };
}

describe("withRetry — happy path", () => {
	it("resolves on the first attempt and never sleeps", async () => {
		const { fn, callCount } = flaky(0, "ok");
		const { sleep, calls } = makeSleep();

		await expect(withRetry(fn, { sleep })).resolves.toBe("ok");

		expect(callCount()).toBe(1);
		expect(calls).toHaveLength(0);
	});

	it("does not sleep when attempts is 1 even though fn throws", async () => {
		const { fn, callCount } = flaky(1, "ok");
		const { sleep, calls } = makeSleep();

		await expect(withRetry(fn, { sleep, attempts: 1 })).rejects.toThrow(
			"fail #0",
		);
		expect(callCount()).toBe(1);
		expect(calls).toHaveLength(0);
	});
});

describe("withRetry — retrying", () => {
	it("retries a failing call and eventually succeeds", async () => {
		const { fn, seen, callCount } = flaky(2, "recovered");
		const { sleep, calls } = makeSleep();

		await expect(withRetry(fn, { sleep })).resolves.toBe("recovered");

		expect(callCount()).toBe(3);
		expect(seen).toHaveLength(3);
		// Two failures, so exactly two backoffs.
		expect(calls).toHaveLength(2);
	});

	it("returns the value from the attempt that succeeded", async () => {
		const values = ["a", "b", "c"];
		let i = 0;
		const fn = async (): Promise<string> => {
			if (i < 2) {
				i++;
				throw new Error(`fail #${i}`);
			}
			return values[i];
		};

		await expect(withRetry(fn, { sleep: makeSleep().sleep })).resolves.toBe(
			"c",
		);
	});

	it("catches a synchronous throw from fn as a failure", async () => {
		let calls = 0;
		const fn = (): Promise<string> => {
			calls++;
			if (calls < 2) throw new Error("sync boom");
			return Promise.resolve("ok");
		};
		const { sleep, calls: sleeps } = makeSleep();

		await expect(withRetry(fn, { sleep })).resolves.toBe("ok");
		expect(calls).toBe(2);
		expect(sleeps).toHaveLength(1);
	});
});

describe("withRetry — exhaustion", () => {
	it("rejects with the LAST error, not the first", async () => {
		const errors = [new Error("first"), new Error("middle"), new Error("last")];
		const { fn } = flaky(3, "never", (n) => errors[n]);
		const { sleep, calls } = makeSleep();

		await expect(withRetry(fn, { sleep, attempts: 3 })).rejects.toBe(
			errors[2],
		);
		// 3 attempts, 2 backoffs between them, then it gives up.
		expect(calls).toHaveLength(2);
	});

	it("rejects with the original error object, unwrapped", async () => {
		// Callers render failures through `onlineErrorMessage(e, fallback)`,
		// which reads `.message` off the raw error. A wrapper would show the
		// wrapper's message instead of the real cause.
		const original = new Error("connection reset");
		const fn = (): Promise<string> => Promise.reject(original);

		await expect(
			withRetry(fn, { sleep: makeSleep().sleep, attempts: 2 }),
		).rejects.toBe(original);
	});

	it("makes exactly `attempts` calls", async () => {
		const { fn, callCount } = flaky(99, "nope");
		const { sleep, calls } = makeSleep();

		await expect(withRetry(fn, { sleep, attempts: 5 })).rejects.toThrow();
		expect(callCount()).toBe(5);
		expect(calls).toHaveLength(4);
	});

	it("clamps a nonsensical attempts value to 1 rather than looping forever", async () => {
		const { fn, callCount } = flaky(99, "nope");
		const { sleep } = makeSleep();

		await expect(withRetry(fn, { sleep, attempts: 0 })).rejects.toThrow();
		expect(callCount()).toBe(1);
	});
});

describe("withRetry — abort", () => {
	it("rejects immediately when the signal is already aborted, without sleeping", async () => {
		const { fn, callCount } = flaky(99, "nope");
		const { sleep, calls } = makeSleep();
		const controller = new AbortController();
		controller.abort();

		await expect(
			withRetry(fn, { sleep, signal: controller.signal }),
		).rejects.toMatchObject({ name: "AbortError" });

		// Zero calls, zero sleeps: an aborted operation never touches the network.
		expect(callCount()).toBe(0);
		expect(calls).toHaveLength(0);
	});

	it("rejects immediately when the signal is already aborted on a later attempt", async () => {
		const controller = new AbortController();
		const { sleep, calls } = makeSleep();
		// Abort from inside the first attempt, so the abort lands *after* the
		// loop has started but before the backoff is entered.
		const fn = (): Promise<string> => {
			controller.abort();
			return Promise.reject(new Error("real failure"));
		};

		await expect(
			withRetry(fn, { sleep, signal: controller.signal, attempts: 3 }),
		).rejects.toMatchObject({ name: "AbortError" });

		expect(calls).toHaveLength(0);
	});

	it("aborts DURING the backoff sleep and makes no further attempt", async () => {
		const controller = new AbortController();
		const { fn, callCount } = flaky(99, "nope");

		// Resolves once the backoff is genuinely pending, so the abort below
		// lands mid-sleep rather than before it starts.
		let markEntered: () => void = () => {};
		const entered = new Promise<void>((resolve) => {
			markEntered = resolve;
		});
		const sleep = (_ms: number, signal?: AbortSignal): Promise<void> => {
			markEntered();
			return new Promise<void>((_resolve, reject) => {
				signal?.addEventListener("abort", () => reject(abortError()), {
					once: true,
				});
			});
		};

		const promise = withRetry(fn, {
			sleep,
			signal: controller.signal,
			attempts: 5,
		});

		await entered;
		expect(callCount()).toBe(1);

		controller.abort();

		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		// The abort won: no second attempt was made.
		expect(callCount()).toBe(1);
	});

	it("surfaces the signal's own abort reason when one was supplied", async () => {
		const controller = new AbortController();
		const reason = new Error("user closed the window");
		reason.name = "AbortError";
		controller.abort(reason);
		const { fn } = flaky(0, "unused");

		await expect(
			withRetry(fn, { sleep: makeSleep().sleep, signal: controller.signal }),
		).rejects.toBe(reason);
	});
});

describe("withRetry — shouldRetry", () => {
	it("stops immediately when shouldRetry returns false", async () => {
		const { fn, callCount } = flaky(99, "nope");
		const { sleep, calls } = makeSleep();

		await expect(
			withRetry(fn, { sleep, shouldRetry: () => false }),
		).rejects.toThrow("fail #0");

		expect(callCount()).toBe(1);
		expect(calls).toHaveLength(0);
	});

	it("passes the failing error and the 1-based attempt number to shouldRetry", async () => {
		const first = new Error("e1");
		const second = new Error("e2");
		const { fn } = flaky(99, "nope", (n) => [first, second][n] ?? new Error());
		const seen: { error: unknown; attempt: number }[] = [];
		let calls = 0;

		await expect(
			withRetry(fn, {
				sleep: makeSleep().sleep,
				attempts: 3,
				shouldRetry: (error, attempt) => {
					seen.push({ error, attempt });
					return ++calls < 3;
				},
			}),
		).rejects.toThrow();

		expect(seen).toEqual([
			{ error: first, attempt: 1 },
			{ error: second, attempt: 2 },
		]);
	});

	it("does not retry an AbortError by default", async () => {
		// Retrying a deliberate abort just delays the caller's own teardown.
		const abort = abortError();
		const fn = vi.fn(() => Promise.reject(abort));
		const { sleep, calls } = makeSleep();

		await expect(withRetry(fn, { sleep })).rejects.toBe(abort);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(calls).toHaveLength(0);
	});

	it("retries a non-abort error by default, including one shaped like a PostgREST error", async () => {
		const { fn, callCount } = flaky(1, "ok", (n) =>
			n === 0 ? { code: "PGRST116", message: "no rows" } : undefined,
		);
		const { sleep } = makeSleep();

		await expect(withRetry(fn, { sleep })).resolves.toBe("ok");
		expect(callCount()).toBe(2);
	});
});

describe("withRetry — backoff schedule", () => {
	const collectDelays = async (opts: Omit<RetryOptions, "sleep" | "onRetry">) => {
		// A failure budget far above any `attempts` these tests use, so the
		// call always exhausts and never resolves.
		const { fn } = flaky(100_000, "nope");
		const { sleep, calls } = makeSleep();
		await expect(withRetry(fn, { ...opts, sleep })).rejects.toThrow();
		return calls;
	};

	it("keeps every delay within [0, baseDelayMs * 2^n) and under maxDelayMs", async () => {
		const delays = (
			await collectDelays({ attempts: 5, baseDelayMs: 100, maxDelayMs: 1000 })
		).map((c) => c.ms);

		// 4 backoffs for 5 attempts, doubling from the first failure.
		expect(delays).toHaveLength(4);
		const ceilings = [100, 200, 400, 800];
		delays.forEach((ms, i) => {
			expect(ms).toBeGreaterThanOrEqual(0);
			expect(ms).toBeLessThan(ceilings[i]!);
		});
	});

	it("never exceeds maxDelayMs however many attempts are configured", async () => {
		const delays = (
			await collectDelays({ attempts: 12, baseDelayMs: 500, maxDelayMs: 4000 })
		).map((c) => c.ms);

		expect(delays).toHaveLength(11);
		for (const ms of delays) {
			expect(ms).toBeGreaterThanOrEqual(0);
			expect(ms).toBeLessThanOrEqual(4000);
		}
	});

	it("caps the exponent instead of overflowing 2 ** attempt", async () => {
		// `2 ** 1000` is Infinity; scaled by any base that stays Infinity, and
		// Infinity * 0 is NaN. The delay must still be a finite number.
		const delays = (
			await collectDelays({ attempts: 1000, baseDelayMs: 300, maxDelayMs: 4000 })
		).map((c) => c.ms);

		expect(delays).toHaveLength(999);
		for (const ms of delays) {
			expect(Number.isFinite(ms)).toBe(true);
			expect(ms).toBeLessThanOrEqual(4000);
		}
	});

	it("sleeps for 0 when baseDelayMs is 0", async () => {
		const delays = (await collectDelays({ attempts: 3, baseDelayMs: 0 })).map(
			(c) => c.ms,
		);
		expect(delays).toEqual([0, 0]);
	});

	it("is actually randomised, not a fixed exponential curve", async () => {
		// A deterministic implementation — always `base * 2 ** n`, always 0, or
		// always the cap — would return one repeated value here. Full jitter
		// must actually spread. 60 samples of `random(0, 1000)` colliding into
		// a single value is ~1e-180, so this cannot flake.
		const samples: number[] = [];
		for (let i = 0; i < 60; i++) {
			const [first] = await collectDelays({ attempts: 2, baseDelayMs: 1000 });
			samples.push(first!.ms);
		}

		expect(new Set(samples).size).toBeGreaterThan(1);
		// Uniform over the full window, so values must land on both sides of
		// the midpoint — a curve that only ever produced small delays would
		// pass a "greater than 0" check but fail this.
		expect(samples.some((ms) => ms > 500)).toBe(true);
		expect(samples.some((ms) => ms < 500)).toBe(true);
		// And strictly inside the window: `Math.random()` is [0, 1), so the
		// ceiling itself is never emitted.
		expect(samples.every((ms) => ms >= 0 && ms < 1000)).toBe(true);
	});

	it("reports the scheduled delay to onRetry", async () => {
		const { fn } = flaky(99, "nope");
		const { sleep } = makeSleep();
		const seen: { attempt: number; delayMs: number; error: unknown }[] = [];

		await expect(
			withRetry(fn, {
				sleep,
				attempts: 3,
				baseDelayMs: 100,
				onRetry: (info) => seen.push(info),
			}),
		).rejects.toThrow();

		expect(seen).toHaveLength(2);
		expect(seen[0]!.attempt).toBe(1);
		expect(seen[1]!.attempt).toBe(2);
		seen.forEach((info, i) => {
			expect(info.delayMs).toBeGreaterThanOrEqual(0);
			expect(info.delayMs).toBeLessThan(100 * 2 ** i);
			expect(info.error).toBeInstanceOf(Error);
		});
	});

	it("does not call onRetry when shouldRetry opts out", async () => {
		const { fn } = flaky(99, "nope");
		const onRetry = vi.fn();

		await expect(
			withRetry(fn, {
				sleep: makeSleep().sleep,
				shouldRetry: () => false,
				onRetry,
			}),
		).rejects.toThrow();

		expect(onRetry).not.toHaveBeenCalled();
	});
});

describe("isAbortError", () => {
	it("recognises a plain Error named AbortError", () => {
		expect(isAbortError(abortError())).toBe(true);
	});

	it("recognises a DOMException-style object", () => {
		expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
	});

	it("does not misidentify ordinary failures", () => {
		for (const value of [
			new Error("network down"),
			{ name: "TimeoutError" },
			{ message: "abort" },
			null,
			undefined,
			"AbortError",
			42,
		]) {
			expect(isAbortError(value)).toBe(false);
		}
	});
});

describe("defaultSleep", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves after the requested delay and leaves no timer behind", async () => {
		const promise = defaultSleep(1000);
		expect(vi.getTimerCount()).toBe(1);

		await vi.advanceTimersByTimeAsync(1000);
		await expect(promise).resolves.toBeUndefined();

		// A pending setTimeout keeps the Node/Electron process alive.
		expect(vi.getTimerCount()).toBe(0);
	});

	it("clears its timer when aborted mid-sleep", async () => {
		const controller = new AbortController();
		const promise = defaultSleep(60_000, controller.signal);
		expect(vi.getTimerCount()).toBe(1);

		controller.abort();

		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		// The 60s timer is gone, not merely unused.
		expect(vi.getTimerCount()).toBe(0);
	});

	it("rejects without ever creating a timer when already aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		await expect(
			defaultSleep(60_000, controller.signal),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(vi.getTimerCount()).toBe(0);
	});

	it("leaks no timers when withRetry runs to exhaustion on the real sleep", async () => {
		const fn = vi.fn(() => Promise.reject(new Error("down")));

		const promise = withRetry(fn, { attempts: 3, baseDelayMs: 100 });
		// Attach the assertion BEFORE advancing the clock: the promise rejects
		// during the drain, and an unhandled rejection would fail the run.
		const settled = expect(promise).rejects.toThrow("down");
		await vi.advanceTimersByTimeAsync(10_000);
		await settled;

		expect(fn).toHaveBeenCalledTimes(3);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("leaks no timers when withRetry is aborted mid-backoff on the real sleep", async () => {
		const controller = new AbortController();
		const fn = vi.fn(() => Promise.reject(new Error("down")));
		const promise = withRetry(fn, {
			attempts: 5,
			baseDelayMs: 4000,
			signal: controller.signal,
		});
		const settled = expect(promise).rejects.toMatchObject({
			name: "AbortError",
		});

		await vi.advanceTimersByTimeAsync(0);
		expect(vi.getTimerCount()).toBe(1);

		controller.abort();
		await settled;

		expect(fn).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});
