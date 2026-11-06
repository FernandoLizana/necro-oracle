// src/motion/decay.test.ts
//
// Feature: visual-necromancy, task 5.2.
//
// Unit tests for the Decay_Sequence (`motion/decay.ts`): the design's test map
// pins `decaySequence` to concrete first-0 / last-1 / non-decreasing cases plus
// the edge cases around empty and single-frame sequences. A small fast-check
// block pins the same invariants across the frame-count space.
//
// No network / LLM / sandbox — `decaySequence` is a pure function.
//
// **Validates: Requirements R6.3**

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { decaySequence } from "./decay.js";

describe("decaySequence (R6.3): Decay_Sequence", () => {
  it("evenly spaces the amounts with first 0 and last 1 (the design example)", () => {
    expect(decaySequence(5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("produces first 0 and last 1 for the smallest multi-frame sequence", () => {
    expect(decaySequence(2)).toEqual([0, 1]);
  });

  it("returns a single fully-decayed frame for frameCount 1", () => {
    expect(decaySequence(1)).toEqual([1]);
  });

  it("returns an empty sequence for zero or negative frame counts", () => {
    expect(decaySequence(0)).toEqual([]);
    expect(decaySequence(-3)).toEqual([]);
  });

  it("floors fractional frame counts and treats NaN as empty", () => {
    expect(decaySequence(5.9)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(decaySequence(0.9)).toEqual([]);
    expect(decaySequence(Number.NaN)).toEqual([]);
  });

  it("holds first 0, last 1, and non-decreasing amounts for every frame count", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 500 }), (frameCount) => {
        const seq = decaySequence(frameCount);
        expect(seq).toHaveLength(frameCount);
        expect(seq[0]).toBe(0);
        expect(seq[seq.length - 1]).toBe(1);
        for (let i = 1; i < seq.length; i++) {
          expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1] as number);
          expect(seq[i]).toBeGreaterThanOrEqual(0);
          expect(seq[i]).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("is a pure function of frameCount", () => {
    fc.assert(
      fc.property(fc.integer({ min: -10, max: 500 }), (frameCount) => {
        expect(decaySequence(frameCount)).toEqual(decaySequence(frameCount));
      }),
      { numRuns: 200 },
    );
  });
});
