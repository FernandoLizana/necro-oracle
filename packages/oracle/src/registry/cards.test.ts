// src/registry/cards.test.ts
//
// Unit tests for the card registry (task 6.1 — TEST-FIRST).
//
// These tests are written against the design API before the real registry
// implementation lands in task 6.2. Until 6.2 implements src/registry/cards.ts
// with the 12 real CardDefinition entries, these tests are EXPECTED RED.
//
// _Requirements: R1.1, R1.2, R1.4, R1.5, R1.6, R18.3_
import { describe, expect, it } from "vitest";
import { CardIdSchema, type CardId } from "./schema.js";
import { NecroError } from "../util/errors.js";
import { CARD_REGISTRY, getCard } from "./cards.js";

// R1.1: the exact 12 cards and their Roman numerals.
const EXPECTED_CARDS: ReadonlyArray<{ id: CardId; numeral: string }> = [
  { id: "judgement", numeral: "XX" },
  { id: "tower", numeral: "XVI" },
  { id: "devil", numeral: "XV" },
  { id: "death", numeral: "XIII" },
  { id: "wheel", numeral: "X" },
  { id: "hermit", numeral: "IX" },
  { id: "hanged_man", numeral: "XII" },
  { id: "temperance", numeral: "XIV" },
  { id: "justice", numeral: "XI" },
  { id: "moon", numeral: "XVIII" },
  { id: "star", numeral: "XVII" },
  { id: "world", numeral: "XXI" },
];

// R18.3 / task 6.2: vitality penalty weights per card. star and world are 0.
const EXPECTED_WEIGHTS: Readonly<Record<CardId, number>> = {
  judgement: 20,
  tower: 15,
  devil: 18,
  death: 10,
  wheel: 12,
  hermit: 5,
  hanged_man: 8,
  temperance: 7,
  justice: 6,
  moon: 9,
  star: 0,
  world: 0,
};

describe("R1.1, R1.4: registry membership", () => {
  it("registers exactly 12 cards", () => {
    expect(CARD_REGISTRY.size).toBe(12);
  });

  it("contains every expected CardId exactly once", () => {
    const ids = [...CARD_REGISTRY.keys()].sort();
    const expected = EXPECTED_CARDS.map((c) => c.id).sort();
    expect(ids).toEqual(expected);
  });

  it("keys agree with each definition's own id", () => {
    for (const [id, def] of CARD_REGISTRY) {
      expect(def.id).toBe(id);
    }
  });

  it("exposes only valid CardIds", () => {
    for (const id of CARD_REGISTRY.keys()) {
      expect(CardIdSchema.safeParse(id).success).toBe(true);
    }
  });
});

describe("R1.1, R1.2: card ids and numerals", () => {
  it.each(EXPECTED_CARDS)(
    "card $id carries numeral $numeral",
    ({ id, numeral }) => {
      const def = CARD_REGISTRY.get(id);
      expect(def).toBeDefined();
      expect(def?.numeral).toBe(numeral);
    },
  );

  it("assigns a distinct numeral to every card", () => {
    const numerals = [...CARD_REGISTRY.values()].map((d) => d.numeral);
    expect(new Set(numerals).size).toBe(numerals.length);
  });
});

describe("R18.3: vitality penalty weights", () => {
  it.each(EXPECTED_CARDS.map((c) => c.id))(
    "card %s has its specified weight",
    (id) => {
      expect(getCard(id).weight).toBe(EXPECTED_WEIGHTS[id]);
    },
  );

  it("sets star and world to weight 0 (strength cards never penalize)", () => {
    expect(getCard("star").weight).toBe(0);
    expect(getCard("world").weight).toBe(0);
  });

  it("gives every penalizing card a positive weight", () => {
    for (const { id } of EXPECTED_CARDS) {
      if (id === "star" || id === "world") continue;
      expect(getCard(id).weight).toBeGreaterThan(0);
    }
  });
});

describe("R1.5: getCard happy path", () => {
  it.each(EXPECTED_CARDS.map((c) => c.id))(
    "returns the registered definition for %s",
    (id) => {
      const def = getCard(id);
      expect(def.id).toBe(id);
      expect(def).toBe(CARD_REGISTRY.get(id));
    },
  );
});

describe("R1.5: getCard sad path", () => {
  it("throws NecroError(CARD_NOT_FOUND) for an unknown id", () => {
    // Cast through unknown: the type system forbids invalid ids, but a
    // runtime consumer can still pass one, and getCard must guard against it.
    const unknown = "the_fool" as unknown as CardId;
    expect(() => getCard(unknown)).toThrow(NecroError);
    try {
      getCard(unknown);
      expect.unreachable("getCard should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NecroError);
      expect((err as NecroError).code).toBe("CARD_NOT_FOUND");
      // userMessage should name the unrecognized id (R1.5).
      expect((err as NecroError).userMessage).toContain("the_fool");
    }
  });
});

describe("R1.6: registry loads without a duplicate-guard violation", () => {
  // R1.6 requires that duplicate id/numeral throws REGISTRY_INVALID at module
  // load. Triggering that path requires a construction factory the module does
  // not expose, so we assert the real registry loads cleanly (no duplicate ids
  // or numerals) and leave the throw-on-duplicate behavior to the
  // implementation-side validation covered in task 6.2.
  it("has no duplicate ids", () => {
    const ids = [...CARD_REGISTRY.values()].map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no duplicate numerals", () => {
    const numerals = [...CARD_REGISTRY.values()].map((d) => d.numeral);
    expect(new Set(numerals).size).toBe(numerals.length);
  });
});
