// apps/web/src/server/limiter/fallback.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 21: Limiter fallback enforcement
//
// Test-first (task 22.1). EXPECTED TO FAIL for the "missing module" reason
// until task 22.2 implements ./port.js, ./fallback.js and ./chain.js.
//
// Fully OFFLINE. The "primary" is a RateLimitPort stub that ALWAYS fails
// (throws RateLimitUnavailableError). The chain must then answer every request
// from the FallbackLimiter, enforcing exactly the same per-IP/hour limits
// (<= 20 summon, <= 10 readings) and the daily ceiling, rejecting the rest with
// a RATE_LIMITED-shaped decision (allowed:false), and it must NEVER surface
// UPSTREAM_UNAVAILABLE from a limiter outage. No GitHub request is made for a
// limited request (checked with a local allowed-only spy).
//
// _Requirements: R13.2, R13.3, R13.5, R13.6, R13.7, R13.8_

import type { ClockPort } from "@necro/github";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createRateLimitChain } from "./chain.js";
import { FallbackLimiter } from "./fallback.js";
import {
  LIMITS,
  type RateLimitDecision,
  type RateLimitPort,
  type RateLimitRequest,
  RateLimitUnavailableError,
  type RouteName,
} from "./port.js";

const NUM_RUNS = 200;

const HOUR_MS = 3_600_000;

/** A fake, deterministic clock whose epoch-ms `now` is settable in a test. */
function fakeClock(startMs: number): ClockPort & { set(ms: number): void } {
  let current = startMs;
  return {
    nowMs: () => current,
    set: (ms: number) => {
      current = ms;
    },
  };
}

/** A primary RateLimitPort that is permanently unavailable. */
const alwaysFailingPrimary: RateLimitPort = {
  check(): Promise<RateLimitDecision> {
    return Promise.reject(new RateLimitUnavailableError("primary down"));
  },
};

/** A primary whose check throws a plain (non-typed) error, also an outage. */
const throwingPrimary: RateLimitPort = {
  check(): Promise<RateLimitDecision> {
    throw new Error("boom");
  },
};

interface Op {
  readonly route: RouteName;
  readonly ipId: string;
  readonly atMs: number; // absolute epoch ms, all inside one aligned hour
}

/**
 * A request sequence confined to a single aligned hour window so per-IP hourly
 * limits are the only thing that can deny within the batch (the daily ceiling
 * is far larger than any per-hour count we generate).
 */
const arbSequence = fc
  .record({
    startMs: fc.integer({ min: 1_500_000_000_000, max: 2_000_000_000_000 }),
    ips: fc.uniqueArray(fc.string({ unit: "grapheme-ascii", minLength: 1, maxLength: 8 }), {
      minLength: 1,
      maxLength: 3,
    }),
    ops: fc.array(
      fc.record({
        route: fc.constantFrom<RouteName>("summon", "readings"),
        ipIndex: fc.nat({ max: 2 }),
        offset: fc.integer({ min: 0, max: HOUR_MS - 1 }),
      }),
      { minLength: 1, maxLength: 80 },
    ),
  })
  .map(({ startMs, ips, ops }) => {
    const windowStart = Math.floor(startMs / HOUR_MS) * HOUR_MS;
    const resolved: Op[] = ops.map((o) => ({
      route: o.route,
      ipId: ips[o.ipIndex % ips.length]!,
      atMs: windowStart + o.offset,
    }));
    // Process in time order (a monotonic clock never goes backwards).
    resolved.sort((a, b) => a.atMs - b.atMs);
    return resolved;
  });

/** Reference model: fixed-window per (route, ip) counts within the batch. */
function expectedAllowed(ops: readonly Op[]): boolean[] {
  const counts = new Map<string, number>();
  return ops.map((op) => {
    const key = `${op.route}:${op.ipId}`;
    const used = counts.get(key) ?? 0;
    const limit = LIMITS[op.route];
    const allowed = used < limit;
    if (allowed) counts.set(key, used + 1);
    return allowed;
  });
}

/** A spy standing in for GitHub work; only an allowed decision may invoke it. */
function gitHubSpy() {
  let calls = 0;
  return {
    callForAllowed(decision: RateLimitDecision): void {
      if (decision.allowed) calls += 1;
    },
    get calls() {
      return calls;
    },
  };
}

describe("P21 (R13.2, R13.3, R13.5, R13.6, R13.7, R13.8): fallback enforces the same limits", () => {
  it("against an always-failing primary, the chain admits exactly the limit and denies the rest, never UPSTREAM_UNAVAILABLE, no GitHub call when limited", () => {
    fc.assert(
      fc.asyncProperty(arbSequence, fc.boolean(), async (ops, usePlainThrow) => {
        const clock = fakeClock(ops[0]!.atMs);
        const fallback = new FallbackLimiter(clock);
        const chain = createRateLimitChain({
          primary: usePlainThrow ? throwingPrimary : alwaysFailingPrimary,
          fallback,
          clock,
        });

        const expected = expectedAllowed(ops);
        const spy = gitHubSpy();
        let allowedCount = 0;

        for (let i = 0; i < ops.length; i += 1) {
          const op = ops[i]!;
          clock.set(op.atMs);
          const req: RateLimitRequest = { route: op.route, ipId: op.ipId, dailyCeiling: 1_000_000 };

          // The chain NEVER rejects — a limiter outage does not propagate.
          // eslint-disable-next-line no-await-in-loop
          const decision = await chain.check(req);

          expect(decision.allowed).toBe(expected[i]);
          if (!decision.allowed) {
            expect(decision.scope === "ip" || decision.scope === "global").toBe(true);
            expect(Number.isInteger(decision.retryAfterSeconds)).toBe(true);
            expect(decision.retryAfterSeconds).toBeGreaterThanOrEqual(1);
          } else {
            allowedCount += 1;
          }
          spy.callForAllowed(decision);
        }

        // No GitHub request ever fired for a denied request.
        expect(spy.calls).toBe(allowedCount);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("enforces the daily ceiling across IPs when per-IP limits are not the binding constraint", async () => {
    // One aligned hour, a small daily ceiling, many distinct IPs each making a
    // single request so no per-IP hourly limit is ever hit — only the shared
    // global daily counter can deny.
    const start = 1_700_000_000_000;
    const clock = fakeClock(start);
    const fallback = new FallbackLimiter(clock);
    const chain = createRateLimitChain({ primary: alwaysFailingPrimary, fallback, clock });
    const ceiling = 5;

    const decisions: RateLimitDecision[] = [];
    for (let i = 0; i < ceiling + 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const d = await chain.check({ route: "readings", ipId: `ip-${i}`, dailyCeiling: ceiling });
      decisions.push(d);
    }

    const allowed = decisions.filter((d) => d.allowed).length;
    expect(allowed).toBe(ceiling);
    for (const d of decisions.slice(ceiling)) {
      expect(d.allowed).toBe(false);
      if (!d.allowed) expect(d.scope).toBe("global");
    }
  });

  it("a primary:null chain always uses the fallback (D5, local dev)", async () => {
    const clock = fakeClock(1_700_000_000_000);
    const fallback = new FallbackLimiter(clock);
    const chain = createRateLimitChain({ primary: null, fallback, clock });

    for (let i = 0; i < LIMITS.summon; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const d = await chain.check({ route: "summon", ipId: "solo", dailyCeiling: 1_000_000 });
      expect(d.allowed).toBe(true);
    }
    const over = await chain.check({ route: "summon", ipId: "solo", dailyCeiling: 1_000_000 });
    expect(over.allowed).toBe(false);
  });
});
