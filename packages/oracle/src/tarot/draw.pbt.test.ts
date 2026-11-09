// src/tarot/draw.pbt.test.ts
//
// Property tests for the tarot draw (judge-ready-pass item 30, 33).
//
// P-TAROT-1 (item 30): every draw is three DISTINCT in-bounds cards at the
//   three positions, each upright or reversed, for an arbitrary RNG stream.
// P-TAROT-2 (item 30): every card in the 22-card deck is REACHABLE as a draw
//   (over enough seeds, the union of drawn ids covers the whole deck).
// P-TAROT-3 (item 30/33): the draw is a deterministic function of its RNG
//   sample stream (same stream -> same draw).

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { TAROT_CARD_IDS } from "./deck.js";
import {
  TAROT_POSITIONS,
  TarotDrawSchema,
  drawTarot,
  seededRandomFn,
  type RandomFn,
} from "./draw.js";

/** An RNG that replays an arbitrary finite sample list, repeating the last. */
function listRng(samples: readonly number[]): RandomFn {
  let i = 0;
  return () => {
    const v = samples.length === 0 ? 0 : samples[Math.min(i, samples.length - 1)];
    i += 1;
    return v as number;
  };
}

/** Floats in [0,1) plus the nasty edges the clamp must survive. */
const arbUnit = fc.oneof(
  fc.float({ min: 0, max: Math.fround(0.999999), noNaN: true }),
  fc.constantFrom(0, 1, 1.5, -0.2, Number.NaN),
);

describe("P-TAROT-1 (item 30): every draw is three distinct in-bounds cards", () => {
  it("holds for an arbitrary RNG stream", () => {
    fc.assert(
      fc.property(fc.array(arbUnit, { minLength: 6, maxLength: 40 }), (samples) => {
        const draw = drawTarot(listRng(samples));
        // Shape is always valid.
        expect(() => TarotDrawSchema.parse(draw)).not.toThrow();
        // Three positions, in order.
        expect(draw.cards.map((c) => c.position)).toEqual([...TAROT_POSITIONS]);
        // Three DISTINCT ids, all in the deck.
        const ids = draw.cards.map((c) => c.cardId);
        expect(new Set(ids).size).toBe(3);
        for (const id of ids) expect(TAROT_CARD_IDS).toContain(id);
        // Every orientation is valid.
        for (const c of draw.cards) {
          expect(["upright", "reversed"]).toContain(c.orientation);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

describe("P-TAROT-2 (item 30): every card in the deck is reachable", () => {
  it("the union of draws over many seeds covers all 22 cards", () => {
    const covered = new Set<string>();
    for (let seed = 0; seed < 2000 && covered.size < 22; seed++) {
      for (const card of drawTarot(seededRandomFn(seed)).cards) {
        covered.add(card.cardId);
      }
    }
    expect(covered.size, `uncovered: ${TAROT_CARD_IDS.filter((id) => !covered.has(id)).join(", ")}`).toBe(22);
  });
});

describe("P-TAROT-3 (item 30/33): the draw is deterministic in its RNG stream", () => {
  it("same sample stream -> identical draw", () => {
    fc.assert(
      fc.property(fc.array(arbUnit, { minLength: 6, maxLength: 40 }), (samples) => {
        const a = drawTarot(listRng(samples));
        const b = drawTarot(listRng(samples));
        expect(a).toEqual(b);
      }),
      { numRuns: 500 },
    );
  });
});