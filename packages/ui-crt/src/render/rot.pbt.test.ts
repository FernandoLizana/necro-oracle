// Feature: visual-necromancy — Rot_Transform properties (task 5.3).
//
// **Validates: Requirements 6.4, 6.5, 6.6, 6.8, 6.12**
//
// Properties 8, 9, 10, 11 over `rot(source, decay, seed)`. These exercise the
// large input space (arbitrary source strings, decays, seeds) where the pure
// invariants pay off: length + line-count preservation, determinism, the
// decay-0 identity, monotonic corruption, and decay clamping.
//
// No network, LLM or sandbox: `rot` is a pure function and these tests only
// generate inputs and compare outputs.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { rot } from "./rot.js";

const NUM_RUNS = 500;

// --- Arbitraries -------------------------------------------------------------

/**
 * A source string that deliberately mixes newlines, spaces and a spread of
 * printable characters (including some multi-unit unicode) so the length and
 * line-count invariants are exercised against realistic code-like text.
 */
const arbSource: fc.Arbitrary<string> = fc.stringOf(
  fc.oneof(
    { weight: 8, arbitrary: fc.constantFrom(..."abcdefgHIJKL0123 ()=+_.") },
    { weight: 2, arbitrary: fc.constant("\n") },
    { weight: 1, arbitrary: fc.fullUnicode() },
  ),
  { maxLength: 240 },
);

/** A decay inside the valid range [0,1]. */
const arbDecay: fc.Arbitrary<number> = fc.double({
  min: 0,
  max: 1,
  noNaN: true,
});

/** Any seed value; `rot` normalises it internally. */
const arbSeed: fc.Arbitrary<number> = fc.integer({ min: -2_147_483_648, max: 2_147_483_647 });

/** Count how many UTF-16 code units differ between two equal-length strings. */
function corruptedCount(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

// --- Property 8: length + line count preserved -------------------------------

describe("P8 (R6.5): rot preserves length and line count", () => {
  it("corrupts only existing non-newline positions, keeping length and lines", () => {
    fc.assert(
      fc.property(arbSource, arbDecay, arbSeed, (source, decay, seed) => {
        const out = rot(source, decay, seed);

        // Total length (UTF-16 code units) is preserved for every decay.
        expect(out.length).toBe(source.length);

        // Line count is preserved: no newline is ever added or removed.
        expect(out.split("\n").length).toBe(source.split("\n").length);

        // Every newline position is untouched, and nothing but existing
        // positions can differ (same length guarantees "only existing").
        for (let i = 0; i < source.length; i++) {
          if (source[i] === "\n") expect(out[i]).toBe("\n");
        }

        // The corrupted count never exceeds the source length.
        expect(corruptedCount(source, out)).toBeLessThanOrEqual(source.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 9: determinism + decay-0 identity ------------------------------

describe("P9 (R6.4, R6.8): rot determinism and decay-0 identity", () => {
  it("returns an equal string for equal (source, decay, seed)", () => {
    fc.assert(
      fc.property(arbSource, arbDecay, arbSeed, (source, decay, seed) => {
        expect(rot(source, decay, seed)).toBe(rot(source, decay, seed));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("returns the source unchanged at decay 0", () => {
    fc.assert(
      fc.property(arbSource, arbSeed, (source, seed) => {
        expect(rot(source, 0, seed)).toBe(source);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 10: corruption count monotonic in decay ------------------------

describe("P10 (R6.6): rot corruption count monotonic in decay", () => {
  it("corrupts at least as many characters at the higher decay", () => {
    fc.assert(
      fc.property(
        arbSource,
        arbSeed,
        fc.tuple(arbDecay, arbDecay),
        (source, seed, [d1, d2]) => {
          const lo = Math.min(d1, d2);
          const hi = Math.max(d1, d2);

          const outLo = rot(source, lo, seed);
          const outHi = rot(source, hi, seed);

          const nLo = corruptedCount(source, outLo);
          const nHi = corruptedCount(source, outHi);

          // Monotonicity of the count (R6.6).
          expect(nHi).toBeGreaterThanOrEqual(nLo);

          // Stronger subset guarantee the design relies on: every position
          // corrupted at the lower decay is also corrupted at the higher decay.
          for (let i = 0; i < source.length; i++) {
            if (source[i] !== outLo[i]) {
              expect(outHi[i]).not.toBe(source[i]);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 11: clamps out-of-range decay ----------------------------------

describe("P11 (R6.12): rot clamps out-of-range decay", () => {
  it("treats decay <= 0 as 0 (identity) and decay >= 1 as 1", () => {
    fc.assert(
      fc.property(
        arbSource,
        arbSeed,
        fc.double({ min: 1, max: 1_000, noNaN: true }),
        fc.double({ min: 0, max: 1_000, noNaN: true }),
        (source, seed, over, under) => {
          // decay >= 1 behaves exactly like decay 1.
          expect(rot(source, 1 + over, seed)).toBe(rot(source, 1, seed));

          // decay <= 0 behaves exactly like decay 0 — the identity.
          expect(rot(source, -under, seed)).toBe(source);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
