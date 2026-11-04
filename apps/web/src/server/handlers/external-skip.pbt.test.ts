// apps/web/src/server/handlers/external-skip.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 29
//
// Property-based tests for the pure External_Sub_Budget skip decision
// (task 23.1, TEST-FIRST).
//
// TEST-FIRST (red). This file is written before
// `server/handlers/external-skip.ts` (task 23.2), so the import below fails to
// resolve and the whole suite is red for the expected reason: the module
// `./external-skip.js` does not exist yet.
//
// Property 29 (design.md D15 "External_Sub_Budget"):
// A pure `decideExternalSkip({ elapsedMs, skipped })` decides whether to skip
// the external-data phase:
//   - skip === (elapsedMs > EXTERNAL_SUB_BUDGET_MS) || skipped === true
//     (EXTERNAL_SUB_BUDGET_MS = 10_000; exactly 10_000 ms does NOT skip);
//   - when skip, `note` is the non-empty Oracle_Voice skip line (R6.21);
//   - when not skip, `note` may be empty / unused.
// On a skip the route calls `runReading` with BOTH `registryData` and `osvData`
// omitted and fabricates nothing (R6.22) — the omission happens in the handler
// (task 26); this property pins the pure DECISION and its note.
//
// Testing steering: fast-check with explicit numRuns (default 200); print the
// seed on failure. No network / LLM / sandbox — pure computation.
//
// **Validates: Requirements R6.20, R6.21, R6.22**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Not yet implemented — task 23.2 adds this module.
import { EXTERNAL_SUB_BUDGET_MS, decideExternalSkip } from "./external-skip.js";

/** P29 runs the default property budget. */
const NUM_RUNS = 200;

/** The documented External_Sub_Budget (design.md D15). */
const BUDGET_MS = 10_000;

/**
 * Elapsed-time generator spanning both sides of the 10 s budget, including
 * negatives, zero, exactly the budget, and well beyond it.
 */
const arbElapsedMs: fc.Arbitrary<number> = fc.oneof(
  // General spread across and beyond the boundary.
  fc.integer({ min: -5_000, max: 20_000 }),
  // Pin the interesting values the boundary cares about.
  fc.constantFrom(-1, 0, 1, 9_999, 10_000, 10_001, 40_000),
);

const arbInput: fc.Arbitrary<{ elapsedMs: number; skipped: boolean }> = fc.record({
  elapsedMs: arbElapsedMs,
  skipped: fc.boolean(),
});

describe("P29 (R6.20, R6.21, R6.22): external-skip decision", () => {
  it("EXTERNAL_SUB_BUDGET_MS is 10_000 (design.md D15)", () => {
    expect(EXTERNAL_SUB_BUDGET_MS).toBe(BUDGET_MS);
  });

  it("skips exactly when elapsedMs > 10_000 or the skipped flag is set", () => {
    fc.assert(
      fc.property(arbInput, ({ elapsedMs, skipped }) => {
        const expected = elapsedMs > BUDGET_MS || skipped === true;
        const { skip } = decideExternalSkip({ elapsedMs, skipped });
        expect(skip).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("exactly 10_000 ms does not skip on its own (strict greater-than boundary)", () => {
    expect(decideExternalSkip({ elapsedMs: BUDGET_MS, skipped: false }).skip).toBe(false);
    // But the flag alone still forces a skip at the boundary.
    expect(decideExternalSkip({ elapsedMs: BUDGET_MS, skipped: true }).skip).toBe(true);
  });

  it("produces a non-empty Oracle_Voice note whenever it skips (R6.21)", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const { skip, note } = decideExternalSkip(input);
        if (skip) {
          expect(typeof note).toBe("string");
          expect(note.trim().length).toBeGreaterThan(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is a pure total function: equal inputs give equal outputs", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        expect(decideExternalSkip({ ...input })).toEqual(decideExternalSkip({ ...input }));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // --- Examples ------------------------------------------------------------

  it("does not skip on a fast, un-flagged external phase", () => {
    const { skip } = decideExternalSkip({ elapsedMs: 2_000, skipped: false });
    expect(skip).toBe(false);
  });

  it("skips on a slow external phase (timeout past the budget)", () => {
    const { skip, note } = decideExternalSkip({ elapsedMs: 10_001, skipped: false });
    expect(skip).toBe(true);
    expect(note.trim().length).toBeGreaterThan(0);
  });

  it("skips on the explicit skipped flag even when fast", () => {
    const { skip, note } = decideExternalSkip({ elapsedMs: 0, skipped: true });
    expect(skip).toBe(true);
    expect(note.trim().length).toBeGreaterThan(0);
  });

  // R6.22: on a skip the route omits BOTH registryData and osvData and
  // fabricates nothing. The pure decision carries only { skip, note }; it must
  // NEVER surface fabricated registry/OSV data as part of the decision.
  it("the decision never carries any fabricated registry/OSV data", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const decision = decideExternalSkip(input);
        expect(Object.keys(decision).sort()).toEqual(["note", "skip"]);
        expect("registryData" in decision).toBe(false);
        expect("osvData" in decision).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
