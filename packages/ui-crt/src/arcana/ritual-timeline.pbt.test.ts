// src/arcana/ritual-timeline.pbt.test.ts
//
// Feature: arcana-visions, task 5.2.
//
// Property-based tests for the Resurrection_Ritual timeline (`ritualTimeline`).
// The module under test (`ritual-timeline.ts`, task 5.1) is a pure function of
// a plain `RitualOpts` record: it either returns `[]` (a single render straight
// to the diff/patch view, no ritual) or the four ordered ritual phases
// `closed-glitch -> tremble -> crossfade -> rising-diff`, each with a `startMs`
// and `durationMs`.
//
// These properties pin the gating rule (when the array is empty), the ordering
// and 3 s budget of a playing ritual, and determinism in the seed. No clock,
// DOM, network, LLM, or sandbox is involved — pure computation only.
//
// Testing steering: fast-check with explicit numRuns (1000 for the ritual
// timeline math); the seed prints on failure.
//
// **Validates: Requirements R6.1, R6.2, R6.4, R6.5, R6.6, R6.8, R6.10, R13.4**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { MotionMode } from "../motion/motion-mode.js";
import {
  RITUAL_TOTAL_MS,
  ritualTimeline,
  type RitualOpts,
  type RitualPhase,
} from "./ritual-timeline.js";

/** Ritual timeline math sits in the 1000-run tier (spreads / normalizers). */
const NUM_RUNS = 1000;

/** The four ritual phases in their fixed, required order (R6.1). */
const ORDERED_PHASES: readonly RitualPhase[] = [
  "closed-glitch",
  "tremble",
  "crossfade",
  "rising-diff",
];

/** Both Motion_Mode values, so the Reduced_Motion skip path (R6.4) is hit. */
const arbMotionMode: fc.Arbitrary<MotionMode> = fc.constantFrom<MotionMode>(
  "full",
  "reduced",
);

/**
 * Every combination of the gating flags and Motion_Mode, with a varied seed.
 * The four booleans (`playwright`, `bootSkip`, `ritualForce`, `imagesReady`)
 * and the two motion modes together cover all 32 gate combinations, so both
 * the skip paths (R6.4, R6.5, R6.10) and the force override (R6.6) are
 * exercised. Seeds span negatives, zero, and large magnitudes plus a couple of
 * non-finite values so the jitter derivation's finite guard is covered too.
 */
const arbRitualOpts: fc.Arbitrary<RitualOpts> = fc.record({
  motionMode: arbMotionMode,
  playwright: fc.boolean(),
  bootSkip: fc.boolean(),
  ritualForce: fc.boolean(),
  imagesReady: fc.boolean(),
  seed: fc.oneof(
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
    fc.constantFrom(0, -1, 1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER),
    fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
  ),
});

/** The reference gating predicate derived directly from the spec (R6.4/5/6/10). */
function mustSkip(opts: RitualOpts): boolean {
  return (
    opts.motionMode === "reduced" ||
    !opts.imagesReady ||
    ((opts.playwright || opts.bootSkip) && !opts.ritualForce)
  );
}

