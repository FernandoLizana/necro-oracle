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
import type {
  CovenRunner,
  LedgerPort,
  LlmCachePort,
  LlmPort,
  LoversRunner,
  ModelRouterPort,
  RitualInput,
  SandboxPort,
} from "@necro/coven";
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
  get(key: "NECRO_LLM_API_KEY"): string | undefined;
  get(key: "NECRO_DAILY_REQUEST_CEILING"): number;
  get(key: "NECRO_CLIENT_IP_HEADER"): string;
  get(key: "UPSTASH_REDIS_REST_URL"): string | undefined;
  get(key: "UPSTASH_REDIS_REST_TOKEN"): string | undefined;
  // --- lovers-binding (task 11.6a): OpenRouter + model + ceiling keys --------
  // The server OpenRouter credential; absent keeps the route on the
  // Mock/deterministic default (unless a valid user key is present — BYOK).
  get(key: "OPENROUTER_API_KEY"): string | undefined;
  // Tier model ids the ModelRouterPort closes over (pure configuration).
  get(key: "NECRO_LLM_MODEL_FAST"): string | undefined;
  get(key: "NECRO_LLM_MODEL_STRONG"): string | undefined;
  // The OpenRouter `models` fallback array (comma list -> string[]).
  get(key: "NECRO_LLM_MODEL_FALLBACKS"): readonly string[] | undefined;
  // Server-key token/request daily ceiling and per-reading call cap (A.8).
  get(key: "NECRO_LLM_DAILY_CEILING"): number;
  get(key: "NECRO_LLM_MAX_CALLS_PER_READING"): number;
  // --- lovers-binding (task 11.6b): the SEPARATE lovers daily ceiling -------
  // The server-key daily ceiling applied by the Lovers_Route when soulSource =
  // ORACLE (R20.1), bounding lovers spend on the server key independently of
  // the shared request ceiling. Defaulted in `@necro/config` (default 200).
  get(key: "NECRO_LOVERS_DAILY_CEILING"): number;
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
 * The two spend circuit-breakers the Resurrection_Route consults before it
 * drives the Ritual (R11.3-R11.5). Each reports, synchronously, whether its
 * breaker is OPEN (tripped). An open LLM breaker makes the route run the Ritual
 * WITHOUT an `LlmPort` (skipping the LLM_Pass with a skip-note); an open sandbox
 * breaker makes it omit the `SandboxPort` (skipping the parse-check with a
 * skip-note). The Ritual always continues with the remaining passes.
 *
 * The breakers are read-only here — the route never trips them; the global
 * spend monitor (token / sandbox-minute budgets) owns that. The interface is
 * deliberately tiny so a test can inject a fixed-state fake.
 */
export interface SpendBreakers {
  /** True when the LLM spend breaker is open (skip the LLM_Pass). */
  llmOpen(): boolean;
  /** True when the sandbox spend breaker is open (skip the parse-check). */
  sandboxOpen(): boolean;
}

/**
 * Everything the Resurrection_Route needs beyond the shared `RouteDeps`. It
 * reuses the `github`/`runReading`/`limiter`/`env`/`clock` of `RouteDeps` to
 * source the in-scope reading exactly as the Reading_Route does, then adds the
 * coven seams:
 *
 *   - `runner`      the `CovenRunner` (a `LocalCovenRunner` built once with the
 *                   default registry) that drives SELECT -> ... -> DIFF;
 *   - `makeLedger`  a per-Ritual `LedgerPort` factory (one append-only ledger
 *                   per run);
 *   - `llm`         the real/Mock `LlmPort`, or `undefined` in Degraded_Mode
 *                   (no `NECRO_LLM_API_KEY`); omitted => runner skips LLM_Pass;
 *   - `sandbox`     the optional E2B `SandboxPort`, or `undefined` when no E2B
 *                   is configured; omitted => Target_Parser-only validation;
 *   - `breakers`    the spend breakers above;
 *   - `loadDemoInput` the Node fixture loader bound to the graveyard root, used
 *                   when `demo: true`; `undefined` => demo unsupported;
 *   - `demoLlm`     the Mock `LlmPort` a demo Ritual runs with (R14.4).
 *
 * All but the shared fields are optional so a test injects only what a case
 * needs; the handler treats an absent `llm`/`sandbox` as "that pass is skipped".
 */
