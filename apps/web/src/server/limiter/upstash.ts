// apps/web/src/server/limiter/upstash.ts
//
// Feature: 03-crt-terminal — Upstash primary limiter adapter (task 22.2).
//
// Builds three @upstash/ratelimit instances (sliding windows for the two
// per-IP routes, a fixed window for the shared daily counter) over an INJECTED
// Redis instance. The route is checked first, the global daily counter second.
// Each underlying call is wrapped in our own `timeoutMs` race driven by
// `setTimeout`; a timeout OR any thrown/rejected error becomes a
// RateLimitUnavailableError. We deliberately do NOT use @upstash/ratelimit's
// own `timeout` option because it fails OPEN (admits the request).
//
// Credentials are never read here: production wires a real Redis in the
// composition root (task 24); tests inject a structural stub. Nothing in this
// module touches the network by itself.
//
// _Requirements: R13.1, R13.2, R13.3, R13.6, R13.10_

import type { ClockPort } from "@necro/github";
import { Ratelimit } from "@upstash/ratelimit";
import type { Redis } from "@upstash/redis";

import {
  LIMITS,
  type RateLimitDecision,
  type RateLimitPort,
  type RateLimitRequest,
  RateLimitUnavailableError,
} from "./port.js";

const DEFAULT_TIMEOUT_MS = 1500;

/** A unique sentinel so a lost timeout race is distinguishable from a real result. */
const TIMED_OUT = Symbol("rate-limit-timeout");

interface LimitResult {
  readonly success: boolean;
  readonly reset: number;
}

/**
 * Race a promise against a `setTimeout` timer. Resolves with the value, or the
 * TIMED_OUT sentinel if the timer fires first. A rejection propagates. The
 * timer is always cleared. Using `setTimeout` lets a test with fake timers trip
 * the race by advancing the clock.
 */
function withTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export function createUpstashLimiter(opts: {
  redis: Redis;
  clock: ClockPort;
  dailyCeiling: number;
  timeoutMs?: number;
}): RateLimitPort {
  const { redis, clock, dailyCeiling } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Per-route sliding windows and the shared fixed-window daily counter.
  // No `timeout` option: that fails open, which we must not do.
  const summon = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(LIMITS.summon, "1 h"),
    prefix: "necro:rl:summon",
  });
  const readings = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(LIMITS.readings, "1 h"),
    prefix: "necro:rl:readings",
  });
  const resurrect = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(LIMITS.resurrect, "1 h"),
    prefix: "necro:rl:resurrect",
  });
  const global = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(dailyCeiling, "1 d"),
    prefix: "necro:rl:day",
  });

  const perRoute: Record<RateLimitRequest["route"], Ratelimit> = {
    summon,
    readings,
    resurrect,
  };

  function retryAfterSeconds(reset: number): number {
    return Math.max(1, Math.ceil((reset - clock.nowMs()) / 1000));
  }

  /** Run one limiter call under the timeout race; map any failure to unavailable. */
  async function call(limiter: Ratelimit, identifier: string): Promise<LimitResult> {
    let raced: LimitResult | typeof TIMED_OUT;
    try {
      raced = await withTimeout(limiter.limit(identifier), timeoutMs);
    } catch (cause) {
      throw new RateLimitUnavailableError(
        cause instanceof Error ? cause.message : "rate limiter call failed",
      );
    }
    if (raced === TIMED_OUT) {
      throw new RateLimitUnavailableError("rate limiter timed out");
    }
    return raced;
  }

  async function check(req: RateLimitRequest): Promise<RateLimitDecision> {
    // Per-IP route limit first.
    const ip = await call(perRoute[req.route], req.ipId);
    if (!ip.success) {
      return { allowed: false, scope: "ip", retryAfterSeconds: retryAfterSeconds(ip.reset) };
    }

    // Shared global daily counter second. A single fixed identifier so every
    // request shares one window (key `necro:rl:day`).
    const g = await call(global, "day");
    if (!g.success) {
      return { allowed: false, scope: "global", retryAfterSeconds: retryAfterSeconds(g.reset) };
    }

    return { allowed: true };
  }

  return { check };
}