describe("P6 (R6.4, R6.5, R6.6, R6.10): ritual gating is empty exactly when it must be skipped", () => {
  it("returns [] iff reduced motion OR frames not ready OR (playwright|bootSkip without force) (R6.4, R6.5, R6.10)", () => {
    fc.assert(
      fc.property(arbRitualOpts, (opts) => {
        const steps = ritualTimeline(opts);
        // IFF: empty exactly when the skip predicate holds; otherwise the four
        // phases play.
        expect(steps.length === 0).toBe(mustSkip(opts));
        if (!mustSkip(opts)) {
          expect(steps).toHaveLength(ORDERED_PHASES.length);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("the Ritual_Force_Flag plays the full ritual even during a Playwright run or ?boot=skip (R6.6)", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        (playwright, bootSkip, seed) => {
          // Force on, full motion, frames ready: the two skip-eligible flags no
          // longer skip; the ritual always plays its four phases.
          const opts: RitualOpts = {
            motionMode: "full",
            playwright,
            bootSkip,
            ritualForce: true,
            imagesReady: true,
            seed,
          };
          expect(ritualTimeline(opts)).toHaveLength(ORDERED_PHASES.length);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("reduced motion and not-ready frames always skip, even with the force flag (R6.4, R6.10)", () => {
    fc.assert(
      fc.property(arbRitualOpts, (opts) => {
        // Reduced motion skips regardless of any other flag.
        expect(ritualTimeline({ ...opts, motionMode: "reduced" })).toEqual([]);
        // Not-ready frames skip regardless of any other flag (force included).
        expect(
          ritualTimeline({ ...opts, motionMode: "full", imagesReady: false }),
        ).toEqual([]);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("P7 (R6.1, R6.2, R13.4): a playing ritual is ordered and completes within 3 s", () => {
  /** Only the non-skip options reach the ordering/budget assertions. */
  const arbPlayingOpts = arbRitualOpts.filter((o) => !mustSkip(o));

  it("emits exactly the four phases in order closed-glitch, tremble, crossfade, rising-diff (R6.1)", () => {
    fc.assert(
      fc.property(arbPlayingOpts, (opts) => {
        const steps = ritualTimeline(opts);
        expect(steps.map((s) => s.phase)).toEqual(ORDERED_PHASES);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("has non-decreasing startMs, each equal to the cumulative prior durations (R6.1)", () => {
    fc.assert(
      fc.property(arbPlayingOpts, (opts) => {
        const steps = ritualTimeline(opts);
        let cumulative = 0;
        for (const step of steps) {
          // startMs equals the sum of all prior durations, so starts are
          // non-decreasing and the phases abut without gaps or overlap.
          expect(step.startMs).toBe(cumulative);
          cumulative += step.durationMs;
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("gives every phase a strictly positive duration (R6.1)", () => {
    fc.assert(
      fc.property(arbPlayingOpts, (opts) => {
        for (const step of ritualTimeline(opts)) {
          expect(step.durationMs).toBeGreaterThan(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("keeps the summed durations within RITUAL_TOTAL_MS (<= 3000) (R6.2, R13.4)", () => {
    expect(RITUAL_TOTAL_MS).toBeLessThanOrEqual(3000);
    fc.assert(
      fc.property(arbPlayingOpts, (opts) => {
        const total = ritualTimeline(opts).reduce(
          (sum, step) => sum + step.durationMs,
          0,
        );
        expect(total).toBeLessThanOrEqual(RITUAL_TOTAL_MS);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("P8 (R6.8): the ritual timeline is deterministic in its seed", () => {
  it("returns a deep-equal array for repeated calls with the same opts (seed included) (R6.8)", () => {
    fc.assert(
      fc.property(arbRitualOpts, (opts) => {
        // The same opts — same seed included — must always yield an identical
        // array across repeated calls (no clock, DOM, or RNG).
        const first = ritualTimeline(opts);
        const second = ritualTimeline({ ...opts });
        expect(second).toEqual(first);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("varies only with the seed among otherwise identical playing options (R6.8)", () => {
    fc.assert(
      fc.property(
        arbRitualOpts.filter((o) => !mustSkip(o)),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        (opts, otherSeed) => {
          // Re-running with the same seed is stable; the total stays fixed at
          // the full budget regardless of seed (the seed only redistributes
          // bounded jitter among the first three phases).
          const a = ritualTimeline(opts);
          const b = ritualTimeline({ ...opts, seed: otherSeed });
          const totalA = a.reduce((sum, s) => sum + s.durationMs, 0);
          const totalB = b.reduce((sum, s) => sum + s.durationMs, 0);
          expect(totalA).toBe(totalB);
          expect(ritualTimeline(opts)).toEqual(a);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
