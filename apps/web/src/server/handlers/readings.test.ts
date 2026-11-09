// apps/web/src/server/handlers/readings.test.ts
//
// Feature: 03-crt-terminal, task 26.1 (TEST-FIRST).
//
// Example tests for the Reading_Route handler `handleReading`: the NDJSON
// streaming contract (design.md D13), the pure monotonic phase sequence
// (D14), the Overall_Budget (40 s) and External_Sub_Budget (10 s) time
// budgets (D15), end-to-end token redaction (R14.7) and the no-snapshot-
// contents rule (R6.6).
//
// TEST-FIRST (red). This file is written before `server/handlers/readings.ts`
// (task 26.2). The import of `./readings.js` below therefore fails to resolve
// and the whole suite is red for the expected reason: the module does not
// exist yet. Nothing here is implementation.
//
// ───────────────────────────────────────────────────────────────────────────
// CONTRACT PINNED BY THIS FILE (recorded for task 26.2)
// ───────────────────────────────────────────────────────────────────────────
//
//   readings.ts  →  handleReading(req: Request, deps: ReadingDeps): Promise<Response>
//
// where `ReadingDeps` is the existing `RouteDeps` plus ONE optional budget
// seam the handler uses to schedule its two time budgets deterministically:
//
//   type TimerHandle = { cancel(): void };
//   type SetTimer = (ms: number, cb: () => void) => TimerHandle;
//   interface ReadingDeps extends RouteDeps { readonly setTimer?: SetTimer }
//
// THE BUDGET / TIMER SEAM (design D15 — "the test path is ClockPort-only").
// Design D15 says production combines `AbortSignal.timeout(40_000)` /
// `AbortSignal.timeout(10_000)`, but that "in tests a fake clock fires it" and
// "the test path is ClockPort-only" so the timeout is deterministic. We make
// that concrete with a single injectable `setTimer` seam:
//
//   • In PRODUCTION, `deps.setTimer` is undefined and the handler falls back to
//     `AbortSignal.timeout(...)` (or a `setTimeout`-backed timer) for both
//     budgets. (26.2's production default — not exercised here.)
//   • In TESTS, we inject a `setTimer` backed by a FAKE CLOCK the test drives.
//     `clock.advance(ms)` moves `clock.nowMs()` forward AND fires every pending
//     timer whose deadline has elapsed. No real `setTimeout`, no wall clock, so
//     the 40 s Overall_Budget and 10 s External_Sub_Budget are fully
//     deterministic. The handler MUST schedule BOTH budgets through
//     `deps.setTimer` when it is provided (never raw `setTimeout`/wall clock),
//     so these tests can advance the clock to trip a budget while a phase
//     promise the test controls is still pending.
//
// The handler reads the "now" it passes to `runReading` from `deps.clock`
// (`now = new Date(clock.nowMs()).toISOString()`, design "Handler pipeline"
// step 5), so the same fake clock also fixes `createdAt`.
//
// The stream body is consumed as NDJSON: `res.body` (a ReadableStream) is read
// to the end, decoded, split on "\n", each non-empty line JSON-parsed and
// validated against `StreamLineSchema`, then asserted against the expected
// phase sequence and final line.
//
// No network / LLM / sandbox — a fully fake `RouteDeps` drives the handler and
// real `Request` objects drive the HTTP surface.
//
// _Requirements: R6.4, R6.5, R6.6, R6.7, R6.11, R6.14, R6.16, R6.19, R6.20, R6.22, R12.8, R12.9, R12.10, R12.11, R14.7_
import type {
  ClockPort,
  ExternalDataResult,
  FetchPort,
  ParsedRepoRef,
  SummonExtras,
  SummonResult,
} from "@necro/github";
import type { Reading, ReadingOpts, RepoSnapshot } from "@necro/oracle";
import { EXTERNAL_SKIP_NOTE } from "@necro/ui-crt";
import { describe, expect, it, vi } from "vitest";

import { ReadingResponseSchema } from "../../protocol/schemas.js";
import { StreamLineSchema, type StreamLine } from "../../protocol/stream.js";
import type { GithubGateway, RouteDeps, RouteEnvPort } from "../deps.js";
import { EXTERNAL_SUB_BUDGET_MS } from "./external-skip.js";

