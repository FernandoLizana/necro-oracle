// src/tarot/draw.test.ts
//
// The three-card tarot draw (judge-ready-pass item 30, 33).
//
// Validates: judge-ready-pass item 30 (distinct cards, positions, injectable
// RNG, orientation) and item 33 (uniqueness + deck-bounds unit tests).

import { describe, expect, it } from "vitest";

import { TAROT_CARD_IDS, TarotCardIdSchema } from "./deck.js";
import {
  TAROT_POSITIONS,
  TarotDrawSchema,
  drawTarot,
  seededRandomFn,
  type RandomFn,
} from "./draw.js";

/** A scripted RNG that replays a fixed list of samples, then repeats the last. */
function scriptedRng(samples: readonly number[]): RandomFn {
  let i = 0;
  return () => {
    const v = samples[Math.min(i, samples.length - 1)] ?? 0;
    i += 1;
    return v;
  };
}

describe("item 30: drawTarot lays a valid Past/Present/Future spread", () => {
  it("always yields three cards at the three positions, in order", () => {
    const draw = drawTarot(seededRandomFn(1));
    expect(() => TarotDrawSchema.parse(draw)).not.toThrow();
    expect(draw.cards.map((c) => c.position)).toEqual([...TAROT_POSITIONS]);
  });

  it("the three drawn cards are DISTINCT (no replacement)", () => {
    for (let seed = 0; seed < 200; seed++) {
      const draw = drawTarot(seededRandomFn(seed));
      const ids = draw.cards.map((c) => c.cardId);
      expect(new Set(ids).size, `seed ${seed} drew a duplicate`).toBe(3);
    }
  });

  it("every drawn card id is a Major-Arcana id, every orientation valid", () => {
    for (let seed = 0; seed < 100; seed++) {
      const draw = drawTarot(seededRandomFn(seed));
      for (const card of draw.cards) {
        expect(() => TarotCardIdSchema.parse(card.cardId)).not.toThrow();
        expect(["upright", "reversed"]).toContain(card.orientation);
      }
    }
  });

  it("is deterministic in its injected RNG: same seed -> same draw", () => {
    const a = drawTarot(seededRandomFn(42));
    const b = drawTarot(seededRandomFn(42));
    expect(a).toEqual(b);
  });

  it("different seeds can produce different draws (RNG actually drives it)", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      seen.add(JSON.stringify(drawTarot(seededRandomFn(seed)).cards));
    }
    // 50 seeds must not all collapse to one draw.
    expect(seen.size).toBeGreaterThan(1);
  });

  it("the first drawn card is the deck card the first RNG sample indexes", () => {
    // rng[0] = 0 picks pool index 0 (The Fool) for Past; rng[1] decides its
    // orientation (< 0.5 => upright).
    const draw = drawTarot(scriptedRng([0, 0, 0.1, 0.1, 0.2, 0.2]));
    expect(draw.cards[0]?.cardId).toBe("fool");
    expect(draw.cards[0]?.orientation).toBe("upright");
  });

  it("a defensive out-of-range RNG value never indexes past the deck", () => {
    // rng returning >= 1 and NaN must still land on a valid card, not throw.
    const draw = drawTarot(scriptedRng([1.5, Number.NaN, 2, 0.9, 1, 0.4]));
    expect(() => TarotDrawSchema.parse(draw)).not.toThrow();
    expect(new Set(draw.cards.map((c) => c.cardId)).size).toBe(3);
    for (const card of draw.cards) {
      expect(TAROT_CARD_IDS).toContain(card.cardId);
    }
  });
});