// apps/web/src/server/handlers/phase.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 28
//
// Property-based tests AND wrapper examples for the pure, monotonic phase
// reporter (task 23.1, TEST-FIRST).
//
// TEST-FIRST (red). This file is written before `server/handlers/phase.ts`
// (task 23.2), so the import below fails to resolve and the whole suite is red
// for the expected reason: the module `./phase.js` does not exist yet.
//
// Property 28 (design.md D14 "Phase reporting is pure and monotonic"):
// Phase reporting is a pure, monotonic state machine over the fixed order
//   PHASE_ORDER = ["SUMMON", "DOWNLOAD", "EXTERNAL", "READING"]
// `advancePhase(state, phase)` returns `{ state, emit }`:
//   - a phase may be reported only if it is the NEXT unreported phase in
//     PHASE_ORDER  -> emit:true, the phase is appended to `state.reported`;
//   - a phase already reported           -> emit:false, state unchanged;
//   - reporting out of order / skipping ahead THROWS a typed internal error.
// `state.reported` is always a prefix of PHASE_ORDER; it never goes backwards
// and never contains a phase twice. `createPhaseReporter(write)` writes exactly
// one PhaseLine the first time each phase is reported and nothing on repeats.
//
// Semantics under test (design.md D14):
//   PHASE_ORDER: readonly ["SUMMON", "DOWNLOAD", "EXTERNAL", "READING"]
//   type PhaseState = { reported: readonly ReadingPhase[] }   // a prefix
//   initialPhaseState(): PhaseState                            // { reported: [] }
//   advancePhase(state, phase): { state: PhaseState; emit: boolean }   // pure
//   interface PhaseReporter { report(phase): void; skipNote(note): void }
//   createPhaseReporter(write: (line: StreamLine) => void): PhaseReporter
//     report()   -> advancePhase + writes one PhaseLine the first time only;
//     skipNote() -> writes one SkipNoteLine.
//
// Testing steering: fast-check with explicit numRuns (default 200); print the
// seed on failure. No network / LLM / sandbox — pure computation.
//
// **Validates: Requirements R6.14, R6.15, R6.16**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { ReadingPhase } from "@necro/ui-crt";

// Not yet implemented — task 23.2 adds this module.
import {
  PHASE_ORDER,
  advancePhase,
  createPhaseReporter,
  initialPhaseState,
  type PhaseState,
} from "./phase.js";

/** P28 runs the default property budget. */
const NUM_RUNS = 200;

/** The fixed Reading_Phase order the machine advances through. */
const ORDER: readonly ReadingPhase[] = ["SUMMON", "DOWNLOAD", "EXTERNAL", "READING"];

/**
 * The wire line shapes the reporter writes (design.md D13). We model the two
 * the reporter can emit structurally so this suite is red ONLY for the missing
 * `./phase.js`, not for the not-yet-written `./stream.js`.
 */
type PhaseLine = { readonly phase: ReadingPhase };
type SkipNoteLine = { readonly skip: true; readonly note: string };
type WireLine = PhaseLine | SkipNoteLine;

const isPhaseLine = (line: WireLine): line is PhaseLine =>
  Object.prototype.hasOwnProperty.call(line, "phase");

/** `true` iff `xs` is a prefix of PHASE_ORDER (order preserved, no gaps). */
function isPrefixOfOrder(xs: readonly ReadingPhase[]): boolean {
  if (xs.length > ORDER.length) return false;
  return xs.every((phase, i) => phase === ORDER[i]);
}

// --- Arbitraries ----------------------------------------------------------

/**
 * A strictly in-order prefix of PHASE_ORDER, optionally with some already-seen
 * phases re-requested (which must emit nothing / change nothing). The sequence
 * is "the next phase or any already-reported phase", so it never goes out of
 * order — the valid-path generator.
 */
