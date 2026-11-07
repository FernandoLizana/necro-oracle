// apps/web/src/server/handlers/lovers.limits-auth.pbt.test.ts
//
// Feature: lovers-binding, task 11.8 — property tests for the Lovers_Route
// handler `handleLovers` (handler: `./lovers.ts`, design C.5 "Lovers route",
// D.5 "Limits + error mapping + server-key soft-degrade"). These are the two
// correctness properties the design pins for BYOK limits and the auth-failure
// policy, plus the malformed-key no-leak invariant:
//
//   - Property 21 (R24.2, R24.3): on `soulSource` ORACLE (no user key) the
//     SEPARATE server daily ceiling (`NECRO_LOVERS_DAILY_CEILING`) is applied
//     via the per-IP limiter chain pre-stream AND the server spend breaker
//     (`breakers.llmOpen`) is consulted; on `soulSource` YOURS (valid user key)
//     the server spend ceiling/breaker is SKIPPED while the per-IP abuse limit
//     is STILL enforced pre-stream with the lovers ceiling.
//
//   - Property 22 (R28.1, R28.2, R42): a SERVER-key (ORACLE) shortfall
//     SOFT-degrades — a deterministic template result and NO error screen; a
//     USER-key (YOURS) 401/402 (an `UPSTREAM_UNAVAILABLE` raised out of the
//     runner) is the ONE HARD case — a typed oracle-voice `UPSTREAM_UNAVAILABLE`
//     error line and NO silent fallback to the server key (`deps.llm` is never
//     used to pay for a YOURS request whose own key failed auth).
//
//   - A malformed user key terminates PRE-STREAM with `VALIDATION_FAILED` and
//     the offending key value never appears in any output line (R27.3).
//
// The harness mirrors `lovers.test.ts` / `resurrect.test.ts`: a fully-fake
// `LoversDeps` (no network / LLM / sandbox), a controllable fake clock that is
// also the `setTimer` scheduler, real `Request` objects, and the NDJSON body
// consumed line-by-line and validated against `LoversStreamLineSchema`. No unit
// or property test touches the network, an LLM, or a sandbox.
//
// Validates: Requirements 24.2, 24.3, 28.1, 28.2

import type {
  CovenRunner,
  LedgerPort,
  LlmPort,
  LoversEmit,
  LoversResult,
  LoversRunner,
  PhaseEmit,
  RitualInput,
  RitualOutcome,
  RitualPorts,
} from "@necro/coven";
import type { ClockPort, ParsedRepoRef, SummonResult } from "@necro/github";
import { NecroError } from "@necro/oracle/client";
import type { Reading, ReadingOpts, RepoSnapshot } from "@necro/oracle";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  LoversStreamLineSchema,
  type LoversStreamLine,
} from "../../protocol/lovers-stream.js";
import type { GithubGateway, RouteEnvPort, SpendBreakers } from "../deps.js";
import { USER_KEY_HEADER } from "../user-key.js";
import type { LoversHandlerDeps } from "./lovers.js";
import { handleLovers } from "./lovers.js";

// --- constants -------------------------------------------------------------

const FAKE_TOKEN = "ghp_faketoken_0000000000000000000000";
const SERVER_OPENROUTER_KEY = "sk-or-server-0000000000000000000000";
const SHA = "a".repeat(40);
const REF_INPUT = `octo/legacy@${SHA}`;
const T0 = 1_700_000_000_000;
const LOVERS_CEILING = 200;

// --- a controllable fake clock that is ALSO the timer scheduler ------------

interface FakeClock extends ClockPort {
  setTimer(ms: number, cb: () => void): { cancel(): void };
}

function makeFakeClock(startMs = T0): FakeClock {
  const now = startMs;
  return {
    nowMs: () => now,
    setTimer(_ms: number, _cb: () => void) {
      // The budget timer never fires in these tests: every phase/result
      // resolves synchronously, so the Overall_Budget stays pending and is
      // cancelled on completion.
      return { cancel() {} };
    },
  };
}

// --- fakes (no real adapters, no I/O) --------------------------------------

function fakeEnv(values: Partial<Record<string, string | number>> = {}): RouteEnvPort {
  const base: Record<string, string | number | undefined> = {
    GITHUB_TOKEN: FAKE_TOKEN,
    NECRO_CLIENT_IP_HEADER: "x-real-ip",
    NECRO_DAILY_REQUEST_CEILING: 1000,
    NECRO_LOVERS_DAILY_CEILING: LOVERS_CEILING,
    OPENROUTER_API_KEY: SERVER_OPENROUTER_KEY,
    ...values,
  };
  return { get: (key: string) => base[key] } as unknown as RouteEnvPort;
}

