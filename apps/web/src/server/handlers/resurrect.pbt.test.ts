// apps/web/src/server/handlers/resurrect.pbt.test.ts
//
// Feature: resurrection-engine, task 13.3 (PROPERTY TEST).
//
// Property 11 — "Exactly one terminal line with a two-field error envelope".
// The Resurrection_Route stream (`handleResurrect`, resurrect.ts) commits to a
// `200 application/x-ndjson` body once the request schema passes and carries
// every subsequent outcome as a line of that stream: zero-or-more Phase_Lines
// and Skip_Note_Lines, then EXACTLY ONE terminal line — a Result_Line
// (`{ result }`) or an Error_Line (`{ error: { code, userMessage } }`). This
// file pins two guarantees across a wide space of runner outcomes:
//
//   (1) The stream ends with EXACTLY ONE terminal line and it is the LAST line:
//       no line follows it, and every non-terminal line is a phase line or a
//       skip-note line (R9.3).
//   (2) Any Error_Line payload's `error` object has EXACTLY the keys `code` and
//       `userMessage` — no `cause`, no stack, no other field (R12.1).
//
// The drive is a fake `CovenRunner` + a fully fake `ResurrectDeps` (mirroring
// the readings.test.ts harness): varied RitualResult shapes, a returned
// BUDGET_EXHAUSTED-style terminal error, thrown errors (NecroError and plain),
// varied skip-note sequences and both spend-breaker states. No network, LLM or
// sandbox is touched. The seam is a fake-clock `setTimer` so no wall clock runs.
//
// **Validates: Requirements 9.3, 12.1**

import type {
  ClockPort,
  ExternalDataResult,
  FetchPort,
  ParsedRepoRef,
  SummonResult,
} from "@necro/github";
import type {
  CovenRunner,
  LedgerPort,
  PhaseEmit,
  RitualInput,
  RitualOutcome,
  RitualPorts,
  RitualResult,
} from "@necro/coven";
import { NecroError } from "@necro/oracle/client";
import type { Reading, ReadingOpts, RepoSnapshot } from "@necro/oracle";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  ResurrectStreamLineSchema,
  type ResurrectStreamLine,
} from "../../protocol/resurrect-stream.js";
import type { GithubGateway, RouteEnvPort } from "../deps.js";
import type { ResurrectDeps, SpendBreakers } from "../deps.js";
import {
  handleResurrect,
  type ResurrectHandlerDeps,
  type SetTimer,
} from "./resurrect.js";

// --- constants -------------------------------------------------------------

/** The fake token the fake env hands out — must never appear in any line. */
const FAKE_TOKEN = "ghp_faketoken_0000000000000000000000";

/** A plausible 40-hex lowercase commit sha for the pinned ref. */
const SHA = "a".repeat(40);

/** A commit-pinned ref the ResurrectRequestSchema accepts: owner/name@<40-hex>. */
const REF_INPUT = `octo/legacy@${SHA}`;

/** A fixed clock origin so `now` is deterministic. */
const T0 = 1_700_000_000_000;

// --- a controllable fake clock that is also the timer scheduler ------------

interface FakeTimer {
  readonly deadline: number;
  readonly cb: () => void;
  fired: boolean;
  cancelled: boolean;
}

interface FakeClock extends ClockPort {
  advance(ms: number): void;
  setTimer: SetTimer;
}

/**
 * A ClockPort whose `nowMs()` only moves when the test calls `advance`.
 * `setTimer(ms, cb)` schedules a cancellable callback. The budget timer never
 * fires in this suite (we never advance past the Overall_Budget), so every
 * terminal line comes from the runner path, not the backstop.
 */
function makeFakeClock(startMs = T0): FakeClock {
  let now = startMs;
  const timers: FakeTimer[] = [];
  return {
    nowMs: () => now,
    setTimer(ms: number, cb: () => void) {
      const timer: FakeTimer = { deadline: now + ms, cb, fired: false, cancelled: false };
      timers.push(timer);
      return {
        cancel() {
          timer.cancelled = true;
        },
      };
    },
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = timers
          .filter((t) => !t.fired && !t.cancelled && t.deadline <= target)
          .sort((a, b) => a.deadline - b.deadline);
        const next = due[0];
        if (next === undefined) break;
        now = next.deadline;
        next.fired = true;
        next.cb();
      }
      now = target;
    },
  };
}

// --- fakes (no real adapters, no I/O) --------------------------------------