const arbInOrderRequests: fc.Arbitrary<readonly ReadingPhase[]> = fc
  .integer({ min: 0, max: ORDER.length })
  .chain((reach) => {
    // We will advance through the first `reach` phases, possibly re-requesting
    // earlier phases in between. Build a request list that only ever asks for
    // an already-reported phase or the single next one.
    const steps = fc.array(fc.integer({ min: 0, max: Math.max(reach, 0) }), {
      minLength: 0,
      maxLength: 24,
    });
    return steps.map((repeats) => {
      const requests: ReadingPhase[] = [];
      let reportedCount = 0;
      // Interleave: for each planned advance, optionally re-request a seen phase.
      for (let next = 0; next < reach; next += 1) {
        // A sprinkling of repeats of already-reported phases (indices < reportedCount).
        if (reportedCount > 0 && repeats.length > 0) {
          const idx = repeats[next % repeats.length]! % reportedCount;
          requests.push(ORDER[idx]!);
        }
        requests.push(ORDER[next]!); // the valid next phase -> advances
        reportedCount += 1;
      }
      // Trailing repeats of whatever has been reported.
      for (const r of repeats) {
        if (reportedCount > 0) requests.push(ORDER[r % reportedCount]!);
      }
      return requests;
    });
  });

/**
 * A request sequence guaranteed to contain at least one out-of-order / skip
 * request: a valid in-order prefix followed by a phase strictly beyond the
 * next expected one (a skip-ahead) or a backwards jump.
 */
const arbOutOfOrderRequests: fc.Arbitrary<{
  readonly prefix: readonly ReadingPhase[];
  readonly bad: ReadingPhase;
}> = fc
  // How many phases to legally report first (0..2 so a strict skip-ahead exists).
  .integer({ min: 0, max: ORDER.length - 2 })
  .chain((reported) => {
    const prefix = ORDER.slice(0, reported);
    // The next legal phase is ORDER[reported]; pick a BAD phase that is neither
    // already reported (those would be no-ops) nor the next legal one.
    const badIndex = fc
      .integer({ min: reported + 1, max: ORDER.length - 1 })
      .map((i) => i);
    return badIndex.map((i) => ({ prefix, bad: ORDER[i]! }));
  });

// --- Helpers --------------------------------------------------------------

/** Advance through a list of requests, collecting every emitted phase. */
function runRequests(requests: readonly ReadingPhase[]): {
  state: PhaseState;
  emitted: readonly ReadingPhase[];
} {
  let state = initialPhaseState();
  const emitted: ReadingPhase[] = [];
  for (const phase of requests) {
    const result = advancePhase(state, phase);
    state = result.state;
    if (result.emit) emitted.push(phase);
  }
  return { state, emitted };
}

// --- Properties -----------------------------------------------------------

