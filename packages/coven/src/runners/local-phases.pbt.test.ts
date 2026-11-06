// @necro/coven — property test for ordered, once-each phase emission (task 11.3).
//
// Property 10: Phases are emitted in order, once each (R9.2).
//   The sequence of `Phase_Line`s a Ritual emits is a NON-REPEATING PREFIX of
//   the canonical order
//
//     SELECT, PRE_PASS, LLM_PASS, VALIDATE, REDIAGNOSE, DIFF
//
//   i.e. every emitted phase appears at most once, the emitted phases match the
//   canonical order position-for-position, and no phase is skipped before a
//   later one appears. A Ritual that terminates early (budget exhaustion) emits
//   a shorter prefix; a Ritual that runs to completion emits the whole list.
//   Degraded_Mode (no LlmPort) and the optional SandboxPort never add, drop, or
//   reorder a phase — they only change the skip-notes interleaved between them,
//   which this property deliberately ignores.
//
// The property drives the REAL `LocalCovenRunner.run` over varied simulated
// progressions. Variation axes (per the task):
//   - clock budgets: a controllable `ClockPort` whose `nowMs()` advances a
//     fixed step per call, combined with a generated `totalBudgetMs`, forces
//     the runner's `overBudget()` checks to trip at different phases so early
//     termination is exercised across the whole prefix lattice.
//   - presence/absence of `LlmPort` and `SandboxPort` (Degraded_Mode and the
//     optional sandbox path).
//   - inputs: a real `RepoSnapshot` built with `buildSnapshotFromFileMap` and a
//     real `Reading` from the oracle's `runReading` over small py2/py3 sources.
//
// The emitted phase order is captured through a recording `PhaseEmit`. No
// network, LLM, or sandbox is touched: the LlmPort/SandboxPort are tiny
// in-memory fakes and the grimoire is a local stub (keeping @necro/coven's
// tests free of any grimoire-package import, honouring oracle <- grimoires <-
// coven). The harness is local to this file so it never clobbers task 11.2's
// concurrently-added `local.test.ts`.
//
// fast-check runs 200 times (the plan's non-fixer property budget); the seed is
// printed on failure (fast-check prints the failing seed by default).

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  buildSnapshotFromFileMap,
  initParser,
  parsePython,
  type RepoRef,
  type RepoSnapshot,
  type Reading,
  type SpreadKind,
} from "@necro/oracle";
import { runReading } from "@necro/oracle";

import { LanguagePairRegistry, PYTHON2_TO_PYTHON3 } from "../registry.js";
import {
  LocalCovenRunner,
  RESURRECTION_PHASES,
  type PhaseEmit,
  type ResurrectionPhase,
} from "./local.js";
import type {
  ClockPort,
  Grimoire,
  LedgerPort,
  LlmPort,
  LlmRequest,
  RitualPorts,
  SandboxPort,
} from "../ports.js";
import type { LedgerEvent, RitualInput } from "../models.js";

// ---------------------------------------------------------------------------
// Local test harness — kept entirely in this file (do not share with 11.2).
// ---------------------------------------------------------------------------

/**
 * A stub grimoire for the `python2->python3` pair. The runner only ever touches
 * `fixers`, `llm`, and `validate`; the schema fields are shaped enough to type
 * but never inspected by the runner. The single fixer is a no-op that records
 * one residual per file so the LLM_PASS has something to attempt (exercising the
 * degraded skip vs the LlmPort path), and `validate` always reports valid so
 * the file-level VALIDATE branch is deterministic. None of this affects the
 * PHASE ORDER — which is the only thing this property observes — it just makes
 * every phase do representative work.
 */
