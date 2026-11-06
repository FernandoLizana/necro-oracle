// Feature: visual-necromancy — Boot_Frame_Renderer properties (task 1.2).
//
// Properties 1 and 2 over `bootFrame(stepIndex)`. These exercise the two
// invariants that make the Boot_Sequence testable and stable in Demo mode:
// determinism with a hard 72-column line budget (R2.2, R2.3), and total,
// saturating indexing (R2.4) — every integer index, including negative values
// and indices beyond the last step, yields a Boot_Frame without throwing, and
// any index at or past the last step returns the ready frame.
//
// No network, LLM, sandbox, clock, DOM or unseeded randomness: `bootFrame` is a
// pure function and these tests only generate indices and compare outputs.
//
// **Validates: Requirements 2.2, 2.3, 2.4**

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { lineText } from "./blocks.js";
import { BOOT_STEP_COUNT, type BootFrame, bootFrame } from "./boot.js";
import { LINE_WIDTH } from "../text/wrap.js";

const NUM_RUNS = 200;

// --- Arbitraries -------------------------------------------------------------

/** A valid, in-range displayed step index: `0..BOOT_STEP_COUNT-1`. */
const arbStepIndex: fc.Arbitrary<number> = fc.integer({
  min: 0,
  max: BOOT_STEP_COUNT - 1,
});

/**
 * Any integer index: deeply negative, in range, and far beyond the last step,
 * so the totality + saturation property is hit across the whole number line.
 */
const arbAnyIndex: fc.Arbitrary<number> = fc.integer({
  min: -1000,
  max: BOOT_STEP_COUNT + 1000,
});

// --- Helpers -----------------------------------------------------------------

/** Measure a line's width in code points (matching `wrapText`'s unit). */
function lineWidth(frame: BootFrame, i: number): number {
  return [...lineText(frame.lines[i]!)].length;
}

/** Structural equality of two Boot_Frames by their flattened line text. */
function sameFrame(a: BootFrame, b: BootFrame): boolean {
  if (a.lines.length !== b.lines.length) return false;
  return a.lines.every((_, i) => lineText(a.lines[i]!) === lineText(b.lines[i]!));
}

// --- Property 1: determinism + 72-column budget ------------------------------

describe("P1 (R2.2, R2.3): boot frame determinism", () => {
  it("returns an equal BootFrame for the same step index (R2.2)", () => {
    fc.assert(
      fc.property(arbStepIndex, (index) => {
        const first = bootFrame(index);
        const second = bootFrame(index);
        expect(sameFrame(first, second)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("keeps every line at most 72 columns (R2.3)", () => {
    fc.assert(
      fc.property(arbStepIndex, (index) => {
        const frame = bootFrame(index);
        for (let i = 0; i < frame.lines.length; i++) {
          expect(lineWidth(frame, i)).toBeLessThanOrEqual(LINE_WIDTH);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 2: total + saturating indexing ---------------------------------

describe("P2 (R2.4): boot index total and saturating", () => {
  it("returns a BootFrame for any integer index without throwing (R2.4)", () => {
    fc.assert(
      fc.property(arbAnyIndex, (index) => {
        const frame = bootFrame(index);
        // A frame is always produced, and it always has at least one line.
        expect(frame.lines.length).toBeGreaterThan(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("returns the ready frame for any index at or beyond the last step (R2.4)", () => {
    const readyFrame = bootFrame(BOOT_STEP_COUNT - 1);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), (over) => {
        const index = BOOT_STEP_COUNT - 1 + over;
        expect(sameFrame(bootFrame(index), readyFrame)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
