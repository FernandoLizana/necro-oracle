// src/motion/boot-schedule.ts
//
// Feature: visual-necromancy, task 1.1.
//
// The Boot_Sequence schedule: which boot step index is displayed at a given
// elapsed time. This module is pure — it reads no clock, DOM or network. The
// only place that supplies elapsed time is `use-boot` through `FramePort`,
// exactly as `use-reveal` drives the Reveal_Schedule in `motion/reveal.ts`.
//
// The whole boot must reach its ready frame within 3.5 seconds (R1.1). We hold
// `BOOT_TOTAL_MS` (the nominal full duration) below that ceiling and derive a
// fixed per-step duration `BOOT_STEP_MS` so that
// `BOOT_STEP_COUNT * BOOT_STEP_MS <= 3500`. `bootStepAt` floors elapsed time
// into a step and clamps the result into the valid `0..BOOT_STEP_COUNT-1`
// range, so negative, fractional, NaN and far-future times all land on a real
// step and the renderer can never be indexed out of range.
//
// See design.md §"1. Boot sequence" and Property 2.
//
// Requirements: 1.1, 2.3, 2.4

import { BOOT_STEP_COUNT } from "../render/boot.js";

/** The ceiling the whole boot must stay under, in milliseconds (R1.1). */
export const BOOT_BUDGET_MS = 3500;

/** The nominal full boot duration, comfortably under {@link BOOT_BUDGET_MS}. */
export const BOOT_TOTAL_MS = 3400;

/**
 * The fixed per-step duration, in milliseconds. Derived from the budget so the
 * whole sequence fits it: `BOOT_STEP_COUNT * BOOT_STEP_MS <= BOOT_BUDGET_MS`.
 * Because `BOOT_TOTAL_MS <= (BOOT_STEP_COUNT - 1) * BOOT_STEP_MS` would push the
 * final transition past the nominal total, the step size is instead floored
 * from the budget across all steps, which also keeps the last step reachable by
 * {@link BOOT_TOTAL_MS}: `floor(BOOT_TOTAL_MS / BOOT_STEP_MS) === BOOT_STEP_COUNT - 1`.
 */
export const BOOT_STEP_MS = Math.floor(BOOT_BUDGET_MS / BOOT_STEP_COUNT);

/**
 * The boot step index displayed at `elapsedMs` since the sequence started.
 *
 * `floor(elapsedMs / BOOT_STEP_MS)` clamped to `0..BOOT_STEP_COUNT-1`. Negative
 * or `NaN` elapsed times resolve to step 0; any time at or beyond
 * `(BOOT_STEP_COUNT - 1) * BOOT_STEP_MS` resolves to the final step, so the
 * ready frame shows and `bootFrame` is never indexed out of range.
 */
export function bootStepAt(elapsedMs: number): number {
  const elapsed = Number.isNaN(elapsedMs) ? 0 : Math.max(0, elapsedMs);
  const step = Math.floor(elapsed / BOOT_STEP_MS);
  return Math.min(BOOT_STEP_COUNT - 1, Math.max(0, step));
}
