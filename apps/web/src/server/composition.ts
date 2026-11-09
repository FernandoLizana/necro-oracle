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

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createSystemFetchPort,
  GitHubSummoner,
  systemClock,
} from "@necro/github";
import { loadEnv } from "@necro/config";
import {
  createDefaultRegistry,
  LocalCovenRunner,
  LocalLoversRunner,
  type CovenRunner,
  type LedgerEvent,
  type LedgerPort,
  type LlmCachePort,
  type LlmPort,
  type LoversGrimoirePort,
  type LoversRunner,
  type ModelRouterPort,
  type ModelTier,
  type RitualInput,
  type RitualPorts,
  type SandboxPort,
} from "@necro/coven";
import { loadDemoRitualInput } from "@necro/coven/node";
import { py2to3Grimoire } from "@necro/grimoires-py2to3";
import {
  buildDeterministicHeart,
  buildTemplatePair,
  GENERATE_STEP,
  PLAN_STEP,
  validateLovers,
} from "@necro/grimoires-lovers-js";
import {
  createMockLlmPort,
  createOpenRouterLlmPort,
  resolveModel,
  routeModel,
} from "@necro/llm";
import { createE2bSandboxPort } from "@necro/sandbox";
import { NecroError, runReading } from "@necro/oracle";

import {
  chooseLimiterPrimary,
  createRouteDeps,
  makeGithubGateway,
  type LoversDeps,
  type ResurrectDeps,
  type ResurrectedFile,
  type RouteDeps,
  type RouteEnvPort,
  type SpendBreakers,
} from "./deps.js";
import { createRateLimitChain } from "./limiter/chain.js";
import { FallbackLimiter } from "./limiter/fallback.js";

/**
 * Resolve the `fixtures/graveyard` directory the demo loader reads. Item 2
 * (judge-ready-pass): on Vercel the serverless function contains only TRACED
 * files, laid out relative to the `outputFileTracingRoot` (the monorepo root),
 * so a plain `process.cwd()/fixtures/graveyard` can miss. Probe candidate roots
 * and return the first whose `lich-py2` fixture directory actually exists:
 *   1. module-anchored: walk up from this file to the traced root (robust to
 *      whatever cwd the runtime uses);
 *   2. `process.cwd()` (local `pnpm dev` / tests run from the repo root);
 *   3. one and two levels up from cwd (app-dir cwd layouts).
 * If none exists the first candidate is returned unchanged so the loader
 * surfaces the canonical DEMO_FIXTURE_MISSING error rather than a path guess.
 */
