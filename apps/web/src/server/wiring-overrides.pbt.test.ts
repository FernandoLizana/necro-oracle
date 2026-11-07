// apps/web/src/server/wiring-overrides.pbt.test.ts
//
// Feature: lovers-binding, task 11.10 — property tests for the four wiring
// guarantees that span the composition root, the lovers/resurrect handlers, and
// the two browser clients (design: Part B production wiring, C.5 Lovers route,
// D.4 Transport, D.5 Limits + error mapping + degrade matrix). All drives are
// pure / Mock: no network, LLM, or sandbox. The composition cases are driven by
// an env-source override and a cold module re-import per case; the handler and
// client cases use fully-fake deps / a fake `fetch`.
//
// Properties pinned here (tasks.md 11.10):
//   • Property 28 (R34.1-R34.4): WIRING — `getResurrectDeps`/`getLoversDeps`
//     wire the server OpenRouter provider as `deps.llm` IFF `OPENROUTER_API_KEY`
//     is present (else omitted → deterministic / BYOK-only); the pure
//     `ModelRouterPort` is ALWAYS wired; `makeUserLlm` is ALWAYS available
//     (BYOK works with no server key).
//   • Property 34 (R40.1-R40.3): OVERRIDES — `request.models` reach the
//     LoversRunner's `modelOverride` ONLY on `soulSource = YOURS`; on ORACLE the
//     override is ignored and exactly one NOTICE line is emitted.
//   • Property 35 (R41.1, R41.2): HEADER ATTACHMENT — the browser resurrect +
//     lovers clients attach the `X-Necro-User-Key` header IFF a key is set in
//     the (in-memory) SoulKey context, never when absent; the header value
//     equals the key, and the key is never persisted by the context.
//   • Property 36 (R42.1, R42.2): SOFT-DEGRADE — an ORACLE shortfall emits the
//     deterministic result + a NOTICE (no error); a YOURS 401/402 errors hard.
//
// **Validates: Requirements 34.1, 34.2, 34.3, 34.4, 40.1, 40.2, 40.3, 41.1, 41.2, 42.1, 42.2**

import type {
  ClockPort,
  CovenRunner,
  LedgerPort,
  LoversEmit,
  LoversResult,
  LoversRunner,
  LoversRunnerInput,
  PhaseEmit,
  RitualInput,
  RitualOutcome,
  RitualPorts,
} from "@necro/coven";
import type { ParsedRepoRef, SummonResult } from "@necro/github";
import { NecroError } from "@necro/oracle/client";
import type { Reading, ReadingOpts, RepoSnapshot } from "@necro/oracle";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LoversStreamLineSchema,
  type LoversStreamLine,
} from "../protocol/lovers-stream.js";
import type { GithubGateway, RouteEnvPort, SpendBreakers } from "./deps.js";
import type * as Composition from "./composition.js";
import type { LoversHandlerDeps } from "./handlers/lovers.js";
import { handleLovers } from "./handlers/lovers.js";

// `server-only` throws when imported outside an RSC bundle; no-op it so
// composition.ts is importable under Vitest. Hoisted above every import.
vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const FAKE_TOKEN = "ghp_faketoken_0000000000000000000000";
const SHA = "a".repeat(40);
const REF_INPUT = `octo/legacy@${SHA}`;
const T0 = 1_700_000_000_000;

/** A valid user key per `UserKeySchema` (8..512 printable, space-free chars). */
const VALID_USER_KEY = "sk-or-v1-abcdef0123456789";

// ===========================================================================
// Property 28 (R34.1-R34.4): WIRING — deps.llm / router / makeUserLlm
// ===========================================================================
//
// `getResurrectDeps`/`getLoversDeps` memoise at module scope, so each case
// re-imports `composition.js` from a COLD module registry (vi.resetModules +
// dynamic import) and drives it with an env-source override that toggles the
// server key present/absent. The guarantees:
//   - `deps.llm` is present IFF `OPENROUTER_API_KEY` is set (the "not demo" half
//     is a per-request route decision, enforced at the handler, not here);
//   - `deps.router` (the pure ModelRouterPort) is ALWAYS wired;
//   - `deps.makeUserLlm` is ALWAYS available (BYOK with no server key).