function makeStubGrimoire(): Grimoire {
  return {
    id: "py2to3",
    pair: PYTHON2_TO_PYTHON3,
    // The runner never calls these schemas; a minimal passthrough-shaped object
    // satisfies the structural type. Cast through `unknown` to avoid pulling in
    // zod here — the runner does not parse with them.
    inputSchema: undefined as unknown as Grimoire["inputSchema"],
    outputSchema: undefined as unknown as Grimoire["outputSchema"],
    fixers: [
      (source, ctx) => {
        // Parse once (the runner arms the parser via initParser) to mirror a
        // real fixer's shape; the result is unused. Record a single residual so
        // LLM_PASS has a construct to resolve.
        try {
          ctx.parse(source);
        } catch {
          // A parse failure is fine; the fixer still returns unchanged content.
        }
        return {
          after: source,
          residuals: [
            {
              path: ctx.path,
              line: 1,
              construct: "stub_residual",
              reason: "no_transform" as const,
            },
          ],
        };
      },
    ],
    llm: {
      // The runner validates LLM output with this schema; a schema that always
      // fails safeParse keeps the residual (reason llm_invalid_output) without
      // throwing. Order-wise this is irrelevant; it simply keeps the LLM path
      // honest when an LlmPort is present.
      outputSchema: {
        safeParse: () => ({ success: false as const, error: undefined }),
      } as unknown as Grimoire["llm"]["outputSchema"],
      buildRequest: (input): LlmRequest => ({
        system: "stub",
        prompt: input.construct,
        maxTokens: 16,
        timeoutMs: 1_000,
        cacheKey: `stub:${input.path}:${input.construct}`,
      }),
      apply: (source) => source,
      mockFixture: () => "{}",
    },
    validate: (after) => {
      // Target_Parser stand-in: count error nodes via the real parser so this is
      // a genuine local parse, but treat any input as "valid" for phase-order
      // purposes (validity does not change which phases emit).
      try {
        parsePython(after);
      } catch {
        // ignore — still report valid; phase order is what we assert.
      }
      return { valid: true, errorNodeCount: 0 };
    },
    divergenceAllowlist: [],
  };
}

/** A registry bound to the stub grimoire for the shipped pair. */
function makeRegistry(): LanguagePairRegistry {
  const registry = new LanguagePairRegistry();
  registry.register(PYTHON2_TO_PYTHON3, makeStubGrimoire());
  return registry;
}

/**
 * A controllable `ClockPort`. Each call to `nowMs()` returns the current value
 * and then advances it by `stepMs`. Because the runner reads the clock a bounded
 * number of times (once to set the deadline, then once per `overBudget()` /
 * validate-deadline check), a generated `(startMs, stepMs, totalBudgetMs,
 * validateBudgetMs)` tuple deterministically decides at which phase boundary the
 * budget first trips — sweeping early termination across every prefix.
 */
function makeAdvancingClock(startMs: number, stepMs: number): ClockPort {
  let t = startMs;
  return {
    nowMs(): number {
      const now = t;
      t += stepMs;
      return now;
    },
  };
}

/** A capturing `LedgerPort` — appends are recorded, never fail. */
function makeCapturingLedger(): { port: LedgerPort; events: LedgerEvent[] } {
  const events: LedgerEvent[] = [];
  return {
    events,
    port: {
      async append(event: LedgerEvent): Promise<void> {
        events.push(event);
      },
    },
  };
}

/** A recording `PhaseEmit` — captures the ordered phase names; ignores skip-notes. */
function makeRecordingEmit(): { emit: PhaseEmit; phases: ResurrectionPhase[] } {
  const phases: ResurrectionPhase[] = [];
  return {
    phases,
    emit: {
      phase(phase: ResurrectionPhase): void {
        phases.push(phase);
      },
      skipNote(): void {
        // Skip-notes are not part of the phase sequence; ignore them.
      },
    },
  };
}

/**
 * A minimal in-memory `LlmPort`. `complete` resolves deterministically with a
 * non-JSON string so the stub grimoire's always-failing schema keeps the
 * residual — no network, no real model. Present-vs-absent is the axis we vary.
 */
const fakeLlm: LlmPort = {
  providerId: "mock",
  async complete(_req: LlmRequest): Promise<{ text: string; cached: boolean }> {
    return { text: "not-json", cached: false };
  },
};

/**
 * A minimal in-memory `SandboxPort`. `parseCheckPython3` resolves `ok: true`
 * without executing anything; `dispose` is a no-op. Present-vs-absent is the
 * axis we vary.
 */
const fakeSandbox: SandboxPort = {
  async parseCheckPython3(): Promise<{ ok: boolean }> {
    return { ok: true };
  },
  async dispose(): Promise<void> {
    // no-op
  },
};

// ---------------------------------------------------------------------------
// Generators — small, pure, synchronous. The async `runReading` lives in the
// property body (via `fc.asyncProperty`), not in an arbitrary.
// ---------------------------------------------------------------------------

/** A short, filesystem-safe path segment (letters/digits/_/-; never . or ..). */
const arbPathSegment: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 6 })
  .map((s) => s.replace(/[^a-zA-Z0-9_-]/g, "_"))
  .filter((s) => s.length > 0 && s !== "." && s !== "..");

/** A relative `.py` file path (1-2 segments). */
const arbPyPath: fc.Arbitrary<string> = fc
  .array(arbPathSegment, { minLength: 1, maxLength: 2 })
  .map((segments) => segments.join("/") + ".py");

