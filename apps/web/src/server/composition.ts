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

import { join } from "node:path";

import {
  createSystemFetchPort,
  GitHubSummoner,
  systemClock,
} from "@necro/github";
import { loadEnv } from "@necro/config";
import {
  createDefaultRegistry,
  LocalCovenRunner,
  type CovenRunner,
  type LedgerEvent,
  type LedgerPort,
  type LlmPort,
  type RitualInput,
  type SandboxPort,
} from "@necro/coven";
import { loadDemoRitualInput } from "@necro/coven/node";
import { py2to3Grimoire } from "@necro/grimoires-py2to3";
import { createMockLlmPort } from "@necro/llm";
import { createE2bSandboxPort } from "@necro/sandbox";
import { runReading } from "@necro/oracle";

import {
  chooseLimiterPrimary,
  createRouteDeps,
  makeGithubGateway,
  type ResurrectDeps,
  type RouteDeps,
  type RouteEnvPort,
  type SpendBreakers,
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

// ---------------------------------------------------------------------------
// Resurrection_Route deps (resurrection-engine, task 13.2).
//
// The Resurrection_Route needs everything in `RouteDeps` (to source the
// in-scope reading via summon + runReading) PLUS the coven seams: a
// `CovenRunner`, a per-Ritual `LedgerPort` factory, the optional `LlmPort` /
// `SandboxPort`, the spend breakers, and the demo fixture loader. These are
// assembled here — the SINGLE place `apps/web` may import a grimoire package
// (`apps/web` is the top of the dependency direction, so wiring the
// `python2->python3` grimoire into the registry here honours
// `oracle <- grimoires <- coven <- apps/web`).
// ---------------------------------------------------------------------------

/** The one cached ResurrectDeps for this warm instance; built on first call. */
let cachedResurrect: ResurrectDeps | undefined;

/**
 * The resurrection composition root. Reuses the memoised `RouteDeps`
 * (same summoner/limiter/clock) and adds the coven runner + ports, memoised at
 * module scope so the one `LocalCovenRunner` (built once with the default
 * registry) survives across warm requests.
 *
 * Provider policy for the shipped build:
 *   - `llm`:     left UNDEFINED (Degraded_Mode) until a real provider is wired.
 *     Only the Mock provider exists today; wiring Mock into a LIVE Ritual would
 *     fabricate conversions, so the live path runs deterministic fixers only
 *     and the runner emits its Degraded skip-note (R13.3). `demoLlm` DOES use
 *     the Mock provider — demo output is deterministic by design (R14.4).
 *   - `sandbox`: the E2B parse-only port WHEN `E2B_API_KEY` is configured, else
 *     UNDEFINED (Target_Parser only, R5.7). E2B opens a micro-VM per port, so a
 *     production rollout should move to a per-Ritual sandbox factory; the
 *     default build ships Target_Parser-only.
 *   - `breakers`: a closed-by-default pair until the global spend monitor
 *     (token / sandbox-minute budgets) lands; the route still honours an open
 *     breaker by omitting the corresponding port (R11.3-R11.5).
 */
export function getResurrectDeps(
  envSource: Record<string, string | undefined> = process.env,
): ResurrectDeps {
  if (cachedResurrect !== undefined) return cachedResurrect;

  const base = getRouteDeps(envSource);

  // The single runner for this warm instance, with the shipped grimoire
  // registered (R15.4). This is the sanctioned grimoire import point.
  const runner: CovenRunner = new LocalCovenRunner(
    createDefaultRegistry({ py2to3: py2to3Grimoire }),
  );

  // Per-Ritual append-only ledger. A minimal in-memory implementation that
  // keeps the append-only / increasing-seq contract (coven-contracts); the
  // events are not persisted in the default build (a later task wires Upstash
  // Streams). The `void` keeps the collected events from being an unused field.
  const makeLedger = (): LedgerPort => {
    const events: LedgerEvent[] = [];
    return {
      append(event: LedgerEvent): Promise<void> {
        events.push(event);
        return Promise.resolve();
      },
    };
  };

  // Optional E2B sandbox: only when configured (R5.7). `E2B_API_KEY` is not in
  // the validated env schema (E2B is an optional deployment concern), so it is
  // read from the raw env source here.
  const sandbox: SandboxPort | undefined = createE2bSandboxPort({
    apiKey: envSource["E2B_API_KEY"],
  });

  // Closed-by-default breakers until the spend monitor lands.
  const breakers: SpendBreakers = {
    llmOpen: () => false,
    sandboxOpen: () => false,
  };

  // The demo Ritual loader, bound to the graveyard fixtures root and the Mock
  // provider. The fixtures live at `<repo>/fixtures/graveyard`; from the web
  // app's runtime CWD (the repo root under Next) that is a stable relative
  // join. The loader itself resolves `<root>/lich-py2/...`.
  const fixturesRoot = join(process.cwd(), "fixtures", "graveyard");
  const loadDemoInput = (now: string): Promise<RitualInput> =>
    loadDemoRitualInput({ fixturesRoot, now });
  const demoLlm: LlmPort = createMockLlmPort();

  const deps: ResurrectDeps = {
    ...base,
    runner,
    makeLedger,
    breakers,
    loadDemoInput,
    demoLlm,
    // `llm` omitted (Degraded_Mode). `sandbox` omitted unless E2B configured.
    ...(sandbox === undefined ? {} : { sandbox }),
  };
  cachedResurrect = deps;
  return cachedResurrect;
}
