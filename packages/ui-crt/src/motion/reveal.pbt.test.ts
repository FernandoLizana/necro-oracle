// src/motion/reveal.pbt.test.ts
//
// Feature: 03-crt-terminal, Property 9
//
// Property-based tests for the Reveal_Schedule (task 11.1, TEST-FIRST).
//
// TEST-FIRST (red). This file is written before `motion/reveal.ts` and
// `motion/motion-mode.ts` (task 11.2), so the imports below fail to resolve and
// the whole suite is red for the expected reason: the modules do not exist yet.
//
// Property 9 (requirements.md §"P9 — Reveal schedule (R10.1, R10.2, R10.3,
// R10.12)"): For all text lengths and elapsed times, the number of revealed
// characters is monotonically non-decreasing in elapsed time and never exceeds
// the text length, reaches the full length within 3 seconds in `full` mode, and
// equals the full length at elapsed time zero in `reduced` mode.
//
// Semantics under test (design.md §"Motion and preferences"):
//   - REVEAL_BASE_CPS = 60, REVEAL_MAX_MS = 3000.
//   - revealRate(length) = max(60, ceil(length / 3)) chars per second.
//   - revealedChars(length, mode, elapsedMs) is `length` in `reduced` mode,
//     otherwise min(length, floor(max(0, elapsedMs) * revealRate(length) /
//     1000)); NaN elapsed counts as 0; at 3000 ms the count is
//     3 * revealRate >= length.
//   - revealedChars is a pure function of (length, mode, elapsedMs).
//
// Testing steering: fast-check with explicit numRuns (default 200); print the
// seed on failure. No network / LLM / sandbox — pure computation.
//
// **Validates: Requirements R10.1, R10.2, R10.3, R10.12**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Not yet implemented — task 11.2 adds these modules.
import {
  REVEAL_BASE_CPS,
  REVEAL_MAX_MS,
  revealDurationMs,
  revealRate,
  revealedChars,
} from "./reveal.js";
import type { MotionMode } from "./motion-mode.js";

/** P9 runs the default property budget. */
const NUM_RUNS = 200;

const MODES: readonly MotionMode[] = ["full", "reduced"];

/** Text lengths from empty to a comfortably large block. */
const arbLength: fc.Arbitrary<number> = fc.integer({ min: 0, max: 5000 });

/**
 * Elapsed times covering negatives (before start), the reveal window, and
 * times well past REVEAL_MAX_MS. Fractional values exercise the floor.
 */
const arbElapsedMs: fc.Arbitrary<number> = fc.double({
  min: -5000,
  max: 20000,
  noNaN: true,
});

describe("P9 (R10.1, R10.2, R10.3, R10.12): reveal schedule", () => {
  it("exposes the base rate and window constants", () => {
    expect(REVEAL_BASE_CPS).toBe(60);
    expect(REVEAL_MAX_MS).toBe(3000);
  });

  it("revealRate is at least the base rate and grows with length", () => {
    fc.assert(
      fc.property(arbLength, (length) => {
        const rate = revealRate(length);
        expect(rate).toBeGreaterThanOrEqual(REVEAL_BASE_CPS);
        expect(rate).toBe(Math.max(REVEAL_BASE_CPS, Math.ceil(length / 3)));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("reduced mode reveals everything immediately at any elapsed time", () => {
    fc.assert(
      fc.property(arbLength, arbElapsedMs, (length, elapsedMs) => {
        expect(revealedChars(length, "reduced", elapsedMs)).toBe(length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("reduced mode equals the full length at elapsed time zero", () => {
    fc.assert(
      fc.property(arbLength, (length) => {
        expect(revealedChars(length, "reduced", 0)).toBe(length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("never reveals fewer than zero or more than the full length", () => {
    fc.assert(
      fc.property(
        arbLength,
        fc.constantFrom<MotionMode>(...MODES),
        arbElapsedMs,
        (length, mode, elapsedMs) => {
          const count = revealedChars(length, mode, elapsedMs);
          expect(count).toBeGreaterThanOrEqual(0);
          expect(count).toBeLessThanOrEqual(length);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("reveals nothing at or before elapsed time zero in full mode", () => {
    fc.assert(
      fc.property(
        arbLength,
        fc.double({ min: -5000, max: 0, noNaN: true }),
        (length, elapsedMs) => {
          expect(revealedChars(length, "full", elapsedMs)).toBe(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("treats NaN elapsed time as zero in full mode", () => {
    fc.assert(
      fc.property(arbLength, (length) => {
        expect(revealedChars(length, "full", Number.NaN)).toBe(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is monotonically non-decreasing in elapsed time (full mode)", () => {
    fc.assert(
      fc.property(
        arbLength,
        fc.tuple(arbElapsedMs, arbElapsedMs),
        (length, [a, b]) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(revealedChars(length, "full", lo)).toBeLessThanOrEqual(
            revealedChars(length, "full", hi),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("reaches the full length by REVEAL_MAX_MS and stays there afterward (full mode)", () => {
    fc.assert(
      fc.property(
        arbLength,
        fc.double({ min: REVEAL_MAX_MS, max: 20000, noNaN: true }),
        (length, elapsedMs) => {
          expect(revealedChars(length, "full", elapsedMs)).toBe(length);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("is a pure function of (length, mode, elapsedMs)", () => {
    fc.assert(
      fc.property(
        arbLength,
        fc.constantFrom<MotionMode>(...MODES),
        arbElapsedMs,
        (length, mode, elapsedMs) => {
          const first = revealedChars(length, mode, elapsedMs);
          const second = revealedChars(length, mode, elapsedMs);
          expect(second).toBe(first);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("revealDurationMs is zero in reduced mode and within the window in full mode", () => {
    fc.assert(
      fc.property(arbLength, (length) => {
        expect(revealDurationMs(length, "reduced")).toBe(0);
        const duration = revealDurationMs(length, "full");
        expect(duration).toBeGreaterThanOrEqual(0);
        expect(duration).toBeLessThanOrEqual(REVEAL_MAX_MS);
        // At the reported duration the full text is revealed.
        expect(revealedChars(length, "full", duration)).toBe(length);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
