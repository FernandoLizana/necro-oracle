// apps/web/src/server/limiter/port.ts
//
// Feature: 03-crt-terminal — rate limiter port and shared types (task 22.2).
//
// Pure types + constants only. No adapter imports, no network. Time always
// comes from an injected ClockPort (@necro/github); nothing here touches the
// ambient clock.
//
// _Requirements: R13.1, R13.2, R13.3, R13.5, R13.7_

/** The two rate-limited API routes. */
export type RouteName = "summon" | "readings";

/** Per-IP-per-hour request limits (design.md "Rate limiter"). */
export const LIMITS = { summon: 20, readings: 10 } as const;

/** One rate-limit question: which route, which (hashed) IP, and the shared daily ceiling. */
export interface RateLimitRequest {
  readonly route: RouteName;
  readonly ipId: string;
  readonly dailyCeiling: number;
}

/**
 * The verdict for a single request. When denied, `scope` names the binding
 * constraint ("ip" per-IP/hour, "global" shared daily) and `retryAfterSeconds`
 * is an integer >= 1.
 */
export type RateLimitDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly scope: "ip" | "global"; readonly retryAfterSeconds: number };

/** A limiter backend. Its `check` rejects (never resolves) when the backend is unavailable. */
export interface RateLimitPort {
  check(req: RateLimitRequest): Promise<RateLimitDecision>;
}

/** Thrown by a primary limiter when it cannot answer (timeout, transport error, …). */
export class RateLimitUnavailableError extends Error {
  constructor(message = "rate limiter unavailable") {
    super(message);
    this.name = "RateLimitUnavailableError";
  }
}
