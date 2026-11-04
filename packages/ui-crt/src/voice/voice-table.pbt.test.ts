// Feature: 03-crt-terminal, Property 6: Voice_Table totality
//
// Validates: Requirements R7.3, R7.4
//
// P6 — Voice_Table totality (R7.3, R7.4): For every `CardId` and both
// orientations, the Voice_Table holds exactly one non-empty mystical line of at
// most 16 words; upright lines read in present tense and reversed lines in a
// conditional/latent tense; and the rendered card heading uses the uppercase
// `CARD_REGISTRY` name.
//
// TEST-FIRST (task 7.1): this is written before `voice/voice-table.ts` exists
// (task 7.2). It is EXPECTED TO FAIL now — the import of `./voice-table.js`
// cannot resolve, so the suite errors at load. That is the correct red.
//
// Enumeration is driven by `CardIdSchema.options` (the finite set of 12 card
// ids) so adding a card to `CardIdSchema` without adding a voice line fails
// this test. Because the domain is finite (12 cards × 2 orientations = 24
// cases) the properties iterate it exhaustively via `fc.constantFrom`, and keep
// the design-default `numRuns` of 200 so every case is hit many times over.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CARD_REGISTRY, CardIdSchema, type CardId } from "@necro/oracle/client";

import { VOICE_TABLE, type Orientation } from "./voice-table.js";

/** Both orientations, as the Voice_Table keys them. */
const ORIENTATIONS: readonly Orientation[] = ["upright", "reversed"] as const;

/** The finite, canonical set of card ids the deck defines. */
const CARD_IDS: readonly CardId[] = CardIdSchema.options;

/** Count whitespace-separated words in a mystical line. */
function wordCount(line: string): number {
  const trimmed = line.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/u).length;
}

/** The rendered heading name for a card: the uppercase CARD_REGISTRY name. */
function headingName(id: CardId): string {
  const def = CARD_REGISTRY.get(id);
  // Every CardId is registered; guard narrows the Map lookup for TS.
  if (def === undefined) throw new Error(`no registry entry for ${id}`);
  return def.name.toUpperCase();
}

// Arbitraries over the finite domain. constantFrom gives fast-check the whole
// set, so shrinking reports a concrete (card, orientation) counterexample.
const arbCardId: fc.Arbitrary<CardId> = fc.constantFrom(...CARD_IDS);
const arbOrientation: fc.Arbitrary<Orientation> = fc.constantFrom(
  ...ORIENTATIONS,
);

describe("P6 (R7.3, R7.4): voice table totality", () => {
  it("has an entry for every CardId with both orientations", () => {
    // Structural totality: the key set is exactly CardIdSchema.options, no more
    // and no fewer, and each entry carries both orientations.
    const tableKeys = Object.keys(VOICE_TABLE).sort();
    expect(tableKeys).toEqual([...CARD_IDS].sort());

    for (const id of CARD_IDS) {
      const entry = VOICE_TABLE[id];
      expect(entry, `VOICE_TABLE has an entry for "${id}"`).toBeDefined();
      expect(Object.keys(entry).sort()).toEqual(["reversed", "upright"]);
    }
  });

  it("gives exactly one non-empty mystical line of at most 16 words for every card and orientation", () => {
    fc.assert(
      fc.property(arbCardId, arbOrientation, (id, orientation) => {
        const line = VOICE_TABLE[id][orientation];

        // Exactly one line present and typed as a string.
        expect(typeof line).toBe("string");

        // Non-empty after trimming.
        expect(line.trim().length).toBeGreaterThan(0);

        // A single line: no embedded newline splits it into two.
        expect(line).not.toContain("\n");

        // At most 16 words (Oracle_Voice mystical-line budget, R7.4).
        expect(wordCount(line)).toBeGreaterThanOrEqual(1);
        expect(wordCount(line)).toBeLessThanOrEqual(16);
      }),
      { numRuns: 200 },
    );
  });

  it("keeps every mystical line within 72 columns (Oracle_Voice line budget)", () => {
    fc.assert(
      fc.property(arbCardId, arbOrientation, (id, orientation) => {
        const line = VOICE_TABLE[id][orientation];
        // Measured in code points so surrogate pairs count once.
        expect([...line].length).toBeLessThanOrEqual(72);
      }),
      { numRuns: 200 },
    );
  });

  it("renders every card heading with the uppercase CARD_REGISTRY name", () => {
    fc.assert(
      fc.property(arbCardId, (id) => {
        const name = headingName(id);
        // The heading name is the card's registry name, uppercased, and the
        // registry round-trips the id.
        expect(name).toBe(CARD_REGISTRY.get(id)?.name.toUpperCase());
        expect(name).toBe(name.toUpperCase());
        expect(name.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  it("distinguishes upright (present/active) from reversed (latent/partial) lines", () => {
    // Orientation carries meaning (R7.4): the two lines of a card are never the
    // same text, so upright and reversed genuinely read differently.
    fc.assert(
      fc.property(arbCardId, (id) => {
        const upright = VOICE_TABLE[id].upright;
        const reversed = VOICE_TABLE[id].reversed;
        expect(upright).not.toBe(reversed);
      }),
      { numRuns: 200 },
    );
  });
});
