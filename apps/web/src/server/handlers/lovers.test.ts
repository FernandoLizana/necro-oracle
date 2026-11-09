// apps/web/src/server/handlers/lovers.test.ts
//
// Feature: lovers-binding, task 11.6b.
//
// Minimal example (unit) tests for the Lovers_Route handler `handleLovers`
// (handler: `./lovers.ts`, design C.5 "Lovers route"). They cover the two
// pipeline paths the PBT/e2e tasks (11.7/11.8/11.10/14.4) do not own here:
//
//   - R14.4  THE LOVERS (VI) not drawn -> a typed VALIDATION_FAILED Error_Line
//            carried inside the 200 stream, with NO model call (neither the
//            resurrect runner nor the lovers runner is invoked on that path).
//   - R19.1/R19.3  a demo/Mock happy path: the strict request schema passes,
//            the handler streams the four Lovers phase lines
//            (PLAN/GENERATE/VALIDATE/BIND) and exactly one terminal
//            `{ result }` line that validates against the stream schema.
//
// The harness mirrors `resurrect.test.ts`: a fully-fake `LoversDeps` (no
// network / LLM), a controllable fake clock that is also the `setTimer`
// scheduler, real `Request` objects, and the NDJSON body consumed line-by-line
// and validated against `LoversStreamLineSchema`.
//
// _Requirements: R14.4, R19.1, R19.3_

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
import type {
  ClockPort,
  ParsedRepoRef,
  SummonResult,
} from "@necro/github";
import type { Reading, ReadingOpts, RepoSnapshot } from "@necro/oracle";
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

// --- a controllable fake clock that is ALSO the timer scheduler ------------

interface FakeTimer {
  readonly deadline: number;
  readonly cb: () => void;
  fired: boolean;
  cancelled: boolean;
}

interface FakeClock extends ClockPort {
  setTimer(ms: number, cb: () => void): { cancel(): void };
}

function makeFakeClock(startMs = T0): FakeClock {
  const now = startMs;
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
  return vi.fn(async () => ({ status: 200, headers: {}, body: null })) as unknown as LoversHandlerDeps["fetch"];
}

function fakeLimiter(): LoversHandlerDeps["limiter"] & { check: ReturnType<typeof vi.fn> } {
  const check = vi.fn(async () => ({ allowed: true }));
  return { check } as unknown as LoversHandlerDeps["limiter"] & {
    check: ReturnType<typeof vi.fn>;
  };
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

function fakeGithub(): GithubGateway & {
  summon: ReturnType<typeof vi.fn>;
  externalData: ReturnType<typeof vi.fn>;
} {
  const summon = vi.fn(async (_input: ParsedRepoRef) => makeSummonResult());
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

/** Build a schema-valid oracle Reading; `card` controls the single draw's id. */
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
        // Item 26 (CORRECTED): the Lovers signal is a grimoire linkage on a
        // LEGAL card; the "__lovers_signal__" sentinel -> judgement + lovers-js.
        card: card === "__lovers_signal__" ? "judgement" : card,
        orientation: "upright",
        severity: 2,
        position: 1,
        evidence: [{ path: "src/app.py", line: 1, detail: "x" }],
        grimoires: card === "__lovers_signal__" ? ["lovers-js"] : [],
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

/** A fake resurrect runner that returns one validated file with Python 3 after-content. */
function fakeResurrectRunner(): CovenRunner & { run: ReturnType<typeof vi.fn> } {
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
  return { run } as unknown as CovenRunner & { run: ReturnType<typeof vi.fn> };
}

/** A schema-valid LoversResult the fake lovers runner returns. */
function makeLoversResult(): LoversResult {
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
    soulsSpent: { promptTokens: 0, completionTokens: 0, costUsd: 0, soulSource: "ORACLE", byModel: [] },
    soulSource: "ORACLE",
    demo: true,
  } as unknown as LoversResult;
}

/** A fake lovers runner: emits the four phases then returns a LoversResult. */
function fakeLoversRunner(
  script?: (emit: LoversEmit) => Promise<LoversResult>,
): LoversRunner & { run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async (_input: unknown, _ports: unknown, emit: LoversEmit) => {
    if (script !== undefined) return script(emit);
    await emit.phase("PLAN");
    await emit.phase("GENERATE");
    await emit.phase("VALIDATE");
    await emit.phase("BIND");
    return makeLoversResult();
  });
  return { run } as unknown as LoversRunner & { run: ReturnType<typeof vi.fn> };
}

