// src/motion/card-reveal.ts
//
// Feature: visual-necromancy, task 6.1.
//
// The Card_Reveal schedule: when each spread position's flip begins and
// finishes, so the Terminal can reveal cards one at a time in position order.
// This module is pure — it reads no clock, performs no DOM/network access, and
// uses no randomness. Elapsed time is supplied by the reveal hook via
// `FramePort`, exactly as with the existing `reveal.ts` schedule.
//
// The schedule flips card *n* only after card *n−1*'s flip plus its full
// typewriter reveal complete: each card's typewriter duration comes from the
// reused `revealDurationMs(diagnosisLength, "full")`. Flip offsets are therefore
// non-decreasing, and an empty spread yields an empty schedule.
//
// See design.md §"One-by-one card reveal" and Property 13.
//
// Requirements: R4.1, R4.6, R4.8

import { revealDurationMs } from "./reveal.js";

/**
 * How long a single Card_Back → ASCII_Card flip takes, in milliseconds. The
 * flip plays before the card's diagnosis typewriter begins.
 */
export const CARD_FLIP_MS = 600;

/** One position's reveal offsets, in spread order. */
export interface CardRevealStep {
  /** Zero-based spread position, increasing by 1 in input order. */
  readonly positionIndex: number;
  /** Elapsed time, in ms, at which this card's flip begins. */
  readonly flipStartMs: number;
  /** Elapsed time, in ms, at which the flip finishes and the typewriter starts. */
  readonly flipDoneMs: number;
}

/**
 * Per-position reveal offsets for a spread. Produces one {@link CardRevealStep}
 * per input position, in input order, with `positionIndex` increasing by 1 from
 * `0`. Card *n* flips only after card *n−1*'s flip (`CARD_FLIP_MS`) and its full
 * typewriter reveal (`revealDurationMs(diagnosisLength, "full")`) have completed,
 * so `flipStartMs` and `flipDoneMs` are non-decreasing across the schedule. An
 * empty spread returns `[]`.
 */
export function cardRevealSchedule(
  positions: readonly { diagnosisLength: number }[],
): readonly CardRevealStep[] {
  const steps: CardRevealStep[] = [];
  let cursorMs = 0;
  let positionIndex = 0;
  for (const position of positions) {
    const flipStartMs = cursorMs;
    const flipDoneMs = flipStartMs + CARD_FLIP_MS;
    steps.push({ positionIndex, flipStartMs, flipDoneMs });
    // The next card flips only after this card's flip finishes and its full
    // typewriter diagnosis reveal completes.
    const diagnosisLength = Math.max(0, position.diagnosisLength);
    cursorMs = flipDoneMs + revealDurationMs(diagnosisLength, "full");
    positionIndex++;
  }
  return steps;
}
