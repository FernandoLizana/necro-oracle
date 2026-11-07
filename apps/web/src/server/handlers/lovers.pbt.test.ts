// apps/web/src/server/handlers/lovers.pbt.test.ts
//
// Feature: lovers-binding, task 11.7 — Property 16 (R14.4): the Lovers
// precondition is enforced BEFORE any model call.
//
// Handler under test: `./lovers.ts` (`handleLovers` -> `runBinding`, design C.5
// "Lovers route", R14.4 precondition). The Lovers_Route must refuse to spend a
// soul (call the LoversRunner / an LlmPort) unless BOTH preconditions hold:
//
//   1. the in-scope reading includes THE LOVERS (VI) (card id "lovers"); and
//   2. the requested file resurrects to NON-EMPTY Python 3 after-content
//      (a resurrectable file with bindable top-level functions).
//
// When either fails the route terminates with the typed, oracle-voice
// `VALIDATION_FAILED` error carried inside the 200 NDJSON stream, and the
// `loversRunner` (the model/binding call) is NEVER invoked. Concretely:
//
//   - zero draws            -> VALIDATION_FAILED, no loversRunner.run;
//   - draws WITHOUT "lovers" -> VALIDATION_FAILED, no loversRunner.run;
//   - "lovers" drawn but the file yields empty/no after-content
//                            -> VALIDATION_FAILED, no loversRunner.run;
//   - "lovers" drawn AND non-empty after-content
//                            -> the handler proceeds and CALLS loversRunner.run.
//
// The spy `loversRunner` is the authoritative "a model/binding call happened"
// probe: a precondition bypass (any loversRunner.run call when the precondition
// fails) is a real bug this property would catch.
//
// Pure/Mock only: a fully-fake `LoversDeps` (no network / LLM / sandbox), a
// controllable fake clock that is also the `setTimer` scheduler, real `Request`
// objects, the NDJSON body validated against `LoversStreamLineSchema`. The
// fake-deps shape mirrors `lovers.test.ts` and the sibling resurrect handler
// tests exactly.
//
// **Validates: Requirements 14.4**

import type {
  CovenRunner,
  LedgerPort,
  LoversEmit,
  LoversResult,
  LoversRunner,
  PhaseEmit,
  RitualInput,
  RitualOutcome,
  RitualPorts,
} from "@necro/coven";
import type { ClockPort, ParsedRepoRef, SummonResult } from "@necro/github";
import type { Reading, ReadingOpts, RepoSnapshot } from "@necro/oracle";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  LoversStreamLineSchema,
  type LoversStreamLine,
} from "../../protocol/lovers-stream.js";
import type { GithubGateway, RouteEnvPort, SpendBreakers } from "../deps.js";
import type { LoversHandlerDeps } from "./lovers.js";
import { handleLovers } from "./lovers.js";

// --- constants -------------------------------------------------------------

const FAKE_TOKEN = "ghp_faketoken_0000000000000000000000";
const SHA = "a".repeat(40);
const REF_INPUT = `octo/legacy@${SHA}`;
const T0 = 1_700_000_000_000;
const TARGET_FILE = "src/app.py";
const PY3_AFTER = "def add(a, b):\n    return a + b\n";

// --- a controllable fake clock that is ALSO the timer scheduler ------------

interface FakeClock extends ClockPort {
  setTimer(ms: number, cb: () => void): { cancel(): void };
}

