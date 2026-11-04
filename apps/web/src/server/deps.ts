// apps/web/src/server/deps.ts
//
// Feature: 03-crt-terminal — PURE route-deps assembly (design.md §"Deps and
// composition"; R12.12, R16.4, R16.6).
//
// This module is PURE wiring: it never reads `process.env`, never imports
// `server-only`, and opens no socket at call time. The single module that
// reads the environment and constructs the real adapters is
// `server/composition.ts` (R16.4). The three helpers here are exercised
// directly by `deps.test.ts` with injected fakes.
//
//   - `createRouteDeps(overrides)`: pure assembly — returns a `RouteDeps`
//     carrying exactly the six injected fields, identity preserved.
//   - `chooseLimiterPrimary(env)`: returns an Upstash-backed `RateLimitPort`
//     ONLY when BOTH UPSTASH_* keys are present and non-empty, else `null`.
//     Construction only — `new Redis(...)` does not open a socket.
//   - `makeGithubGateway({ summoner, fetch, clock })`: wraps `summon` and
//     `fetchExternalData` behind the `GithubGateway` interface over the
//     INJECTED fetch/clock.
//
// _Requirements: R12.12, R16.4, R16.6_

import {
  fetchExternalData,
  systemClock,
  type ClockPort,
  type EnvPort,
  type ExternalDataResult,
  type FetchPort,
  type ParsedRepoRef,
  type SummonResult,
} from "@necro/github";
import type { Reading, ReadingOpts, RepoSnapshot } from "@necro/oracle";
import { Redis } from "@upstash/redis";

import type { RateLimitChain } from "./limiter/chain.js";
import { createUpstashLimiter } from "./limiter/upstash.js";
import type { RateLimitPort } from "./limiter/port.js";

/**
 * The environment surface the route pipeline reads. Extends the GitHub
 * `EnvPort` (which types `get("GITHUB_TOKEN")`) with the route-specific keys:
 * the numeric daily ceiling, the client-IP header name, and the optional
 * Upstash credentials.
 */
export interface RouteEnvPort extends EnvPort {
  get(key: "GITHUB_TOKEN"): string | undefined;
  get(key: "NECRO_DAILY_REQUEST_CEILING"): number;
  get(key: "NECRO_CLIENT_IP_HEADER"): string;
  get(key: "UPSTASH_REDIS_REST_URL"): string | undefined;
  get(key: "UPSTASH_REDIS_REST_TOKEN"): string | undefined;
}

/**
 * The GitHub surface the route pipeline depends on: summon a snapshot, then
 * fetch its external data. Backed by one `GitHubSummoner` so its cache and
 * in-flight de-duplication survive across warm requests (R12.10).
 */
export interface GithubGateway {
  summon(input: ParsedRepoRef): Promise<SummonResult>;
  externalData(snapshot: RepoSnapshot): Promise<ExternalDataResult>;
}

/** Everything a route handler needs, assembled once in the composition root. */
export interface RouteDeps {
  readonly clock: ClockPort;
  readonly env: RouteEnvPort;
  readonly fetch: FetchPort;
  readonly limiter: RateLimitChain;
  readonly github: GithubGateway;
  readonly runReading: (snapshot: RepoSnapshot, opts: ReadingOpts) => Promise<Reading>;
}

/**
 * Pure assembly: return a `RouteDeps` carrying exactly the six injected fields.
 * No `process.env` read, no adapter construction, no I/O. The explicit field
 * copy guarantees the result has exactly the documented keys.
 */
export function createRouteDeps(overrides: RouteDeps): RouteDeps {
  return {
    clock: overrides.clock,
    env: overrides.env,
    fetch: overrides.fetch,
    limiter: overrides.limiter,
    github: overrides.github,
    runReading: overrides.runReading,
  };
}

/**
 * Choose the primary limiter backend. Returns an Upstash-backed
 * `RateLimitPort` only when BOTH `UPSTASH_REDIS_REST_URL` and
 * `UPSTASH_REDIS_REST_TOKEN` are present and non-empty; otherwise `null` so the
 * chain is built with `primary: null` and always answers from the fallback
 * (local dev). Construction only — `new Redis(...)` does not open a socket
 * (R16.6).
 */
export function chooseLimiterPrimary(env: RouteEnvPort): RateLimitPort | null {
  const url = env.get("UPSTASH_REDIS_REST_URL");
  const token = env.get("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) return null;

  const redis = new Redis({ url, token });
  return createUpstashLimiter({
    redis,
    clock: systemClock,
    dailyCeiling: env.get("NECRO_DAILY_REQUEST_CEILING"),
  });
}

/**
 * Wrap a single `GitHubSummoner` (and the external-data orchestrator) behind
 * the `GithubGateway` interface, over the INJECTED fetch/clock. Only the
 * `summon` method of the summoner is used, so a structural stub suffices in
 * tests.
 */
export function makeGithubGateway({
  summoner,
  fetch,
  clock,
}: {
  summoner: { summon(input: ParsedRepoRef): Promise<SummonResult> };
  fetch: FetchPort;
  clock: ClockPort;
}): GithubGateway {
  return {
    summon: (input) => summoner.summon(input),
    externalData: (snapshot) => fetchExternalData(snapshot, { fetch, clock }),
  };
}