export interface ResurrectDeps extends RouteDeps {
  readonly runner: CovenRunner;
  readonly makeLedger: () => LedgerPort;
  readonly llm?: LlmPort;
  readonly sandbox?: SandboxPort;
  readonly breakers: SpendBreakers;
  readonly loadDemoInput?: (now: string) => Promise<RitualInput>;
  readonly demoLlm?: LlmPort;
  // --- lovers-binding (task 11.6a): LLM routing + BYOK seams ----------------
  /**
   * The pure injected `ModelRouterPort` (Resolved decision 7). Built in
   * `composition.ts` from the pure `@necro/llm` router closing over the tier
   * env model ids, and forwarded to the runner as `RitualPorts.router`. Absent
   * only in tests that do not exercise routing.
   */
  readonly router?: ModelRouterPort;
  /**
   * Build an OpenRouter `LlmPort` for ONE request from a per-request key
   * (BYOK / `soulSource = YOURS`). Present whenever the OpenRouter provider can
   * be constructed (i.e. the provider module is wired); the handler calls it
   * with the validated user key so BYOK works even when `OPENROUTER_API_KEY` is
   * absent (item 8 / D.5). The returned port is used for that request only and
   * never stored. Absent in tests that do not exercise BYOK.
   */
  readonly makeUserLlm?: (userKey: string) => LlmPort;
}

/**
 * The resurrected Python 3 source of ONE file, sourced for the Lovers binding.
 * The Lovers input is the RESURRECTED Python 3 source (R16.1), so the Lovers
 * route first resurrects the requested file (reusing the resurrect runner) and
 * hands the file's after-content to the {@link LoversRunner}.
 */
export interface ResurrectedFile {
  /** The repo-relative path of the resurrected file (echoed to the result). */
  readonly file: string;
  /** The resurrected Python 3 module source (the LoversRunner `source`). */
  readonly source: string;
}

/**
 * Everything the Lovers_Route (`POST /api/lovers`) needs beyond the shared
 * `RouteDeps` (lovers-binding design C.5, C.4). It reuses the
 * `github`/`runReading`/`limiter`/`env`/`clock` of `RouteDeps` to source the
 * in-scope reading (to enforce the LOVERS-drawn precondition, R14.4) EXACTLY as
 * the resurrect route does, reuses the `resurrectRunner` to produce the
 * resurrected Python 3 source of the bound file (R16.1), then drives the
 * `loversRunner` (PLAN -> GENERATE -> VALIDATE -> BIND) over that source. The
 * LLM routing / BYOK / cache seams mirror `ResurrectDeps` so 11.6a's wiring is
 * reused unchanged:
 *
 *   - `loversRunner`   the `LoversRunner` (a `LocalLoversRunner` built once from
 *                      the injected `LoversGrimoirePort` in composition);
 *   - `resurrectRunner` the shared `CovenRunner` used to resurrect the file to
 *                      Python 3 before the binding (R16.1);
 *   - `makeLedger`     a per-ritual `LedgerPort` factory;
 *   - `makeCache`      a per-request accepted-output completion cache factory
 *                      (design A.8; absent => the runner runs with no cache);
 *   - `router`         the pure injected `ModelRouterPort` (R35.4);
 *   - `llm`            the server OpenRouter provider (ORACLE), or `undefined`
 *                      when no server key is configured (deterministic / BYOK);
 *   - `makeUserLlm`    the per-request BYOK provider factory (soulSource YOURS);
 *   - `demoLlm`        the Mock `LlmPort` a demo binding runs with (R15.4);
 *   - `loadDemoLovers` the demo seam: the resurrected Python 3 source + file
 *                      path for an offline demo binding (`undefined` => demo
 *                      unsupported in this deployment);
 *   - `breakers`       the spend breakers (shared with resurrect);
 *   - `loversDailyCeiling` the SEPARATE server daily ceiling (R20.1).
 *
 * Every field beyond the shared ones is optional so a test injects only what a
 * case needs; the handler treats an absent `llm` as the deterministic template
 * path.
 */
export interface LoversDeps extends RouteDeps {
  readonly loversRunner: LoversRunner;
  readonly resurrectRunner: CovenRunner;
  readonly makeLedger: () => LedgerPort;
  readonly makeCache?: () => LlmCachePort;
  readonly router?: ModelRouterPort;
  readonly llm?: LlmPort;
  readonly makeUserLlm?: (userKey: string) => LlmPort;
  readonly demoLlm?: LlmPort;
  readonly loadDemoLovers?: (now: string) => Promise<ResurrectedFile>;
  readonly breakers: SpendBreakers;
  /** The separate server daily ceiling for the Lovers_Route (R20.1). */
  readonly loversDailyCeiling: number;
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
