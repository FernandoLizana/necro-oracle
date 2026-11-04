// apps/web/src/server/limiter/fallback.ts
//
// Feature: 03-crt-terminal — in-memory fixed-window fallback limiter (task 22.2).
//
// Pure core (`evaluateFixedWindow`) plus a stateful `FallbackLimiter` that
// never rejects. Fixed windows are aligned to the injected ClockPort only
// (no ambient time). The fallback is the demo's actual path when Upstash is
// absent or down.
//
// _Requirements: R13.2, R13.3, R13.5, R13.6, R13.7, R13.8, R13.10_

import type { ClockPort } from "@necro/github";

import {
  LIMITS,
  type RateLimitDecision,
  type RateLimitPort,
  type RateLimitRequest,
} from "./port.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const DEFAULT_MAX_KEYS = 10_000;

/** A single counter entry: the aligned window start and the count within it. */
export interface WindowCounter {
  windowStart: number;
  count: number;
}

/**
 * Pure fixed-window evaluation over the passed counter map (the map IS the
 * store, so this may mutate it). Aligns the window to `floor(now/windowMs)*windowMs`,
 * resets the entry on access when its window has ended, increments and allows
 * while under `limit`, and otherwise denies with
 * `retryAfterSeconds = max(1, ceil((windowEnd - now) / 1000))`.
 *
 * `scope` is intentionally omitted here and stamped by the caller; a denied
 * decision is returned with scope "ip" as a placeholder that FallbackLimiter
 * overwrites. Callers should read `allowed`/`retryAfterSeconds` and set scope.
 */
export function evaluateFixedWindow(
  counters: Map<string, WindowCounter>,
  key: string,
  limit: number,
  windowMs: number,
  nowMs: number,
): RateLimitDecision {
  const aligned = Math.floor(nowMs / windowMs) * windowMs;
  let entry = counters.get(key);
  if (entry === undefined || entry.windowStart !== aligned) {
    entry = { windowStart: aligned, count: 0 };
    counters.set(key, entry);
  }

  if (entry.count < limit) {
    entry.count += 1;
    return { allowed: true };
  }

  const windowEnd = aligned + windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowEnd - nowMs) / 1000));
  // scope is a placeholder; FallbackLimiter rewrites it to "ip" or "global".
  return { allowed: false, scope: "ip", retryAfterSeconds };
}

/**
 * In-memory fallback limiter. Enforces per-IP-per-hour limits and a shared
 * daily ceiling, both as fixed windows aligned to the injected clock. Never
 * rejects: a limiter outage must not surface as an upstream error.
 */
export class FallbackLimiter implements RateLimitPort {
  private readonly counters = new Map<string, WindowCounter>();
  private readonly maxKeys: number;

  constructor(
    private readonly clock: ClockPort,
    opts?: { maxKeys?: number },
  ) {
    this.maxKeys = opts?.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  check(req: RateLimitRequest): Promise<RateLimitDecision> {
    const now = this.clock.nowMs();

    // Per-IP hourly window first.
    const ipKey = `${req.route}:${req.ipId}`;
    const ipDecision = evaluateFixedWindow(this.counters, ipKey, LIMITS[req.route], HOUR_MS, now);
    this.evictIfNeeded(now);
    if (!ipDecision.allowed) {
      return Promise.resolve({
        allowed: false,
        scope: "ip",
        retryAfterSeconds: ipDecision.retryAfterSeconds,
      });
    }

    // Then the shared global daily counter.
    const globalDecision = evaluateFixedWindow(this.counters, "global", req.dailyCeiling, DAY_MS, now);
    this.evictIfNeeded(now);
    if (!globalDecision.allowed) {
      return Promise.resolve({
        allowed: false,
        scope: "global",
        retryAfterSeconds: globalDecision.retryAfterSeconds,
      });
    }

    return Promise.resolve({ allowed: true });
  }

  /**
   * Keep the map bounded: when it exceeds maxKeys, prune entries whose window
   * has ended first, then evict the oldest windows until back within budget.
   */
  private evictIfNeeded(now: number): void {
    if (this.counters.size <= this.maxKeys) return;

    // Prune expired: an entry is expired once we are at/after its window end
    // for the longest window it could belong to. Daily is the longest window,
    // so treat an entry as expired when its window ended for a day window.
    for (const [key, entry] of this.counters) {
      const windowMs = key === "global" ? DAY_MS : HOUR_MS;
      if (now >= entry.windowStart + windowMs) {
        this.counters.delete(key);
      }
    }
    if (this.counters.size <= this.maxKeys) return;

    // Still over budget: evict oldest windowStart first.
    const sorted = [...this.counters.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
    for (const [key] of sorted) {
      if (this.counters.size <= this.maxKeys) break;
      this.counters.delete(key);
    }
  }
}