function resolveFixturesRoot(): string {
  const candidates: string[] = [];
  try {
    // From apps/web/src/server/composition.ts, the monorepo root is five levels
    // up (server -> src -> web -> apps -> root). The traced layout mirrors that.
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(here, "..", "..", "..", "..", "fixtures", "graveyard"));
    candidates.push(join(here, "..", "..", "..", "fixtures", "graveyard"));
  } catch {
    // import.meta.url may be unavailable in some bundling modes; fall through.
  }
  candidates.push(join(process.cwd(), "fixtures", "graveyard"));
  candidates.push(join(process.cwd(), "..", "..", "fixtures", "graveyard"));

  for (const root of candidates) {
    if (existsSync(join(root, "lich-py2"))) {
      return root;
    }
  }
  return candidates[0] ?? join(process.cwd(), "fixtures", "graveyard");
}

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
 * Provider policy for the shipped build (lovers-binding task 11.6a):
 *   - `llm`:     the real OpenRouter provider WHEN `OPENROUTER_API_KEY` is
 *     present (built here, closing over the `NECRO_LLM_MODEL_FALLBACKS` array
 *     and the per-request token/timeout caps); otherwise UNDEFINED so the live
 *     path runs deterministic fixers only and the runner emits its Degraded
 *     skip-note (R13.3). The route further decides, per request, whether to
 *     swap in a BYOK provider (see `makeUserLlm`). `demoLlm` DOES use the Mock
 *     provider — demo output is deterministic by design (R14.4).
 *   - `router`:  the pure `ModelRouterPort` built from the `@necro/llm` router,
 *     closing over the tier env model ids, injected into every Ritual.
 *   - `makeUserLlm`: a per-request OpenRouter provider factory keyed by the
 *     user key, so BYOK works even with NO server key (item 8 / D.5).
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
  // SEC-06: plumb the validated per-reading LLM call cap
  // (NECRO_LLM_MAX_CALLS_PER_READING, A.8 / R36.1) into the runner so the
  // configured ceiling is actually applied; previously the runner was built
  // with no options and silently used its internal default of 12.
  const runner: CovenRunner = new LocalCovenRunner(
    createDefaultRegistry({ py2to3: py2to3Grimoire }),
    { maxLlmCallsPerReading: base.env.get("NECRO_LLM_MAX_CALLS_PER_READING") },
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

  // --- lovers-binding (task 11.6a): LLM routing + provider wiring -----------

  // The concrete ModelRouterPort (Resolved decision 7): a thin adapter over the
  // pure `@necro/llm` router, closing over the tier env model ids so the runner
  // depends only on the coven-owned port type (`@necro/llm` never imports
  // `@necro/coven`). `route` is the pure tier selection; `resolveModel` applies
  // the override-then-env precedence (A.3). The port type requires a `string`
  // return, so a missing env model id resolves to the empty string — the
  // runner/provider treat an empty model id as the signal to stay on the
  // deterministic path (consistent with resolveModel returning `undefined`).
  const fastModel = base.env.get("NECRO_LLM_MODEL_FAST");
  const strongModel = base.env.get("NECRO_LLM_MODEL_STRONG");
  const modelEnv: { fast?: string; strong?: string } = {
    ...(fastModel !== undefined ? { fast: fastModel } : {}),
    ...(strongModel !== undefined ? { strong: strongModel } : {}),
  };
  const router: ModelRouterPort = {
    route: (signals) => routeModel(signals),
    resolveModel: (tier: ModelTier, override) =>
      resolveModel(tier, modelEnv, override) ?? "",
  };

  // The OpenRouter `models` fallback array and the per-request caps closed over
  // by every provider built here.
  const serverKey = base.env.get("OPENROUTER_API_KEY");
  const fallbackModels = base.env.get("NECRO_LLM_MODEL_FALLBACKS");
  // SEC-03: the configured public URL is wired as the OpenRouter `HTTP-Referer`
  // for attribution. It is server-only config (never user-controlled); when
  // absent the provider keeps its hardcoded fallback. The user supplies NO base
  // URL and NO referer; the only user transport input is `X-Necro-User-Key`.
  const publicUrl = base.env.get("NECRO_PUBLIC_URL");
  const providerModels = fallbackModels !== undefined && fallbackModels.length > 0
    ? fallbackModels
    : undefined;

  // The server-key OpenRouter provider: wired as `deps.llm` for the EXISTING
  // resurrect route ONLY when `OPENROUTER_API_KEY` is present (the critical gap
  // this task closes). When the key is absent the route keeps the
  // Mock/deterministic default (`llm` stays undefined) — unless a valid user
  // key arrives, in which case the route builds a BYOK provider via
  // `makeUserLlm`. `demo` requests never use this provider (the route omits
  // `deps.llm` for demo and uses `demoLlm`), so the "not demo" half of the
  // policy is enforced at the route, not here.
  const serverLlm: LlmPort | undefined =
    serverKey !== undefined
      ? createOpenRouterLlmPort({
          apiKey: serverKey,
          ...(publicUrl !== undefined ? { referer: publicUrl } : {}),
          ...(providerModels !== undefined ? { models: providerModels } : {}),
        })
      : undefined;

  // The per-request BYOK provider factory: builds an OpenRouter provider from a
  // user key for ONE request. Available whenever the OpenRouter provider module
  // is reachable (always, in this build), so BYOK works even with NO server key
  // configured (item 8 / D.5). The key is used for that request only and never
  // stored; the daily-ceiling skip and per-IP keep/skip decisions live in the
  // route.
  const makeUserLlm = (userKey: string): LlmPort =>
    createOpenRouterLlmPort({
      apiKey: userKey,
      ...(publicUrl !== undefined ? { referer: publicUrl } : {}),
      ...(providerModels !== undefined ? { models: providerModels } : {}),
    });

  // Closed-by-default breakers until the spend monitor lands.
  const breakers: SpendBreakers = {
    llmOpen: () => false,
    sandboxOpen: () => false,
  };

  // The demo Ritual loader, bound to the graveyard fixtures root and the Mock
  // provider. Item 2 (judge-ready-pass): `process.cwd()` alone is NOT enough on
  // Vercel — the serverless function only contains TRACED files, placed
  // relative to the `outputFileTracingRoot` (the monorepo root). next.config.ts
  // traces `fixtures/graveyard/lich-py2/**` into the resurrect/lovers functions,
  // so we probe several candidate roots and use the first whose lich-py2
  // directory actually exists: the module-anchored traced layout first (walking
  // up from this file to the traced root), then the repo-root cwd for local dev.
  const fixturesRoot = resolveFixturesRoot();
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
    router,
    makeUserLlm,
    // `llm` is the server OpenRouter provider when a server key is present,
    // else omitted (Degraded_Mode / BYOK-only). `sandbox` omitted unless E2B
    // configured.
    ...(serverLlm === undefined ? {} : { llm: serverLlm }),
    ...(sandbox === undefined ? {} : { sandbox }),
  };
  cachedResurrect = deps;
  return cachedResurrect;
}