/** Assemble a fully-fake LoversDeps with the given overrides. */
function makeDeps(over: {
  card?: string;
  loversRunner?: LoversRunner;
  resurrectRunner?: CovenRunner;
  env?: Partial<Record<string, string | number>>;
} = {}): LoversHandlerDeps {
  const clock = makeFakeClock();
  return {
    clock,
    env: fakeEnv(over.env),
    fetch: fakeFetch(),
    limiter: fakeLimiter(),
    github: fakeGithub(),
    runReading: fakeRunReading(over.card ?? "__lovers_signal__"),
    loversRunner: over.loversRunner ?? fakeLoversRunner(),
    resurrectRunner: over.resurrectRunner ?? fakeResurrectRunner(),
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

const VALID_BODY = {
  ref: REF_INPUT,
  file: "src/app.py",
  targetLang: "javascript",
  spread: "fates",
} as const;

// --- tests -----------------------------------------------------------------

describe("handleLovers (lovers-binding task 11.6b)", () => {
  it("R14.4: THE LOVERS not drawn -> VALIDATION_FAILED, no model call", async () => {
    const loversRunner = fakeLoversRunner();
    const resurrectRunner = fakeResurrectRunner();
    const deps = makeDeps({ card: "hanged_man", loversRunner, resurrectRunner });

    const res = await handleLovers(loversRequest({ ...VALID_BODY }), deps);
    expect(res.status).toBe(200);

    const lines = await readLines(res);
    // Exactly one terminal error line; no phase lines.
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect("error" in line).toBe(true);
    if ("error" in line) {
      expect(line.error.code).toBe("VALIDATION_FAILED");
    }
    // NO model call: neither the resurrect runner nor the lovers runner ran.
    expect((loversRunner as unknown as { run: { mock: { calls: unknown[] } } }).run.mock.calls).toHaveLength(0);
    expect((resurrectRunner as unknown as { run: { mock: { calls: unknown[] } } }).run.mock.calls).toHaveLength(0);
  });

  it("R19.1/R19.3: demo happy path streams four phases + one result line", async () => {
    const loversRunner = fakeLoversRunner();
    const clock = makeFakeClock();
    const deps = {
      ...makeDeps({ loversRunner }),
      clock,
      setTimer: (ms: number, cb: () => void) => clock.setTimer(ms, cb),
      demoLlm: { providerId: "mock", complete: async () => ({ text: "{}", cached: false }) },
      loadDemoLovers: async () => ({ file: "src/app.py", source: "def add(a, b):\n    return a + b\n" }),
    } as unknown as LoversHandlerDeps;

    const res = await handleLovers(loversRequest({ ...VALID_BODY, demo: true }), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");

    const lines = await readLines(res);
    const phases = lines.filter((l): l is { phase: "PLAN" | "GENERATE" | "VALIDATE" | "BIND" } => "phase" in l);
    expect(phases.map((p) => p.phase)).toEqual(["PLAN", "GENERATE", "VALIDATE", "BIND"]);

    const last = lines[lines.length - 1]!;
    expect("result" in last).toBe(true);
    if ("result" in last) {
      expect(last.result.file).toBe("src/app.py");
      expect(last.result.targetLang).toBe("javascript");
    }
  });

  // Item 15 (P0.5): the demo network guard must NOT mutate globalThis.fetch.
  // A serverless isolate serves concurrent requests, so a global monkey-patch
  // (and its finally-restore) could block or race another in-flight request.
  // The demo is network-free by construction (Mock LLM + no sandbox + demo
  // loader), so the handler must not touch the global.
  it("item 15: a demo run never replaces globalThis.fetch (no global patch)", async () => {
    const fetchBefore = globalThis.fetch;
    // Capture globalThis.fetch identity AT THE MOMENT the demo runner runs
    // (mid-request). A global monkey-patch would be observable here — and to a
    // concurrent request. The demo is network-free by construction, so the
    // handler must not have patched the global.
    let fetchDuringRun: unknown;
    const loversRunner = {
      run: vi.fn(async (_i: unknown, _p: unknown, emit: LoversEmit): Promise<LoversResult> => {
        fetchDuringRun = globalThis.fetch;
        await emit.phase("PLAN");
        await emit.phase("GENERATE");
        await emit.phase("VALIDATE");
        await emit.phase("BIND");
        return makeLoversResult();
      }),
    } as unknown as LoversRunner;
    const clock = makeFakeClock();
    const deps = {
      ...makeDeps({ loversRunner }),
      clock,
      setTimer: (ms: number, cb: () => void) => clock.setTimer(ms, cb),
      demoLlm: { providerId: "mock", complete: async () => ({ text: "{}", cached: false }) },
      loadDemoLovers: async () => ({ file: "src/app.py", source: "def add(a, b):\n    return a + b\n" }),
    } as unknown as LoversHandlerDeps;

    const res = await handleLovers(loversRequest({ ...VALID_BODY, demo: true }), deps);
    await res.text();

    // globalThis.fetch was NOT replaced at any point during the demo run.
    expect(fetchDuringRun).toBe(fetchBefore);
    expect(globalThis.fetch).toBe(fetchBefore);
  });

  // Item 29c (R13.1/R24.3): the per-IP limiter runs BEFORE any GitHub work. A
  // denied request is a PRE-STREAM 429 (Retry-After + RATE_LIMITED) and NEVER
  // reaches github.summon or either runner — the resurrect/readings routes
  // had this test; the lovers route previously lacked it.
  it("item 29c: a denied limiter is a pre-stream 429 and performs NO GitHub work", async () => {
    const github = fakeGithub();
    const loversRunner = fakeLoversRunner();
    const resurrectRunner = fakeResurrectRunner();
    const deps = {
      ...makeDeps({ loversRunner, resurrectRunner }),
      github,
      limiter: {
        check: vi.fn(async () => ({ allowed: false, scope: "ip", retryAfterSeconds: 90 })),
      },
    } as unknown as LoversHandlerDeps;

    const res = await handleLovers(loversRequest(VALID_BODY), deps);

    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("RATE_LIMITED");

    expect(github.summon).not.toHaveBeenCalled();
    expect(
      (loversRunner as unknown as { run: { mock: { calls: unknown[] } } }).run.mock.calls,
    ).toHaveLength(0);
    expect(
      (resurrectRunner as unknown as { run: { mock: { calls: unknown[] } } }).run.mock.calls,
    ).toHaveLength(0);
  });
});


// ---------------------------------------------------------------------------
// PROD HOTFIX - demo error framing: a demo-mode lovers error line MUST be a
// valid JSON protocol frame (lovers already emits valid JSON; this locks it so
// a future [DEMO] line-prefix regression like the resurrect one is caught).
// ---------------------------------------------------------------------------

describe("handleLovers - demo error line stays a valid JSON frame (prod hotfix)", () => {
  it("a demo:true error line parses as JSON and is never prefixed with [DEMO] before its object", async () => {
    // A demo request with NO demoLlm/loadDemoLovers wired triggers the typed
    // 'No replay is kept in this crypt' UPSTREAM_UNAVAILABLE error on the demo
    // path. The signal card must be present so the precondition passes and the
    // run reaches the demo branch.
    const deps = makeDeps({ card: "__lovers_signal__" });
    const res = await handleLovers(loversRequest({ ...VALID_BODY, demo: true }), deps);
    expect(res.status).toBe(200);

    const text = await res.text();
    const rawLines = text.split("\n").filter((l) => l.trim().length > 0);
    expect(rawLines.length).toBeGreaterThan(0);
    for (const line of rawLines) {
      expect(() => JSON.parse(line), `invalid JSON frame: ${line}`).not.toThrow();
      expect(line.startsWith("[DEMO] ")).toBe(false);
      expect(line.trimStart().startsWith("{")).toBe(true);
    }
    const parsed = rawLines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const errorLine = parsed.find((l) => "error" in l) as
      | { error: { code: string; userMessage: string } }
      | undefined;
    expect(errorLine, "a terminal { error } line must be present").toBeDefined();
    expect(errorLine!.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});