// Not yet implemented — task 26.2 adds this module. The import is what makes
// this suite red until then.
import { handleReading } from "./readings.js";

// --- constants -------------------------------------------------------------

/** The fake token the fake env hands out; it must NEVER appear in any streamed
 *  byte, header or value the handler produces (R14.7). */
const FAKE_TOKEN = "ghp_faketoken_0000000000000000000000";

/** A plausible 40-hex lowercase commit sha for the pinned ref. */
const SHA = "a".repeat(40);

/** A commit-pinned ref the ReadingRequestSchema accepts: owner/name@<40-hex>. */
const REF_INPUT = `octo/legacy@${SHA}`;

/** The Overall_Budget in ms (design D15). */
const OVERALL_BUDGET_MS = 40_000;

/** A fixed clock origin so `createdAt`/`now` are deterministic. */
const T0 = 1_700_000_000_000;

// --- a controllable fake clock that is ALSO the timer scheduler ------------

interface FakeTimer {
  readonly deadline: number;
  readonly cb: () => void;
  fired: boolean;
  cancelled: boolean;
}

/**
 * A ClockPort whose `nowMs()` only moves when the test calls `advance`.
 * `advance(ms)` steps the clock forward and fires every pending timer whose
 * deadline has elapsed, in deadline order. `setTimer(ms, cb)` schedules a
 * callback `ms` after the current `nowMs()`. This is the single seam that
 * makes the two time budgets deterministic — no real `setTimeout`.
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
      // Fire due timers in deadline order; each fires at most once.
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

// --- a controllable deferred promise --------------------------------------

/** A promise plus its resolve/reject, so a test can hang a phase and later
 *  settle it (or never settle it, to let a budget fire first). */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
  return Object.assign(vi.fn(async () => ({ status: 200, headers: {}, body: null }))) as unknown as FetchPort;
}

/** A permissive, spyable limiter (allow by default). */
function fakeLimiter(
  decision:
    | { allowed: true }
    | { allowed: false; scope: "ip" | "global"; retryAfterSeconds: number } = { allowed: true },
): RouteDeps["limiter"] & { check: ReturnType<typeof vi.fn> } {
  const check = vi.fn(async () => decision);
  return { check } as unknown as RouteDeps["limiter"] & { check: ReturnType<typeof vi.fn> };
}

/**
 * Build a minimal but schema-valid SummonResult. The snapshot carries FILE
 * CONTENTS (a runtime Map and secret-looking bodies) so the tests can prove no
 * file contents ever reach the stream (R6.6, R12.11).
 */
function makeSummonResult(over: {
  extras?: Partial<SummonExtras>;
  cache?: "hit" | "miss";
  truncated?: boolean;
} = {}): SummonResult {
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
    truncated: over.truncated ?? false,
    createdAt: "2024-01-01T00:00:00Z",
    // Runtime-only Map of file CONTENTS — must never leak into the stream.
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
      ...over.extras,
    },
    cache: over.cache ?? "miss",
  };
}

/** A schema-valid ExternalDataResult with real registry + OSV data. */
function makeExternalData(over: Partial<ExternalDataResult> = {}): ExternalDataResult {
  return {
    registryData: new Map(),
    osvData: [],
    skipped: [],
    ...over,
  } as ExternalDataResult;
}

/**
 * A fake GithubGateway. Each of `summon`/`externalData` can be given a fixed
 * value, a thrown error, or a controllable promise the test settles later (to
 * let a budget fire first). All are vitest spies for call-count assertions.
 */
