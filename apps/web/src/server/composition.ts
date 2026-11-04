import "server-only";

// apps/web/src/server/composition.ts
//
// Feature: 03-crt-terminal — the composition root (design.md §"Deps and
// composition"; R12.10, R12.12, R16.4, R16.6).
//
// This is the SINGLE module that reads `process.env` and imports `server-only`
// (R16.4, R16.6). It validates the environment once, constructs the real
// adapters (one `GitHubSummoner`, the system fetch/clock, the rate-limit
// chain), and MEMOISES the resulting `RouteDeps` at module scope so the one
// summoner — and its `SnapshotCache` and in-flight de-duplication — survive
// across warm requests (R12.10, R12.12). Later calls return the SAME object.
//
// `getRouteDeps` accepts an optional env-source override (defaulting to
// `process.env`) so tests can supply a plain record instead of mutating the
// ambient environment. Memoisation is module-global: the first call builds and
// caches, and every subsequent call returns the cached value regardless of the
// argument (tests reset the module registry to start cold).
//
// _Requirements: R12.10, R12.12, R16.4, R16.6_

import {
  createSystemFetchPort,
  GitHubSummoner,
  systemClock,
} from "@necro/github";
import { loadEnv } from "@necro/config";
import { runReading } from "@necro/oracle";

import {
  chooseLimiterPrimary,
  createRouteDeps,
  makeGithubGateway,
  type RouteDeps,
  type RouteEnvPort,
} from "./deps.js";
import { createRateLimitChain } from "./limiter/chain.js";
import { FallbackLimiter } from "./limiter/fallback.js";

/** The one cached RouteDeps for this (warm) module instance; built on first call. */
let cached: RouteDeps | undefined;

/**
 * The composition root. Validates the env source, constructs the real adapters
 * once, and returns a memoised `RouteDeps`. The first call wins; subsequent
 * calls return the same instance (and the same single `GitHubSummoner` behind
 * `github`).
 */
export function getRouteDeps(
  envSource: Record<string, string | undefined> = process.env,
): RouteDeps {
  if (cached !== undefined) return cached;

  // Validate the environment once; throws EnvValidationError on malformed input.
  const validated = loadEnv(envSource);

  // Wrap the validated Env in the typed RouteEnvPort surface the pipeline reads.
  const env: RouteEnvPort = {
    get: ((key: string) => validated[key as keyof typeof validated]) as RouteEnvPort["get"],
  };

  const clock = systemClock;
  const fetch = createSystemFetchPort();

  // One summoner for the life of this warm instance (R12.10).
  const summoner = new GitHubSummoner({ fetch, clock, env });
  const github = makeGithubGateway({ summoner, fetch, clock });

  const limiter = createRateLimitChain({
    primary: chooseLimiterPrimary(env),
    fallback: new FallbackLimiter(clock),
    clock,
  });

  cached = createRouteDeps({ clock, env, fetch, limiter, github, runReading });
  return cached;
}