/** Env source WITH a server OpenRouter key. */
const ENV_WITH_KEY: Record<string, string | undefined> = {
  OPENROUTER_API_KEY: "sk-server-key-present-000000",
  NECRO_LLM_MODEL_FAST: "openai/gpt-4o-mini",
  NECRO_LLM_MODEL_STRONG: "anthropic/claude-3.5-sonnet",
  NECRO_DAILY_REQUEST_CEILING: "1000",
  NECRO_CLIENT_IP_HEADER: "x-real-ip",
};

/** Env source WITHOUT any server OpenRouter key (BYOK-only / deterministic). */
const ENV_WITHOUT_KEY: Record<string, string | undefined> = {
  NECRO_DAILY_REQUEST_CEILING: "1000",
  NECRO_CLIENT_IP_HEADER: "x-real-ip",
};

describe("Property 28 (R34.1, R34.2, R34.3, R34.4): resurrect/lovers wire deps.llm from the key; router + makeUserLlm always present", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Re-import composition from a cold registry so memoisation starts fresh. */
  async function freshComposition(): Promise<typeof Composition> {
    vi.doMock("server-only", () => ({}));
    return import("./composition.js");
  }

  it("resurrect: deps.llm present IFF OPENROUTER_API_KEY set; router + makeUserLlm always present", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (keyPresent) => {
        vi.resetModules();
        const { getResurrectDeps } = await freshComposition();
        const deps = getResurrectDeps(keyPresent ? ENV_WITH_KEY : ENV_WITHOUT_KEY);

        // deps.llm is the server OpenRouter provider IFF a server key is set.
        expect(deps.llm !== undefined).toBe(keyPresent);
        // The pure ModelRouterPort is ALWAYS wired (R35.4), both methods.
        expect(deps.router).toBeDefined();
        expect(typeof deps.router?.route).toBe("function");
        expect(typeof deps.router?.resolveModel).toBe("function");
        // makeUserLlm is ALWAYS available so BYOK works with no server key.
        expect(typeof deps.makeUserLlm).toBe("function");
      }),
      { numRuns: 50 },
    );
  });

  it("lovers: deps.llm present IFF OPENROUTER_API_KEY set; router + makeUserLlm always present", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (keyPresent) => {
        vi.resetModules();
        const { getLoversDeps } = await freshComposition();
        const deps = getLoversDeps(keyPresent ? ENV_WITH_KEY : ENV_WITHOUT_KEY);

        expect(deps.llm !== undefined).toBe(keyPresent);
        expect(deps.router).toBeDefined();
        expect(typeof deps.router?.route).toBe("function");
        expect(typeof deps.router?.resolveModel).toBe("function");
        expect(typeof deps.makeUserLlm).toBe("function");
      }),
      { numRuns: 50 },
    );
  });

  it("Mock stays the default when no key at all is present (demoLlm is the Mock provider)", async () => {
    vi.resetModules();
    const { getResurrectDeps } = await freshComposition();
    const deps = getResurrectDeps(ENV_WITHOUT_KEY);
    // No server LlmPort, but the deterministic/demo seam still carries a Mock.
    expect(deps.llm).toBeUndefined();
    expect(deps.demoLlm).toBeDefined();
    expect(deps.demoLlm?.providerId).toBe("mock");
  });
});

// ===========================================================================
// Shared fakes for the handler-driven properties (34, 36)
// ===========================================================================

interface FakeClock extends ClockPort {
  setTimer(ms: number, cb: () => void): { cancel(): void };
}

function makeFakeClock(startMs = T0): FakeClock {
  const now = startMs;
  return {
    nowMs: () => now,
    setTimer(_ms: number, _cb: () => void) {
      // The budget timer never fires in these cases (the runner resolves
      // synchronously under the fake clock); a no-op cancel suffices.
      return { cancel() {} };
    },
  };
}

