// apps/web/src/server/handlers/resurrect.test.ts
//
// Feature: resurrection-engine, task 13.4.
//
// Example (unit) tests for the Resurrection_Route handler `handleResurrect`
// (handler: `./resurrect.ts`, design "Resurrection_Route", "Error Handling").
// They cover the route GUARD and SPEND-BREAKER paths that the stream
// termination / error-envelope PROPERTY test (task 13.3, `resurrect.pbt.test.ts`)
// does not drive by example:
//
//   - R1.6  no completed reading in scope (a reading with zero draws) ->
//           a reading-required Error_Line carried inside the 200 stream.
//   - R11.2 limiter rejects -> a PRE-STREAM 429 with a Retry-After header and
//           NO GitHub work.
//   - R11.3 LLM spend breaker open -> the Ritual runs WITHOUT an LlmPort, so
//           the runner skips the LLM_Pass and emits its Degraded skip-note; the
//           Ritual continues to a terminal Result_Line.
//   - R11.4/R11.5 sandbox spend breaker open -> the route emits its own
//           breaker skip-note, omits the SandboxPort, and the Ritual continues
//           to a terminal Result_Line (Target_Parser-only validation).
//   - R9.6  a Stream_Line that fails `ResurrectStreamLineSchema` is NOT written;
//           the stream terminates with a redacted Error_Line instead.
//   - R9.4  a per-phase time-bounded Skip_Note_Line emitted by the runner is
//           forwarded and the Ritual continues to a terminal Result_Line.
//   - R12.2 an error with an unknown/unrecognized code (a non-NecroError) ->
//           the terminal envelope falls back to a generic code + generic
//           oracle-voice userMessage with no cause/stack and nothing else.
//
// The harness mirrors `readings.test.ts`: a fully-fake `ResurrectDeps` (no
// network / LLM / sandbox), a controllable fake clock that is also the
// `setTimer` scheduler, real `Request` objects over the HTTP surface, and the
// NDJSON body consumed line-by-line and validated against
// `ResurrectStreamLineSchema`. The fake `CovenRunner` is the single seam the
// tests drive to produce phases, skip-notes, results and errors — it honours
// the `ports.llm === undefined` contract so the Degraded skip-note surfaces the
// same way the real runner emits it.
//
// _Requirements: R1.6, R9.4, R9.6, R11.2, R11.3, R11.4, R11.5, R12.2_

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
import type {
  ClockPort,
  ParsedRepoRef,
  SummonResult,
} from "@necro/github";
import type { Reading, ReadingOpts, RepoSnapshot } from "@necro/oracle";
import { describe, expect, it, vi } from "vitest";

import {
  ResurrectStreamLineSchema,
  type ResurrectStreamLine,
} from "../../protocol/resurrect-stream.js";
import type { GithubGateway, RouteEnvPort, SpendBreakers } from "../deps.js";
import type { ResurrectHandlerDeps } from "./resurrect.js";
import { handleResurrect } from "./resurrect.js";

// --- constants -------------------------------------------------------------

/** The fake token the fake env hands out; it must NEVER reach any streamed byte. */
const FAKE_TOKEN = "ghp_faketoken_0000000000000000000000";

/** The fake LLM key the fake env hands out; also redacted out of every line. */
const FAKE_LLM_KEY = "sk-fake-llm-key-000000000000000000000000";

/** A plausible 40-hex lowercase commit sha for the pinned ref. */
const SHA = "a".repeat(40);

/** A commit-pinned ref the ResurrectRequestSchema accepts: owner/name@<40-hex>. */
const REF_INPUT = `octo/legacy@${SHA}`;

/** The Overall_Budget in ms (handler `OVERALL_BUDGET_MS`). */
const OVERALL_BUDGET_MS = 48_000;

/** A fixed clock origin so `now`/`createdAt` are deterministic. */
const T0 = 1_700_000_000_000;

/**
 * The Degraded skip-note the real `LocalCovenRunner` emits when `ports.llm` is
 * absent. The fake runner reproduces it verbatim so the R11.3 assertion pins
 * the breaker-open behaviour rather than a stand-in string.
 */
const DEGRADED_SKIP_NOTE =
  "No breath of the machine-spirit answered the call.\n" +
  "The living hand was stayed; only the old rites were worked.";