function fakeGithub(opts: {
  summonResult?: SummonResult;
  summonThrows?: unknown;
  summonPending?: Promise<SummonResult>;
  external?: ExternalDataResult;
  externalThrows?: unknown;
  externalPending?: Promise<ExternalDataResult>;
} = {}): GithubGateway & {
  summon: ReturnType<typeof vi.fn>;
  externalData: ReturnType<typeof vi.fn>;
} {
  const summon = vi.fn(async (_input: ParsedRepoRef) => {
    if (opts.summonPending !== undefined) return opts.summonPending;
    if (opts.summonThrows !== undefined) throw opts.summonThrows;
    return opts.summonResult ?? makeSummonResult();
  });
  const externalData = vi.fn(async (_snapshot: RepoSnapshot) => {
    if (opts.externalPending !== undefined) return opts.externalPending;
    if (opts.externalThrows !== undefined) throw opts.externalThrows;
    return opts.external ?? makeExternalData();
  });
  return { summon, externalData } as unknown as GithubGateway & {
    summon: ReturnType<typeof vi.fn>;
    externalData: ReturnType<typeof vi.fn>;
  };
}

/**
 * A fake runReading. By default returns a schema-valid Reading; callers may
 * override the Reading (e.g. to echo the token) or supply a controllable
 * promise that never resolves so the Overall_Budget can fire first. The spy
 * records the `opts` it was called with so the external-skip behaviour can be
 * asserted (registryData/osvData present vs omitted).
 */
function fakeRunReading(opts: {
  reading?: Partial<Reading>;
  pending?: Promise<Reading>;
} = {}): RouteDeps["runReading"] & { mock: ReturnType<typeof vi.fn> } {
  const fn = vi.fn(async (snapshot: RepoSnapshot, readOpts: ReadingOpts) => {
    if (opts.pending !== undefined) return opts.pending;
    return makeReading(snapshot, readOpts, opts.reading);
  });
  // `vi.fn().mock` is a getter-only property on the spy, so attaching a `mock`
  // field onto the spy itself (via Object.assign/defineProperty) throws. Wrap
  // the spy in a thin callable that forwards to it and carries `mock` -> spy;
  // the spy's own `.mock.calls` remains the vitest call record the assertions
  // read as `runReading.mock.mock.calls`.
  const wrapper = ((snapshot: RepoSnapshot, readOpts: ReadingOpts) =>
    fn(snapshot, readOpts)) as unknown as RouteDeps["runReading"] & {
    mock: ReturnType<typeof vi.fn>;
  };
  wrapper.mock = fn;
  return wrapper;
}

/** Build a schema-valid oracle Reading from the snapshot/opts (see ReadingSchema). */
function makeReading(
  snapshot: RepoSnapshot,
  readOpts: ReadingOpts,
  over: Partial<Reading> = {},
): Reading {
  return {
    id: "123e4567-e89b-42d3-a456-426614174000",
    repo: {
      owner: snapshot.ref.owner,
      name: snapshot.ref.name,
      sha: snapshot.ref.sha,
      defaultBranch: snapshot.ref.defaultBranch,
    },
    draws: [],
    spread: [{ position: 1, label: "The Corpse", draw: null, description: "nothing stirs" }],
    vitality: 42,
    createdAt: readOpts.now,
    engineVersion: "0.0.0",
    errors: [],
    ...over,
  } as Reading;
}

/** Assemble a full fake ReadingDeps (RouteDeps + optional `setTimer` seam). */
function makeDeps(
  parts: {
    clock?: FakeClock;
    limiter?: RouteDeps["limiter"];
    github?: GithubGateway;
    env?: RouteEnvPort;
    fetch?: FetchPort;
    runReading?: RouteDeps["runReading"];
  } = {},
): RouteDeps & { clock: FakeClock; setTimer: FakeClock["setTimer"] } {
  const clock = parts.clock ?? makeFakeClock();
  const deps = {
    clock,
    env: parts.env ?? fakeEnv(),
    fetch: parts.fetch ?? fakeFetch(),
    limiter: parts.limiter ?? fakeLimiter(),
    github: parts.github ?? fakeGithub(),
    runReading: parts.runReading ?? fakeRunReading(),
    // The budget/timer seam the handler schedules both budgets through.
    setTimer: (ms: number, cb: () => void) => clock.setTimer(ms, cb),
  };
  return deps as RouteDeps & { clock: FakeClock; setTimer: FakeClock["setTimer"] };
}

// --- Request builders ------------------------------------------------------