function fakeEnv(values: Partial<Record<string, string | number>> = {}): RouteEnvPort {
  const base: Record<string, string | number | undefined> = {
    GITHUB_TOKEN: FAKE_TOKEN,
    NECRO_CLIENT_IP_HEADER: "x-real-ip",
    NECRO_DAILY_REQUEST_CEILING: 1000,
    NECRO_LOVERS_DAILY_CEILING: 200,
    ...values,
  };
  return { get: (key: string) => base[key] } as unknown as RouteEnvPort;
}

function fakeFetch(): LoversHandlerDeps["fetch"] {
  return vi.fn(async () => ({ status: 200, headers: {}, body: null })) as unknown as LoversHandlerDeps["fetch"];
}

function fakeLimiter(): LoversHandlerDeps["limiter"] {
  const check = vi.fn(async () => ({ allowed: true }));
  return { check } as unknown as LoversHandlerDeps["limiter"];
}

function fakeBreakers(state: { llm?: boolean; sandbox?: boolean } = {}): SpendBreakers {
  return {
    llmOpen: () => state.llm ?? false,
    sandboxOpen: () => state.sandbox ?? false,
  };
}

function fakeMakeLedger(): () => LedgerPort {
  return () => ({ append: vi.fn(async () => undefined) }) as unknown as LedgerPort;
}

function makeSnapshot(): RepoSnapshot {
  return {
    ref: { owner: "octo", name: "legacy", sha: SHA, defaultBranch: "master" },
    files: [{ path: "src/app.py", size: 128, lang: "python", sha: "e".repeat(40) }],
    meta: {
      pushedAt: "2014-01-01T00:00:00Z",
      isArchived: false,
      openIssueCount: 3,
      openPRCount: 1,
      oldestOpenPRAgeDays: 400,
      latestReleaseAt: null,
      licenseKey: "mit",
    },
    manifests: [],
    oversizeFiles: [],
    truncated: false,
    createdAt: "2024-01-01T00:00:00Z",
    contents: new Map<string, string>([["src/app.py", "def add(a, b):\n    return a + b\n"]]),
  } as unknown as RepoSnapshot;
}

function makeSummonResult(): SummonResult {
  return {
    snapshot: makeSnapshot(),
    extras: { stars: 1, defaultBranch: "master", hasWorkflowsDir: false, degradedFields: [] },
    cache: "miss",
  } as unknown as SummonResult;
}

function fakeGithub(): GithubGateway {
  const summon = vi.fn(async (_input: ParsedRepoRef) => makeSummonResult());
  const externalData = vi.fn(async (_snapshot: RepoSnapshot) => ({
    registryData: new Map(),
    osvData: [],
    skipped: [],
  }));
  return { summon, externalData } as unknown as GithubGateway;
}

function makeReading(snapshot: RepoSnapshot, readOpts: ReadingOpts, card: string): Reading {
  return {
    id: "123e4567-e89b-42d3-a456-426614174000",
    repo: {
      owner: snapshot.ref.owner,
      name: snapshot.ref.name,
      sha: snapshot.ref.sha,
      defaultBranch: snapshot.ref.defaultBranch,
    },
    draws: [
      {
        card,
        orientation: "upright",
        severity: 2,
        position: 1,
        evidence: [{ path: "src/app.py", line: 1, detail: "x" }],
      },
    ],
    spread: [{ position: 1, label: "The Corpse", draw: null, description: "nothing stirs" }],
    vitality: 42,
    createdAt: readOpts.now,
    engineVersion: "0.0.0",
    errors: [],
  } as unknown as Reading;
}

function fakeRunReading(card: string): LoversHandlerDeps["runReading"] {
  return ((snapshot: RepoSnapshot, readOpts: ReadingOpts) =>
    Promise.resolve(makeReading(snapshot, readOpts, card))) as LoversHandlerDeps["runReading"];
}

