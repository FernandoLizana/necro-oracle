// apps/web/src/server/limiter/chain.ts
//
// Feature: 03-crt-terminal — primary/fallback limiter chain with a circuit
// breaker (task 22.2).
//
// Tries the primary per request; on RateLimitUnavailableError or any throw
// (sync or async) it answers that request from the fallback and opens a
// circuit for `openMs`, measured ONLY with the injected ClockPort. While the
// circuit is open, requests skip the primary and go straight to the fallback;
// after it expires, the next request probes the primary again. A primary
// failure is NEVER converted into an upstream error — the chain always resolves.
//
// _Requirements: R13.1, R13.6, R13.10_

import type { ClockPort } from "@necro/github";

import type { RateLimitDecision, RateLimitPort, RateLimitRequest } from "./port.js";

const DEFAULT_OPEN_MS = 30_000;

/** A limiter facade that never rejects. */
export interface RateLimitChain {
  check(req: RateLimitRequest): Promise<RateLimitDecision>;
}

export function createRateLimitChain(opts: {
  primary: RateLimitPort | null;
  fallback: RateLimitPort;
  clock: ClockPort;
  openMs?: number;
}): RateLimitChain {
  const { primary, fallback, clock } = opts;
  const openMs = opts.openMs ?? DEFAULT_OPEN_MS;

  // Epoch-ms at/after which the primary may be probed again. 0 = closed.
  let openUntil = 0;

  async function check(req: RateLimitRequest): Promise<RateLimitDecision> {
    // No primary (local dev, no Upstash keys): always use the fallback.
    if (primary === null) {
      return fallback.check(req);
    }

    const now = clock.nowMs();
    // Circuit open: skip the primary entirely.
    if (now < openUntil) {
      return fallback.check(req);
    }

    try {
      // Wrap in Promise.resolve so a synchronous throw lands in catch too.
      return await Promise.resolve(primary.check(req));
    } catch {
      // Any failure (typed or not) → open the circuit and fall back.
      openUntil = clock.nowMs() + openMs;
      return fallback.check(req);
    }
  }

  return { check };
}