/** Small py2/py3 source so the reading draws varied cards; "\n" only. */
const arbPySource: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(
      'print "legacy"',
      "print('modern')",
      "x = 0L",
      "if a <> b:\n    pass",
      "except Exception, e:\n    pass",
      "value = 42",
      "def f():\n    return None",
      "pass",
    ),
    { minLength: 0, maxLength: 5 },
  )
  .map((lines) => (lines.length === 0 ? "pass\n" : lines.join("\n") + "\n"));

/** A 40-hex-char commit sha. */
const arbSha: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: 15 }), { minLength: 40, maxLength: 40 })
  .map((nibbles) => nibbles.map((n) => "0123456789abcdef"[n]).join(""));

const arbRepoRef: fc.Arbitrary<RepoRef> = fc.record({
  owner: arbPathSegment,
  name: arbPathSegment,
  sha: arbSha,
  defaultBranch: fc.constantFrom("main", "master", "develop"),
});

const arbSpread: fc.Arbitrary<SpreadKind> = fc.constantFrom(
  "fates",
  "necropsy",
  "celtic",
);

const arbIsoNow: fc.Arbitrary<string> = fc
  .date({
    min: new Date("2020-01-01T00:00:00Z"),
    max: new Date("2030-01-01T00:00:00Z"),
  })
  .map((d) => d.toISOString());

/**
 * One generated progression: the repo content + reading inputs, the clock
 * shape, the budgets, and the port-presence flags. The budgets are chosen to
 * span from "trips immediately" (tiny total budget) through "never trips"
 * (large total budget) so both early-termination prefixes and the full run
 * occur across the 200 runs.
 */
interface PhaseScenario {
  readonly ref: RepoRef;
  readonly files: ReadonlyArray<{ readonly path: string; readonly source: string }>;
  readonly spread: SpreadKind;
  readonly now: string;
  readonly startMs: number;
  readonly stepMs: number;
  readonly totalBudgetMs: number;
  readonly validateBudgetMs: number;
  readonly withLlm: boolean;
  readonly withSandbox: boolean;
}

const arbScenario: fc.Arbitrary<PhaseScenario> = fc.record({
  ref: arbRepoRef,
  files: fc.uniqueArray(
    fc.record({ path: arbPyPath, source: arbPySource }),
    { minLength: 1, maxLength: 4, selector: (f) => f.path },
  ),
  spread: arbSpread,
  now: arbIsoNow,
  startMs: fc.integer({ min: 0, max: 1_000 }),
  // Each clock read advances time by this much; combined with a small total
  // budget it forces `overBudget()` to trip at a generated phase boundary.
  stepMs: fc.integer({ min: 0, max: 400 }),
  // Total budget spans 0 (trip at the very first check) up to comfortably past
  // any plausible advance so full runs also occur.
  totalBudgetMs: fc.integer({ min: 0, max: 20_000 }),
  // Validate budget likewise spans trip-immediately through never-trip.
  validateBudgetMs: fc.integer({ min: 0, max: 20_000 }),
  withLlm: fc.boolean(),
  withSandbox: fc.boolean(),
});

/** Build a real `RepoSnapshot` + `Reading` for a scenario (local parse only). */
async function buildReadingFor(
  scenario: PhaseScenario,
): Promise<{ snapshot: RepoSnapshot; reading: Reading }> {
  const fileMap: Record<string, string> = {};
  for (const f of scenario.files) fileMap[f.path] = f.source;

  const snapshot = buildSnapshotFromFileMap(scenario.ref, fileMap, {
    createdAt: scenario.now,
  });
  const reading = await runReading(snapshot, {
    spreadKind: scenario.spread,
    now: scenario.now,
  });
  return { snapshot, reading };
}

// ---------------------------------------------------------------------------
// The invariant: the captured sequence is a non-repeating prefix of the
// canonical order.
// ---------------------------------------------------------------------------

/**
 * Assert `emitted` is a NON-REPEATING PREFIX of `RESURRECTION_PHASES`:
 *   - it is no longer than the canonical list;
 *   - position-for-position it equals the canonical list's prefix (so the order
 *     matches and no phase is skipped before a later one appears);
 *   - which, being an exact prefix of a list with no duplicates, also means no
 *     phase repeats. An explicit uniqueness check is added as belt-and-braces.
 */
