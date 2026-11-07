// src/landing/selection.ts
//
// Feature: oracle-landing-polish, task 3.1.
//
// The pure selection model for the DMG Landing_State list: the `SelectionState`
// (a 0-based, always-in-range cursor index), `move()` (up/down clamped to the
// list bounds with NO wrap), `selectedRow()` (the row under the cursor), and
// `activate()` (what choosing the current row means — summon + read fates for a
// concrete repo, or focus the NECRO> input for the ENTER row). See design.md
// §"Pure module: selection model".
//
// Nothing here reads the DOM, clock, network or storage; every function is a
// total pure mapping over its inputs.

import type { LandingRow } from "./repos.js";

/** The cursor position into `LANDING_ROWS`. */
export interface SelectionState {
  /** 0-based index into the landing rows; always in range. */
  readonly index: number;
}

/**
 * Move the cursor up or down, clamped to `[0, rowCount - 1]` with NO wrap.
 * "up" decrements, "down" increments; both saturate at the list bounds. A
 * non-positive `rowCount` pins the index at 0 (an empty list has no cursor to
 * move).
 */
export function move(
  state: SelectionState,
  dir: "up" | "down",
  rowCount: number,
): SelectionState {
  if (rowCount <= 0) {
    return { index: 0 };
  }
  const max = rowCount - 1;
  const next = dir === "up" ? state.index - 1 : state.index + 1;
  const clamped = next < 0 ? 0 : next > max ? max : next;
  return { index: clamped };
}

/**
 * The row currently under the cursor. Assumes `state.index` is in range for
 * `rows` (the invariant `move` maintains); if it is not, the index is clamped
 * to the list bounds so the lookup is always total.
 */
export function selectedRow(
  state: SelectionState,
  rows: readonly LandingRow[],
): LandingRow {
  const max = rows.length - 1;
  const index = state.index < 0 ? 0 : state.index > max ? max : state.index;
  const row = rows[index];
  if (row === undefined) {
    throw new Error("selectedRow: empty row list has no selectable row");
  }
  return row;
}

/**
 * What activating a row means:
 *  - a concrete repo -> run `summon <ref>` then `read fates`
 *  - the ENTER row    -> focus the NECRO> input
 */
export type ActivateResult =
  | { readonly kind: "summon-read"; readonly ref: string }
  | { readonly kind: "focus-input" };

/** Map the row under the cursor to its activation effect. */
export function activate(row: LandingRow): ActivateResult {
  if (row.kind === "repo") {
    return { kind: "summon-read", ref: row.repo.ref };
  }
  return { kind: "focus-input" };
}
