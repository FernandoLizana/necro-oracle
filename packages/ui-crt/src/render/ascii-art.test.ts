// Unit tests for the per-CardId illustration table and the renderer error /
// Card_Back contracts (task 2.4).
//
// Validates: Requirements 3.11, 3.10, 4.3
//
// Task 2.1's `ascii-card.test.ts` already locks the renderer's structural
// shape, the `CARD_UNKNOWN` error, and the Card_Back frame. This file is the
// companion for the art table: it proves every one of the twelve bespoke motifs
// is a genuinely distinct illustration rather than the shared `GENERIC_ART`
// fallback (R3.11), and that where a motif supplies a `reversed` variant the
// reversed art is not just a copy of the upright art (R3.12-adjacent). It then
// re-checks the two cross-cutting contracts this task owns — an unknown id
// raises `NecroError('CARD_UNKNOWN')` (R3.10) and the Card_Back is one identical
// frame for every position (R4.3) — from the art table's point of view (the
// bespoke motifs never leak into the face-down frame).

import { describe, expect, it } from "vitest";

import { NecroError, type CardId } from "@necro/oracle/client";

import {
  CARD_ART,
  GENERIC_ART,
  artFor,
  type CardArt,
} from "./ascii-art.js";
import { CARD_COLS, CARD_ROWS, asciiCard, asciiCardBack } from "./ascii-card.js";

/** The twelve registered CardIds that carry a bespoke phosphor motif. */
const BESPOKE_IDS = [
  "tower",
  "death",
  "devil",
  "hermit",
  "wheel",
  "judgement",
  "hanged_man",
  "temperance",
  "justice",
  "moon",
  "star",
  "world",
] as const satisfies readonly CardId[];

/** Count the display columns of a frame row (box glyphs are width-1 here). */
function cols(row: string): number {
  return [...row].length;
}

/** Normalise an illustration's rows to a single comparable string. */
function motifText(rows: readonly string[]): string {
  return rows.join("\n");
}

describe("R3.11: every bespoke motif is a non-generic illustration", () => {
  it("defines CARD_ART for all twelve bespoke CardIds", () => {
    for (const id of BESPOKE_IDS) {
      const art: CardArt | undefined = CARD_ART[id];
      expect(art, `CARD_ART missing bespoke entry for ${id}`).toBeDefined();
      expect(art.upright.length).toBeGreaterThan(0);
    }
  });

  it("gives each of the twelve a distinct upright motif, none equal to GENERIC_ART", () => {
    const generic = motifText(GENERIC_ART.upright);
    for (const id of BESPOKE_IDS) {
      const upright = motifText(CARD_ART[id].upright);
      expect(
        upright,
        `${id} upright art falls back to GENERIC_ART`,
      ).not.toBe(generic);
    }
  });

  it("gives every bespoke motif a visually distinct upright from every other", () => {
    const seen = new Map<string, CardId>();
    for (const id of BESPOKE_IDS) {
      const upright = motifText(CARD_ART[id].upright);
      const clash = seen.get(upright);
      expect(
        clash,
        `${id} shares its upright motif with ${String(clash)}`,
      ).toBeUndefined();
      seen.set(upright, id);
    }
  });

  it("resolves bespoke ids to their own motif via artFor, not the generic fallback", () => {
    for (const id of BESPOKE_IDS) {
      expect(artFor(id)).toBe(CARD_ART[id]);
      expect(motifText(artFor(id).upright)).not.toBe(
        motifText(GENERIC_ART.upright),
      );
    }
  });
});

/**
 * The CardIds that carry a bespoke `reversed` motif (distinct from the bare CSS
 * 180° flip). Task 2.2 authored the first five; task 21.4 (OPTIONAL polish)
 * added the remaining seven where a plain flip would read as a confusing
 * upside-down figure or (for the World's ring) as no change at all.
 */
