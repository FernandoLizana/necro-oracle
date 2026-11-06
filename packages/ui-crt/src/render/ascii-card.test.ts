// Unit tests for the ASCII_Card_Renderer and Card_Back (task 2.1).
//
// Validates: Requirements R3.1, R3.2, R3.3, R3.5, R3.8, R3.10, R3.12, R4.3
//
// These examples pin the renderer's structural contract: every card in both
// orientations is exactly `CARD_ROWS × CARD_COLS` glyphs (R3.3, R3.12); the
// frame carries a box-drawing border, the roman numeral, and the uppercase name
// (R3.1); numerals and names are uppercase with no emoji (R3.5); the
// `accessibleText` names the card, numeral and orientation (R3.7-adjacent);
// an id outside the Deck_Card_Set throws `NecroError('CARD_UNKNOWN')` (R3.10);
// and the Card_Back is one identical frame for every position (R4.3). The
// property tests (task 2.3) cover determinism and completeness across the full
// input space; these examples lock the exact shape.

import { describe, expect, it } from "vitest";

import {
  CardIdSchema,
  NecroError,
  getCard,
  type CardId,
} from "@necro/oracle/client";

import type { Orientation } from "../voice/voice-table.js";
import {
  ART_ROWS,
  CARD_COLS,
  CARD_ROWS,
  asciiCard,
  asciiCardBack,
  type CardArtTable,
} from "./ascii-card.js";

const ALL_IDS = CardIdSchema.options;
const ORIENTATIONS: readonly Orientation[] = ["upright", "reversed"];

/** Count the display columns of a frame row (box glyphs are width-1 here). */
function cols(row: string): number {
  return [...row].length;
}

/** Emoji / pictographic ranges that must never appear in a card. */
const EMOJI =
  /[\u{1f000}-\u{1ffff}\u{2600}-\u{27bf}\u{2190}-\u{21ff}\u{fe0f}]/u;

describe("R3.3, R3.12: ascii card frame size", () => {
  it("renders exactly CARD_ROWS rows of CARD_COLS columns for every card/orientation", () => {
    for (const id of ALL_IDS) {
      for (const orientation of ORIENTATIONS) {
        const card = asciiCard(id, orientation);
        expect(card.rows).toHaveLength(CARD_ROWS);
        for (const row of card.rows) {
          expect(cols(row)).toBe(CARD_COLS);
        }
      }
    }
  });
});

describe("R3.1, R3.5: frame content", () => {
  it("includes a box-drawing border, the roman numeral and the uppercase name", () => {
    const card = asciiCard("tower", "upright");
    const def = getCard("tower");

    // Top and bottom borders use box-drawing corners.
    expect(card.rows[0]).toContain("\u250c"); // ┌
    expect(card.rows[0]).toContain("\u2510"); // ┐
    expect(card.rows[CARD_ROWS - 1]).toContain("\u2514"); // └
    expect(card.rows[CARD_ROWS - 1]).toContain("\u2518"); // ┘

    // Numeral row then name row, both uppercase.
    expect(card.rows[1]).toContain(def.numeral.toUpperCase());
    expect(card.rows[2]).toContain(def.name.toUpperCase());

    const joined = card.rows.join("\n");
    expect(joined).not.toMatch(EMOJI);
    // Vertical borders frame the inner rows.
    for (let i = 1; i < CARD_ROWS - 1; i++) {
      const row = card.rows[i]!;
      if (row.startsWith("\u2502")) {
        expect(row.endsWith("\u2502")).toBe(true);
      }
    }
  });

  it("uppercases numeral and name for every registered card", () => {
    for (const id of ALL_IDS) {
      const def = getCard(id);
      const card = asciiCard(id, "upright");
      expect(card.rows[1]).toContain(def.numeral.toUpperCase());
      expect(card.rows[2]).toContain(def.name.toUpperCase());
    }
  });
});

