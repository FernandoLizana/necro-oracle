// src/spread/assign.pbt.test.ts
//
// Property-based tests for the spread engine (task 28.3).
//
// Properties (design.md §"Correctness Properties" / requirements.md R17):
//   P5  — No duplicate card in spread: across any spread result, no CardId
//         appears in more than one filled position.          (R17.7)
//   P6  — Primary position holds most severe: for a necropsy spread with at
//         least one drawn card, the draw at position 1 ("The Corpse") has a
//         `severity × weight` product >= that of every other FILLED position
//         (ties broken by the SHA seed, hence a `>=` comparison). Weight comes
//         from CARD_REGISTRY.                                 (R17.3)
//   P11 — Spread count invariant: assignSpread(draws, "fates", sha) always
//         returns exactly 3 positions; "necropsy" exactly 5; "celtic" exactly
//         10 — for every (draws, sha).                        (R17.2, R17.3, R17.4)
//
// Testing steering: spread PBTs use numRuns 1000; print the seed on failure;
// when a counterexample is found, add it as a permanent regression example
// next to the property. No network / LLM / sandbox — pure computation (R21.5).
//
// _Validates: Requirements R17.2, R17.3, R17.4, R17.7 / Properties P5, P6, P11_
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { CardDraw, CardId } from "../registry/schema.js";
import { CARD_REGISTRY } from "../registry/cards.js";
import { assignSpread, type SpreadKind } from "./assign.js";
import { arbCardDrawArray, arbSha } from "../../test/arbitraries.js";

/** Spread PBTs run 1000 cases (testing steering). */
const NUM_RUNS = 1000;

/** The three spread kinds and their exact position counts (R17.2–R17.4). */
const SPREAD_KINDS: readonly SpreadKind[] = ["fates", "necropsy", "celtic"];
const EXPECTED_COUNT: Record<SpreadKind, number> = {
  fates: 3,
  necropsy: 5,
  celtic: 10,
};

/** The `severity × weight` product the engine ranks by (weight from registry). */
function product(draw: CardDraw): number {
  return draw.severity * (CARD_REGISTRY.get(draw.card)?.weight ?? 0);
}

/** Card ids across all filled (non-void) positions, in position order. */
function filledCards(positions: ReturnType<typeof assignSpread>): CardId[] {
  return positions.filter((p) => p.draw !== null).map((p) => p.draw!.card);
}

// ---------------------------------------------------------------------------
// P5 — No duplicate card in spread (R17.7)
// ---------------------------------------------------------------------------

describe("P5 (R17.7): no duplicate card in spread", () => {
  it("no CardId appears twice across filled positions, for any kind", () => {
    fc.assert(
      fc.property(
        arbCardDrawArray,
        arbSha,
        fc.constantFrom(...SPREAD_KINDS),
        (draws, sha, kind) => {
          const positions = assignSpread(draws, kind, sha);
          const cards = filledCards(positions);
          // A duplicate would make the Set smaller than the array.
          return new Set(cards).size === cards.length;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Permanent regression (testing steering): seed 789089480 shrank to a single
  // linked `judgement` draw in a necropsy spread. The `else if (judgementDraw)`
  // branch of assignNecropsy assigns judgement to The Call WITHOUT adding it to
  // `placed`, so the subsequent Corpse pickFirst re-selects the same judgement
  // draw — placing one CardId in two positions (R17.7 violation).
  it("regression: single linked judgement draw is not placed twice (necropsy)", () => {
    const draws: CardDraw[] = [
      {
        card: "judgement",
        severity: 0,
        orientation: "reversed",
        evidence: [],
        summary: "",
        grimoires: [],
      },
    ];
    const positions = assignSpread(draws, "necropsy", "0".repeat(40));
    const cards = filledCards(positions);
    expect(new Set(cards).size).toBe(cards.length);
  });
});

// ---------------------------------------------------------------------------
// P11 — Spread count invariant (R17.2, R17.3, R17.4)
// ---------------------------------------------------------------------------

describe("P11 (R17.2, R17.3, R17.4): spread count invariant", () => {
  it("returns exactly 3 / 5 / 10 positions for fates / necropsy / celtic", () => {
    fc.assert(
      fc.property(arbCardDrawArray, arbSha, (draws, sha) => {
        return (
          assignSpread(draws, "fates", sha).length === EXPECTED_COUNT.fates &&
          assignSpread(draws, "necropsy", sha).length ===
            EXPECTED_COUNT.necropsy &&
          assignSpread(draws, "celtic", sha).length === EXPECTED_COUNT.celtic
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// P6 — Primary position holds most severe (R17.3)
// ---------------------------------------------------------------------------

describe("P6 (R17.3): primary position holds most severe", () => {
  it("necropsy position 1 (The Corpse) product >= every other filled position", () => {
    fc.assert(
      fc.property(arbCardDrawArray, arbSha, (draws, sha) => {
        const positions = assignSpread(draws, "necropsy", sha);
        const corpse = positions[0]!; // position 1, "The Corpse"

        // Guard: skip the assertion when The Corpse is void (no draws placed).
        if (corpse.draw === null) return true;

        const corpseProduct = product(corpse.draw);
        // Every OTHER filled position must have a product <= The Corpse's.
        for (let i = 1; i < positions.length; i++) {
          const other = positions[i]!;
          if (other.draw === null) continue;
          if (product(other.draw) > corpseProduct) return false;
        }
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Permanent regression (testing steering): seed -1448982190 shrank to
  // [moon@0, hermit@3, judgement@0]. assignNecropsy's
  // `if (judgementDraw && otherCount >= 2)` branch forces `judgement` into The
  // Corpse even though its severity × weight (0) is below hermit's (3×5 = 15),
  // so The Wound outranks The Corpse (R17.3 / P6 violation).
  it("regression: The Corpse outranks The Wound even when judgement is drawn", () => {
    const draws: CardDraw[] = [
      {
        card: "moon",
        severity: 0,
        orientation: "reversed",
        evidence: [],
        summary: "",
        grimoires: [],
      },
      {
        card: "hermit",
        severity: 3,
        orientation: "upright",
        evidence: [],
        summary: "",
        grimoires: [],
      },
      {
        card: "judgement",
        severity: 0,
        orientation: "reversed",
        evidence: [],
        summary: "",
        grimoires: [],
      },
    ];
    const positions = assignSpread(draws, "necropsy", "0".repeat(40));
    const corpse = positions[0]!;
    expect(corpse.draw).not.toBeNull();
    const corpseProduct = product(corpse.draw!);
    for (let i = 1; i < positions.length; i++) {
      const other = positions[i]!;
      if (other.draw === null) continue;
      expect(product(other.draw)).toBeLessThanOrEqual(corpseProduct);
    }
  });
});
