// src/motion/glitch.pbt.test.ts
//
// Feature: visual-necromancy, task 3.2 — Properties 6 and 7.
//
// Property-based tests for the Glitch_Profile (`motion/glitch.ts`, task 3.1):
// the pure mapping from a CardDraw severity (0..3) to a Glitch_Intensity and
// its bounded glitch parameters.
//
// Property 6 (design §Property 6, R5.2, R5.6): the Glitch_Profile is
// deterministic — two calls with the same severity return equal, finite,
// bounded parameters — and maps each integer severity 0..3 onto an equal
// Glitch_Intensity (`intensity === severity`).
//
// Property 7 (design §Property 7, R5.3, R5.4): every glitch parameter is
// non-decreasing as severity rises (monotonicity), and severity 0 yields an
// all-zero profile (a calm card is perfectly steady).
//
// Semantics under test (motion/glitch.ts):
//   glitchProfile(severity):
//     intensity     = clamp(round(severity), 0..3)   (NaN -> 0)
//     offsetPx      = intensity * 2
//     tearCount     = intensity
//     corruptChars  = intensity * 3
//     durationMs    = min(GLITCH_MAX_DURATION_MS, intensity * 90)
//
// Testing steering: fast-check with explicit numRuns (default 200). No network,
// clock, DOM, or real randomness — pure computation.
//
// **Validates: Requirements 5.2, 5.3, 5.4, 5.6**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  GLITCH_MAX_DURATION_MS,
  glitchProfile,
  type GlitchParams,
} from "./glitch.js";

/** Both properties run the default property budget. */
const NUM_RUNS = 200;

/** The valid, in-range integer severities 0..3 (also valid Glitch_Intensity). */
const arbSeverity: fc.Arbitrary<0 | 1 | 2 | 3> = fc.constantFrom<0 | 1 | 2 | 3>(
  0,
  1,
  2,
  3,
);

/**
 * Broad severities for monotonicity and clamping: finite reals covering
 * negatives, fractional values, the in-range band, and values beyond 3.
 */
const arbBroadSeverity: fc.Arbitrary<number> = fc.double({
  min: -10,
  max: 10,
  noNaN: true,
});

/** The five numeric fields of a GlitchParams, in a fixed order. */
function params(p: GlitchParams): readonly number[] {
  return [p.intensity, p.offsetPx, p.tearCount, p.corruptChars, p.durationMs];
}

describe("P6 (R5.2, R5.6): glitch profile determinism and severity mapping", () => {
  it("returns equal parameters across two calls with the same severity (R5.6)", () => {
    fc.assert(
      fc.property(arbBroadSeverity, (severity) => {
        expect(glitchProfile(severity)).toEqual(glitchProfile(severity));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("maps each integer severity 0..3 to an equal Glitch_Intensity (R5.2)", () => {
    fc.assert(
      fc.property(arbSeverity, (severity) => {
        expect(glitchProfile(severity).intensity).toBe(severity);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("derives finite, non-negative, bounded parameters for any severity (R5.6)", () => {
    fc.assert(
      fc.property(arbBroadSeverity, (severity) => {
        const p = glitchProfile(severity);
        for (const value of params(p)) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
        // Bounded by the severity-3 ceiling for each field.
        expect(p.intensity).toBeLessThanOrEqual(3);
        expect(p.offsetPx).toBeLessThanOrEqual(6);
        expect(p.tearCount).toBeLessThanOrEqual(3);
        expect(p.corruptChars).toBeLessThanOrEqual(9);
        expect(p.durationMs).toBeLessThanOrEqual(GLITCH_MAX_DURATION_MS);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("P7 (R5.3, R5.4): glitch monotonicity and severity-0 emptiness", () => {
  it("makes every parameter non-decreasing as severity rises (R5.4)", () => {
    fc.assert(
      fc.property(
        fc.tuple(arbBroadSeverity, arbBroadSeverity),
        ([a, b]) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const low = glitchProfile(lo);
          const high = glitchProfile(hi);
          expect(high.intensity).toBeGreaterThanOrEqual(low.intensity);
          expect(high.offsetPx).toBeGreaterThanOrEqual(low.offsetPx);
          expect(high.tearCount).toBeGreaterThanOrEqual(low.tearCount);
          expect(high.corruptChars).toBeGreaterThanOrEqual(low.corruptChars);
          expect(high.durationMs).toBeGreaterThanOrEqual(low.durationMs);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("yields an all-zero profile at severity 0 (R5.3)", () => {
    const p = glitchProfile(0);
    expect(p).toEqual({
      intensity: 0,
      offsetPx: 0,
      tearCount: 0,
      corruptChars: 0,
      durationMs: 0,
    });
  });

  it("yields an all-zero profile for any severity that clamps to 0 (R5.3)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 0, noNaN: true }),
        (severity) => {
          for (const value of params(glitchProfile(severity))) {
            expect(value).toBe(0);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