function makeFakeClock(startMs = T0): FakeClock {
  const now = startMs;
  return {
    nowMs: () => now,
    setTimer(_ms: number, _cb: () => void) {
      // The precondition always resolves synchronously relative to the fake
      // clock (no advance), so the Overall_Budget timer never fires here.
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
    NECRO_LOVERS_DAILY_CEILING: 200,
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

function fakeLimiter(): LoversHandlerDeps["limiter"] {
  const check = vi.fn(async () => ({ allowed: true }));
  return { check } as unknown as LoversHandlerDeps["limiter"];
}

function fakeBreakers(): SpendBreakers {
  return { llmOpen: () => false, sandboxOpen: () => false };
}

function fakeMakeLedger(): () => LedgerPort {
  return () => ({ append: vi.fn(async () => undefined) }) as unknown as LedgerPort;
}

function makeSnapshot(): RepoSnapshot {
  return {
    ref: { owner: "octo", name: "legacy", sha: SHA, defaultBranch: "master" },
    files: [{ path: TARGET_FILE, size: 128, lang: "python", sha: "e".repeat(40) }],
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
    contents: new Map<string, string>([[TARGET_FILE, PY3_AFTER]]),
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

/**
 * Build a schema-valid oracle Reading whose draws carry the given card ids
 * (empty => a reading with NO draws, exercising the "cards not yet cast" gate).
 */
function makeReading(
  snapshot: RepoSnapshot,
  readOpts: ReadingOpts,
  cards: readonly string[],
): Reading {
  const draws = cards.map((card, i) => ({
    card,
    orientation: "upright" as const,
    severity: 2,
    position: i + 1,
    evidence: [{ path: TARGET_FILE, line: 1, detail: "x" }],
  }));
  return {
    id: "123e4567-e89b-42d3-a456-426614174000",
    repo: {
      owner: snapshot.ref.owner,
      name: snapshot.ref.name,
      sha: snapshot.ref.sha,
      defaultBranch: snapshot.ref.defaultBranch,
    },
    draws,
    spread: [{ position: 1, label: "The Corpse", draw: null, description: "nothing stirs" }],
    vitality: 42,
    createdAt: readOpts.now,
    engineVersion: "0.0.0",
    errors: [],
  } as unknown as Reading;
}

function fakeRunReading(cards: readonly string[]): LoversHandlerDeps["runReading"] {
  return ((snapshot: RepoSnapshot, readOpts: ReadingOpts) =>
    Promise.resolve(makeReading(snapshot, readOpts, cards))) as LoversHandlerDeps["runReading"];
}

/**
 * A fake resurrect runner returning one file whose `after` is controllable: a
 * non-empty string means the file is resurrectable with content; an empty/
 * whitespace string means the file is not bindable (the route's precondition
 * then fails with NO binding call).
 */
function fakeResurrectRunner(after: string): CovenRunner & { run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async (_input: RitualInput, _ports: RitualPorts, _emit: PhaseEmit) => {
    const outcome: RitualOutcome = {
      result: {
        ritualId: "123e4567-e89b-42d3-a456-426614174000",
        selectedCount: 1,
        files: [
          {
            path: TARGET_FILE,
            before: "def add(a, b):\n    return a + b\n",
            after,
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
  return { run } as unknown as CovenRunner & { run: ReturnType<typeof vi.fn> };
}

/**
 * A resurrect runner that yields a result WITHOUT the requested file at all
 * (the file was filtered out / not a py2 candidate) — another "not bindable"
 * shape the precondition must reject with no binding call.
 */
function fakeResurrectRunnerNoFile(): CovenRunner & { run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async (_input: RitualInput, _ports: RitualPorts, _emit: PhaseEmit) => {
    const outcome: RitualOutcome = {
      result: {
        ritualId: "123e4567-e89b-42d3-a456-426614174000",
        selectedCount: 0,
        files: [],
        patch: "",
        beforeVitality: 42,
        afterVitality: 42,
        vitalityDelta: 0,
        changedCards: [],
        degraded: false,
        demo: false,
      },
      error: null,
    };
    return outcome;
  });
  return { run } as unknown as CovenRunner & { run: ReturnType<typeof vi.fn> };
}

/** A schema-valid LoversResult the (spy) lovers runner returns if ever reached. */
function makeLoversResult(): LoversResult {
  return {
    file: TARGET_FILE,
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
    soulsSpent: { promptTokens: 0, completionTokens: 0, costUsd: 0, soulSource: "ORACLE", byModel: [] },
    soulSource: "ORACLE",
    demo: true,
  } as unknown as LoversResult;
}

/** A SPY lovers runner: records every call and (if reached) emits + returns. */
function spyLoversRunner(): LoversRunner & { run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async (_input: unknown, _ports: unknown, emit: LoversEmit) => {
    await emit.phase("PLAN");
    await emit.phase("GENERATE");
    await emit.phase("VALIDATE");
    await emit.phase("BIND");
    return makeLoversResult();
  });
  return { run } as unknown as LoversRunner & { run: ReturnType<typeof vi.fn> };
}

/** Assemble a fully-fake LoversDeps for one generated case. */
function makeDeps(args: {
  cards: readonly string[];
  resurrectRunner: CovenRunner;
  loversRunner: LoversRunner;
}): LoversHandlerDeps {
  const clock = makeFakeClock();
  return {
    clock,
    env: fakeEnv(),
    fetch: fakeFetch(),
    limiter: fakeLimiter(),
    github: fakeGithub(),
    runReading: fakeRunReading(args.cards),
    loversRunner: args.loversRunner,
    resurrectRunner: args.resurrectRunner,
    makeLedger: fakeMakeLedger(),
    breakers: fakeBreakers(),
    loversDailyCeiling: 200,
    setTimer: (ms: number, cb: () => void) => clock.setTimer(ms, cb),
  } as unknown as LoversHandlerDeps;
}

/** POST a lovers request body as a real Request. */
function loversRequest(body: Record<string, unknown>): Request {
  return new Request("https://necro.test/api/lovers", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7" },
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

function callCount(runner: LoversRunner | CovenRunner): number {
  return (runner as unknown as { run: { mock: { calls: unknown[] } } }).run.mock.calls.length;
}

const LOVERS_CARD = "lovers";

/** Non-lovers card ids drawn from the deck (never the "lovers" id). */
const OTHER_CARDS = [
  "hanged_man",
  "wheel",
  "death",
  "devil",
  "tower",
  "moon",
  "star",
  "hermit",
  "justice",
  "judgement",
  "temperance",
  "world",
] as const;

const arbOtherCard = fc.constantFrom(...OTHER_CARDS);

/** A set of non-lovers cards (possibly empty). */
const arbNonLoversCards = fc.array(arbOtherCard, { minLength: 0, maxLength: 5 });

/**
 * The after-content a resurrect produces for the "not bindable" branch: an
 * empty string or whitespace-only (the route trims and treats it as unbindable).
 */
const arbEmptyAfter = fc.constantFrom("", "   ", "\n", "\t  \n");

const VALID_BODY = {
  ref: REF_INPUT,
  file: TARGET_FILE,
  targetLang: "javascript" as const,
  spread: "fates" as const,
} as const;

// --- the property ----------------------------------------------------------

describe("P16 (R14.4): the Lovers precondition is enforced before any model call", () => {
  it("zero draws -> VALIDATION_FAILED, loversRunner never called", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("fates" as const, "necropsy" as const),
        async (spread) => {
          const loversRunner = spyLoversRunner();
          const deps = makeDeps({
            cards: [],
            resurrectRunner: fakeResurrectRunner(PY3_AFTER),
            loversRunner,
          });

          const res = await handleLovers(loversRequest({ ...VALID_BODY, spread }), deps);
          expect(res.status).toBe(200);

          const lines = await readLines(res);
          const terminal = lines[lines.length - 1]!;
          expect("error" in terminal).toBe(true);
          if ("error" in terminal) {
            expect(terminal.error.code).toBe("VALIDATION_FAILED");
          }
          // No phase line (a phase line means the runner ran).
          expect(lines.some((l) => "phase" in l)).toBe(false);
          // The model/binding call never happened.
          expect(callCount(loversRunner)).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("draws WITHOUT 'lovers' -> VALIDATION_FAILED, loversRunner never called", async () => {
    await fc.assert(
      fc.asyncProperty(
        // At least one non-lovers draw; "lovers" is guaranteed absent.
        arbNonLoversCards.filter((cs) => cs.length >= 1),
        fc.constantFrom("fates" as const, "necropsy" as const),
        async (cards, spread) => {
          const loversRunner = spyLoversRunner();
          const deps = makeDeps({
            cards,
            resurrectRunner: fakeResurrectRunner(PY3_AFTER),
            loversRunner,
          });

          const res = await handleLovers(loversRequest({ ...VALID_BODY, spread }), deps);
          expect(res.status).toBe(200);

          const lines = await readLines(res);
          const terminal = lines[lines.length - 1]!;
          expect("error" in terminal).toBe(true);
          if ("error" in terminal) {
            expect(terminal.error.code).toBe("VALIDATION_FAILED");
          }
          expect(lines.some((l) => "phase" in l)).toBe(false);
          expect(callCount(loversRunner)).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("'lovers' drawn but file not resurrectable -> VALIDATION_FAILED, loversRunner never called", async () => {
    await fc.assert(
      fc.asyncProperty(
        // "lovers" is always present (anywhere among other draws).
        arbNonLoversCards,
        fc.nat({ max: 5 }),
        // The file resurrects to empty after-content, OR the file is absent
        // from the result entirely — both are "not bindable".
        fc.oneof(
          arbEmptyAfter.map((after) => ({ kind: "empty" as const, after })),
          fc.constant({ kind: "missing" as const }),
        ),
        fc.constantFrom("fates" as const, "necropsy" as const),
        async (others, insertAt, outcome, spread) => {
          // Weave the lovers card in at a generated position among the others.
          const idx = others.length === 0 ? 0 : insertAt % (others.length + 1);
          const cards = [...others.slice(0, idx), LOVERS_CARD, ...others.slice(idx)];

          const resurrectRunner =
            outcome.kind === "empty"
              ? fakeResurrectRunner(outcome.after)
              : fakeResurrectRunnerNoFile();

          const loversRunner = spyLoversRunner();
          const deps = makeDeps({ cards, resurrectRunner, loversRunner });

          const res = await handleLovers(loversRequest({ ...VALID_BODY, spread }), deps);
          expect(res.status).toBe(200);

          const lines = await readLines(res);
          const terminal = lines[lines.length - 1]!;
          expect("error" in terminal).toBe(true);
          if ("error" in terminal) {
            expect(terminal.error.code).toBe("VALIDATION_FAILED");
          }
          expect(lines.some((l) => "phase" in l)).toBe(false);
          // The precondition failed AFTER the deterministic resurrect step, so
          // the binding/model call must NOT have fired.
          expect(callCount(loversRunner)).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("'lovers' drawn AND non-empty after-content -> handler proceeds, loversRunner called exactly once", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbNonLoversCards,
        fc.nat({ max: 5 }),
        // Non-empty, non-whitespace Python 3 after-content.
        fc.constantFrom(PY3_AFTER, "def f():\n    return 1\n", "x = 1\n"),
        fc.constantFrom("fates" as const, "necropsy" as const),
        async (others, insertAt, after, spread) => {
          const idx = others.length === 0 ? 0 : insertAt % (others.length + 1);
          const cards = [...others.slice(0, idx), LOVERS_CARD, ...others.slice(idx)];

          const loversRunner = spyLoversRunner();
          const deps = makeDeps({
            cards,
            resurrectRunner: fakeResurrectRunner(after),
            loversRunner,
          });

          const res = await handleLovers(loversRequest({ ...VALID_BODY, spread }), deps);
          expect(res.status).toBe(200);

          const lines = await readLines(res);
          // All preconditions pass => the binding/model call fired exactly once.
          expect(callCount(loversRunner)).toBe(1);
          // And a terminal result line (not a precondition error) was emitted.
          const terminal = lines[lines.length - 1]!;
          expect("result" in terminal).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