describe("R3.12: accessibleText names card + numeral + orientation", () => {
  it("records the numeral, uppercase name and orientation", () => {
    const def = getCard("hermit");
    expect(asciiCard("hermit", "upright").accessibleText).toBe(
      `${def.numeral.toUpperCase()} ${def.name.toUpperCase()}, upright`,
    );
    expect(asciiCard("hermit", "reversed").accessibleText).toBe(
      `${def.numeral.toUpperCase()} ${def.name.toUpperCase()}, reversed`,
    );
  });

  it("folds the uppercased position label into accessibleText when supplied", () => {
    const def = getCard("hermit");
    expect(asciiCard("hermit", "upright", {}, "Past").accessibleText).toBe(
      `${def.numeral.toUpperCase()} ${def.name.toUpperCase()}, PAST, upright`,
    );
  });
});

describe("R3.3, R4.6: footer panel carries the orientation and position label", () => {
  it("shows just the orientation word when no label is supplied", () => {
    const footer = asciiCard("hermit", "upright").rows[CARD_ROWS - 2]!;
    expect(footer).toContain("UPRIGHT");
    expect(cols(footer)).toBe(CARD_COLS);
    expect(asciiCard("hermit", "reversed").rows[CARD_ROWS - 2]!).toContain(
      "REVERSED",
    );
  });

  it("shows the uppercased label alongside the orientation when it fits", () => {
    const footer = asciiCard("hermit", "upright", {}, "Past").rows[
      CARD_ROWS - 2
    ]!;
    expect(footer).toContain("PAST");
    expect(footer).toContain("UPRIGHT");
    expect(cols(footer)).toBe(CARD_COLS);
  });

  it("keeps the frame exactly CARD_ROWS × CARD_COLS even with a very long label", () => {
    const card = asciiCard(
      "hermit",
      "reversed",
      {},
      "An Extremely Long Spread Position Label",
    );
    expect(card.rows).toHaveLength(CARD_ROWS);
    for (const row of card.rows) {
      expect(cols(row)).toBe(CARD_COLS);
    }
    // Too wide for both: the orientation stays, a readable fallback (R4.6).
    expect(card.rows[CARD_ROWS - 2]!).toContain("REVERSED");
  });
});

describe("R3.12: illustration block consumes the passed art table", () => {
  it("renders the supplied art rows inside the frame, fitted to the inner block", () => {
    const art: CardArtTable = {
      tower: { upright: ["/\\", "||"] },
    };
    const card = asciiCard("tower", "upright", art);
    // Illustration rows sit between the two dividers (rows 4..4+ART_ROWS-1).
    const firstArtRow = card.rows[4]!;
    expect(firstArtRow).toContain("/\\");
    // Still exactly ART_ROWS illustration rows, each full width.
    for (let i = 0; i < ART_ROWS; i++) {
      expect(cols(card.rows[4 + i]!)).toBe(CARD_COLS);
    }
  });

  it("uses a distinct reversed variant when the table provides one", () => {
    const art: CardArtTable = {
      hanged_man: { upright: ["UP"], reversed: ["DOWN"] },
    };
    const up = asciiCard("hanged_man", "upright", art);
    const down = asciiCard("hanged_man", "reversed", art);
    expect(up.rows[4]).toContain("UP");
    expect(down.rows[4]).toContain("DOWN");
    expect(up.rows).not.toEqual(down.rows);
  });
});

describe("R3.2, R3.10: unknown ids throw a typed NecroError", () => {
  it("throws NecroError('CARD_UNKNOWN') for an id outside the Deck_Card_Set", () => {
    const callUnknown = () =>
      asciiCard("not_a_card" as unknown as CardId, "upright");
    expect(callUnknown).toThrow(NecroError);
    try {
      callUnknown();
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(NecroError);
      expect((err as NecroError).code).toBe("CARD_UNKNOWN");
      expect((err as NecroError).userMessage).toBe(
        "The deck holds no such card. (Unknown card id.)",
      );
    }
  });
});

describe("R4.3: Card_Back is one identical frame", () => {
  it("fills the same frame size with a single repeating sigil, identical each call", () => {
    const back = asciiCardBack();
    expect(back).toHaveLength(CARD_ROWS);
    for (const row of back) {
      expect(cols(row)).toBe(CARD_COLS);
    }
    // Identical across calls (one shared face-down frame).
    expect(asciiCardBack()).toEqual(back);
    // Inner rows repeat a single sigil glyph.
    const inner = back[1]!.slice(1, CARD_COLS - 1);
    expect(new Set([...inner]).size).toBe(1);
  });
});
