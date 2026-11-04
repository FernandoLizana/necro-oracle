/**
 * @necro/oracle — property tests for the card registry weights (task 6.3).
 *
 * Property 4: Severity/orientation consistency.
 *   Across every generated `CardDraw` array (`arbCardDrawArray`), each draw's
 *   orientation agrees with the product convention the arbitraries maintain:
 *   severity 0 or 1 → "reversed" (latent / partial), severity 2 or 3 →
 *   "upright" (active / full). This locks in the invariant the shared
 *   arbitraries guarantee so every downstream PBT that consumes them can rely
 *   on it. The registry side of P4 asserts every CARD_REGISTRY weight is a
 *   non-negative integer in [0, 100] (R1.2).
 *
 * Property 14: Registry weight consistency.
 *   Expressed purely in terms of CARD_REGISTRY weights (no dependency on
 *   `computeVitality`, task 27, which may not exist yet). The weighted penalty
 *   of a draw set is Σ(weight × severity) over its draws. `star` and `world`
 *   carry weight 0, so a draw set consisting ONLY of `star` and/or `world`
 *   yields a zero penalty regardless of severity (score stays at 100). Any
 *   draw of a weighted card (weight > 0) at severity ≥ 1 yields a strictly
 *   positive penalty (score drops below 100).
 *
 * These are pure, synchronous, no-network properties (R21.5, R21.6).
 * fast-check prints the shrunk counterexample and seed on failure by default;
 * we also pass an explicit numRuns of 200.
 *
 * Validates: Requirements R1.2, R18.3, R5.2, R5.3 / Properties: P4, P14
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  arbCardDraw,
  arbCardDrawArray,
} from "../../test/arbitraries.js";
import type { CardDraw, CardId, Severity } from "./schema.js";
import { CARD_REGISTRY } from "./cards.js";

/** The two cards defined by R18.3 to carry weight 0. */
const ZERO_WEIGHT_CARDS: readonly CardId[] = ["star", "world"] as const;

/** Orientation the arbitraries guarantee for a given severity. */
function expectedOrientation(severity: Severity): "upright" | "reversed" {
  return severity <= 1 ? "reversed" : "upright";
}

/** Weighted penalty of a draw set using registry weights: Σ(weight × severity). */
function weightedPenalty(draws: readonly CardDraw[]): number {
  let penalty = 0;
  for (const draw of draws) {
    const def = CARD_REGISTRY.get(draw.card);
    // Every card id is in the registry; guard keeps TypeScript happy.
    if (def === undefined) continue;
    penalty += def.weight * draw.severity;
  }
  return penalty;
}

describe("P4 (R18.3, R5.2, R5.3): severity/orientation consistency", () => {
  // Property 4 — Validates: Requirements R18.3, R5.2, R5.3 / Properties: P4
  it("every generated draw's orientation matches its severity (0/1 → reversed, 2/3 → upright)", () => {
    fc.assert(
      fc.property(arbCardDrawArray, (draws) => {
        for (const draw of draws) {
          expect(draw.orientation).toBe(expectedOrientation(draw.severity));
        }
      }),
      { numRuns: 200 },
    );
  });

  it("holds for a single generated draw of any card id", () => {
    fc.assert(
      fc.property(arbCardDraw, (draw) => {
        expect(draw.orientation).toBe(expectedOrientation(draw.severity));
      }),
      { numRuns: 200 },
    );
  });

  it("every CARD_REGISTRY weight is a non-negative integer in [0, 100] (R1.2)", () => {
    for (const [id, def] of CARD_REGISTRY) {
      expect(Number.isInteger(def.weight), `weight for ${id} is an integer`).toBe(
        true,
      );
      expect(def.weight).toBeGreaterThanOrEqual(0);
      expect(def.weight).toBeLessThanOrEqual(100);
    }
  });
});

describe("P14 (R1.2, R18.3): registry weight consistency", () => {
  /**
   * Draw sets composed ONLY of zero-weight cards (star / world), at any
   * severity and orientation, so the weighted penalty must be exactly 0.
   */
  const arbZeroWeightDraws: fc.Arbitrary<CardDraw[]> = fc.array(
    fc
      .record({
        card: fc.constantFrom(...ZERO_WEIGHT_CARDS),
        severity: fc.constantFrom<Severity>(0, 1, 2, 3),
      })
      .map(
        ({ card, severity }): CardDraw => ({
          card,
          severity,
          orientation: expectedOrientation(severity),
          evidence: [],
          summary: "",
          grimoires: [],
        }),
      ),
    { maxLength: 2 },
  );

  // All weighted card ids (weight > 0) — i.e. every card except star/world.
  const WEIGHTED_CARD_IDS: readonly CardId[] = [...CARD_REGISTRY.entries()]
    .filter(([, def]) => def.weight > 0)
    .map(([id]) => id);

  /** A single draw of a weighted card at severity >= 1. */
  const arbWeightedDraw: fc.Arbitrary<CardDraw> = fc
    .record({
      card: fc.constantFrom(...WEIGHTED_CARD_IDS),
      severity: fc.constantFrom<Severity>(1, 2, 3),
    })
    .map(
      ({ card, severity }): CardDraw => ({
        card,
        severity,
        orientation: expectedOrientation(severity),
        evidence: [],
        summary: "",
        grimoires: [],
      }),
    );

  // Property 14 — Validates: Requirements R1.2, R18.3 / Properties: P14
  it("star/world-only draws score 100 (zero weighted penalty)", () => {
    fc.assert(
      fc.property(arbZeroWeightDraws, (draws) => {
        expect(weightedPenalty(draws)).toBe(0);
        // Score = 100 - penalty stays pinned at 100.
        expect(100 - weightedPenalty(draws)).toBe(100);
      }),
      { numRuns: 200 },
    );
  });

  it("any weighted card at severity >= 1 reduces the score below 100", () => {
    fc.assert(
      fc.property(
        arbWeightedDraw,
        arbZeroWeightDraws,
        (weighted, zeros) => {
          // Mixing in zero-weight draws never changes the penalty.
          const draws = [weighted, ...zeros];
          const penalty = weightedPenalty(draws);
          expect(penalty).toBeGreaterThan(0);
          expect(100 - penalty).toBeLessThan(100);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("confirms the registry weights fixed by R18.3: star and world are 0, all others > 0", () => {
    for (const id of ZERO_WEIGHT_CARDS) {
      expect(CARD_REGISTRY.get(id)?.weight).toBe(0);
    }
    for (const id of WEIGHTED_CARD_IDS) {
      expect(CARD_REGISTRY.get(id)?.weight).toBeGreaterThan(0);
    }
    // Exactly the two documented zero-weight cards exist.
    const zeroWeight = [...CARD_REGISTRY.entries()]
      .filter(([, def]) => def.weight === 0)
      .map(([id]) => id)
      .sort();
    expect(zeroWeight).toEqual(["star", "world"]);
  });

  // --- Regression examples (permanent counterexamples) -------------------
  //
  // When a counterexample is found by a property above, record it here as a
  // named example test so it is checked forever after. None found yet.
});