/** A POST request to /api/readings with a JSON body (default content type). */
function postJson(
  body: unknown,
  headers: Record<string, string> = { "content-type": "application/json" },
): Request {
  return new Request("https://necro.test/api/readings", {
    method: "POST",
    headers: { "x-real-ip": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A valid reading request body: the pinned ref + a server-playable spread. */
function validBody(over: { ref?: string; spread?: string } = {}): Record<string, unknown> {
  return { ref: over.ref ?? REF_INPUT, spread: over.spread ?? "necropsy" };
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
 * line and validate each against `StreamLineSchema`. Returns the ordered lines
 * plus the raw bytes (for secret-leak scans).
 */
async function readStream(res: Response): Promise<{ lines: StreamLine[]; raw: string }> {
  const raw = await readBodyText(res);
  const lines = raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => StreamLineSchema.parse(JSON.parse(l) as unknown));
  return { lines, raw };
}

/** The phases emitted, in order, from a decoded line list. */
function phasesOf(lines: StreamLine[]): string[] {
  return lines.flatMap((l) => ("phase" in l ? [l.phase] : []));
}

/** The final `{ result }` line, if any. */
function resultOf(lines: StreamLine[]): unknown | undefined {
  const last = lines[lines.length - 1];
  return last !== undefined && "result" in last ? last.result : undefined;
}

/** The final `{ error }` line, if any. */
function errorOf(lines: StreamLine[]): { code: string; userMessage: string } | undefined {
  const last = lines[lines.length - 1];
  return last !== undefined && "error" in last ? last.error : undefined;
}

/** True when any line is a skip-note line. */
function hasSkipNote(lines: StreamLine[]): boolean {
  return lines.some((l) => "skip" in l);
}

// ───────────────────────────────────────────────────────────────────────────
// transport headers (R6.14, R12.8, D13)
// ───────────────────────────────────────────────────────────────────────────

describe("handleReading — transport headers (R6.14, R12.8, D13)", () => {
  it("streams application/x-ndjson with no-store and nosniff", async () => {
    const deps = makeDeps();
    const res = await handleReading(postJson(validBody()), deps);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/x-ndjson/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    // Drain so the stream closes cleanly.
    await readStream(res);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// happy path (R6.6, R6.7, R6.14, R6.16, R6.20, R6.22)
// ───────────────────────────────────────────────────────────────────────────

describe("handleReading — happy path (R6.6, R6.7, R6.14, R6.16)", () => {
  it("emits SUMMON, DOWNLOAD, EXTERNAL, READING in order then a validated { result }", async () => {
    const github = fakeGithub({ summonResult: makeSummonResult(), external: makeExternalData() });
    const runReading = fakeRunReading();
    const deps = makeDeps({ github, runReading });

    const res = await handleReading(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    // Exactly the four phases, in order, each once (monotonic — D14).
    expect(phasesOf(lines)).toEqual(["SUMMON", "DOWNLOAD", "EXTERNAL", "READING"]);

    // The final line is a { result } that validates against the wire schema.
    const result = resultOf(lines);
    expect(result).toBeDefined();
    expect(() => ReadingResponseSchema.parse(result)).not.toThrow();

    // No error line, no skip note on the happy path.
    expect(errorOf(lines)).toBeUndefined();
    expect(hasSkipNote(lines)).toBe(false);
  });

  it("the phase lines all precede the final result line (phases are non-final)", async () => {
    const deps = makeDeps();
    const res = await handleReading(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    const lastIsResult = "result" in (lines[lines.length - 1] as StreamLine);
    expect(lastIsResult).toBe(true);
    // Every phase line comes before the result line.
    const resultIdx = lines.length - 1;
    for (let i = 0; i < resultIdx; i++) {
      expect("phase" in lines[i]! || "skip" in lines[i]!).toBe(true);
    }
  });

  it("runReading receives the real registryData and osvData when external is fast and not skipped (R6.22)", async () => {
    const registryData = new Map([["flask", { ecosystem: "pypi" } as never]]);
    const osvData = [{ id: "GHSA-xxxx" } as never];
    const external = makeExternalData({ registryData, osvData, skipped: [] });
    const runReading = fakeRunReading();
    const deps = makeDeps({ github: fakeGithub({ external }), runReading });

    const res = await handleReading(postJson(validBody()), deps);
    await readStream(res);

    expect(runReading.mock).toHaveBeenCalledTimes(1);
    const passedOpts = runReading.mock.mock.calls[0]![1] as ReadingOpts;
    expect(passedOpts.registryData).toBe(registryData);
    expect(passedOpts.osvData).toBe(osvData);
    expect(passedOpts.spreadKind).toBe("necropsy");
  });

  it("passes the requested spread through to runReading", async () => {
    const runReading = fakeRunReading();
    const deps = makeDeps({ runReading });

    await readStream(await handleReading(postJson(validBody({ spread: "fates" })), deps));

    const passedOpts = runReading.mock.mock.calls[0]![1] as ReadingOpts;
    expect(passedOpts.spreadKind).toBe("fates");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// pre-stream request guard: celtic / bad ref -> VALIDATION_FAILED (R6.4, Q15)
// ───────────────────────────────────────────────────────────────────────────

describe("handleReading — request guard (R6.4, Q15)", () => {
  it("a celtic spread is rejected with VALIDATION_FAILED before streaming (HTTP 400)", async () => {
    const github = fakeGithub();
    const deps = makeDeps({ github });

    const res = await handleReading(postJson(validBody({ spread: "celtic" })), deps);

    // The schema rejects celtic before the stream begins, so this is an HTTP
    // 400 Error_Envelope, NOT an NDJSON stream.
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_FAILED");
    // Nothing reached GitHub.
    expect(github.summon).not.toHaveBeenCalled();
  });

  it("a non-40-hex ref is rejected with VALIDATION_FAILED before streaming (HTTP 400)", async () => {
    const github = fakeGithub();
    const deps = makeDeps({ github });

    const res = await handleReading(postJson(validBody({ ref: "octo/legacy@deadbeef" })), deps);

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(github.summon).not.toHaveBeenCalled();
  });

  it("an uppercase-hex ref (not lowercase 40-hex) is rejected before streaming", async () => {
    const deps = makeDeps();
    const res = await handleReading(
      postJson(validBody({ ref: `octo/legacy@${"A".repeat(40)}` })),
      deps,
    );
    expect(res.status).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// cache-hit path: DOWNLOAD still emitted once, one summon, no extra fetch
// (R6.16, R12.10)
// ───────────────────────────────────────────────────────────────────────────

describe("handleReading — cache hit (R6.16, R12.10)", () => {
  it("still emits DOWNLOAD exactly once on a cache hit and summons exactly once", async () => {
    const github = fakeGithub({ summonResult: makeSummonResult({ cache: "hit" }) });
    const deps = makeDeps({ github });

    const res = await handleReading(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    // Monotonic phase machine: DOWNLOAD is emitted once even though the cache
    // hit makes the tarball instantaneous (R6.16).
    expect(phasesOf(lines)).toEqual(["SUMMON", "DOWNLOAD", "EXTERNAL", "READING"]);
    expect(phasesOf(lines).filter((p) => p === "DOWNLOAD")).toHaveLength(1);

    // A cache hit performs no tarball: the single gateway summon is the only
    // GitHub call, and externalData runs at most once (R12.10). No re-summon.
    expect(github.summon).toHaveBeenCalledTimes(1);
    expect(github.externalData).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Overall_Budget: 40 s abort -> final { error: NETWORK_TIMEOUT }, no result
// (R6.11, R6.19)
// ───────────────────────────────────────────────────────────────────────────

describe("handleReading — Overall_Budget 40 s (R6.11, R6.19)", () => {
  it("a run that hangs past 40 s ends with a final { error: NETWORK_TIMEOUT } and NO result line", async () => {
    const clock = makeFakeClock();
    // runReading never resolves; the Overall_Budget must trip.
    const hung = deferred<Reading>();
    const runReading = fakeRunReading({ pending: hung.promise });
    const deps = makeDeps({ clock, runReading });

    const resPromise = handleReading(postJson(validBody()), deps);

    // Let the earlier phases settle, then blow the Overall_Budget.
    await Promise.resolve();
    clock.advance(OVERALL_BUDGET_MS + 1);

    const res = await resPromise;
    const { lines } = await readStream(res);

    // Streaming already began at 200; the failure is carried as a final line.
    expect(res.status).toBe(200);
    const err = errorOf(lines);
    expect(err).toBeDefined();
    expect(err!.code).toBe("NETWORK_TIMEOUT");
    // No result line was written (R6.19).
    expect(resultOf(lines)).toBeUndefined();
  });

  it("a run that finishes before 40 s writes a result and NO error line", async () => {
    const clock = makeFakeClock();
    const deps = makeDeps({ clock });

    const res = await handleReading(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    // The pipeline completed well within budget; advancing past 40 s now must
    // not inject a late error (the budget timer was cancelled on completion).
    clock.advance(OVERALL_BUDGET_MS + 5_000);

    expect(resultOf(lines)).toBeDefined();
    expect(errorOf(lines)).toBeUndefined();
    // The budget timer must have been cancelled once the result was written.
    expect(clock.pending()).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// External_Sub_Budget: 10 s race around externalData (R6.20, R6.22)
// ───────────────────────────────────────────────────────────────────────────

describe("handleReading — External_Sub_Budget 10 s (R6.20, R6.22)", () => {
  it("(a) slow externalData -> skip-note line AND runReading WITHOUT registry/OSV data", async () => {
    const clock = makeFakeClock();
    // externalData never resolves; the 10 s sub-budget must trip and skip it.
    const hung = deferred<ExternalDataResult>();
    const github = fakeGithub({ summonResult: makeSummonResult(), externalPending: hung.promise });
    const runReading = fakeRunReading();
    const deps = makeDeps({ clock, github, runReading });

    const resPromise = handleReading(postJson(validBody()), deps);

    // Item 28: the external sub-budget is now ARMED at the EXTERNAL phase, so
    // wait for the pipeline to reach EXTERNAL (its timer becomes pending) before
    // tripping it. The overall timer is pending from entry; EXTERNAL adds a 2nd.
    for (let i = 0; i < 20 && clock.pending() < 2; i++) await Promise.resolve();
    // Trip the 10 s external sub-budget (but stay under the 40 s overall one).
    clock.advance(EXTERNAL_SUB_BUDGET_MS + 1);

    const res = await resPromise;
    const { lines } = await readStream(res);

    // A skip-note line was emitted carrying the Oracle_Voice skip note (R6.21).
    expect(hasSkipNote(lines)).toBe(true);
    const skipLine = lines.find((l) => "skip" in l) as { skip: true; note: string };
    expect(skipLine.note).toBe(EXTERNAL_SKIP_NOTE);

    // The reading still completes (skip is a note, not an error).
    expect(resultOf(lines)).toBeDefined();
    expect(errorOf(lines)).toBeUndefined();

    // runReading ran with BOTH registryData and osvData omitted (R6.22) —
    // nothing fabricated.
    expect(runReading.mock).toHaveBeenCalledTimes(1);
    const passedOpts = runReading.mock.mock.calls[0]![1] as ReadingOpts;
    expect(passedOpts.registryData).toBeUndefined();
    expect(passedOpts.osvData).toBeUndefined();
  });

  it("(b) externalData resolves with skipped: true within 10 s -> same skip behaviour", async () => {
    const external = makeExternalData({
      registryData: new Map([["flask", { ecosystem: "pypi" } as never]]),
      osvData: [{ id: "GHSA-yyyy" } as never],
      skipped: [{ name: "flask", ecosystem: "pypi", reason: "http-error" } as never],
    });
    const github = fakeGithub({ external });
    const runReading = fakeRunReading();
    const deps = makeDeps({ github, runReading });

    const res = await handleReading(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    // Even though the data came back fast, `skipped: true` forces the skip.
    expect(hasSkipNote(lines)).toBe(true);
    const skipLine = lines.find((l) => "skip" in l) as { skip: true; note: string };
    expect(skipLine.note).toBe(EXTERNAL_SKIP_NOTE);

    const passedOpts = runReading.mock.mock.calls[0]![1] as ReadingOpts;
    expect(passedOpts.registryData).toBeUndefined();
    expect(passedOpts.osvData).toBeUndefined();
    expect(resultOf(lines)).toBeDefined();
  });

  it("(c) real external data within 10 s -> passed to runReading, NO skip note", async () => {
    const registryData = new Map([["flask", { ecosystem: "pypi" } as never]]);
    const osvData = [{ id: "GHSA-zzzz" } as never];
    const external = makeExternalData({ registryData, osvData, skipped: [] });
    const github = fakeGithub({ external });
    const runReading = fakeRunReading();
    const deps = makeDeps({ github, runReading });

    const res = await handleReading(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    expect(hasSkipNote(lines)).toBe(false);
    const passedOpts = runReading.mock.mock.calls[0]![1] as ReadingOpts;
    expect(passedOpts.registryData).toBe(registryData);
    expect(passedOpts.osvData).toBe(osvData);
    expect(resultOf(lines)).toBeDefined();
  });

  // Item 28 (R6.20): the External_Sub_Budget must start at the EXTERNAL phase,
  // NOT at request receipt. A slow SUMMON/DOWNLOAD must not eat into external's
  // 10 s window. Here SUMMON stays pending while the clock advances PAST 10 s;
  // once SUMMON resolves and EXTERNAL begins, externalData resolves promptly
  // and its data MUST still be used (no spurious skip), because its budget only
  // started when EXTERNAL began.
  it("(d) a slow SUMMON does not consume the external 10 s window (budget starts at EXTERNAL)", async () => {
    const clock = makeFakeClock();
    const registryData = new Map([["flask", { ecosystem: "pypi" } as never]]);
    const osvData = [{ id: "GHSA-slow-summon" } as never];
    const slowSummon = deferred<SummonResult>();
    const slowExternal = deferred<ExternalDataResult>();
    const github = fakeGithub({
      summonPending: slowSummon.promise,
      externalPending: slowExternal.promise,
    });
    const runReading = fakeRunReading();
    const deps = makeDeps({ clock, github, runReading });

    const resPromise = handleReading(postJson(validBody()), deps);
    await Promise.resolve();

    // SUMMON takes 8 s (under the 10 s external window and 40 s overall). If the
    // external timer had started at request RECEIPT (the bug), only 2 s would
    // remain for external by the time EXTERNAL begins.
    clock.advance(8_000);
    slowSummon.resolve(makeSummonResult());
    // Wait for the pipeline to reach EXTERNAL and ARM the sub-budget (its timer
    // becomes the 2nd pending timer alongside the overall one).
    for (let i = 0; i < 20 && clock.pending() < 2; i++) await Promise.resolve();

    // EXTERNAL now runs for 5 s before its data arrives: 5 s < the full 10 s
    // window (so NO skip) IF the budget started at EXTERNAL. With the bug the
    // 10 s-from-receipt timer (8 s + 5 s = 13 s) would have already tripped.
    clock.advance(5_000);
    slowExternal.resolve(makeExternalData({ registryData, osvData, skipped: [] }));

    const res = await resPromise;
    const { lines } = await readStream(res);

    expect(hasSkipNote(lines)).toBe(false);
    const passedOpts = runReading.mock.mock.calls[0]![1] as ReadingOpts;
    expect(passedOpts.registryData).toBe(registryData);
    expect(passedOpts.osvData).toBe(osvData);
    expect(resultOf(lines)).toBeDefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// mid-stream gateway failure -> final { error } line, not a status (R6.5, D13)
// ───────────────────────────────────────────────────────────────────────────

describe("handleReading — mid-stream failure (R6.5, D13)", () => {
  it("a gateway NecroError after streaming began is carried as a final { error } line at status 200", async () => {
    // Make externalData throw a mapped-code error AFTER SUMMON/DOWNLOAD began.
    const github = fakeGithub({
      summonResult: makeSummonResult(),
      externalThrows: Object.assign(new Error("upstream fell over"), {
        code: "UPSTREAM_UNAVAILABLE",
      }),
    });
    const deps = makeDeps({ github });

    const res = await handleReading(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    // Status committed to 200 at first byte; failure is a final line.
    expect(res.status).toBe(200);
    expect(errorOf(lines)).toBeDefined();
    expect(resultOf(lines)).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// no snapshot file contents in the stream (R6.6)
// ───────────────────────────────────────────────────────────────────────────

describe("handleReading — no snapshot contents leak (R6.6, R12.11)", () => {
  it("the crafted snapshot file-content markers appear NOWHERE in the streamed bytes", async () => {
    const deps = makeDeps({ github: fakeGithub({ summonResult: makeSummonResult() }) });

    const res = await handleReading(postJson(validBody()), deps);
    const { raw } = await readStream(res);

    expect(raw).not.toContain("SECRET_FILE_BODY");
    expect(raw).not.toContain("do-not-leak");
    expect(raw).not.toContain("py2 body that must stay server-side");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// end-to-end token redaction (R14.7)
// ───────────────────────────────────────────────────────────────────────────

describe("handleReading — token redaction end-to-end (R14.7)", () => {
  it("a token echoed inside the Reading never reaches the streamed bytes", async () => {
    // runReading fabricates an error whose userMessage echoes the token; the
    // outgoing Reading_Response must be scrubbed before it is written.
    const runReading = fakeRunReading({
      reading: {
        errors: [
          {
            code: "DETECTOR_FAILED",
            userMessage: `a detector leaked the token ${FAKE_TOKEN} into its message`,
          },
        ],
      },
    });
    const deps = makeDeps({ runReading });

    const res = await handleReading(postJson(validBody()), deps);
    const { raw } = await readStream(res);

    expect(raw).not.toContain(FAKE_TOKEN);
  });

  it("the token never appears in the stream even when a phase fails with a message echoing it", async () => {
    const github = fakeGithub({
      summonThrows: Object.assign(new Error(`boom ${FAKE_TOKEN}`), { code: "UPSTREAM_UNAVAILABLE" }),
    });
    const deps = makeDeps({ github });

    const res = await handleReading(postJson(validBody()), deps);
    const { raw } = await readStream(res);

    expect(raw).not.toContain(FAKE_TOKEN);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// outgoing Reading_Response validated before writing (R6.7)
// ───────────────────────────────────────────────────────────────────────────

describe("handleReading — outgoing validation (R6.7)", () => {
  it("the final result line validates against ReadingResponseSchema", async () => {
    const deps = makeDeps();
    const res = await handleReading(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    const result = resultOf(lines);
    expect(result).toBeDefined();
    const parsed = ReadingResponseSchema.parse(result);
    // The summary mirrors the summoned ref; the reading carries the oracle shape.
    expect(parsed.summary.ref.sha).toBe(SHA);
    expect(parsed.reading.repo.sha).toBe(SHA);
    expect(parsed.reading.vitality).toBe(42);
  });

  it("an invalid Reading from runReading becomes a final { error } line, not a malformed result", async () => {
    // A Reading missing required fields must fail ReadingResponseSchema.parse
    // server-side and surface as an error line (never a bad result).
    const runReading = fakeRunReading({ reading: { vitality: 9999 as unknown as number } });
    const deps = makeDeps({ runReading });

    const res = await handleReading(postJson(validBody()), deps);
    const { lines } = await readStream(res);

    expect(resultOf(lines)).toBeUndefined();
    expect(errorOf(lines)).toBeDefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// limiter runs before any GitHub work (R12.9, R13.1)
// ───────────────────────────────────────────────────────────────────────────

describe("handleReading — limiter before GitHub (R13.1)", () => {
  it("a denied request is 429 + RATE_LIMITED and performs NO GitHub work (pre-stream)", async () => {
    const limiter = fakeLimiter({ allowed: false, scope: "ip", retryAfterSeconds: 90 });
    const github = fakeGithub();
    const deps = makeDeps({ limiter, github });

    const res = await handleReading(postJson(validBody()), deps);

    // Rejected before the stream begins, so this is a plain HTTP 429 envelope.
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(github.summon).not.toHaveBeenCalled();
  });
});
