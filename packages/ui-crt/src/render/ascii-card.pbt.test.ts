// Feature: visual-necromancy — ASCII_Card_Renderer properties (task 2.3).
//
// Properties 3, 4 and 5 over `asciiCard(cardId, orientation, art?)`. These pin
// the three invariants that make the ASCII card deck stable and closed:
//
//   P3 — determinism: the same id + orientation always renders an equal card,
//        so Demo replay and re-renders never drift (R3.9).
//   P4 — frame-size invariance: every registered card, in both orientations,
//        is exactly `CARD_ROWS` rows × `CARD_COLS` columns, so all cards share
//        one outer frame regardless of name length or illustration (R3.3, R3.12).
//   P5 — complete and closed: every Deck_Card_Set member renders a card, and
//        any id outside the set raises a typed `NecroError` with the renderer's
//        own `CARD_UNKNOWN` code rather than a partial or blank frame
//        (R3.2, R3.10).
//
// Generators draw CardIds from `CardIdSchema.options` (the whole Deck_Card_Set)
// and non-members from arbitrary strings filtered to exclude every real CardId.
// The renderer is pure, so there is no network, LLM, sandbox, clock, DOM or
// unseeded randomness here: the tests only build ids/orientations and compare
// the synchronous outputs. Columns are measured with `[...row].length` so a
// box-drawing glyph counts as one column, matching the frame-size contract.
//
// **Validates: Requirements 3.2, 3.3, 3.9, 3.10, 3.12**

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { CardIdSchema, NecroError, type CardId } from "@necro/oracle/client";

import {
  asciiCard,
  CARD_COLS,
  CARD_ROWS,
  type AsciiCard,
} from "./ascii-card.js";
import type { Orientation } from "../voice/voice-table.js";

const NUM_RUNS = 200;

// --- Arbitraries -------------------------------------------------------------

/** The full Deck_Card_Set: every registered CardId. */
const CARD_IDS: readonly CardId[] = CardIdSchema.options;
const CARD_ID_SET: ReadonlySet<string> = new Set(CARD_IDS);

/** A registered CardId drawn from the Deck_Card_Set. */
const arbCardId: fc.Arbitrary<CardId> = fc.constantFrom(...CARD_IDS);

/** Either orientation. */
const arbOrientation: fc.Arbitrary<Orientation> = fc.constantFrom(
  "upright",
  "reversed",
);

/**
 * An arbitrary spread position label, including the empty string and labels far
 * wider than the inner block, so frame-size invariance is exercised with the
 * footer label present (task 23.2).
 */
const arbFooterLabel: fc.Arbitrary<string> = fc.string({ maxLength: 60 });

/**
 * An arbitrary string that is NOT a member of the Deck_Card_Set, so it exercises
 * the closed-set error path. Empty strings are excluded so the id is always a
 * concrete non-member.
 */
const arbNonMemberId: fc.Arbitrary<string> = fc
  .string()
  .filter((s) => s.length > 0 && !CARD_ID_SET.has(s));

// --- Helpers -----------------------------------------------------------------

/** Measure a row's width in code points, matching the frame-size contract. */
function rowWidth(row: string): number {
  return [...row].length;
}

/** Structural equality of two cards by all surfaced fields. */
function sameCard(a: AsciiCard, b: AsciiCard): boolean {
  if (a.cardId !== b.cardId) return false;
  if (a.orientation !== b.orientation) return false;
  if (a.accessibleText !== b.accessibleText) return false;
  if (a.rows.length !== b.rows.length) return false;
  return a.rows.every((row, i) => row === b.rows[i]);
}

// --- Property 3: determinism -------------------------------------------------

describe("P3 (R3.9): ascii card determinism", () => {
  it("renders an equal card for the same id and orientation (R3.9)", () => {
    fc.assert(
      fc.property(arbCardId, arbOrientation, (cardId, orientation) => {
        const first = asciiCard(cardId, orientation);
        const second = asciiCard(cardId, orientation);
        expect(sameCard(first, second)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 4: frame-size invariance ---------------------------------------

describe("P4 (R3.3, R3.12): ascii card frame-size invariance", () => {
  it("renders exactly CARD_ROWS rows for every card and orientation (R3.3)", () => {
    fc.assert(
      fc.property(arbCardId, arbOrientation, (cardId, orientation) => {
        const card = asciiCard(cardId, orientation);
        expect(card.rows.length).toBe(CARD_ROWS);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("renders every row exactly CARD_COLS columns wide (R3.3, R3.12)", () => {
    fc.assert(
      fc.property(arbCardId, arbOrientation, (cardId, orientation) => {
        const card = asciiCard(cardId, orientation);
        for (const row of card.rows) {
          expect(rowWidth(row)).toBe(CARD_COLS);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("keeps the frame size for any footer position label, however wide (R3.3, R4.6)", () => {
    fc.assert(
      fc.property(
        arbCardId,
        arbOrientation,
        arbFooterLabel,
        (cardId, orientation, footerLabel) => {
          const card = asciiCard(cardId, orientation, {}, footerLabel);
          expect(card.rows.length).toBe(CARD_ROWS);
          for (const row of card.rows) {
            expect(rowWidth(row)).toBe(CARD_COLS);
          }
          // The orientation word always remains in the footer panel.
          expect(card.rows[CARD_ROWS - 2]).toContain(
            orientation.toUpperCase(),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// --- Property 5: complete and closed -----------------------------------------

describe("P5 (R3.2, R3.10): ascii card set complete and closed", () => {
  it("renders a card for every Deck_Card_Set member in both orientations (R3.2)", () => {
    fc.assert(
      fc.property(arbCardId, arbOrientation, (cardId, orientation) => {
        const card = asciiCard(cardId, orientation);
        expect(card.cardId).toBe(cardId);
        expect(card.orientation).toBe(orientation);
        expect(card.rows.length).toBe(CARD_ROWS);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("throws a typed NecroError for any non-member id (R3.10)", () => {
    fc.assert(
      fc.property(arbNonMemberId, arbOrientation, (badId, orientation) => {
        let thrown: unknown;
        try {
          // The bad id is intentionally outside the CardId type here.
          asciiCard(badId as CardId, orientation);
        } catch (err) {
          thrown = err;
        }
        expect(thrown).toBeInstanceOf(NecroError);
        expect((thrown as NecroError).code).toBe("CARD_UNKNOWN");
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