/** A fake RouteEnvPort handing out the fake token and documented defaults. */
function fakeEnv(values: Partial<Record<string, string | number>> = {}): RouteEnvPort {
  const base: Record<string, string | number | undefined> = {
    GITHUB_TOKEN: FAKE_TOKEN,
    NECRO_CLIENT_IP_HEADER: "x-real-ip",
    NECRO_DAILY_REQUEST_CEILING: 1000,
    ...values,
  };
  return { get: (key: string) => base[key] } as unknown as RouteEnvPort;
}

/** A fake FetchPort — the handler reaches GitHub only through the gateway. */
function fakeFetch(): FetchPort {
  return (async () => ({ status: 200, headers: {}, body: null })) as unknown as FetchPort;
}

/** A permissive limiter (always allow — guards are covered by 13.4). */
function fakeLimiter(): ResurrectDeps["limiter"] {
  return { check: async () => ({ allowed: true }) } as unknown as ResurrectDeps["limiter"];
}

/** A minimal, schema-shaped SummonResult; its contents never reach the stream. */
function makeSummonResult(): SummonResult {
  const snapshot: RepoSnapshot = {
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
    contents: new Map<string, string>([["src/app.py", "print 'hi'"]]),
  };
  return {
    snapshot,
    extras: {
      stars: 1,
      defaultBranch: "master",
      hasWorkflowsDir: false,
      degradedFields: [],
    },
    cache: "miss",
  } as unknown as SummonResult;
}

/** A fake GithubGateway. Only `summon` is used by the handler's live path. */
function fakeGithub(): GithubGateway {
  return {
    summon: async (_input: ParsedRepoRef) => makeSummonResult(),
    externalData: async (_snapshot: RepoSnapshot) =>
      ({ registryData: new Map(), osvData: [], skipped: [] }) as ExternalDataResult,
  };
}

/**
 * A fake runReading returning a reading with ONE draw so the handler's
 * reading-required guard (R1.6) passes and the Ritual proceeds. The handler
 * only reads `reading.draws.length`; the faked runner never inspects the draw,
 * so a single placeholder entry (cast) is sufficient.
 */
function fakeRunReading(): ResurrectDeps["runReading"] {
  return (async (snapshot: RepoSnapshot, readOpts: ReadingOpts) =>
    ({
      id: "123e4567-e89b-42d3-a456-426614174000",
      repo: {
        owner: snapshot.ref.owner,
        name: snapshot.ref.name,
        sha: snapshot.ref.sha,
        defaultBranch: snapshot.ref.defaultBranch,
      },
      draws: [{ card: "hanged_man" }],
      spread: [{ position: 1, label: "The Corpse", draw: null, description: "stirs" }],
      vitality: 42,
      createdAt: readOpts.now,
      engineVersion: "0.0.0",
      errors: [],
    }) as unknown as Reading) as ResurrectDeps["runReading"];
}

/** Fixed-state spend breakers. */
function fakeBreakers(llmOpen: boolean, sandboxOpen: boolean): SpendBreakers {
  return { llmOpen: () => llmOpen, sandboxOpen: () => sandboxOpen };
}

/** A no-op append-only ledger (the handler only calls `makeLedger()`). */
function fakeMakeLedger(): LedgerPort {
  return { append: async () => undefined } as unknown as LedgerPort;
}

/**
 * A fake CovenRunner driven by a generated `plan`: it emits the planned phases
 * and skip-notes through `emit`, then either returns a `RitualOutcome`
 * (success or a returned terminal error) or throws (NecroError / plain).
 */
interface RunnerPlan {
  readonly phases: readonly (
    | "SELECT"
    | "PRE_PASS"
    | "LLM_PASS"
    | "VALIDATE"
    | "REDIAGNOSE"
    | "DIFF"
  )[];
  readonly skipNotes: readonly string[];
  readonly terminal:
    | { kind: "result"; result: RitualResult }
    | { kind: "returned-error"; error: NecroError }
    | { kind: "throw-necro"; error: NecroError }
    | { kind: "throw-plain"; message: string };
}