function assertNonRepeatingPrefix(emitted: readonly ResurrectionPhase[]): void {
  // No duplicates.
  expect(new Set(emitted).size).toBe(emitted.length);
  // Length within bounds.
  expect(emitted.length).toBeLessThanOrEqual(RESURRECTION_PHASES.length);
  // Exact prefix match, position-for-position.
  for (let i = 0; i < emitted.length; i++) {
    expect(emitted[i]).toBe(RESURRECTION_PHASES[i]);
  }
}

// ---------------------------------------------------------------------------
// Property.
// ---------------------------------------------------------------------------

describe("P10 (R9.2): phases are emitted in order, once each", () => {
  it("every emitted phase sequence is a non-repeating prefix of RESURRECTION_PHASES", async () => {
    // Arm the parser once up front; `runReading`, the stub fixer, and the stub
    // validate all rely on it being ready. Doing it here keeps first-run init
    // cost out of the timed property body.
    await initParser();

    await fc.assert(
      fc.asyncProperty(arbScenario, async (scenario) => {
        const { snapshot, reading } = await buildReadingFor(scenario);

        const input: RitualInput = {
          pairId: PYTHON2_TO_PYTHON3,
          snapshot,
          reading,
          target: { kind: "bare" },
          spread: scenario.spread,
          now: scenario.now,
          demo: false,
        };

        const clock = makeAdvancingClock(scenario.startMs, scenario.stepMs);
        const ledger = makeCapturingLedger();
        const ports: RitualPorts = {
          clock,
          ledger: ledger.port,
          ...(scenario.withLlm ? { llm: fakeLlm } : {}),
          ...(scenario.withSandbox ? { sandbox: fakeSandbox } : {}),
        };

        const runner = new LocalCovenRunner(makeRegistry(), {
          totalBudgetMs: scenario.totalBudgetMs,
          validateBudgetMs: scenario.validateBudgetMs,
        });

        const recorder = makeRecordingEmit();
        // The runner returns a RitualOutcome even on budget exhaustion (the
        // BUDGET_EXHAUSTED terminal state travels through `outcome.error`, not a
        // throw), so `run` resolves rather than rejecting here.
        await runner.run(input, ports, recorder.emit);

        // The core property (R9.2).
        assertNonRepeatingPrefix(recorder.phases);
      }),
      { numRuns: 200 },
    );
  });

  it("a run with ample budget emits the full canonical sequence (both degraded and with-LLM)", async () => {
    // A deterministic companion pinning the FULL prefix: given a non-advancing
    // clock and a generous budget, no `overBudget()` check can trip, so every
    // phase must emit exactly once in canonical order. Covered for both the
    // degraded (no LlmPort) and the with-LLM/with-sandbox configurations so the
    // optional ports provably neither add nor drop a phase.
    await initParser();

    const arbFullRun = fc.record({
      ref: arbRepoRef,
      files: fc.uniqueArray(
        fc.record({ path: arbPyPath, source: arbPySource }),
        { minLength: 1, maxLength: 4, selector: (f) => f.path },
      ),
      spread: arbSpread,
      now: arbIsoNow,
      withLlm: fc.boolean(),
      withSandbox: fc.boolean(),
    });

    await fc.assert(
      fc.asyncProperty(arbFullRun, async (base) => {
        const scenario: PhaseScenario = {
          ...base,
          // A frozen clock + huge budget: `overBudget()` is always false.
          startMs: 0,
          stepMs: 0,
          totalBudgetMs: 1_000_000,
          validateBudgetMs: 1_000_000,
        };
        const { snapshot, reading } = await buildReadingFor(scenario);

        const input: RitualInput = {
          pairId: PYTHON2_TO_PYTHON3,
          snapshot,
          reading,
          target: { kind: "bare" },
          spread: scenario.spread,
          now: scenario.now,
          demo: false,
        };

        const ports: RitualPorts = {
          clock: makeAdvancingClock(0, 0),
          ledger: makeCapturingLedger().port,
          ...(scenario.withLlm ? { llm: fakeLlm } : {}),
          ...(scenario.withSandbox ? { sandbox: fakeSandbox } : {}),
        };

        const runner = new LocalCovenRunner(makeRegistry(), {
          totalBudgetMs: scenario.totalBudgetMs,
          validateBudgetMs: scenario.validateBudgetMs,
        });

        const recorder = makeRecordingEmit();
        await runner.run(input, ports, recorder.emit);

        // The complete, non-repeating sequence in canonical order.
        expect(recorder.phases).toEqual([...RESURRECTION_PHASES]);
      }),
      { numRuns: 200 },
    );
  });
});
