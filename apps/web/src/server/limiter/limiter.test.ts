// apps/web/src/server/limiter/limiter.test.ts
//
// Feature: 03-crt-terminal — rate limiter example tests (task 22.1).
//
// Written test-first, EXPECTED TO FAIL for the "missing module" reason until
// task 22.2 implements ./port.js, ./fallback.js, ./chain.js and ./upstash.js.
//
// Fully OFFLINE. No Upstash, no network, no real credentials. Time comes only
// from a fake ClockPort (`{ nowMs(): number }`, matching @necro/github). The
// Upstash adapter takes a `redis` instance by injection, so the timeout-race
// example passes a hand-written stub whose call never resolves; we advance the
// fake clock to trip the adapter's own timeout. @upstash/redis is never
// imported and nothing touches the network.
//
// Covers:
//   - createRateLimitChain: 30s open-circuit on RateLimitUnavailableError,
//     measured ONLY with ClockPort; probes the primary again after it expires.
//   - primary:null always uses the fallback (D5).
//   - createUpstashLimiter: a hanging call loses the timeout race and becomes
//     RateLimitUnavailableError (it does NOT use Upstash's fail-open timeout).
//   - evaluateFixedWindow: pure core arithmetic and window reset on access.
//
// _Requirements: R13.1, R13.2, R13.3, R13.6, R13.8, R13.10_

import type { ClockPort } from "@necro/github";
import { describe, expect, it, vi } from "vitest";

import { createRateLimitChain } from "./chain.js";
import { evaluateFixedWindow, FallbackLimiter } from "./fallback.js";
import {
  type RateLimitDecision,
  type RateLimitPort,
  type RateLimitRequest,
  RateLimitUnavailableError,
} from "./port.js";
import { createUpstashLimiter } from "./upstash.js";

const HOUR_MS = 3_600_000;

/** A fake, deterministic clock whose epoch-ms `now` is settable in a test. */
function fakeClock(startMs: number): ClockPort & { set(ms: number): void; advance(ms: number): void } {
  let current = startMs;
  return {
    nowMs: () => current,
    set: (ms: number) => {
      current = ms;
    },
    advance: (ms: number) => {
      current += ms;
    },
  };
}

const ALLOW: RateLimitDecision = { allowed: true };