function fakeRunner(plan: RunnerPlan): CovenRunner {
  return {
    async run(
      _input: RitualInput,
      _ports: RitualPorts,
      emit: PhaseEmit,
    ): Promise<RitualOutcome> {
      for (const phase of plan.phases) {
        await emit.phase(phase);
      }
      for (const note of plan.skipNotes) {
        await emit.skipNote(note);
      }
      switch (plan.terminal.kind) {
        case "result":
          return { result: plan.terminal.result, error: null };
        case "returned-error":
          return { result: emptyResult(), error: plan.terminal.error };
        case "throw-necro":
          throw plan.terminal.error;
        case "throw-plain":
          throw new Error(plan.terminal.message);
      }
    },
  };
}

/** A minimal, schema-valid RitualResult used as the partial of a returned error. */
function emptyResult(): RitualResult {
  return {
    ritualId: "7f3d6b1e-9c2a-4d5e-8b1a-0f2c3d4e5f60",
    selectedCount: 0,
    files: [],
    patch: "",
    beforeVitality: 40,
    afterVitality: 55,
    vitalityDelta: 15,
    changedCards: [],
    degraded: false,
    demo: false,
  };
}

/** Assemble a full fake ResurrectHandlerDeps around a planned runner + state. */
function makeDeps(args: {
  runner: CovenRunner;
  breakers: SpendBreakers;
  clock: FakeClock;
}): ResurrectHandlerDeps {
  return {
    clock: args.clock,
    env: fakeEnv(),
    fetch: fakeFetch(),
    limiter: fakeLimiter(),
    github: fakeGithub(),
    runReading: fakeRunReading(),
    runner: args.runner,
    makeLedger: fakeMakeLedger,
    breakers: args.breakers,
    setTimer: args.clock.setTimer,
  };
}

// --- Request + NDJSON reading ----------------------------------------------

function postResurrect(body: unknown): Request {
  return new Request("https://necro.test/api/resurrect", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7" },
    body: JSON.stringify(body),
  });
}

/** Read the entire ReadableStream body of a Response to a single string. */
async function readBodyText(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value !== undefined) out += decoder.decode(value, { stream: true });
    if (done) break;
  }
  out += decoder.decode();
  return out;
}

/** Split an NDJSON body into its non-empty raw lines, preserving order. */
function rawLines(body: string): string[] {
  return body.split("\n").filter((l) => l.trim().length > 0);
}

// --- arbitraries -----------------------------------------------------------

const PHASES = [
  "SELECT",
  "PRE_PASS",
  "LLM_PASS",
  "VALIDATE",
  "REDIAGNOSE",
  "DIFF",
] as const;

/** An ordered, non-repeating phase prefix (0..6 phases) — how the runner emits. */
const arbPhases = fc
  .integer({ min: 0, max: PHASES.length })
  .map((n) => PHASES.slice(0, n));

/** 0..3 free-text skip-notes (1..2000 chars so they validate as Skip_Note_Lines). */
const arbSkipNotes = fc.array(
  fc.string({ minLength: 1, maxLength: 80 }).map((s) => `skip: ${s}`),
  { minLength: 0, maxLength: 3 },
);

/** A varied, schema-valid RitualResult. */
const arbResult: fc.Arbitrary<RitualResult> = fc.record({
  selectedCount: fc.integer({ min: 0, max: 50 }),
  patch: fc.constantFrom("", "--- a\n+++ b\n@@ -1 +1 @@\n-print 'x'\n+print('x')\n"),
  beforeVitality: fc.integer({ min: 0, max: 100 }),
  rediagnosed: fc.boolean(),
  afterRaw: fc.integer({ min: 0, max: 100 }),
  degraded: fc.boolean(),
  demo: fc.boolean(),
}).map((r) => {
  const afterVitality = r.rediagnosed ? r.afterRaw : null;
  const vitalityDelta = r.rediagnosed ? r.afterRaw - r.beforeVitality : null;
  return {
    ritualId: "7f3d6b1e-9c2a-4d5e-8b1a-0f2c3d4e5f60",
    selectedCount: r.selectedCount,
    files: [],
    patch: r.patch,
    beforeVitality: r.beforeVitality,
    afterVitality,
    vitalityDelta,
    changedCards: [],
    degraded: r.degraded,
    demo: r.demo,
  } satisfies RitualResult;
});

/**
 * A terminal outcome. Errors cover an oracle code, the coven-only
 * BUDGET_EXHAUSTED code (which the route rewrites onto an oracle code), a
 * NecroError throw, and a plain throw — each reaching the stream as an
 * Error_Line. A NecroError's `cause` is populated to prove it is NEVER carried
 * into the emitted envelope (R12.1).
 */
