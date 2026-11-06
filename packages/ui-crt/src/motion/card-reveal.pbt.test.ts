// src/motion/card-reveal.pbt.test.ts
//
// Feature: visual-necromancy, Property 13 (task 6.2).
//
// Property-based tests for the Card_Reveal schedule (`motion/card-reveal.ts`,
// task 6.1).
//
// Property 13 (design.md §"One-by-one card reveal", requirements R4.1, R4.6,
// R4.8): `cardRevealSchedule` produces one step per spread position, in input
// order, with `positionIndex` strictly increasing by 1 from 0; flip offsets
// (`flipStartMs`, `flipDoneMs`) are non-decreasing across the schedule and each
// step's `flipDoneMs` is at least its `flipStartMs`; an empty spread yields `[]`.
//
// This encodes the reveal contract:
//   - R4.1: positions revealed one at a time in position order.
//   - R4.6: the spread order is preserved exactly — no reorder, add, or omit.
//   - R4.8: an empty spread completes without error, producing no steps.
//
// Testing steering: fast-check with explicit numRuns (default 200); print the
// seed on failure. No network / clock / DOM / real randomness — pure computation.
//
// **Validates: Requirements 4.1, 4.6, 4.8**
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CARD_FLIP_MS,
  cardRevealSchedule,
  type CardRevealStep,
} from "./card-reveal.js";

/** P13 runs the default property budget. */
const NUM_RUNS = 200;

/** A single spread position: only its diagnosis length drives the schedule. */
const arbPosition: fc.Arbitrary<{ diagnosisLength: number }> = fc.record({
  // Cover empty diagnoses, typical card text, and comfortably large blocks,
  // plus negatives (the schedule clamps them to 0).
  diagnosisLength: fc.integer({ min: -100, max: 5000 }),
});

/** Spreads from empty (fates/necropsy/celtic are at most 10) up to larger ones. */
const arbPositions: fc.Arbitrary<readonly { diagnosisLength: number }[]> =
  fc.array(arbPosition, { minLength: 0, maxLength: 20 });

/** Non-empty spreads, for the properties that inspect step content. */
const arbNonEmptyPositions: fc.Arbitrary<
  readonly { diagnosisLength: number }[]
> = fc.array(arbPosition, { minLength: 1, maxLength: 20 });

describe("P13 (R4.1, R4.6, R4.8): reveal schedule preserves order and shape", () => {
  it("exposes the card flip duration constant", () => {
    expect(CARD_FLIP_MS).toBe(600);
  });

  it("produces exactly one step per spread position (R4.6)", () => {
    fc.assert(
      fc.property(arbPositions, (positions) => {
        const schedule = cardRevealSchedule(positions);
        expect(schedule).toHaveLength(positions.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("returns [] for an empty spread without error (R4.8)", () => {
    const schedule = cardRevealSchedule([]);
    expect(schedule).toEqual([]);
  });

  it("indexes positions in input order, strictly increasing by 1 from 0 (R4.1, R4.6)", () => {
    fc.assert(
      fc.property(arbPositions, (positions) => {
        const schedule = cardRevealSchedule(positions);
        schedule.forEach((step, i) => {
          expect(step.positionIndex).toBe(i);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("keeps flipDoneMs at least flipStartMs for every step", () => {
    fc.assert(
      fc.property(arbPositions, (positions) => {
        const schedule = cardRevealSchedule(positions);
        for (const step of schedule) {
          expect(step.flipDoneMs).toBeGreaterThanOrEqual(step.flipStartMs);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("has non-decreasing flip offsets across the schedule (R4.1)", () => {
    fc.assert(
      fc.property(arbNonEmptyPositions, (positions) => {
        const schedule = cardRevealSchedule(positions);
        for (let i = 1; i < schedule.length; i++) {
          const prev = schedule[i - 1] as CardRevealStep;
          const curr = schedule[i] as CardRevealStep;
          expect(curr.flipStartMs).toBeGreaterThanOrEqual(prev.flipStartMs);
          expect(curr.flipDoneMs).toBeGreaterThanOrEqual(prev.flipDoneMs);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("flips card n only after card n-1's flip and full diagnosis (R4.1)", () => {
    // Each next flip starts no earlier than the previous card's flip finished,
    // so no two positions reveal at once and order is performed one at a time.
    fc.assert(
      fc.property(arbNonEmptyPositions, (positions) => {
        const schedule = cardRevealSchedule(positions);
        for (let i = 1; i < schedule.length; i++) {
          const prev = schedule[i - 1] as CardRevealStep;
          const curr = schedule[i] as CardRevealStep;
          expect(curr.flipStartMs).toBeGreaterThanOrEqual(prev.flipDoneMs);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is a pure function of the input positions", () => {
    fc.assert(
      fc.property(arbPositions, (positions) => {
        const first = cardRevealSchedule(positions);
        const second = cardRevealSchedule(positions);
        expect(second).toEqual(first);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("starts the first card's flip at time zero for a non-empty spread (R4.1)", () => {
    fc.assert(
      fc.property(arbNonEmptyPositions, (positions) => {
        const schedule = cardRevealSchedule(positions);
        const first = schedule[0] as CardRevealStep;
        expect(first.flipStartMs).toBe(0);
        expect(first.flipDoneMs).toBe(CARD_FLIP_MS);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