// ---------------------------------------------------------------------------
// Lovers_Route deps (lovers-binding, task 11.6b).
//
// The Lovers_Route reuses everything `getResurrectDeps` already wired in 11.6a
// — the shared `RouteDeps` (summon + runReading), the `CovenRunner` (to
// resurrect the bound file to Python 3), the pure `ModelRouterPort`, the server
// OpenRouter provider / per-request BYOK factory / Mock demo provider, the
// spend breakers and the per-ritual ledger factory — and ADDS the Lovers
// capabilities: a `LoversRunner` (a `LocalLoversRunner` built from the
// `LoversGrimoirePort` assembled from the `@necro/grimoires-lovers-js` barrel,
// the sanctioned grimoire import point), a per-request accepted-output cache
// factory, the SEPARATE `NECRO_LOVERS_DAILY_CEILING`, and the offline demo
// seam. Memoised at module scope like `getResurrectDeps`.
// ---------------------------------------------------------------------------

/** The one cached LoversDeps for this warm instance; built on first call. */
let cachedLovers: LoversDeps | undefined;

/**
 * The lovers composition root. Reuses the memoised `ResurrectDeps` (same
 * summoner/limiter/clock/runner/providers) and adds the Lovers runner + seams,
 * memoised so the one `LocalLoversRunner` (built once with the injected
 * `LoversGrimoirePort`) survives across warm requests.
 */
export function getLoversDeps(
  envSource: Record<string, string | undefined> = process.env,
): LoversDeps {
  if (cachedLovers !== undefined) return cachedLovers;

  // Reuse every provider / router / breaker / ledger seam 11.6a already wired.
  const resurrect = getResurrectDeps(envSource);

  // The structural LoversGrimoirePort, assembled from the lovers-js barrel (the
  // sanctioned grimoire import point). coven never imports a grimoire, so the
  // runner receives these capabilities injected.
  const grimoirePort: LoversGrimoirePort = {
    plan: PLAN_STEP,
    generate: GENERATE_STEP,
    buildDeterministicHeart,
    buildTemplatePair,
    validateLovers,
  };

  // The one LoversRunner for this warm instance. Its single-request deadline
  // (A.8) is the default `totalBudgetMs`, kept inside the route's 120 s
  // `maxDuration` backstop minus the summon + resurrect headroom the route
  // spends first.
  const loversRunner: LoversRunner = new LocalLoversRunner(grimoirePort);

  // A per-request accepted-output completion cache (design A.8): a minimal
  // in-memory, first-write-wins store. One cache per request keeps BYOK keys
  // from ever influencing a shared cache and matches the request lifetime.
  const makeCache = (): LlmCachePort => {
    const store = new Map<string, string>();
    return {
      get: (key) => store.get(key),
      set: (key, text) => {
        if (!store.has(key)) store.set(key, text);
      },
    };
  };

  // The separate server daily ceiling for the Lovers_Route (R20.1).
  const loversDailyCeiling = resurrect.env.get("NECRO_LOVERS_DAILY_CEILING");

  // The offline demo seam: load the demo ritual input, resurrect it
  // deterministically (no LlmPort), and hand the first resurrected file's
  // after-content to the binding as its Python 3 source. Network is blocked by
  // the handler for the whole demo run; the Mock provider drives the binding.
  const loadDemoLovers =
    resurrect.loadDemoInput === undefined
      ? undefined
      : async (now: string): Promise<ResurrectedFile> => {
          const input = await resurrect.loadDemoInput!(now);
          const ports: RitualPorts = {
            clock: resurrect.clock,
            ledger: resurrect.makeLedger(),
          };
          const outcome = await resurrect.runner.run(input, ports, {
            phase: () => undefined,
            skipNote: () => undefined,
          });
          const file =
            outcome.result.files.find(
              (f) => f.validated && f.after.trim().length > 0,
            ) ?? outcome.result.files[0];
          if (file === undefined) {
            throw new NecroError(
              "UPSTREAM_UNAVAILABLE",
              "No replay is kept in this crypt.\nThe demo repository has no bindable file.",
            );
          }
          return { file: file.path, source: file.after };
        };

  const deps: LoversDeps = {
    clock: resurrect.clock,
    env: resurrect.env,
    fetch: resurrect.fetch,
    limiter: resurrect.limiter,
    github: resurrect.github,
    runReading: resurrect.runReading,
    loversRunner,
    resurrectRunner: resurrect.runner,
    makeLedger: resurrect.makeLedger,
    makeCache,
    breakers: resurrect.breakers,
    loversDailyCeiling,
    // Reuse the 11.6a provider/router/demo seams unchanged.
    ...(resurrect.router === undefined ? {} : { router: resurrect.router }),
    ...(resurrect.llm === undefined ? {} : { llm: resurrect.llm }),
    ...(resurrect.makeUserLlm === undefined ? {} : { makeUserLlm: resurrect.makeUserLlm }),
    ...(resurrect.demoLlm === undefined ? {} : { demoLlm: resurrect.demoLlm }),
    ...(loadDemoLovers === undefined ? {} : { loadDemoLovers }),
  };
  cachedLovers = deps;
  return cachedLovers;
}