/** A per-phase time-bounded skip-note the runner emits under VALIDATE pressure. */
const TIME_BUDGET_SKIP_NOTE =
  "The sands ran low before the deeper proof was done.\n" +
  "What was left unproven is marked, and the rite went on.";

// --- a controllable fake clock that is ALSO the timer scheduler ------------

interface FakeTimer {
  readonly deadline: number;
  readonly cb: () => void;
  fired: boolean;
  cancelled: boolean;
}

/**
 * A ClockPort whose `nowMs()` only moves when the test calls `advance`.
 * `setTimer(ms, cb)` schedules a callback `ms` after the current `nowMs()`;
 * `advance(ms)` steps the clock forward and fires every due timer in deadline
 * order. This is the single seam that makes the Overall_Budget deterministic —
 * no real `setTimeout`.
 */
interface FakeClock extends ClockPort {
  advance(ms: number): void;
  setTimer(ms: number, cb: () => void): { cancel(): void };
  pending(): number;
}

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
    pending() {
      return timers.filter((t) => !t.fired && !t.cancelled).length;
    },
  };
}

// --- fakes (no real adapters, no I/O) --------------------------------------

/** A fake RouteEnvPort handing out the fake token/key and documented defaults. */
function fakeEnv(values: Partial<Record<string, string | number>> = {}): RouteEnvPort {
  const base: Record<string, string | number | undefined> = {
    GITHUB_TOKEN: FAKE_TOKEN,
    NECRO_LLM_API_KEY: FAKE_LLM_KEY,
    NECRO_CLIENT_IP_HEADER: "x-real-ip",
    NECRO_DAILY_REQUEST_CEILING: 1000,
    ...values,
  };
  return { get: (key: string) => base[key] } as unknown as RouteEnvPort;
}

/** A fake FetchPort — the handler reaches GitHub only through the gateway. */
function fakeFetch(): ResurrectHandlerDeps["fetch"] {
  return vi.fn(async () => ({ status: 200, headers: {}, body: null })) as unknown as ResurrectHandlerDeps["fetch"];
}

/** A permissive, spyable limiter (allow by default). */
function fakeLimiter(
  decision:
    | { allowed: true }
    | { allowed: false; scope: "ip" | "global"; retryAfterSeconds: number } = { allowed: true },
): ResurrectHandlerDeps["limiter"] & { check: ReturnType<typeof vi.fn> } {
  const check = vi.fn(async () => decision);
  return { check } as unknown as ResurrectHandlerDeps["limiter"] & {
    check: ReturnType<typeof vi.fn>;
  };
}

/** The two spend breakers; both CLOSED by default. A test injects an open one. */
function fakeBreakers(state: { llm?: boolean; sandbox?: boolean } = {}): SpendBreakers {
  return {
    llmOpen: () => state.llm ?? false,
    sandboxOpen: () => state.sandbox ?? false,
  };
}

/** A fake per-Ritual ledger factory: an append-only no-op sink. */
function fakeMakeLedger(): () => LedgerPort {
  return () => ({ append: vi.fn(async () => undefined) }) as unknown as LedgerPort;
}

/** A minimal schema-valid SummonResult carrying file CONTENTS that must not leak. */
function makeSummonResult(): SummonResult {
  const files: RepoSnapshot["files"] = [
    { path: "setup.py", size: 42, lang: "python", sha: "f".repeat(40) },
    { path: "src/app.py", size: 128, lang: "python", sha: "e".repeat(40) },
  ];
  const snapshot: RepoSnapshot = {
    ref: { owner: "octo", name: "legacy", sha: SHA, defaultBranch: "master" },
    files,
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
    contents: new Map<string, string>([
      ["setup.py", "SECRET_FILE_BODY = 'do-not-leak'"],
      ["src/app.py", "print 'hello'  # py2 body that must stay server-side"],
    ]),
  };
  return {
    snapshot,
    extras: {
      stars: 1234,
      defaultBranch: "master",
      hasWorkflowsDir: true,
      degradedFields: [],
    },
    cache: "miss",
  } as SummonResult;
}

/** A fake GithubGateway. `summon` returns a fixed snapshot; a spy for assertions. */
function fakeGithub(opts: { summonResult?: SummonResult } = {}): GithubGateway & {
  summon: ReturnType<typeof vi.fn>;
  externalData: ReturnType<typeof vi.fn>;
} {
  const summon = vi.fn(async (_input: ParsedRepoRef) => opts.summonResult ?? makeSummonResult());
  const externalData = vi.fn(async (_snapshot: RepoSnapshot) => ({
    registryData: new Map(),
    osvData: [],
    skipped: [],
  }));
  return { summon, externalData } as unknown as GithubGateway & {
    summon: ReturnType<typeof vi.fn>;
    externalData: ReturnType<typeof vi.fn>;
  };
}