function fakeResurrectRunner(): CovenRunner {
  const run = vi.fn(async (_input: RitualInput, _ports: RitualPorts, _emit: PhaseEmit) => {
    const outcome: RitualOutcome = {
      result: {
        ritualId: "123e4567-e89b-42d3-a456-426614174000",
        selectedCount: 1,
        files: [
          {
            path: "src/app.py",
            before: "def add(a, b):\n    return a + b\n",
            after: "def add(a, b):\n    return a + b\n",
            diff: [],
            residuals: [],
            fullyConverted: true,
            validated: true,
          },
        ],
        patch: "",
        beforeVitality: 42,
        afterVitality: 55,
        vitalityDelta: 13,
        changedCards: [],
        degraded: false,
        demo: false,
      },
      error: null,
    };
    return outcome;
  });
  return { run } as unknown as CovenRunner;
}

/** A schema-valid LoversResult the fake lovers runner returns, with `path`/`soulSource`. */
function makeLoversResult(args: {
  path: "llm" | "template";
  soulSource: "ORACLE" | "YOURS";
}): LoversResult {
  return {
    file: "src/app.py",
    targetLang: "javascript",
    pair: {
      jsBeloved: "// beloved",
      contractSchema: "{}",
      pythonTests: "# py tests",
      jsTests: "// js tests",
      pythonHeart: "# heart",
    },
    plan: {
      functions: [
        {
          name: "add",
          params: [],
          returns: { pyType: "int", jsonType: "number", jsType: "number" },
          bindable: true,
          edgeCases: [],
        },
      ],
      typeMap: [],
    },
    path: args.path,
    soulsSpent: {
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      soulSource: args.soulSource,
      byModel: [],
    },
    soulSource: args.soulSource,
    demo: false,
  } as unknown as LoversResult;
}

/**
 * A fake lovers runner that records the `modelOverride` it was handed and emits
 * the four phases before returning a result. `onThrow`, when set, is thrown
 * instead of returning (used for the hard YOURS-auth-failure case).
 */
function recordingLoversRunner(opts: {
  path: "llm" | "template";
  soulSource: "ORACLE" | "YOURS";
  onThrow?: () => never;
}): LoversRunner & { readonly lastInput: LoversRunnerInput | undefined } {
  const holder: { lastInput: LoversRunnerInput | undefined } = { lastInput: undefined };
  const run = vi.fn(async (input: LoversRunnerInput, _ports: unknown, emit: LoversEmit) => {
    holder.lastInput = input;
    await emit.phase("PLAN");
    await emit.phase("GENERATE");
    await emit.phase("VALIDATE");
    await emit.phase("BIND");
    if (opts.onThrow !== undefined) opts.onThrow();
    return makeLoversResult({ path: opts.path, soulSource: opts.soulSource });
  });
  // A live getter for `lastInput` (not a snapshot copy): the closure above
  // mutates `holder`, and this getter reads it back after `run` resolves.
  const runner = { run } as unknown as LoversRunner & {
    readonly lastInput: LoversRunnerInput | undefined;
  };
  Object.defineProperty(runner, "lastInput", {
    get: () => holder.lastInput,
    enumerable: true,
  });
  return runner;
}

/** Assemble a fully-fake LoversHandlerDeps. */
function makeLoversDeps(over: {
  card?: string;
  loversRunner: LoversRunner;
  llm?: LoversHandlerDeps["llm"];
  makeUserLlm?: LoversHandlerDeps["makeUserLlm"];
  breakers?: SpendBreakers;
  env?: Partial<Record<string, string | number>>;
}): LoversHandlerDeps {
  const clock = makeFakeClock();
  return {
    clock,
    env: fakeEnv(over.env),
    fetch: fakeFetch(),
    limiter: fakeLimiter(),
    github: fakeGithub(),
    runReading: fakeRunReading(over.card ?? "lovers"),
    loversRunner: over.loversRunner,
    resurrectRunner: fakeResurrectRunner(),
    makeLedger: fakeMakeLedger(),
    breakers: over.breakers ?? fakeBreakers(),
    loversDailyCeiling: 200,
    router: { route: () => "FAST", resolveModel: () => "model" },
    setTimer: (ms: number, cb: () => void) => clock.setTimer(ms, cb),
    ...(over.llm !== undefined ? { llm: over.llm } : {}),
    ...(over.makeUserLlm !== undefined ? { makeUserLlm: over.makeUserLlm } : {}),
  } as unknown as LoversHandlerDeps;
}

