// src/motion/reveal.ts
//
// Feature: 03-crt-terminal, task 11.2.
//
// The Reveal_Schedule: how many characters of a text block are visible at a
// given elapsed time. This module is pure — it reads no clock. The only place
// that supplies elapsed time is the `use-reveal` hook through `FramePort`.
//
// See design.md §"Motion and preferences" and Property 9.
//
// Requirements: R10.1, R10.2, R10.3, R10.12

import type { MotionMode } from "./motion-mode.js";

/** Base reveal speed in characters per second. */
export const REVEAL_BASE_CPS = 60;

/** The reveal window: any text is fully revealed by this many milliseconds. */
export const REVEAL_MAX_MS = 3000;

/**
 * Reveal rate for a given text length, in characters per second. It is at
 * least `REVEAL_BASE_CPS`, and grows so that a block of `length` characters is
 * fully revealed within `REVEAL_MAX_MS` (3 seconds): `max(60, ceil(length / 3))`.
 */
export function revealRate(length: number): number {
  return Math.max(REVEAL_BASE_CPS, Math.ceil(length / 3));
}

/**
 * Number of characters revealed at `elapsedMs` for a block of `length`
 * characters.
 *
 * - In `reduced` mode the whole block is revealed immediately (returns `length`).
 * - In `full` mode: `min(length, floor(max(0, elapsedMs) * revealRate(length) /
 *   1000))`. Negative or `NaN` elapsed times count as 0. Because
 *   `revealRate(length) * 3 >= length`, the count reaches `length` by
 *   `REVEAL_MAX_MS` and never exceeds it.
 */
export function revealedChars(
  length: number,
  mode: MotionMode,
  elapsedMs: number,
): number {
  if (mode === "reduced") return length;
  const elapsed = Number.isNaN(elapsedMs) ? 0 : Math.max(0, elapsedMs);
  const revealed = Math.floor((elapsed * revealRate(length)) / 1000);
  return Math.min(length, revealed);
}

/**
 * The elapsed time, in milliseconds, at which the full block is revealed.
 *
 * - `0` in `reduced` mode (everything is revealed at time zero).
 * - In `full` mode: the exact time the final character appears, clamped to
 *   `[0, REVEAL_MAX_MS]`. By construction `revealedChars(length, "full",
 *   revealDurationMs(length, "full")) === length`.
 */
export function revealDurationMs(length: number, mode: MotionMode): number {
  if (mode === "reduced") return 0;
  const duration = Math.ceil((length * 1000) / revealRate(length));
  return Math.min(REVEAL_MAX_MS, Math.max(0, duration));
}