/** Build a schema-valid oracle Reading; `drawCount` controls `draws.length`. */
function makeReading(
  snapshot: RepoSnapshot,
  readOpts: ReadingOpts,
  over: { drawCount?: number } = {},
): Reading {
  const drawCount = over.drawCount ?? 1;
  const draws = Array.from({ length: drawCount }, (_v, i) => ({
    card: "hanged_man",
    orientation: "upright",
    severity: 2,
    position: i + 1,
    evidence: [{ path: "src/app.py", line: 1, detail: "print statement" }],
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

/**
 * A fake runReading. `drawCount: 0` yields a reading with NO draws (the
 * "no completed reading in scope" case, R1.6). A spy records its calls.
 */
function fakeRunReading(opts: { drawCount?: number } = {}): ResurrectHandlerDeps["runReading"] & {
  mock: ReturnType<typeof vi.fn>;
} {
  const fn = vi.fn(async (snapshot: RepoSnapshot, readOpts: ReadingOpts) =>
    makeReading(snapshot, readOpts, opts.drawCount === undefined ? {} : { drawCount: opts.drawCount }),
  );
  const wrapper = ((snapshot: RepoSnapshot, readOpts: ReadingOpts) =>
    fn(snapshot, readOpts)) as unknown as ResurrectHandlerDeps["runReading"] & {
    mock: ReturnType<typeof vi.fn>;
  };
  wrapper.mock = fn;
  return wrapper;
}

/** A schema-valid `RitualResult` the fake runner can return. */
function makeRitualResult(over: Partial<RitualResult> = {}): RitualResult {
  return {
    ritualId: "123e4567-e89b-42d3-a456-426614174000",
    selectedCount: 1,
    files: [
      {
        path: "src/app.py",
        before: "print 'hi'\n",
        after: "print('hi')\n",
        diff: [
          { kind: "remove", text: "print 'hi'" },
          { kind: "add", text: "print('hi')" },
        ],
        residuals: [],
        fullyConverted: true,
        validated: true,
      },
    ],
    patch: "--- a/src/app.py\n+++ b/src/app.py\n",
    beforeVitality: 42,
    afterVitality: 55,
    vitalityDelta: 13,
    changedCards: [{ card: "hanged_man", change: "severity", improved: true }],
    degraded: false,
    demo: false,
    ...over,
  };
}

/**
 * A fake CovenRunner the tests fully control. The `script` is called with the
 * injected `ports` and `emit` so a test can inspect the ports the ROUTE chose
 * (e.g. assert `ports.llm` is absent when the LLM breaker is open) and drive
 * phases / skip-notes / the terminal outcome. The returned `RitualOutcome`
 * decides the stream's terminal line.
 */
function fakeRunner(
  script: (args: {
    input: RitualInput;
    ports: RitualPorts;
    emit: PhaseEmit;
  }) => Promise<RitualOutcome>,
): CovenRunner & { run: ReturnType<typeof vi.fn> } {
  const run = vi.fn((input: RitualInput, ports: RitualPorts, emit: PhaseEmit) =>
    script({ input, ports, emit }),
  );
  return { run } as unknown as CovenRunner & { run: ReturnType<typeof vi.fn> };
}

/**
 * A default "happy" runner: emits SELECT then DIFF, (optionally) the Degraded
 * skip-note when no LlmPort was injected (mirroring the real runner), and
 * returns a validated Result_Line. Used by the breaker tests so the Ritual
 * reaches a terminal Result_Line.
 */
function happyRunner(resultOver: Partial<RitualResult> = {}): CovenRunner & {
  run: ReturnType<typeof vi.fn>;
} {
  return fakeRunner(async ({ ports, emit }) => {
    await emit.phase("SELECT");
    if (ports.llm === undefined) {
      // The real LocalCovenRunner emits exactly this when Degraded (R11.3).
      await emit.skipNote(DEGRADED_SKIP_NOTE);
    }
    await emit.phase("DIFF");
    return {
      result: makeRitualResult({ degraded: ports.llm === undefined, ...resultOver }),
      error: null,
    };
  });
}

/** Assemble a full fake `ResurrectHandlerDeps` (RouteDeps + coven seams + timer). */
function makeDeps(
  parts: {
    clock?: FakeClock;
    limiter?: ResurrectHandlerDeps["limiter"];
    github?: GithubGateway;
    env?: RouteEnvPort;
    runReading?: ResurrectHandlerDeps["runReading"];
    runner?: CovenRunner;
    breakers?: SpendBreakers;
    llm?: ResurrectHandlerDeps["llm"];
    sandbox?: ResurrectHandlerDeps["sandbox"];
  } = {},
): ResurrectHandlerDeps & { clock: FakeClock } {
  const clock = parts.clock ?? makeFakeClock();
  const deps = {
    clock,
    env: parts.env ?? fakeEnv(),
    fetch: fakeFetch(),
    limiter: parts.limiter ?? fakeLimiter(),
    github: parts.github ?? fakeGithub(),
    runReading: parts.runReading ?? fakeRunReading(),
    runner: parts.runner ?? happyRunner(),
    makeLedger: fakeMakeLedger(),
    breakers: parts.breakers ?? fakeBreakers(),
    // A non-null LlmPort/SandboxPort so an OPEN breaker (not a missing port) is
    // what forces the omission in the breaker tests. These are never *called*
    // by the fake runner, so a structural stub suffices.
    llm: parts.llm ?? ({ providerId: "mock", complete: vi.fn() } as unknown as ResurrectHandlerDeps["llm"]),
    sandbox:
      parts.sandbox ??
      ({ parseCheckPython3: vi.fn(), dispose: vi.fn() } as unknown as ResurrectHandlerDeps["sandbox"]),
    setTimer: (ms: number, cb: () => void) => clock.setTimer(ms, cb),
  };
  return deps as unknown as ResurrectHandlerDeps & { clock: FakeClock };
}

// --- Request builders ------------------------------------------------------

/** A POST request to /api/resurrect with a JSON body (default content type). */
function postJson(
  body: unknown,
  headers: Record<string, string> = { "content-type": "application/json" },
): Request {
  return new Request("https://necro.test/api/resurrect", {
    method: "POST",
    headers: { "x-real-ip": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A valid resurrect request body: the pinned ref + a server-playable spread. */
function validBody(over: { ref?: string; spread?: string; target?: string } = {}): Record<string, unknown> {
  const base: Record<string, unknown> = { ref: over.ref ?? REF_INPUT, spread: over.spread ?? "necropsy" };
  if (over.target !== undefined) base.target = over.target;
  return base;
}

// --- NDJSON stream reading -------------------------------------------------

/** Read the entire ReadableStream body of a Response to a single string. */
async function readBodyText(res: Response): Promise<string> {
  expect(res.body).not.toBeNull();
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

/**
 * Read the NDJSON body to the end, split on newlines, JSON-parse each non-empty
 * line and validate each against `ResurrectStreamLineSchema`. Returns the
 * ordered lines plus the raw bytes (for secret-leak scans).
 */
async function readStream(res: Response): Promise<{ lines: ResurrectStreamLine[]; raw: string }> {
  const raw = await readBodyText(res);
  const lines = raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => ResurrectStreamLineSchema.parse(JSON.parse(l) as unknown));
  return { lines, raw };
}

/** The phases emitted, in order, from a decoded line list. */
function phasesOf(lines: ResurrectStreamLine[]): string[] {
  return lines.flatMap((l) => ("phase" in l ? [l.phase] : []));
}

/** Every skip-note line's note text, in order. */
function skipNotesOf(lines: ResurrectStreamLine[]): string[] {
  return lines.flatMap((l) => ("skip" in l ? [l.note] : []));
}

/** The final `{ result }` line's result, if any. */
function resultOf(lines: ResurrectStreamLine[]): unknown | undefined {
  const last = lines[lines.length - 1];
  return last !== undefined && "result" in last ? last.result : undefined;
}

/** The final `{ error }` line, if any. */
function errorOf(
  lines: ResurrectStreamLine[],
): { code: string; userMessage: string } | undefined {
  const last = lines[lines.length - 1];
  return last !== undefined && "error" in last ? last.error : undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// R11.2 — limiter rejects BEFORE any GitHub work, PRE-STREAM 429 + Retry-After
// ───────────────────────────────────────────────────────────────────────────

describe("handleResurrect — limiter reject (R11.2)", () => {
  it("a denied request is a pre-stream 429 with Retry-After and RATE_LIMITED, no GitHub work", async () => {
    const limiter = fakeLimiter({ allowed: false, scope: "ip", retryAfterSeconds: 90 });
    const github = fakeGithub();
    const runner = fakeRunner(async () => ({ result: makeRitualResult(), error: null }));
    const deps = makeDeps({ limiter, github, runner });

    const res = await handleResurrect(postJson(validBody()), deps);

    // Rejected before the stream begins -> a plain HTTP 429 envelope, not NDJSON.
    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);

    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("RATE_LIMITED");

    // Nothing reached GitHub or the runner.
    expect(github.summon).not.toHaveBeenCalled();
    expect((runner as { run: ReturnType<typeof vi.fn> }).run).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// R1.6 — a reading with zero draws => no completed reading in scope
// ───────────────────────────────────────────────────────────────────────────

describe("handleResurrect — no reading in scope (R1.6)", () => {
  it("a reading with zero draws ends with a reading-required Error_Line and never runs the Ritual", async () => {
    const runReading = fakeRunReading({ drawCount: 0 });
    const runner = fakeRunner(async () => ({ result: makeRitualResult(), error: null }));
    const deps = makeDeps({ runReading, runner });

    const res = await handleResurrect(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    // Streaming already committed to 200; the rejection is carried as a line.
    expect(res.status).toBe(200);
    const err = errorOf(lines);
    expect(err).toBeDefined();
    expect(err!.code).toBe("VALIDATION_FAILED");
    expect(resultOf(lines)).toBeUndefined();

    // The runner was never driven — the reading-required guard fired first.
    expect((runner as { run: ReturnType<typeof vi.fn> }).run).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// R11.3 — LLM breaker open => Ritual runs WITHOUT an LlmPort, Degraded skip-note
// ───────────────────────────────────────────────────────────────────────────

describe("handleResurrect — LLM spend breaker open (R11.3)", () => {
  it("omits the LlmPort so the runner skips the LLM_Pass with a skip-note, then completes", async () => {
    let injectedLlmAbsent = false;
    const runner = fakeRunner(async ({ ports, emit }) => {
      injectedLlmAbsent = ports.llm === undefined;
      await emit.phase("SELECT");
      if (ports.llm === undefined) await emit.skipNote(DEGRADED_SKIP_NOTE);
      await emit.phase("DIFF");
      return { result: makeRitualResult({ degraded: true }), error: null };
    });
    const deps = makeDeps({ runner, breakers: fakeBreakers({ llm: true }) });

    const res = await handleResurrect(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    // The route omitted the LlmPort because the breaker was open.
    expect(injectedLlmAbsent).toBe(true);

    // The Degraded skip-note surfaced and the Ritual continued to a Result_Line.
    expect(skipNotesOf(lines)).toContain(DEGRADED_SKIP_NOTE);
    expect(phasesOf(lines)).toEqual(["SELECT", "DIFF"]);
    expect(resultOf(lines)).toBeDefined();
    expect(errorOf(lines)).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// R11.4 / R11.5 — sandbox breaker open => route skip-note, SandboxPort omitted
// ───────────────────────────────────────────────────────────────────────────

describe("handleResurrect — sandbox spend breaker open (R11.4, R11.5)", () => {
  it("emits a route-level breaker skip-note, omits the SandboxPort, and the Ritual completes", async () => {
    let injectedSandboxAbsent = false;
    const runner = fakeRunner(async ({ ports, emit }) => {
      injectedSandboxAbsent = ports.sandbox === undefined;
      await emit.phase("SELECT");
      await emit.phase("DIFF");
      return { result: makeRitualResult(), error: null };
    });
    const deps = makeDeps({ runner, breakers: fakeBreakers({ sandbox: true }) });

    const res = await handleResurrect(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    // The route omitted the SandboxPort because the breaker was open (R11.5).
    expect(injectedSandboxAbsent).toBe(true);

    // A route-level skip-note was emitted (the route states the breaker-skip
    // itself; R11.4) BEFORE the runner's phases, and the Ritual still completes.
    const notes = skipNotesOf(lines);
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes.some((n) => /sandbox/i.test(n))).toBe(true);
    expect(resultOf(lines)).toBeDefined();
    expect(errorOf(lines)).toBeUndefined();
  });

  it("both breakers open => both skips and the Ritual still reaches a Result_Line", async () => {
    const runner = fakeRunner(async ({ ports, emit }) => {
      await emit.phase("SELECT");
      if (ports.llm === undefined) await emit.skipNote(DEGRADED_SKIP_NOTE);
      await emit.phase("DIFF");
      return { result: makeRitualResult({ degraded: true }), error: null };
    });
    const deps = makeDeps({
      runner,
      breakers: fakeBreakers({ llm: true, sandbox: true }),
    });

    const res = await handleResurrect(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    const notes = skipNotesOf(lines);
    // The Degraded (LLM) skip-note and the sandbox breaker skip-note are both present.
    expect(notes).toContain(DEGRADED_SKIP_NOTE);
    expect(notes.some((n) => /sandbox/i.test(n))).toBe(true);
    expect(resultOf(lines)).toBeDefined();
    expect(errorOf(lines)).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// R9.4 — a per-phase time-bounded Skip_Note_Line is forwarded, Ritual continues
// ───────────────────────────────────────────────────────────────────────────

describe("handleResurrect — time-bounded phase skip-note (R9.4)", () => {
  it("forwards a runner-emitted time-budget skip-note and still reaches a Result_Line", async () => {
    const runner = fakeRunner(async ({ emit }) => {
      await emit.phase("SELECT");
      await emit.phase("PRE_PASS");
      await emit.phase("LLM_PASS");
      await emit.phase("VALIDATE");
      // The VALIDATE phase's own time budget was reached: one skip-note, carry on.
      await emit.skipNote(TIME_BUDGET_SKIP_NOTE);
      await emit.phase("REDIAGNOSE");
      await emit.phase("DIFF");
      return { result: makeRitualResult(), error: null };
    });
    const deps = makeDeps({ runner });

    const res = await handleResurrect(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    expect(skipNotesOf(lines)).toContain(TIME_BUDGET_SKIP_NOTE);
    // The skip is a note, not a terminal line: the Ritual completed.
    expect(resultOf(lines)).toBeDefined();
    expect(errorOf(lines)).toBeUndefined();
    // Phases remain in order with the skip interleaved, not replacing a phase.
    expect(phasesOf(lines)).toEqual([
      "SELECT",
      "PRE_PASS",
      "LLM_PASS",
      "VALIDATE",
      "REDIAGNOSE",
      "DIFF",
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// R9.6 — a Stream_Line that fails the schema is not written; stream terminates
//        with a redacted Error_Line
// ───────────────────────────────────────────────────────────────────────────

describe("handleResurrect — invalid stream line termination (R9.6)", () => {
  it("a Result_Line that fails ResurrectStreamLineSchema is withheld and the stream ends in an Error_Line", async () => {
    // The runner returns a RitualResult whose `beforeVitality` is out of range
    // (schema: 0..100), so the `{ result }` line fails validation and must NOT
    // be written — the stream terminates with a redacted Error_Line instead.
    const runner = fakeRunner(async ({ emit }) => {
      await emit.phase("SELECT");
      await emit.phase("DIFF");
      return {
        result: makeRitualResult({ beforeVitality: 9999 as unknown as number }),
        error: null,
      };
    });
    const deps = makeDeps({ runner });

    const res = await handleResurrect(postJson(validBody()), deps);
    const { lines, raw } = await readStream(res);

    // No result line slipped through; the terminal line is an Error_Line.
    expect(resultOf(lines)).toBeUndefined();
    const err = errorOf(lines);
    expect(err).toBeDefined();
    // It is an oracle-code envelope (UPSTREAM_UNAVAILABLE fixed message).
    expect(err!.code).toBe("UPSTREAM_UNAVAILABLE");
    // The offending out-of-range value never reached the wire.
    expect(raw).not.toContain("9999");
  });

  it("an invalid non-terminal line (a bad phase object) terminates the stream with an Error_Line", async () => {
    // Emit a phase value outside the ResurrectionPhase enum: the phase LINE
    // fails the schema, so it is withheld and the stream terminates (R9.6).
    const runner = fakeRunner(async ({ emit }) => {
      await emit.phase("SELECT");
      await emit.phase("NOT_A_PHASE" as never);
      await emit.phase("DIFF");
      return { result: makeRitualResult(), error: null };
    });
    const deps = makeDeps({ runner });

    const res = await handleResurrect(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    // SELECT was written; the bad phase was withheld and became the terminus.
    expect(phasesOf(lines)).toEqual(["SELECT"]);
    expect(resultOf(lines)).toBeUndefined();
    expect(errorOf(lines)).toBeDefined();
    expect(errorOf(lines)!.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// R12.2 — an unknown/unrecognized error code => generic fallback envelope
// ───────────────────────────────────────────────────────────────────────────

describe("handleResurrect — unknown-code fallback envelope (R12.2)", () => {
  it("a non-NecroError throw becomes a generic UPSTREAM_UNAVAILABLE envelope with only code + userMessage", async () => {
    // A bare JS error (an "unknown code") thrown mid-Ritual must collapse to the
    // single fixed generic envelope — no cause, no stack, nothing of the throw.
    const secret = "stack-trace-and-internal-detail-must-not-leak";
    const runner = fakeRunner(async ({ emit }) => {
      await emit.phase("SELECT");
      throw new Error(secret);
    });
    const deps = makeDeps({ runner });

    const res = await handleResurrect(postJson(validBody()), deps);
    const { lines, raw } = await readStream(res);

    const err = errorOf(lines);
    expect(err).toBeDefined();
    expect(err!.code).toBe("UPSTREAM_UNAVAILABLE");
    // The envelope carries exactly { code, userMessage } — no extra fields.
    const last = lines[lines.length - 1] as { error: Record<string, unknown> };
    expect(Object.keys(last.error).sort()).toEqual(["code", "userMessage"]);
    // Oracle-voice, non-empty, and leaking none of the thrown value.
    expect(err!.userMessage.length).toBeGreaterThan(0);
    expect(raw).not.toContain(secret);
    expect(resultOf(lines)).toBeUndefined();
  });

  it("a NecroError with a coven-only code (BUDGET_EXHAUSTED) is mapped to an oracle code the schema accepts", async () => {
    // The runner returns a terminal BUDGET_EXHAUSTED error (a coven-only code
    // the oracle ErrorLineSchema does not know). The route's mapEngineError
    // rewrites it to an oracle code so the Error_Line still validates (R9.6),
    // while the Ritual's partials ride in the ledger, not the stream (R9.3).
    const covenErr = new NecroError(
      "BUDGET_EXHAUSTED" as never,
      "The rite ran past the appointed hour.\nWhat was proven is kept; the rest is left to the dark.",
    );
    const runner = fakeRunner(async ({ emit }) => {
      await emit.phase("SELECT");
      return { result: makeRitualResult({ afterVitality: null, vitalityDelta: null }), error: covenErr };
    });
    const deps = makeDeps({ runner });

    const res = await handleResurrect(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    const err = errorOf(lines);
    expect(err).toBeDefined();
    // Mapped onto an oracle code (NETWORK_TIMEOUT per COVEN_TO_ORACLE_CODE) so
    // the line validates; the oracle-voice userMessage is preserved.
    expect(err!.code).toBe("NETWORK_TIMEOUT");
    expect(err!.userMessage).toContain("appointed hour");
    expect(resultOf(lines)).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// transport + redaction sanity (reused guard contract, R12.3)
// ───────────────────────────────────────────────────────────────────────────

describe("handleResurrect — transport + redaction", () => {
  it("streams application/x-ndjson with no-store and nosniff and never leaks the token/key", async () => {
    const deps = makeDeps();
    const res = await handleResurrect(postJson(validBody()), deps);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/x-ndjson/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    const { raw } = await readStream(res);
    expect(raw).not.toContain(FAKE_TOKEN);
    expect(raw).not.toContain(FAKE_LLM_KEY);
    // Snapshot file contents never reach the stream.
    expect(raw).not.toContain("SECRET_FILE_BODY");
    expect(raw).not.toContain("do-not-leak");
  });

  it("the Overall_Budget timer is cancelled once a terminal line is written", async () => {
    const clock = makeFakeClock();
    const deps = makeDeps({ clock });

    const res = await handleResurrect(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    // Completed within budget; advancing past the deadline must not inject a
    // late error line (the timer was cancelled on completion).
    clock.advance(OVERALL_BUDGET_MS + 5_000);

    expect(resultOf(lines)).toBeDefined();
    expect(errorOf(lines)).toBeUndefined();
    expect(clock.pending()).toBe(0);
  });
});