const REVERSED_IDS = [
  "tower",
  "wheel",
  "hanged_man",
  "moon",
  "star",
  // Added by task 21.4:
  "death",
  "devil",
  "hermit",
  "judgement",
  "temperance",
  "justice",
  "world",
] as const satisfies readonly CardId[];

/** The frame's inner block the art table authors to: 6 rows × 22 columns. */
const ART_INNER_ROWS = 6;
const ART_INNER_COLS = 22;

describe("R3.12: reversed art differs from upright where a variant is defined", () => {
  it("has at least one motif with a bespoke reversed variant", () => {
    const withReversed = BESPOKE_IDS.filter(
      (id) => CARD_ART[id].reversed !== undefined,
    );
    expect(withReversed.length).toBeGreaterThan(0);
  });

  it("defines a bespoke reversed variant for every REVERSED_ID (task 21.4)", () => {
    for (const id of REVERSED_IDS) {
      expect(
        CARD_ART[id].reversed,
        `${id} is expected to carry a bespoke reversed motif`,
      ).toBeDefined();
    }
  });

  it("sizes every reversed motif to the frame's inner block (6 rows × 22 cols)", () => {
    for (const id of REVERSED_IDS) {
      const reversed = CARD_ART[id].reversed!;
      expect(reversed.length, `${id} reversed row count`).toBe(ART_INNER_ROWS);
      for (const row of reversed) {
        expect(cols(row), `${id} reversed row width`).toBe(ART_INNER_COLS);
      }
    }
  });

  it("keeps every reversed motif visually distinct from every other", () => {
    const seen = new Map<string, CardId>();
    for (const id of REVERSED_IDS) {
      const reversed = motifText(CARD_ART[id].reversed!);
      const clash = seen.get(reversed);
      expect(
        clash,
        `${id} shares its reversed motif with ${String(clash)}`,
      ).toBeUndefined();
      seen.set(reversed, id);
    }
  });

  it("makes each defined reversed variant differ from its upright", () => {
    for (const id of BESPOKE_IDS) {
      const art = CARD_ART[id];
      if (art.reversed === undefined) continue;
      expect(
        motifText(art.reversed),
        `${id} reversed art is identical to its upright`,
      ).not.toBe(motifText(art.upright));
    }
  });

  it("produces different framed cards for the two orientations when reversed art exists", () => {
    for (const id of BESPOKE_IDS) {
      if (CARD_ART[id].reversed === undefined) continue;
      const up = asciiCard(id, "upright", CARD_ART);
      const down = asciiCard(id, "reversed", CARD_ART);
      expect(up.rows, `${id} framed card ignores reversed art`).not.toEqual(
        down.rows,
      );
    }
  });
});

describe("R3.10: an unknown id throws NecroError('CARD_UNKNOWN')", () => {
  it("rejects an id outside the Deck_Card_Set rather than drawing generic art", () => {
    const callUnknown = () =>
      asciiCard("not_a_card" as unknown as CardId, "upright", CARD_ART);
    expect(callUnknown).toThrow(NecroError);
    try {
      callUnknown();
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(NecroError);
      expect((err as NecroError).code).toBe("CARD_UNKNOWN");
    }
  });
});

describe("R4.3: Card_Back is identical across positions and full-width", () => {
  it("returns a deep-equal frame on every call, each row CARD_COLS wide", () => {
    const first = asciiCardBack();
    const second = asciiCardBack();
    expect(second).toEqual(first);
    expect(first).toHaveLength(CARD_ROWS);
    for (const row of first) {
      expect(cols(row)).toBe(CARD_COLS);
    }
  });

  it("never leaks a bespoke motif glyph into the face-down frame", () => {
    const back = motifText(asciiCardBack());
    // The Card_Back inner fill is a single repeating sigil, so none of the
    // distinctive motif fragments can appear in it.
    expect(back).not.toContain("RUBBLE");
    expect(back).not.toContain("\\|/");
  });
});
