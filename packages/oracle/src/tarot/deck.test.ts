// src/tarot/deck.test.ts
//
// The 22-card Major-Arcana tarot deck (judge-ready-pass item 30).
//
// Validates: judge-ready-pass item 30 (separate deck, 22 cards, bounds).

import { describe, expect, it } from "vitest";

import { CardIdSchema } from "../registry/schema.js";
import {
  TAROT_CARD_IDS,
  TAROT_DECK,
  TarotCardSchema,
  getTarotCard,
  type TarotCardId,
} from "./deck.js";

describe("item 30: the Major-Arcana tarot deck is a separate, complete deck", () => {
  it("holds exactly 22 cards in canonical order (0..21)", () => {
    expect(TAROT_DECK).toHaveLength(22);
    TAROT_DECK.forEach((card, i) => {
      expect(card.order).toBe(i);
    });
  });

  it("ids match the canonical Major-Arcana id list and the manifest asset ids", () => {
    expect(TAROT_DECK.map((c) => c.id)).toEqual([...TAROT_CARD_IDS]);
    // Spot-check the four corners of the deck.
    expect(TAROT_DECK[0]?.id).toBe("fool");
    expect(TAROT_DECK[0]?.numeral).toBe("0");
    expect(TAROT_DECK[21]?.id).toBe("world");
    expect(TAROT_DECK[21]?.numeral).toBe("XXI");
  });

  it("every card validates and carries both orientation meanings", () => {
    for (const card of TAROT_DECK) {
      expect(() => TarotCardSchema.parse(card)).not.toThrow();
      expect(card.upright.length).toBeGreaterThan(0);
      expect(card.reversed.length).toBeGreaterThan(0);
    }
  });

  it("every meaning is <= 16 words (oracle-voice rule 2)", () => {
    for (const card of TAROT_DECK) {
      for (const line of [card.upright, card.reversed]) {
        const words = line.trim().split(/\s+/).length;
        expect(words, `"${card.id}" meaning too long: "${line}"`).toBeLessThanOrEqual(16);
      }
    }
  });

  it("has no duplicate id, order, numeral, or name", () => {
    const ids = new Set(TAROT_DECK.map((c) => c.id));
    const orders = new Set(TAROT_DECK.map((c) => c.order));
    const numerals = new Set(TAROT_DECK.map((c) => c.numeral));
    const names = new Set(TAROT_DECK.map((c) => c.name));
    expect(ids.size).toBe(22);
    expect(orders.size).toBe(22);
    expect(numerals.size).toBe(22);
    expect(names.size).toBe(22);
  });

  it("is a SEPARATE deck: it is NOT the 12-card diagnosis registry", () => {
    // The diagnosis deck has exactly 12 ids; the tarot deck has 22 and is a
    // strict superset of the diagnosis ids by name but a distinct structure.
    expect(CardIdSchema.options).toHaveLength(12);
    expect(TAROT_CARD_IDS.length).toBe(22);
    // The 10 cards unique to the tarot deck are not diagnosis ids.
    const diagnosis = new Set<string>(CardIdSchema.options);
    const tarotOnly = TAROT_CARD_IDS.filter((id) => !diagnosis.has(id));
    expect(tarotOnly.sort()).toEqual(
      [
        "chariot",
        "emperor",
        "empress",
        "fool",
        "hierophant",
        "high_priestess",
        "lovers",
        "magician",
        "strength",
        "sun",
      ].sort(),
    );
  });

  it("getTarotCard resolves every id and throws a typed error on an unknown id", () => {
    for (const id of TAROT_CARD_IDS) {
      expect(getTarotCard(id).id).toBe(id);
    }
    expect(() => getTarotCard("not_a_card" as TarotCardId)).toThrow(
      /holds no card named/,
    );
  });
});