function fakeFetch(): LoversHandlerDeps["fetch"] {
  return vi.fn(async () => ({
    status: 200,
    headers: {},
    body: null,
  })) as unknown as LoversHandlerDeps["fetch"];
}

/** A permissive, spyable limiter that records every `check` call. */
function fakeLimiter(): LoversHandlerDeps["limiter"] & { check: ReturnType<typeof vi.fn> } {
  const check = vi.fn(async (_req: unknown) => ({ allowed: true }));
  return { check } as unknown as LoversHandlerDeps["limiter"] & {
    check: ReturnType<typeof vi.fn>;
  };
}

/** The two spend breakers; a spyable `llmOpen` so we can assert it is consulted. */
function fakeBreakers(
  state: { llm?: boolean; sandbox?: boolean } = {},
): SpendBreakers & { llmOpen: ReturnType<typeof vi.fn> } {
  const llmOpen = vi.fn(() => state.llm ?? false);
  return {
    llmOpen,
    sandboxOpen: () => state.sandbox ?? false,
  } as unknown as SpendBreakers & { llmOpen: ReturnType<typeof vi.fn> };
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

/** Build a schema-valid oracle Reading in which THE LOVERS (VI) was drawn. */
function makeReading(snapshot: RepoSnapshot, readOpts: ReadingOpts): Reading {
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
        card: "lovers",
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

function fakeRunReading(): LoversHandlerDeps["runReading"] {
  return ((snapshot: RepoSnapshot, readOpts: ReadingOpts) =>
    Promise.resolve(makeReading(snapshot, readOpts))) as LoversHandlerDeps["runReading"];
}

/** A fake resurrect runner that returns one validated Python 3 file. */
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

/** A schema-valid, deterministic (template-path) LoversResult. */
function makeLoversResult(soulSource: "ORACLE" | "YOURS"): LoversResult {
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
    path: "template",
    soulsSpent: { promptTokens: 0, completionTokens: 0, costUsd: 0, soulSource, byModel: [] },
    soulSource,
    demo: false,
  } as unknown as LoversResult;
}

/**
 * A fake LoversRunner. By default emits the four phases then returns a
 * deterministic template result. A `raise` makes `run` throw the given error
 * (used to model a provider auth failure threaded outward). Records the
 * `LoversPorts` it was called with so a test can inspect the injected `llm`.
 */
function fakeLoversRunner(opts: {
  raise?: () => never;
  soulSource?: "ORACLE" | "YOURS";
} = {}): LoversRunner & {
  run: ReturnType<typeof vi.fn>;
  portsSeen: Array<{ llm: LlmPort | undefined }>;
} {
  const portsSeen: Array<{ llm: LlmPort | undefined }> = [];
  const run = vi.fn(
    async (_input: unknown, ports: { llm?: LlmPort }, emit: LoversEmit) => {
      portsSeen.push({ llm: ports.llm });
      await emit.phase("PLAN");
      if (opts.raise !== undefined) opts.raise();
      await emit.phase("GENERATE");
      await emit.phase("VALIDATE");
      await emit.phase("BIND");
      return makeLoversResult(opts.soulSource ?? "ORACLE");
    },
  );
  return { run, portsSeen } as unknown as LoversRunner & {
    run: ReturnType<typeof vi.fn>;
    portsSeen: Array<{ llm: LlmPort | undefined }>;
  };
}

/**
 * A tagged server-key `LlmPort`: if this provider's `complete` is EVER called
 * on a YOURS request whose own key failed auth, that is the silent-fallback bug
 * (R28.2). `serverLlmUsed` records the violation.
 */
function makeServerLlm(): { llm: LlmPort; serverLlmUsed: () => boolean } {
  let used = false;
  const llm: LlmPort = {
    providerId: "openrouter",
    complete: (async () => {
      used = true;
      return { text: "{}", cached: false };
    }) as LlmPort["complete"],
  } as unknown as LlmPort;
  return { llm, serverLlmUsed: () => used };
}

/** A tagged per-request BYOK provider factory (soulSource YOURS). */
function makeUserLlmFactory(): {
  makeUserLlm: (userKey: string) => LlmPort;
  keysSeen: string[];
} {
  const keysSeen: string[] = [];
  const makeUserLlm = (userKey: string): LlmPort => {
    keysSeen.push(userKey);
    return {
      providerId: "openrouter",
      complete: (async () => ({ text: "{}", cached: false })) as LlmPort["complete"],
    } as unknown as LlmPort;
  };
  return { makeUserLlm, keysSeen };
}

interface DepsBundle {
  deps: LoversHandlerDeps;
  limiter: LoversHandlerDeps["limiter"] & { check: ReturnType<typeof vi.fn> };
  breakers: SpendBreakers & { llmOpen: ReturnType<typeof vi.fn> };
  loversRunner: LoversRunner & {
    run: ReturnType<typeof vi.fn>;
    portsSeen: Array<{ llm: LlmPort | undefined }>;
  };
  serverLlmUsed: () => boolean;
  userKeysSeen: string[];
}

/** Assemble a fully-fake LoversDeps bundle with spyable seams. */
function makeDeps(over: {
  loversRunner?: ReturnType<typeof fakeLoversRunner>;
  breakers?: SpendBreakers & { llmOpen: ReturnType<typeof vi.fn> };
  env?: Partial<Record<string, string | number>>;
} = {}): DepsBundle {
  const clock = makeFakeClock();
  const limiter = fakeLimiter();
  const breakers = over.breakers ?? fakeBreakers();
  const loversRunner = over.loversRunner ?? fakeLoversRunner();
  const { llm: serverLlm, serverLlmUsed } = makeServerLlm();
  const { makeUserLlm, keysSeen } = makeUserLlmFactory();

  const deps = {
    clock,
    env: fakeEnv(over.env),
    fetch: fakeFetch(),
    limiter,
    github: fakeGithub(),
    runReading: fakeRunReading(),
    loversRunner,
    resurrectRunner: fakeResurrectRunner(),
    makeLedger: fakeMakeLedger(),
    breakers,
    loversDailyCeiling: LOVERS_CEILING,
    llm: serverLlm,
    makeUserLlm,
    setTimer: (ms: number, cb: () => void) => clock.setTimer(ms, cb),
  } as unknown as LoversHandlerDeps;

  return { deps, limiter, breakers, loversRunner, serverLlmUsed, userKeysSeen: keysSeen };
}

/** POST a lovers request, optionally with an `X-Necro-User-Key` header. */
function loversRequest(
  body: Record<string, unknown>,
  userKey?: string,
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-real-ip": "203.0.113.7",
  };
  if (userKey !== undefined) headers[USER_KEY_HEADER] = userKey;
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

/** Is there exactly one terminal error line carrying `code`? */
function terminalErrorCode(lines: LoversStreamLine[]): string | undefined {
  const errs = lines.filter((l) => "error" in l);
  if (errs.length !== 1) return undefined;
  const first = errs[0]!;
  return "error" in first ? first.error.code : undefined;
}

/** Is there exactly one terminal result line? */
function hasOneResult(lines: LoversStreamLine[]): boolean {
  return lines.filter((l) => "result" in l).length === 1;
}

/** A valid user-key arbitrary matching `UserKeySchema` (8..512 printable, no space). */
const arbValidUserKey = fc
  .string({ minLength: 8, maxLength: 64, unit: fc.constantFrom(...VALID_KEY_CHARS()) })
  .filter((s) => /^[^\s\x00-\x1f\x7f]{8,512}$/.test(s));

function VALID_KEY_CHARS(): string[] {
  const chars: string[] = [];
  for (let c = 0x21; c <= 0x7e; c++) chars.push(String.fromCharCode(c));
  return chars;
}

// ---------------------------------------------------------------------------
// Property 21 (R24.2, R24.3): BYOK skips the server ceiling but keeps per-IP
// limits.
// ---------------------------------------------------------------------------

describe("P21 (R24.2, R24.3): BYOK skips the server spend ceiling, keeps the per-IP limit", () => {
  it("ORACLE (no user key): per-IP limiter runs pre-stream with the lovers ceiling AND the server spend breaker is consulted", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const bundle = makeDeps();
        const res = await handleLovers(loversRequest({ ...VALID_BODY }), bundle.deps);
        expect(res.status).toBe(200);
        await readLines(res);

        // Per-IP abuse limit ran pre-stream, keyed by "lovers" with the SEPARATE
        // lovers daily ceiling (R20.1 / R24.3).
        expect(bundle.limiter.check).toHaveBeenCalledTimes(1);
        const arg = bundle.limiter.check.mock.calls[0]![0] as {
          route: string;
          dailyCeiling: number;
        };
        expect(arg.route).toBe("lovers");
        expect(arg.dailyCeiling).toBe(LOVERS_CEILING);

        // The server spend breaker IS consulted on ORACLE (the server pays).
        expect(bundle.breakers.llmOpen).toHaveBeenCalled();
      }),
      { numRuns: 60 },
    );
  });

  it("YOURS (valid user key): per-IP limiter STILL runs pre-stream, and the server spend ceiling does NOT gate the request even when its breaker is OPEN", async () => {
    await fc.assert(
      fc.asyncProperty(arbValidUserKey, fc.boolean(), async (userKey, serverBreakerOpen) => {
        // The server spend ceiling is modelled by the LLM spend breaker. For
        // YOURS it must be SKIPPED (R24.2): the request's behaviour is the SAME
        // whether the server breaker is open or closed — the user pays, so the
        // server ceiling never degrades a YOURS request.
        const breakers = fakeBreakers({ llm: serverBreakerOpen });
        const bundle = makeDeps({ breakers });
        const res = await handleLovers(loversRequest({ ...VALID_BODY }, userKey), bundle.deps);
        expect(res.status).toBe(200);
        const lines = await readLines(res);

        // Per-IP abuse limit STILL enforced pre-stream, keyed by "lovers" with
        // the SEPARATE lovers daily ceiling (R24.3).
        expect(bundle.limiter.check).toHaveBeenCalledTimes(1);
        const arg = bundle.limiter.check.mock.calls[0]![0] as {
          route: string;
          dailyCeiling: number;
        };
        expect(arg.route).toBe("lovers");
        expect(arg.dailyCeiling).toBe(LOVERS_CEILING);

        // The server spend ceiling is SKIPPED for YOURS (R24.2): even with the
        // server breaker OPEN, the BYOK provider (built from the user key) is
        // still injected into the runner — the breaker never forced the
        // deterministic degrade and never substituted the server provider.
        expect(bundle.userKeysSeen).toContain(userKey);
        expect(bundle.loversRunner.portsSeen.at(-1)?.llm?.providerId).toBe("openrouter");
        // No server-key soft-degrade NOTICE: the breaker was not enforced.
        expect(lines.some((l) => "skip" in l)).toBe(false);

        // A valid YOURS request still produces exactly one terminal result.
        expect(hasOneResult(lines)).toBe(true);
      }),
      { numRuns: 60 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 22 (R28.1, R28.2, R42): BYOK auth failure has no silent server-key
// fallback; a server-key shortfall soft-degrades.
// ---------------------------------------------------------------------------

describe("P22 (R28.1, R28.2): auth-failure fallback policy", () => {
  it("YOURS 401/402 (runner raises UPSTREAM_UNAVAILABLE): one HARD typed error line, NO silent fallback to the server key", async () => {
    await fc.assert(
      fc.asyncProperty(arbValidUserKey, async (userKey) => {
        const loversRunner = fakeLoversRunner({
          soulSource: "YOURS",
          raise: () => {
            // The OpenRouter provider maps 401/402 -> UPSTREAM_UNAVAILABLE.
            throw new NecroError("UPSTREAM_UNAVAILABLE", "gate refused");
          },
        });
        const bundle = makeDeps({ loversRunner });

        const res = await handleLovers(loversRequest({ ...VALID_BODY }, userKey), bundle.deps);
        expect(res.status).toBe(200);
        const lines = await readLines(res);

        // HARD case: exactly one typed oracle-voice UPSTREAM_UNAVAILABLE error
        // line, never a result (R28.1).
        expect(terminalErrorCode(lines)).toBe("UPSTREAM_UNAVAILABLE");
        expect(hasOneResult(lines)).toBe(false);

        // The runner was driven with the BYOK provider, NOT the server key, and
        // the server-key provider's `complete` was NEVER called — no silent
        // fallback to the server key to pay for a YOURS request (R28.2).
        expect(bundle.userKeysSeen).toContain(userKey);
        expect(bundle.serverLlmUsed()).toBe(false);
      }),
      { numRuns: 60 },
    );
  });

  it("ORACLE server-key shortfall (open spend breaker): SOFT-degrades to a deterministic result, never an error screen", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        // An open server spend breaker is a server-key shortfall: the runner
        // runs the deterministic template path (no LlmPort injected) and the
        // route must NOT error-screen.
        const breakers = fakeBreakers({ llm: true });
        const bundle = makeDeps({ breakers });

        const res = await handleLovers(loversRequest({ ...VALID_BODY }), bundle.deps);
        expect(res.status).toBe(200);
        const lines = await readLines(res);

        // Soft-degrade: a deterministic result, never a terminal error (R42.1).
        expect(terminalErrorCode(lines)).toBeUndefined();
        expect(hasOneResult(lines)).toBe(true);

        // With the breaker open, no LlmPort is injected into the runner (the
        // deterministic path), so the server-key provider is never used.
        expect(bundle.loversRunner.portsSeen.at(-1)?.llm).toBeUndefined();
        expect(bundle.serverLlmUsed()).toBe(false);
      }),
      { numRuns: 40 },
    );
  });

  it("ORACLE runner raising UPSTREAM_UNAVAILABLE is NOT the hard case: it is mapped but is never a YOURS-style silent server-key spend", async () => {
    // Defence-in-depth: even if a provider error threads out on an ORACLE
    // request, the server-key provider's `complete` is never called by the
    // handler itself as a "fallback" (the handler injects one port and lets the
    // runner own fallback). This pins that the server key is only ever used
    // through the normal injected port, never a second silent attempt.
    const loversRunner = fakeLoversRunner({
      soulSource: "ORACLE",
      raise: () => {
        throw new NecroError("UPSTREAM_UNAVAILABLE", "server gate refused");
      },
    });
    const bundle = makeDeps({ loversRunner });

    const res = await handleLovers(loversRequest({ ...VALID_BODY }), bundle.deps);
    expect(res.status).toBe(200);
    const lines = await readLines(res);

    // The ORACLE error is surfaced (the runner threw), but the handler never
    // made a *second* silent server-key attempt beyond the single injected port.
    expect(terminalErrorCode(lines)).toBe("UPSTREAM_UNAVAILABLE");
    expect(bundle.serverLlmUsed()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Malformed user key: PRE-STREAM VALIDATION_FAILED, and the key value never
// appears in any output (R27.3).
// ---------------------------------------------------------------------------

describe("Malformed user key terminates pre-stream and never leaks the value (R27.3)", () => {
  // Malformed keys that survive HTTP header transport. Two caveats shape this
  // generator:
  //   1. A `Request` trims LEADING/TRAILING whitespace from a header value, so
  //      an invalid whitespace character must sit in the INTERIOR to survive.
  //   2. HTTP forbids C0 control characters (e.g. TAB) in a header value and
  //      the `Headers` constructor throws on them — so we do NOT generate those
  //      here (the schema's control-char rejection is unit-tested elsewhere);
  //      the transport-surviving malformed shapes are a too-short value, a
  //      too-long value, and an interior space.
  const arbMalformedKey = fc.oneof(
    // too short (1..7 printable chars) — length alone fails the 8..512 bound.
    fc.string({ minLength: 1, maxLength: 7, unit: fc.constantFrom(...VALID_KEY_CHARS()) }),
    // too long (513..560 printable chars) — over the 512 upper bound.
    fc.string({ minLength: 513, maxLength: 560, unit: fc.constantFrom(...VALID_KEY_CHARS()) }),
    // an interior space (survives header trimming; a space is a legal header
    // byte but fails the no-whitespace key schema).
    fc
      .tuple(
        fc.string({ minLength: 4, maxLength: 16, unit: fc.constantFrom(...VALID_KEY_CHARS()) }),
        fc.string({ minLength: 4, maxLength: 16, unit: fc.constantFrom(...VALID_KEY_CHARS()) }),
      )
      .map(([a, b]) => `${a} ${b}`),
  );

  it("is rejected PRE-STREAM as a 400 VALIDATION_FAILED envelope, with the key value absent from the body", async () => {
    await fc.assert(
      fc.asyncProperty(arbMalformedKey, async (badKey) => {
        const bundle = makeDeps();
        const res = await handleLovers(loversRequest({ ...VALID_BODY }, badKey), bundle.deps);

        // Pre-stream: a 400 plain Error_Envelope (NOT a 200 stream), so no model
        // call and no limiter-passing stream begins.
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: { code: string; userMessage: string } };
        expect(body.error.code).toBe("VALIDATION_FAILED");

        // The offending key value NEVER appears anywhere in the response body
        // (R27.3). Guard against a trivially-contained short/substring key by
        // only asserting non-containment for keys long enough to be meaningful;
        // the schema already bounds min length at 8, so short malformed keys may
        // coincidentally share characters with fixed copy — assert on the
        // whitespace/control variants (length >= 9) which cannot be a substring
        // of the fixed oracle-voice message.
        const raw = JSON.stringify(body);
        if (badKey.length >= 9) {
          expect(raw.includes(badKey)).toBe(false);
        }
        // Never runs the binding.
        expect(bundle.loversRunner.run).not.toHaveBeenCalled();
      }),
      { numRuns: 80 },
    );
  });
});