describe("createRateLimitChain — open-circuit behaviour (R13.6, R13.10)", () => {
  it("opens a 30s circuit on RateLimitUnavailableError and routes to the fallback without re-probing the primary", async () => {
    const clock = fakeClock(1_700_000_000_000);
    const fallback = new FallbackLimiter(clock);

    const primaryCheck = vi
      .fn<(req: RateLimitRequest) => Promise<RateLimitDecision>>()
      .mockRejectedValue(new RateLimitUnavailableError("down"));
    const primary: RateLimitPort = { check: primaryCheck };

    const chain = createRateLimitChain({ primary, fallback, clock });
    const req: RateLimitRequest = { route: "readings", ipId: "ip-a", dailyCeiling: 1_000_000 };

    // First request: primary fails, answered by fallback, circuit opens.
    const first = await chain.check(req);
    expect(first.allowed).toBe(true);
    expect(primaryCheck).toHaveBeenCalledTimes(1);

    // Within the 30s window the primary is NOT probed again.
    clock.advance(29_999);
    await chain.check(req);
    expect(primaryCheck).toHaveBeenCalledTimes(1);
  });

  it("probes the primary again only after the 30s window elapses, measured with ClockPort", async () => {
    const clock = fakeClock(1_700_000_000_000);
    const fallback = new FallbackLimiter(clock);

    const primaryCheck = vi
      .fn<(req: RateLimitRequest) => Promise<RateLimitDecision>>()
      // First call fails (opens circuit); later calls succeed.
      .mockRejectedValueOnce(new RateLimitUnavailableError("down"))
      .mockResolvedValue(ALLOW);
    const primary: RateLimitPort = { check: primaryCheck };

    const chain = createRateLimitChain({ primary, fallback, clock });
    const req: RateLimitRequest = { route: "readings", ipId: "ip-a", dailyCeiling: 1_000_000 };

    await chain.check(req); // opens circuit, 1 primary call
    expect(primaryCheck).toHaveBeenCalledTimes(1);

    // Still inside the window: no new probe.
    clock.advance(30_000 - 1);
    await chain.check(req);
    expect(primaryCheck).toHaveBeenCalledTimes(1);

    // At/after the boundary the next request probes the primary again.
    clock.advance(1);
    await chain.check(req);
    expect(primaryCheck).toHaveBeenCalledTimes(2);
  });

  it("respects a custom openMs and never rejects on a plain throw from the primary", async () => {
    const clock = fakeClock(1_700_000_000_000);
    const fallback = new FallbackLimiter(clock);
    const primaryCheck = vi
      .fn<(req: RateLimitRequest) => Promise<RateLimitDecision>>()
      .mockImplementation(() => {
        throw new Error("sync boom");
      });
    const primary: RateLimitPort = { check: primaryCheck };

    const chain = createRateLimitChain({ primary, fallback, clock, openMs: 5_000 });
    const req: RateLimitRequest = { route: "summon", ipId: "ip-b", dailyCeiling: 1_000_000 };

    // Never throws; answered by fallback.
    const d = await chain.check(req);
    expect(d.allowed).toBe(true);

    clock.advance(5_000);
    await chain.check(req);
    expect(primaryCheck).toHaveBeenCalledTimes(2);
  });

  it("primary:null always uses the fallback and never calls any primary (D5)", async () => {
    const clock = fakeClock(1_700_000_000_000);
    const fallback = new FallbackLimiter(clock);
    const spy = vi.spyOn(fallback, "check");
    const chain = createRateLimitChain({ primary: null, fallback, clock });

    await chain.check({ route: "readings", ipId: "ip-c", dailyCeiling: 1_000_000 });
    await chain.check({ route: "summon", ipId: "ip-c", dailyCeiling: 1_000_000 });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("createUpstashLimiter — timeout race (R13.6)", () => {
  it("turns a hanging Upstash call into RateLimitUnavailableError via its own timeout, not a fail-open allow", async () => {
    vi.useFakeTimers();
    try {
      const clock = fakeClock(1_700_000_000_000);

      // A redis stub whose every method hangs forever: the adapter's own
      // timeoutMs race must fire. NOTE: this stub is intentionally structural —
      // 22.2 may need the real `Redis`/`@upstash/ratelimit` surface to wire the
      // adapter. The shape below is the minimum the race example needs; adjust
      // in 22.2 if the adapter calls a different method set.
      const hang = vi.fn(() => new Promise<never>(() => {}));
      const redisStub = {
        eval: hang,
        evalsha: hang,
        get: hang,
        set: hang,
        incr: hang,
        expire: hang,
        hincrby: hang,
      } as unknown as Parameters<typeof createUpstashLimiter>[0]["redis"];

      const limiter = createUpstashLimiter({
        redis: redisStub,
        clock,
        dailyCeiling: 1000,
        timeoutMs: 1500,
      });

      const req: RateLimitRequest = { route: "readings", ipId: "ip-x", dailyCeiling: 1000 };
      const pending = limiter.check(req);
      // Assert the promise rejects; attach the expectation before advancing
      // timers so the rejection is observed.
      const settled = expect(pending).rejects.toBeInstanceOf(RateLimitUnavailableError);

      // Trip the adapter's timeout.
      await vi.advanceTimersByTimeAsync(1500);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("evaluateFixedWindow — pure core (R13.8, R13.10)", () => {
  it("allows up to the limit within one aligned window and denies beyond it", () => {
    const counters = new Map<string, { windowStart: number; count: number }>();
    const key = "readings:ip-a";
    const limit = 3;
    const now = Math.floor(1_700_000_000_000 / HOUR_MS) * HOUR_MS + 123;

    const results: RateLimitDecision[] = [];
    for (let i = 0; i < limit + 2; i += 1) {
      results.push(evaluateFixedWindow(counters, key, limit, HOUR_MS, now));
    }

    expect(results.slice(0, limit).every((d) => d.allowed)).toBe(true);
    for (const d of results.slice(limit)) {
      expect(d.allowed).toBe(false);
      if (!d.allowed) {
        expect(d.retryAfterSeconds).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(d.retryAfterSeconds)).toBe(true);
      }
    }
  });

  it("resets the counter when the window has ended (reset on access)", () => {
    const counters = new Map<string, { windowStart: number; count: number }>();
    const key = "readings:ip-a";
    const limit = 2;
    const base = Math.floor(1_700_000_000_000 / HOUR_MS) * HOUR_MS;

    // Fill the first window.
    expect(evaluateFixedWindow(counters, key, limit, HOUR_MS, base).allowed).toBe(true);
    expect(evaluateFixedWindow(counters, key, limit, HOUR_MS, base + 10).allowed).toBe(true);
    expect(evaluateFixedWindow(counters, key, limit, HOUR_MS, base + 20).allowed).toBe(false);

    // Advance into the next aligned window: the counter resets.
    const afterReset = evaluateFixedWindow(counters, key, limit, HOUR_MS, base + HOUR_MS);
    expect(afterReset.allowed).toBe(true);
  });

  it("computes retryAfterSeconds = max(1, ceil((windowEnd - now) / 1000))", () => {
    const counters = new Map<string, { windowStart: number; count: number }>();
    const key = "readings:ip-a";
    const limit = 1;
    const windowStart = Math.floor(1_700_000_000_000 / HOUR_MS) * HOUR_MS;
    const now = windowStart + HOUR_MS - 2500; // 2.5s before the window ends

    expect(evaluateFixedWindow(counters, key, limit, HOUR_MS, now).allowed).toBe(true);
    const denied = evaluateFixedWindow(counters, key, limit, HOUR_MS, now);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.retryAfterSeconds).toBe(Math.max(1, Math.ceil((windowStart + HOUR_MS - now) / 1000)));
    }
  });
});
