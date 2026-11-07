// packages/ui-crt/src/landing/selection.pbt.test.ts
//
// Feature: oracle-landing-polish, task 3.2.
//
// Two properties over the pure selection model (`./selection.js`) driving the
// DMG Landing_State list (`LANDING_ROWS` from `./repos.js`):
//
// P1 (R4.6): the selection index stays in range under any key sequence —
//   starting from any in-range index, applying any sequence of move("up"/
//   "down") over a fixed `rowCount` keeps `index` within `[0, rowCount - 1]`,
//   never wraps (an "up" at 0 stays 0; a "down" at max stays max), and each
//   step changes the index by at most 1.
//
// P2 (R4.5): the cursor and the inverted row mark the same single row — for
//   any in-range `SelectionState` and rows, `selectedRow(state, rows)` returns
//   exactly the one row at that index, which is the single row the
//   inverted-row rendering would mark.
//
// Testing steering: fast-check with explicit numRuns (1000 for the selection
// math); the seed prints on failure. No network / LLM / sandbox — these are
// pure, synchronous functions over generated indices and the real
// `LANDING_ROWS` table.
//
// **Validates: Requirements R4.5, R4.6**

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { LANDING_ROWS, type LandingRow } from "./repos.js";
import { move, selectedRow, type SelectionState } from "./selection.js";

// --- arbitraries ------------------------------------------------------------

/** A single step over the list: move the cursor up or down. */
const arbDir: fc.Arbitrary<"up" | "down"> = fc.constantFrom("up", "down");

/** Any sequence (possibly empty) of up/down steps. */
const arbDirSequence: fc.Arbitrary<readonly ("up" | "down")[]> = fc.array(arbDir, {
  minLength: 0,
  maxLength: 64,
});

/** A positive row count spanning singleton lists through large lists. */
const arbRowCount: fc.Arbitrary<number> = fc.integer({ min: 1, max: 500 });

/**
 * A `(rowCount, startIndex)` pair where `startIndex` is always in range for
 * `rowCount` — the invariant `move` assumes and preserves.
 */
const arbCountAndIndex: fc.Arbitrary<{ rowCount: number; index: number }> = arbRowCount.chain(
  (rowCount) =>
    fc.integer({ min: 0, max: rowCount - 1 }).map((index) => ({ rowCount, index })),
);

describe("P1 (R4.6): selection index stays in range under any key sequence", () => {
  it("every intermediate index stays within [0, rowCount - 1] and never wraps", () => {
    fc.assert(
      fc.property(arbCountAndIndex, arbDirSequence, ({ rowCount, index }, steps) => {
        const max = rowCount - 1;
        let state: SelectionState = { index };

        for (const dir of steps) {
          const before = state.index;
          const next = move(state, dir, rowCount);

          // In range at every step.
          expect(next.index).toBeGreaterThanOrEqual(0);
          expect(next.index).toBeLessThanOrEqual(max);

          // Each step changes the index by at most 1 (no jumps).
          expect(Math.abs(next.index - before)).toBeLessThanOrEqual(1);

          // No wrap: up at 0 stays 0; down at max stays max.
          if (dir === "up" && before === 0) {
            expect(next.index).toBe(0);
          }
          if (dir === "down" && before === max) {
            expect(next.index).toBe(max);
          }

          state = next;
        }

        // The final index is still in range after the whole sequence.
        expect(state.index).toBeGreaterThanOrEqual(0);
        expect(state.index).toBeLessThanOrEqual(max);
      }),
      { numRuns: 1000 },
    );
  });

  it("holds over the real LANDING_ROWS list (clamp at both ends)", () => {
    const rowCount = LANDING_ROWS.length;
    const max = rowCount - 1;

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max }),
        arbDirSequence,
        (startIndex, steps) => {
          let state: SelectionState = { index: startIndex };
          for (const dir of steps) {
            state = move(state, dir, rowCount);
            expect(state.index).toBeGreaterThanOrEqual(0);
            expect(state.index).toBeLessThanOrEqual(max);
          }
          return true;
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("P2 (R4.5): the cursor and inverted row mark the same single row", () => {
  it("selectedRow returns exactly the row at the cursor index for the real list", () => {
    const rows = LANDING_ROWS;
    const max = rows.length - 1;

    fc.assert(
      fc.property(fc.integer({ min: 0, max }), (index) => {
        const state: SelectionState = { index };
        const selected = selectedRow(state, rows);

        // It is the row object at that exact index (reference equality) — the
        // single row the inverted-row rendering would mark.
        expect(selected).toBe(rows[index]);

        // Exactly one row matches the cursor: no other index shares it.
        const matches = rows.filter((row) => row === selected);
        expect(matches).toHaveLength(1);
        expect(rows.indexOf(selected)).toBe(index);
      }),
      { numRuns: 1000 },
    );
  });

  it("selectedRow is consistent with move over arbitrary non-empty lists", () => {
    // Build arbitrary non-empty row lists by slicing the real table so each
    // element is a genuine, distinct LandingRow reference.
    const arbRows: fc.Arbitrary<readonly LandingRow[]> = fc
      .integer({ min: 1, max: LANDING_ROWS.length })
      .map((n) => LANDING_ROWS.slice(0, n));

    fc.assert(
      fc.property(
        arbRows.chain((rows) =>
          fc
            .integer({ min: 0, max: rows.length - 1 })
            .map((index) => ({ rows, index })),
        ),
        arbDir,
        ({ rows, index }, dir) => {
          const start: SelectionState = { index };
          const moved = move(start, dir, rows.length);

          // After a move, selectedRow tracks exactly the new cursor index.
          expect(selectedRow(moved, rows)).toBe(rows[moved.index]);
          // And it is a single, in-range row.
          expect(rows.indexOf(selectedRow(moved, rows))).toBe(moved.index);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
