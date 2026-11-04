// apps/web/src/server/limiter/arithmetic.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 16: Rate limit arithmetic
//
// Test-first (task 22.1). These tests are written BEFORE the limiter modules
// exist and are EXPECTED TO FAIL for the "missing module" reason until task
// 22.2 implements:
//     ./port.js      RateLimitPort, RateLimitRequest, RateLimitDecision,
//                    RouteName, LIMITS, RateLimitUnavailableError
//     ./fallback.js  FallbackLimiter, evaluateFixedWindow
//     ./chain.js     createRateLimitChain, RateLimitChain
//
// Everything here is fully OFFLINE: no Upstash, no network, no real
// credentials. Time comes only from a fake ClockPort whose `now` is settable
// (matching the @necro/github `ClockPort` shape: `{ nowMs(): number }`). The
// "no GitHub request for a limited request" clause is checked with a local spy
// gateway that is only ever invoked when a decision is `allowed`.
//
// _Requirements: R13.1, R13.2, R13.5, R13.10_

import type { ClockPort } from "@necro/github";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { FallbackLimiter } from "./fallback.js";
import { LIMITS, type RateLimitDecision, type RateLimitRequest } from "./port.js";

const NUM_RUNS = 200;

/** Window constants from design.md ("Rate limiter"). */
const HOUR_MS = 3_600_000;
const DAILY_CEILING = 1000;

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

/**
 * The handler's rejection arithmetic (design.md "Rejection"): the Oracle_Voice
 * wait in whole minutes derived from a decision's retryAfterSeconds.
 * Kept pure and local so P16 can assert the "at least one whole minute" clause
 * without reaching into the (not-yet-written) error map (task 21).
 */
function waitMinutes(retryAfterSeconds: number): number {
  return Math.max(1, Math.ceil(retryAfterSeconds / 60));
}

/** A spy that stands in for "a GitHub request"; must never fire on a limited request. */
function gitHubSpy() {
  let calls = 0;
  return {
    callForAllowed(decision: RateLimitDecision): void {
      // A real handler only touches GitHub once the limiter allows the request.
      if (decision.allowed) calls += 1;
    },
    get calls() {
      return calls;
    },
  };
}

/** Arbitrary start-of-hour-ish epoch: any instant in a plausible range. */
const arbStartMs = fc.integer({ min: 1_500_000_000_000, max: 2_000_000_000_000 });

describe("P16 (R13.2, R13.5): per-IP limit arithmetic", () => {
  it("the 11th readings request from one IP within one hour is RATE_LIMITED with Retry-After >= 1s and a wait >= 1 whole minute, and makes no GitHub request", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbStartMs,
        // How far into the shared window the burst of 11 requests is spread,
        // always kept strictly inside the same aligned hour so all 11 land in
        // one window.
        fc.array(fc.integer({ min: 0, max: HOUR_MS - 1 }), { minLength: 11, maxLength: 11 }),
        fc.string({ unit: "grapheme-ascii", minLength: 1, maxLength: 32 }),
        async (startMs, offsetsRaw, ipId) => {
          const clock = fakeClock(startMs);
          const limiter = new FallbackLimiter(clock);
          const spy = gitHubSpy();

          // All 11 requests fall inside the one aligned hour window that
          // contains `startMs`.
          const windowStart = Math.floor(startMs / HOUR_MS) * HOUR_MS;
          const offsets = [...offsetsRaw].sort((a, b) => a - b);

          const req: RateLimitRequest = { route: "readings", ipId, dailyCeiling: DAILY_CEILING };

          let lastDecision: RateLimitDecision | undefined;
          for (let i = 0; i < 11; i += 1) {
            clock.set(windowStart + offsets[i]!);
            lastDecision = await limiter.check(req);
            spy.callForAllowed(lastDecision);
          }

          // The limit for readings is 10/hour, so the 11th is denied.
          expect(LIMITS.readings).toBe(10);
          expect(lastDecision).toBeDefined();
          expect(lastDecision!.allowed).toBe(false);
          if (lastDecision!.allowed === false) {
            expect(lastDecision!.scope).toBe("ip");
            // Retry-After is an integer >= 1 second.
            expect(Number.isInteger(lastDecision!.retryAfterSeconds)).toBe(true);
            expect(lastDecision!.retryAfterSeconds).toBeGreaterThanOrEqual(1);
            // The Oracle_Voice wait is at least one whole minute.
            expect(waitMinutes(lastDecision!.retryAfterSeconds)).toBeGreaterThanOrEqual(1);
          }

          // Exactly the first 10 were allowed; the limited request made no
          // GitHub call.
          expect(spy.calls).toBe(10);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("the first 10 readings requests in one window are all allowed (boundary, not off-by-one)", async () => {
    await fc.assert(
      fc.asyncProperty(arbStartMs, fc.string({ unit: "grapheme-ascii", minLength: 1, maxLength: 32 }), async (startMs, ipId) => {
        const clock = fakeClock(startMs);
        const limiter = new FallbackLimiter(clock);
        const req: RateLimitRequest = { route: "readings", ipId, dailyCeiling: DAILY_CEILING };

        for (let i = 0; i < 10; i += 1) {
          const d = await limiter.check(req);
          expect(d.allowed, `request #${i + 1} should be allowed`).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a request in the NEXT aligned hour is allowed again (window reset on access)", async () => {
    const startMs = 1_700_000_000_000;
    const clock = fakeClock(startMs);
    const limiter = new FallbackLimiter(clock);
    const req: RateLimitRequest = { route: "readings", ipId: "ip-a", dailyCeiling: DAILY_CEILING };

    // Exhaust the first window.
    for (let i = 0; i < 10; i += 1) {
      await limiter.check(req);
    }
    const denied = await limiter.check(req);
    expect(denied.allowed).toBe(false);

    // Jump past the end of the current aligned hour into the next window.
    const windowStart = Math.floor(startMs / HOUR_MS) * HOUR_MS;
    clock.set(windowStart + HOUR_MS);
    const afterReset = await limiter.check(req);
    expect(afterReset.allowed).toBe(true);
  });
});
