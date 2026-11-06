// packages/coven/src/runners/local.test.ts
//
// Example-based unit tests for the local Coven_Runner (`LocalCovenRunner`,
// task 11.1) covering the orchestration EDGE PATHS the phase-order property
// test (task 11.3, local-phases.pbt.test.ts) does not pin:
//
//   - R5.6  — the optional SandboxPort throws (unavailable) during VALIDATE
//             => the runner falls back to the Target_Parser and emits EXACTLY
//             ONE sandbox-fallback skip-note; the file still validates.
//   - R5.8 / R9.7 — the VALIDATE phase budget is reached => every not-yet-
//             validated file is marked `validated: false` with a `not_validated`
//             residual and is excluded from the Patch (never silently skipped).
//   - R6.5  — re-diagnosis fails => the produced File_Results are PRESERVED,
//             `afterVitality`/`vitalityDelta` are null, and a skip-note is
//             emitted for the re-diagnosis step.
//   - R10.4 / R10.5 — the overall wall-clock budget is exhausted => the Ritual
//             ends with a `BUDGET_EXHAUSTED` error carrying the PARTIAL
//             File_Results, and the injected sandbox's `dispose()` is called.
//   - R13.3 / R13.4 — no LlmPort is injected (Degraded_Mode) => the result's
//             `degraded` flag is true and EXACTLY ONE degraded skip-note is
//             emitted.
//
// Everything is hand-built and self-contained (testing steering: no network,
// no LLM, no sandbox). The runner resolves its grimoire from an injected
// `LanguagePairRegistry`, so a tiny STUB `Grimoire` is registered under the
// Ritual's pair id — the real `@necro/grimoires-py2to3` is deliberately NOT
// imported (that would violate oracle <- grimoires <- coven). A controllable
// `ClockPort` drives the budget checks (the runner reads time ONLY through the
// port), a capturing `LedgerPort` records the append-only event stream, and
// optional fake Llm / Sandbox ports exercise the degraded and sandbox paths.
//
// A real `RepoSnapshot` is built with `buildSnapshotFromFileMap` and a `Reading`
// carrying py2 static evidence so SELECT yields a candidate; re-diagnosis runs
// a REAL `runReading` over the overlay (a local parse the steering permits).
//
// Validates: Requirements 5.6, 5.8, 6.5, 9.7, 10.4, 10.5, 13.3, 13.4

import {
  buildSnapshotFromFileMap,
  initParser,
  type CardDraw,
  type Evidence,
  type Reading,
  type RepoMeta,
  type RepoRef,
  type RepoSnapshot,
  type SpreadKind,
} from "@necro/oracle";
import { z } from "zod";
import { beforeAll, describe, expect, it } from "vitest";

import { LocalCovenRunner, type PhaseEmit } from "./local.js";
import { LanguagePairRegistry } from "../registry.js";
import type {
  ClockPort,
  Grimoire,
  LedgerPort,
  LlmPort,
  RitualPorts,
  SandboxPort,
} from "../ports.js";
import {
  LanguagePairIdSchema,
  type LedgerEvent,
  type RitualInput,
} from "../models.js";

// ---------------------------------------------------------------------------
// Fixtures — the smallest schema-valid snapshot / reading the runner needs.
// ---------------------------------------------------------------------------

const REF: RepoRef = {
  owner: "graveyard",
  name: "dead-repo",
  sha: "0".repeat(40),
  defaultBranch: "main",
};

const META: RepoMeta = {
  pushedAt: null,
  isArchived: false,
  openIssueCount: 0,
  openPRCount: 0,
  oldestOpenPRAgeDays: null,
  latestReleaseAt: null,
  licenseKey: null,
};

const NOW = "2024-01-01T00:00:00.000Z";
const PAIR_ID = LanguagePairIdSchema.parse("python2->python3");

/** A py2-classified static evidence item on a `.py` path (what SELECT reads). */
function py2Evidence(path: string): Evidence {
  return {
    kind: "print_statement",
    path,
    line: 1,
    detail: "legacy print statement",
    source: "static",
  };
}

/** A minimal Judgement draw flagging `path` as py2. */
function judgementDraw(path: string): CardDraw {
  return {
    card: "judgement" as CardDraw["card"],
    severity: 2,
    orientation: "reversed",
    evidence: [py2Evidence(path)],
    summary: "legacy python 2 constructs",
    grimoires: [],
  };
}