/** A trivial Mock-shaped LlmPort (never actually invoked by the fake runner). */
function fakeLlm(): NonNullable<LoversHandlerDeps["llm"]> {
  return {
    providerId: "mock",
    complete: async () => ({ text: "{}", cached: false }),
  } as unknown as NonNullable<LoversHandlerDeps["llm"]>;
}

/** POST a lovers request body as a real Request, with an optional user key. */
function loversRequest(body: Record<string, unknown>, userKey?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-real-ip": "203.0.113.7",
  };
  if (userKey !== undefined) headers["x-necro-user-key"] = userKey;
  return new Request("https://necro.test/api/lovers", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** Read the NDJSON body into validated stream lines. */
async function readLines(res: Response): Promise<LoversStreamLine[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => LoversStreamLineSchema.parse(JSON.parse(l)));
}

const VALID_BODY = {
  ref: REF_INPUT,
  file: "src/app.py",
  targetLang: "javascript",
  spread: "fates",
} as const;

// ===========================================================================
// Property 34 (R40.1, R40.2, R40.3): OVERRIDES honoured only on YOURS
// ===========================================================================

describe("Property 34 (R40.1, R40.2, R40.3): model overrides reach the runner only on YOURS; ignored with a NOTICE on ORACLE", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Arbitrary optional model-override object (fast/strong each optional). */
  const arbModels = fc.option(
    fc
      .record(
        {
          fast: fc.option(fc.constantFrom("openai/gpt-4o-mini", "x/y"), { nil: undefined }),
          strong: fc.option(fc.constantFrom("anthropic/claude-3.5-sonnet", "a/b"), {
            nil: undefined,
          }),
        },
        { requiredKeys: [] },
      )
      // At least one field set, so an empty-but-present `models` object does not
      // muddy "present" vs "absent".
      .filter((m) => m.fast !== undefined || m.strong !== undefined),
    { nil: undefined },
  );

  it("YOURS: request.models reach the LoversRunner.modelOverride (no NOTICE)", async () => {
    await fc.assert(
      fc.asyncProperty(arbModels, async (models) => {
        const runner = recordingLoversRunner({ path: "llm", soulSource: "YOURS" });
        const deps = makeLoversDeps({
          loversRunner: runner,
          makeUserLlm: () => fakeLlm(),
        });
        const body: Record<string, unknown> = { ...VALID_BODY };
        if (models !== undefined) body.models = models;

        const res = await handleLovers(loversRequest(body, VALID_USER_KEY), deps);
        const lines = await readLines(res);

        // No "overrides ignored" NOTICE on YOURS.
        const notices = lines.filter((l): l is { skip: true; note: string } => "skip" in l);
        expect(notices.some((n) => /overrides ignored/i.test(n.note))).toBe(false);

        const handed = runner.lastInput?.modelOverride;
        if (models === undefined) {
          expect(handed).toBeUndefined();
        } else {
          // modelOverride iff YOURS: the set fields are threaded through.
          expect(handed).toBeDefined();
          if (models.fast !== undefined) expect(handed?.fast).toBe(models.fast);
          if (models.strong !== undefined) expect(handed?.strong).toBe(models.strong);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("ORACLE: request.models are ignored (runner sees no override) and exactly one NOTICE is emitted when models were sent", async () => {
    await fc.assert(
      fc.asyncProperty(arbModels, async (models) => {
        const runner = recordingLoversRunner({ path: "template", soulSource: "ORACLE" });
        const deps = makeLoversDeps({ loversRunner: runner, llm: fakeLlm() });
        const body: Record<string, unknown> = { ...VALID_BODY };
        if (models !== undefined) body.models = models;

        // No user key => ORACLE.
        const res = await handleLovers(loversRequest(body), deps);
        const lines = await readLines(res);

        // The runner NEVER receives a modelOverride on ORACLE.
        expect(runner.lastInput?.modelOverride).toBeUndefined();

        const noticeCount = lines.filter(
          (l) => "skip" in l && /overrides ignored/i.test(l.note),
        ).length;
        // Exactly one NOTICE iff overrides were actually sent; otherwise none.
        expect(noticeCount).toBe(models !== undefined ? 1 : 0);

        // Soft-degrade, not an error: a terminal result line, no error line.
        const last = lines[lines.length - 1]!;
        expect("result" in last).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ===========================================================================
// Property 36 (R42.1, R42.2): SOFT-DEGRADE vs the hard YOURS case
// ===========================================================================

describe("Property 36 (R42.1, R42.2): ORACLE shortfalls soft-degrade with a NOTICE; a YOURS 401/402 errors hard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ORACLE shortfall (open breaker / no key) => deterministic result + >=1 NOTICE, never an error line", async () => {
    // The ORACLE degrade conditions wired at the composition→handler seam:
    //   - breaker open (deps.llm present but breaker trips), and
    //   - no server key AND no provider (deps.llm undefined, serverKey absent).
    const arbCase = fc.constantFrom<"breaker" | "nokey">("breaker", "nokey");
    await fc.assert(
      fc.asyncProperty(arbCase, async (which) => {
        const runner = recordingLoversRunner({ path: "template", soulSource: "ORACLE" });
        const deps =
          which === "breaker"
            ? makeLoversDeps({
                loversRunner: runner,
                llm: fakeLlm(),
                breakers: fakeBreakers({ llm: true }),
              })
            : makeLoversDeps({ loversRunner: runner });

        const res = await handleLovers(loversRequest({ ...VALID_BODY }), deps);
        expect(res.status).toBe(200);
        const lines = await readLines(res);

        // No error line — a soft-degrade is never an error screen.
        expect(lines.some((l) => "error" in l)).toBe(false);
        // Exactly one terminal line and it is the deterministic result.
        const last = lines[lines.length - 1]!;
        expect("result" in last).toBe(true);
        if ("result" in last) expect(last.result.path).toBe("template");
        // At least one NOTICE line explains the degrade.
        expect(lines.some((l) => "skip" in l)).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it("YOURS 401/402 (provider raises UPSTREAM_UNAVAILABLE) => a hard typed error line, no silent server-key fallback", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const runner = recordingLoversRunner({
          path: "llm",
          soulSource: "YOURS",
          onThrow: () => {
            throw new NecroError(
              "UPSTREAM_UNAVAILABLE",
              "Your soul was refused at the gate.\nOpenRouter rejected your key.",
            );
          },
        });
        const serverLlm = fakeLlm();
        const makeUserLlm = vi.fn(() => fakeLlm());
        const deps = makeLoversDeps({
          loversRunner: runner,
          llm: serverLlm,
          makeUserLlm,
        });

        const res = await handleLovers(loversRequest({ ...VALID_BODY }, VALID_USER_KEY), deps);
        expect(res.status).toBe(200);
        const lines = await readLines(res);

        // The terminal line is a typed error (the hard YOURS case), not a result.
        const last = lines[lines.length - 1]!;
        expect("error" in last).toBe(true);
        if ("error" in last) {
          expect(last.error.code).toBe("UPSTREAM_UNAVAILABLE");
        }
        expect(lines.some((l) => "result" in l)).toBe(false);
        // The BYOK provider was built from the user key (no silent server-key path).
        expect(makeUserLlm).toHaveBeenCalledWith(VALID_USER_KEY);
      }),
      { numRuns: 10 },
    );
  });
});