const arbTerminal: fc.Arbitrary<RunnerPlan["terminal"]> = fc.oneof(
  arbResult.map((result) => ({ kind: "result", result }) as const),
  fc
    .constantFrom("BUDGET_EXHAUSTED", "NETWORK_TIMEOUT", "UPSTREAM_UNAVAILABLE")
    .map(
      (code) =>
        ({
          kind: "returned-error",
          error: new NecroError(
            code as never,
            "The rite ran past the hour.\nThe veil closed early.",
            new Error("internal cause with /secret/path and stack-ish text"),
          ),
        }) as const,
    ),
  fc
    .constantFrom("VALIDATION_FAILED", "PAIR_UNKNOWN", "REDIAGNOSIS_FAILED")
    .map(
      (code) =>
        ({
          kind: "throw-necro",
          error: new NecroError(
            code as never,
            "The circle rejected the offering.\nName a supported pair.",
            new Error("cause-should-not-leak"),
          ),
        }) as const,
    ),
  fc
    .string({ minLength: 0, maxLength: 60 })
    .map((message) => ({ kind: "throw-plain", message }) as const),
);

const arbPlan: fc.Arbitrary<RunnerPlan> = fc.record({
  phases: arbPhases,
  skipNotes: arbSkipNotes,
  terminal: arbTerminal,
});

const arbBreakers = fc.record({
  llmOpen: fc.boolean(),
  sandboxOpen: fc.boolean(),
});

// A line is "terminal" when it carries a `result` or an `error` key.
function isTerminal(line: ResurrectStreamLine): boolean {
  return "result" in line || "error" in line;
}

// ───────────────────────────────────────────────────────────────────────────
// P11 (R9.3, R12.1): exactly one terminal line with a two-field error envelope
// ───────────────────────────────────────────────────────────────────────────

describe("P11 (R9.3, R12.1): stream termination and error envelope", () => {
  it("ends with exactly ONE terminal line (the last line); every other line is a phase or skip-note; any Error_Line has exactly { code, userMessage }", async () => {
    await fc.assert(
      fc.asyncProperty(arbPlan, arbBreakers, async (plan, breakers) => {
        const clock = makeFakeClock();
        const deps = makeDeps({
          runner: fakeRunner(plan),
          breakers: fakeBreakers(breakers.llmOpen, breakers.sandboxOpen),
          clock,
        });

        const res = await handleResurrect(postResurrect({ ref: REF_INPUT, spread: "fates" }), deps);

        // Streaming always commits to 200 once the request schema passes.
        expect(res.status).toBe(200);

        const body = await readBodyText(res);
        const raws = rawLines(body);

        // Every line must decode and validate against the union schema, and no
        // raw secret may appear anywhere in the body.
        expect(body).not.toContain(FAKE_TOKEN);
        const lines: ResurrectStreamLine[] = raws.map((l) =>
          ResurrectStreamLineSchema.parse(JSON.parse(l) as unknown),
        );

        // (1) There is EXACTLY ONE terminal line.
        const terminalIdxs = lines
          .map((l, i) => (isTerminal(l) ? i : -1))
          .filter((i) => i >= 0);
        expect(terminalIdxs).toHaveLength(1);

        // ...and it is the LAST line (no line follows it).
        const terminalIdx = terminalIdxs[0]!;
        expect(terminalIdx).toBe(lines.length - 1);

        // Every non-terminal line is a phase line or a skip-note line.
        for (let i = 0; i < terminalIdx; i++) {
          const l = lines[i]!;
          expect("phase" in l || "skip" in l).toBe(true);
          expect(isTerminal(l)).toBe(false);
        }

        // (2) Any Error_Line payload has EXACTLY the keys `code` and
        //     `userMessage` — no `cause`, stack, or any other field (R12.1).
        const terminal = lines[terminalIdx]!;
        if ("error" in terminal) {
          const keys = Object.keys(terminal.error).sort();
          expect(keys).toEqual(["code", "userMessage"]);
          expect(typeof terminal.error.code).toBe("string");
          expect(terminal.error.code.length).toBeGreaterThan(0);
          expect(typeof terminal.error.userMessage).toBe("string");
          // The internal `cause` text never escaped into the envelope.
          expect(JSON.stringify(terminal.error)).not.toContain("cause");
          expect(JSON.stringify(terminal.error)).not.toContain("/secret/path");
        } else {
          // The only other terminal shape is a Result_Line.
          expect("result" in terminal).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