/** A Reading over the given draws (every other field is a harmless default). */
function reading(draws: CardDraw[]): Reading {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    repo: REF,
    draws,
    spread: [],
    vitality: 50,
    createdAt: NOW,
    engineVersion: "0.0.0",
    errors: [],
  };
}

/** A runtime snapshot from a path->content map (files stay far under 1 MB). */
function snapshotOf(files: Record<string, string>): RepoSnapshot {
  return buildSnapshotFromFileMap(REF, files, { meta: META, createdAt: NOW });
}

/** A RitualInput over one py2 file flagged by `judgement`, bare target. */
function ritualInput(
  overrides: Partial<RitualInput> = {},
): RitualInput {
  const snapshot = snapshotOf({ "legacy.py": 'print "hello"\n' });
  return {
    pairId: PAIR_ID,
    snapshot,
    reading: reading([judgementDraw("legacy.py")]),
    target: { kind: "bare" },
    spread: "necropsy",
    now: NOW,
    demo: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A controllable ClockPort. `nowMs()` returns `base + step * callCount`, so a
// test picks `step` and the budgets to place the budget deadline exactly where
// it wants it. A `step` of 0 freezes time (budgets never trip from the clock).
// ---------------------------------------------------------------------------

function makeClock(opts: { base?: number; step?: number } = {}): ClockPort & {
  calls: () => number;
} {
  const base = opts.base ?? 1_000_000;
  const step = opts.step ?? 0;
  let calls = 0;
  return {
    nowMs(): number {
      const value = base + step * calls;
      calls += 1;
      return value;
    },
    calls: () => calls,
  };
}

/** A capturing, append-only LedgerPort that records every event in order. */
function makeLedger(): LedgerPort & { events: LedgerEvent[] } {
  const events: LedgerEvent[] = [];
  return {
    async append(event: LedgerEvent): Promise<void> {
      events.push(event);
    },
    events,
  };
}

/** A PhaseEmit that records the phases and skip-notes the runner streams. */
function makeEmit(): PhaseEmit & { phases: string[]; skipNotes: string[] } {
  const phases: string[] = [];
  const skipNotes: string[] = [];
  return {
    phase(phase): void {
      phases.push(phase);
    },
    skipNote(note): void {
      skipNotes.push(note);
    },
    phases,
    skipNotes,
  };
}

// ---------------------------------------------------------------------------
// A trivial, adapter-free STUB Grimoire. The fixers are a no-op pass-through
// (so a candidate validates cleanly by default); `validate` reports valid
// Python 3 unless a test overrides it; the declarative LLM step has a trivial
// output schema and an apply that returns the source unchanged. The runner
// never imports a grimoire package — it resolves THIS stub from the registry.
// ---------------------------------------------------------------------------

function stubGrimoire(
  overrides: {
    validate?: (after: string) => { valid: boolean; errorNodeCount: number };
  } = {},
): Grimoire {
  const outputSchema = z.object({ converted: z.boolean() });
  return {
    id: "stub",
    pair: { from: "python2", to: "python3" } as unknown as Grimoire["pair"],
    inputSchema: z.object({
      path: z.string(),
      before: z.string(),
    }) as unknown as Grimoire["inputSchema"],
    outputSchema: z.object({
      path: z.string(),
      before: z.string(),
      after: z.string(),
      diff: z.array(z.unknown()),
      residuals: z.array(z.unknown()),
      fullyConverted: z.boolean(),
      validated: z.boolean(),
    }) as unknown as Grimoire["outputSchema"],
    // No-op fixers: leave content unchanged, emit no residuals.
    fixers: [(source) => ({ after: source, residuals: [] })],
    llm: {
      outputSchema: outputSchema as unknown as Grimoire["llm"]["outputSchema"],
      buildRequest: () => ({
        system: "convert",
        prompt: "data",
        maxTokens: 16,
        timeoutMs: 1_000,
        cacheKey: "k",
      }),
      apply: (source) => source,
      mockFixture: () => '{"converted":true}',
    },
    validate:
      overrides.validate ??
      ((_after: string) => ({ valid: true, errorNodeCount: 0 })),
    divergenceAllowlist: [],
  };
}

/** A registry with the stub grimoire bound to the Ritual's pair id. */
function registryWith(grimoire: Grimoire = stubGrimoire()): LanguagePairRegistry {
  const registry = new LanguagePairRegistry();
  registry.register(PAIR_ID, grimoire);
  return registry;
}

// ---------------------------------------------------------------------------
// Fake optional ports.
// ---------------------------------------------------------------------------

/** A SandboxPort whose parse-check always throws (unavailable), tracking dispose. */
function throwingSandbox(): SandboxPort & { disposed: () => number } {
  let disposed = 0;
  return {
    async parseCheckPython3(): Promise<{ ok: boolean }> {
      throw new Error("sandbox unreachable");
    },
    async dispose(): Promise<void> {
      disposed += 1;
    },
    disposed: () => disposed,
  };
}

/** A SandboxPort whose parse-check always succeeds, tracking dispose. */
function okSandbox(): SandboxPort & { disposed: () => number } {
  let disposed = 0;
  return {
    async parseCheckPython3(): Promise<{ ok: boolean }> {
      return { ok: true };
    },
    async dispose(): Promise<void> {
      disposed += 1;
    },
    disposed: () => disposed,
  };
}

/** A deterministic, network-free LlmPort returning a fixed valid completion. */
function fakeLlm(): LlmPort {
  return {
    providerId: "mock",
    async complete() {
      return { text: '{"converted":true}', cached: false };
    },
  };
}

// The runner arms the oracle parser (initParser) and the REDIAGNOSE phase runs
// a real local reading; initialise once up front so no init cost lands inside a
// timed assertion.
beforeAll(async () => {
  await initParser();
});

// ---------------------------------------------------------------------------
// R13.3 / R13.4 — Degraded_Mode: no LlmPort => degraded flag + ONE skip-note.
// ---------------------------------------------------------------------------

describe("LocalCovenRunner (R13.3, R13.4): Degraded_Mode", () => {
  it("marks the result degraded and emits exactly one degraded skip-note when no LlmPort is injected", async () => {
    const runner = new LocalCovenRunner(registryWith());
    const emit = makeEmit();
    const ports: RitualPorts = {
      clock: makeClock(), // frozen time: no budget trips
      ledger: makeLedger(),
      // llm deliberately absent => Degraded_Mode
    };

    const outcome = await runner.run(ritualInput(), ports, emit);

    expect(outcome.error).toBeNull();
    expect(outcome.result.degraded).toBe(true);

    // EXACTLY ONE skip-note, and it is the degraded one (mentions the bare-
    // handed oracle / no model bound). No other skip-note is emitted on this
    // clean path (sandbox absent, budgets frozen, validation passes).
    expect(emit.skipNotes).toHaveLength(1);
    expect(emit.skipNotes[0]).toContain("bare-handed");
    expect(emit.skipNotes[0]).toContain("No model is bound");
  });

  it("does not emit the degraded skip-note when an LlmPort IS injected", async () => {
    const runner = new LocalCovenRunner(registryWith());
    const emit = makeEmit();
    const ports: RitualPorts = {
      clock: makeClock(),
      ledger: makeLedger(),
      llm: fakeLlm(),
    };

    const outcome = await runner.run(ritualInput(), ports, emit);

    expect(outcome.result.degraded).toBe(false);
    expect(emit.skipNotes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R5.6 — the optional SandboxPort is unavailable during VALIDATE: fall back to
// the Target_Parser and emit exactly one sandbox-fallback skip-note.
// ---------------------------------------------------------------------------

describe("LocalCovenRunner (R5.6): sandbox fallback", () => {
  it("falls back to the Target_Parser and emits one skip-note when the sandbox throws", async () => {
    const sandbox = throwingSandbox();
    const runner = new LocalCovenRunner(registryWith());
    const emit = makeEmit();
    const ports: RitualPorts = {
      clock: makeClock(), // frozen: no budget trips
      ledger: makeLedger(),
      llm: fakeLlm(), // present => no degraded skip-note muddying the count
      sandbox,
    };

    const outcome = await runner.run(ritualInput(), ports, emit);

    expect(outcome.error).toBeNull();

    // The Target_Parser (stub validate) returned valid, so the file stays
    // validated even though the sandbox parse-check was unavailable.
    expect(outcome.result.files).toHaveLength(1);
    expect(outcome.result.files[0]!.validated).toBe(true);

    // EXACTLY ONE sandbox-fallback skip-note (the phase emits it once, not
    // per file), naming the Target_Parser fallback.
    const sandboxNotes = emit.skipNotes.filter((n) =>
      n.includes("Target_Parser"),
    );
    expect(sandboxNotes).toHaveLength(1);
    expect(sandboxNotes[0]).toContain("Sandbox parse-check unavailable");
  });

  it("uses the sandbox result (no fallback skip-note) when the sandbox is available", async () => {
    const runner = new LocalCovenRunner(registryWith());
    const emit = makeEmit();
    const ports: RitualPorts = {
      clock: makeClock(),
      ledger: makeLedger(),
      llm: fakeLlm(),
      sandbox: okSandbox(),
    };

    const outcome = await runner.run(ritualInput(), ports, emit);

    expect(outcome.error).toBeNull();
    expect(outcome.result.files[0]!.validated).toBe(true);
    const sandboxNotes = emit.skipNotes.filter((n) =>
      n.includes("Target_Parser"),
    );
    expect(sandboxNotes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R5.8 / R9.7 — the VALIDATE budget is reached: remaining files are marked
// `validated: false` with a `not_validated` residual and excluded from the Patch.
// ---------------------------------------------------------------------------

describe("LocalCovenRunner (R5.8, R9.7): VALIDATE budget", () => {
  it("marks not-yet-validated files not_validated and excludes them from the Patch", async () => {
    // A generous overall budget but a ZERO validate budget: `validateDeadline`
    // equals the clock reading at the top of VALIDATE, so the first per-file
    // check (clock has advanced by one step) is already at/over the deadline.
    const runner = new LocalCovenRunner(registryWith(), {
      totalBudgetMs: 10_000_000, // never trips on the overall budget
      validateBudgetMs: 0, // trips immediately inside VALIDATE
    });
    const emit = makeEmit();
    const ports: RitualPorts = {
      clock: makeClock({ step: 1 }), // advances 1 ms per read
      ledger: makeLedger(),
      llm: fakeLlm(),
    };

    const outcome = await runner.run(ritualInput(), ports, emit);

    expect(outcome.error).toBeNull();
    expect(outcome.result.files).toHaveLength(1);

    const file = outcome.result.files[0]!;
    expect(file.validated).toBe(false);
    // The budget cut-short residual is recorded explicitly (R5.8/R9.7).
    expect(file.residuals.some((r) => r.reason === "not_validated")).toBe(true);

    // Excluded from the Patch: a not-validated file never appears in the
    // unified diff (R7.7). With the single candidate not validated, the patch
    // is empty.
    expect(outcome.result.patch).toBe("");
    expect(outcome.result.patch).not.toContain("legacy.py");
  });
});

// ---------------------------------------------------------------------------
// R6.5 — re-diagnosis fails: File_Results preserved, after/delta null, a
// re-diagnosis skip-note emitted.
//
// The failure is forced by handing the Ritual an INVALID spread kind: the
// overlay re-reading calls `runReading(overlay, { spreadKind: <invalid> })`,
// whose spread assignment yields no positions and whose final `ReadingSchema`
// parse then rejects — exactly the "post-reading rejects" path R6.5 handles.
// ---------------------------------------------------------------------------

describe("LocalCovenRunner (R6.5): re-diagnosis failure", () => {
  it("preserves File_Results, nulls after/delta, and emits a re-diagnosis skip-note", async () => {
    const runner = new LocalCovenRunner(registryWith());
    const emit = makeEmit();
    const ports: RitualPorts = {
      clock: makeClock(), // frozen: budgets never trip
      ledger: makeLedger(),
      llm: fakeLlm(),
    };

    // An invalid spread kind forces the post-resurrection reading to reject.
    const input = ritualInput({
      spread: "not-a-spread" as unknown as SpreadKind,
    });

    const outcome = await runner.run(input, ports, emit);

    // The Ritual still returns a result (no terminal error) with its
    // File_Results intact (R6.5 — never discarded).
    expect(outcome.error).toBeNull();
    expect(outcome.result.files).toHaveLength(1);
    expect(outcome.result.files[0]!.path).toBe("legacy.py");

    // after/delta are null because the re-reading would not settle; before is
    // still a concrete vitality.
    expect(outcome.result.afterVitality).toBeNull();
    expect(outcome.result.vitalityDelta).toBeNull();
    expect(outcome.result.beforeVitality).toBeGreaterThanOrEqual(0);
    expect(outcome.result.changedCards).toEqual([]);

    // A skip-note for the re-diagnosis step is streamed (oracle-voice text).
    const redxNotes = emit.skipNotes.filter((n) =>
      n.includes("second reading"),
    );
    expect(redxNotes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// R10.4 / R10.5 — the overall wall-clock budget is exhausted: the Ritual ends
// with a BUDGET_EXHAUSTED error carrying partial File_Results, and the injected
// sandbox is disposed.
// ---------------------------------------------------------------------------

describe("LocalCovenRunner (R10.4, R10.5): budget exhaustion", () => {
  it("returns BUDGET_EXHAUSTED with partial File_Results and disposes the sandbox", async () => {
    const sandbox = okSandbox();
    // A ZERO overall budget: the deadline equals the clock reading taken at the
    // start of run(), so the first `overBudget()` check (after SELECT, once the
    // clock has advanced) trips immediately.
    const runner = new LocalCovenRunner(registryWith(), {
      totalBudgetMs: 0,
    });
    const emit = makeEmit();
    const ports: RitualPorts = {
      clock: makeClock({ step: 1 }), // advances so overBudget() becomes true
      ledger: makeLedger(),
      llm: fakeLlm(),
      sandbox,
    };

    const outcome = await runner.run(ritualInput(), ports, emit);

    // Terminal state: a typed BUDGET_EXHAUSTED error returned alongside the
    // partial result (not thrown — the partial files must survive).
    expect(outcome.error).not.toBeNull();
    expect(outcome.error!.code).toBe("BUDGET_EXHAUSTED");

    // Partial File_Results are preserved (the single selected candidate), not
    // discarded; it is marked not-validated (never confirmed) so it stays out
    // of the Patch, and after/delta are null (re-diagnosis never ran).
    expect(outcome.result.files).toHaveLength(1);
    expect(outcome.result.files[0]!.path).toBe("legacy.py");
    expect(outcome.result.files[0]!.validated).toBe(false);
    expect(outcome.result.afterVitality).toBeNull();
    expect(outcome.result.vitalityDelta).toBeNull();
    expect(outcome.result.patch).toBe("");

    // The sandbox micro-VM is disposed in this terminal state (R10.5 / rule 3).
    expect(sandbox.disposed()).toBe(1);
  });

  it("still disposes the sandbox on the happy path (every terminal state)", async () => {
    const sandbox = okSandbox();
    const runner = new LocalCovenRunner(registryWith());
    const emit = makeEmit();
    const ports: RitualPorts = {
      clock: makeClock(),
      ledger: makeLedger(),
      llm: fakeLlm(),
      sandbox,
    };

    const outcome = await runner.run(ritualInput(), ports, emit);

    expect(outcome.error).toBeNull();
    expect(sandbox.disposed()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Ledger sanity — the append-only stream has strictly increasing `seq`. This
// guards the coven-contracts invariant across the edge paths above.
// ---------------------------------------------------------------------------

describe("LocalCovenRunner: ledger is append-only with increasing seq", () => {
  it("appends events with strictly increasing seq on the happy path", async () => {
    const runner = new LocalCovenRunner(registryWith());
    const ledger = makeLedger();
    const ports: RitualPorts = {
      clock: makeClock(),
      ledger,
      llm: fakeLlm(),
    };

    await runner.run(ritualInput(), ports, makeEmit());

    expect(ledger.events.length).toBeGreaterThan(0);
    for (let i = 1; i < ledger.events.length; i++) {
      expect(ledger.events[i]!.seq).toBeGreaterThan(ledger.events[i - 1]!.seq);
    }
    // The stream opens with the ritual.start event (seq 0).
    expect(ledger.events[0]!.seq).toBe(0);
  });
});