describe("P28 (R6.14, R6.15, R6.16): monotonic phase reporting", () => {
  it("PHASE_ORDER is exactly SUMMON, DOWNLOAD, EXTERNAL, READING", () => {
    expect([...PHASE_ORDER]).toEqual(ORDER);
    expect(initialPhaseState()).toEqual({ reported: [] });
  });

  it("reported phases are always a prefix of PHASE_ORDER with no repeats", () => {
    fc.assert(
      fc.property(arbInOrderRequests, (requests) => {
        let state = initialPhaseState();
        for (const phase of requests) {
          state = advancePhase(state, phase).state;
          // Invariant holds after every step.
          expect(isPrefixOfOrder(state.reported)).toBe(true);
          expect(new Set(state.reported).size).toBe(state.reported.length);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("emits each phase exactly once, in PHASE_ORDER (a prefix, no repeats)", () => {
    fc.assert(
      fc.property(arbInOrderRequests, (requests) => {
        const { state, emitted } = runRequests(requests);
        // The emitted phases equal the reported prefix, in order, no dupes.
        expect(emitted).toEqual([...state.reported]);
        expect(isPrefixOfOrder(emitted)).toBe(true);
        expect(new Set(emitted).size).toBe(emitted.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("re-reporting an already-reported phase emits nothing and leaves state unchanged", () => {
    fc.assert(
      fc.property(arbInOrderRequests, (requests) => {
        const { state } = runRequests(requests);
        // Re-requesting any already-reported phase is a no-op that never emits.
        for (const phase of state.reported) {
          const again = advancePhase(state, phase);
          expect(again.emit).toBe(false);
          expect(again.state).toEqual(state);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("never goes backwards: advancing is monotonic in the reported length", () => {
    fc.assert(
      fc.property(arbInOrderRequests, (requests) => {
        let state = initialPhaseState();
        let length = 0;
        for (const phase of requests) {
          state = advancePhase(state, phase).state;
          expect(state.reported.length).toBeGreaterThanOrEqual(length);
          length = state.reported.length;
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("throws on an out-of-order / skip-ahead request", () => {
    fc.assert(
      fc.property(arbOutOfOrderRequests, ({ prefix, bad }) => {
        // Report the legal prefix first.
        let state = initialPhaseState();
        for (const phase of prefix) state = advancePhase(state, phase).state;
        // Skipping ahead past the next expected phase throws a typed error.
        expect(() => advancePhase(state, bad)).toThrow();
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("purity: advancePhase does not mutate the input state", () => {
    fc.assert(
      fc.property(arbInOrderRequests, (requests) => {
        let state = initialPhaseState();
        for (const phase of requests) {
          const before = [...state.reported];
          const result = advancePhase(state, phase);
          // The original array is untouched regardless of emit.
          expect([...state.reported]).toEqual(before);
          state = result.state;
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // --- Wrapper examples (createPhaseReporter) -----------------------------

  describe("createPhaseReporter wrapper", () => {
    it("happy path: emits SUMMON/DOWNLOAD/EXTERNAL/READING, one PhaseLine each, in order", () => {
      const written: WireLine[] = [];
      const reporter = createPhaseReporter((line) => written.push(line as WireLine));

      for (const phase of ORDER) reporter.report(phase);

      expect(written).toEqual(ORDER.map((phase) => ({ phase })));
      // Every written line (so far) is a PhaseLine in PHASE_ORDER.
      const phases = written.filter(isPhaseLine).map((line) => line.phase);
      expect(phases).toEqual(ORDER);
    });

    it("cache-hit: DOWNLOAD is still reported exactly once (R6.16)", () => {
      const written: WireLine[] = [];
      const reporter = createPhaseReporter((line) => written.push(line as WireLine));

      // A cache hit makes DOWNLOAD instantaneous, but it is still emitted once.
      reporter.report("SUMMON");
      reporter.report("DOWNLOAD"); // cache hit — instant, but reported
      reporter.report("DOWNLOAD"); // a redundant re-report must NOT duplicate
      reporter.report("EXTERNAL");
      reporter.report("READING");

      const downloads = written.filter(isPhaseLine).filter((l) => l.phase === "DOWNLOAD");
      expect(downloads).toHaveLength(1);
      expect(written.filter(isPhaseLine).map((l) => l.phase)).toEqual(ORDER);
    });

    it("skipNote writes one SkipNoteLine and does not touch phase order", () => {
      const written: WireLine[] = [];
      const reporter = createPhaseReporter((line) => written.push(line as WireLine));

      reporter.report("SUMMON");
      reporter.report("DOWNLOAD");
      reporter.skipNote("The mists hide the registries; I read the bones alone.");
      reporter.report("EXTERNAL");
      reporter.report("READING");

      const skips = written.filter((l): l is SkipNoteLine => !isPhaseLine(l));
      expect(skips).toHaveLength(1);
      expect(skips[0]!.skip).toBe(true);
      expect(skips[0]!.note.length).toBeGreaterThan(0);
      // Phases are still the full ordered prefix, each emitted once.
      expect(written.filter(isPhaseLine).map((l) => l.phase)).toEqual(ORDER);
    });

    it("a repeated report writes no second line for that phase", () => {
      const written: WireLine[] = [];
      const reporter = createPhaseReporter((line) => written.push(line as WireLine));

      reporter.report("SUMMON");
      reporter.report("SUMMON"); // no-op: nothing new written
      expect(written).toEqual([{ phase: "SUMMON" }]);
    });
  });
});
