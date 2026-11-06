// src/motion/decay.ts
//
// Feature: visual-necromancy, task 5.2.
//
// The Decay_Sequence: the ordered list of decay amounts, from 0 to 1, that
// drives the Rot_Transform frames of the Resurrection_Animation. Frame `i`
// renders `rot(preRitualCode, decaySequence[i], seed)`, so the sequence's
// amounts must start at 0 (the untouched source), end at 1 (fully decayed
// before rebirth), and never decrease in between (R6.3).
//
// This module is pure — it reads no clock, performs no DOM/network access, and
// uses no randomness. The frame cadence (how long each amount is held on
// screen) is supplied elsewhere through `FramePort`, exactly as with the other
// motion schedules; this function only shapes the amounts themselves.
//
// See design.md §"src/motion/decay.ts — Decay_Sequence" and Property 12.
//
// Requirements: R6.3

/**
 * The decay amounts, from 0 to 1, for a Resurrection_Animation of `frameCount`
 * frames.
 *
 * - For `frameCount >= 2` the amounts are evenly spaced as `i / (frameCount - 1)`,
 *   so the first amount is exactly `0`, the last is exactly `1`, and the amounts
 *   are strictly increasing (and therefore non-decreasing). For example
 *   `decaySequence(5)` is `[0, 0.25, 0.5, 0.75, 1]`.
 * - For `frameCount === 1` there is a single frame and no room to interpolate
 *   from 0 to 1, so the lone amount is `1`: a one-frame animation shows the
 *   fully-decayed state that immediately precedes rebirth. This keeps "the last
 *   decay amount is 1" true for every non-empty sequence.
 * - For `frameCount <= 0` (including fractional or `NaN` inputs that floor to
 *   zero or below) there are no frames, so the sequence is empty (`[]`).
 *
 * The input is floored, so fractional frame counts are treated as the nearest
 * whole number of frames at or below the value.
 */
export function decaySequence(frameCount: number): readonly number[] {
  const count = Number.isNaN(frameCount) ? 0 : Math.floor(frameCount);
  if (count <= 0) return [];
  if (count === 1) return [1];
  const amounts: number[] = [];
  for (let i = 0; i < count; i++) {
    amounts.push(i / (count - 1));
  }
  return amounts;
}
