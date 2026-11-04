// src/scoring/vitality.ts
//
// Vitality scoring (task 27.2). THIS IS A MINIMAL THROWING STUB authored for the
// test-first task 27.1 so that `src/scoring/vitality.test.ts` typechecks against
// the design API before the real implementation lands. Task 27.2 replaces the
// bodies below with the real pure computation.
//
// Design API:
//   computeVitality(draws: CardDraw[]): number        // integer in [0, 100]
//   computeVitalityDelta(before: number, after: number): number  // after - before
//
// _Requirements: R18.1, R18.2, R18.3, R18.4, R18.5, R18.6_
import type { CardDraw } from "../registry/schema.js";
import { CARD_REGISTRY } from "../registry/cards.js";

/**
 * Compute the repository vitality score from a set of non-null card draws.
 *
 * Formula (R18.2): `Math.round(Math.max(0, 100 - Σ(card.weight × draw.severity)))`.
 * Empty / all-null input → 100 (R18.5); a penalty sum > 100 clamps to 0 (R18.4).
 * `star`/`world` carry weight 0, so they never reduce vitality (R18.3).
 *
 * @returns an integer in [0, 100] (R18.1).
 */
export function computeVitality(draws: CardDraw[]): number {
  const penalty = draws.reduce((sum, d) => {
    const def = CARD_REGISTRY.get(d.card);
    const weight = def === undefined ? 0 : def.weight;
    return sum + weight * d.severity;
  }, 0);
  return Math.round(Math.max(0, 100 - penalty));
}

/**
 * Compute the change in vitality produced by a resurrection (R18.6).
 *
 * @returns `after - before`; a positive result means vitality improved.
 */
export function computeVitalityDelta(before: number, after: number): number {
  return after - before;
}
