// @necro/ui-crt — ASCII_Card_Renderer and Card_Back (task 2.1, pure).
//
// Validates: Requirements R3.1, R3.2, R3.3, R3.5, R3.8, R3.10, R3.12, R4.3
//
// `asciiCard(cardId, orientation, art)` maps a registered CardId and an
// orientation to a framed ASCII tarot card: a box-drawing border enclosing the
// roman numeral row, the uppercase card name row, a per-card illustration
// block, and a thin divider (R3.1). Every card — upright and reversed —
// produces exactly `CARD_ROWS × CARD_COLS` glyphs so all twelve cards share one
// outer frame size (R3.3, R3.12). Names, numerals and verdict words are
// uppercase and no emoji is emitted (R3.5). The numeral and name come from
// `getCard(cardId)` in `@necro/oracle/client`; an id outside the Deck_Card_Set
// raises a typed `NecroError` with `code: "CARD_UNKNOWN"` and an Oracle_Voice
// `userMessage` rather than a partial or blank card (R3.2, R3.10).
//
// The renderer is pure and synchronous: it performs no clock, network, DOM or
// unseeded-random access (R3.8), and it accepts the loaded illustration table
// (`ascii-art.ts`, task 2.2) as an argument instead of importing it, so this
// module stays free of the lazy art chunk. The renderer always emits the frame
// in normal reading order; the visual 180° flip for `reversed` is applied by
// `AsciiCardView` in CSS. Orientation is still recorded here in `accessibleText`
// and surfaced to the view so the two orientations are distinct at the data
// level (R3.12). `asciiCardBack()` builds the single shared Card_Back frame —
// the same box filled with one repeating sigil glyph, identical at every
// position (R4.3).

import { getCard, type CardId } from "@necro/oracle/client";
import { NecroError } from "@necro/oracle/client";

import type { Orientation } from "../voice/voice-table.js";

/** Fixed outer frame size shared by every card in both orientations. */
export const CARD_COLS = 24; // outer columns incl. border
export const CARD_ROWS = 13; // outer rows incl. border

/** Inner content width (between the two vertical border glyphs). */
const INNER_COLS = CARD_COLS - 2; // 22

/** The number of illustration rows in a card's inner block. */
export const ART_ROWS = 6;

/** The glyph tiled across every cell of the Card_Back (R4.3). */
const CARD_BACK_SIGIL = "+";

// Box-drawing glyphs for the frame (ASCII-safe Unicode, no emoji).
const TOP_LEFT = "\u250c"; // ┌
const TOP_RIGHT = "\u2510"; // ┐
const BOTTOM_LEFT = "\u2514"; // └
const BOTTOM_RIGHT = "\u2518"; // ┘
const VERTICAL = "\u2502"; // │
const HORIZONTAL = "\u2500"; // ─
const TEE_LEFT = "\u251c"; // ├
const TEE_RIGHT = "\u2524"; // ┤

/**
 * The illustration table shape this renderer consumes. It mirrors the `CardArt`
 * exported by `render/ascii-art.ts` (task 2.2) but is declared here so the
 * renderer does not depend on that module's implementation existing: the caller
 * passes the loaded table in. Each card maps to an `upright` illustration and an
 * optional distinct `reversed` variant.
 */
export interface CardArt {
  /** Illustration rows for the upright orientation. */
  readonly upright: readonly string[];
  /** Optional distinct illustration rows for the reversed orientation. */
  readonly reversed?: readonly string[];
}

/** The loaded per-CardId illustration table passed to the renderer. */
export type CardArtTable = Readonly<Partial<Record<CardId, CardArt>>>;

/** A framed ASCII tarot card: exactly `CARD_ROWS` rows of `CARD_COLS` glyphs. */
export interface AsciiCard {
  readonly cardId: CardId;
  readonly orientation: Orientation; // 'upright' | 'reversed'
  /** The framed glyph rows: exactly CARD_ROWS rows, each exactly CARD_COLS. */
  readonly rows: readonly string[];
  /** Accessible text equivalent, e.g. "XVI THE TOWER, upright". */
  readonly accessibleText: string;
}

/**
 * Center `text` within `width` columns, truncating from the right when it is
 * too long so the field is always exactly `width` columns. Deterministic.
 */
function center(text: string, width: number): string {
  const clipped = text.length > width ? text.slice(0, width) : text;
  const total = width - clipped.length;
  const left = Math.floor(total / 2);
  const right = total - left;
  return " ".repeat(left) + clipped + " ".repeat(right);
}

/** Pad or clip `text` to exactly `width` columns (left-aligned). */
function fit(text: string, width: number): string {
  if (text.length === width) return text;
  if (text.length > width) return text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

/** Wrap a fitted inner line between the vertical border glyphs. */
function framed(inner: string): string {
  return VERTICAL + fit(inner, INNER_COLS) + VERTICAL;
}

/** A full-width horizontal border row with the given corner glyphs. */
function border(left: string, right: string): string {
  return left + HORIZONTAL.repeat(INNER_COLS) + right;
}

/**
 * Pick the illustration rows for a card/orientation from the loaded table,
 * falling back to the table's own generic entry only when present. The result
 * is always normalised to exactly `ART_ROWS` rows of `INNER_COLS` columns, so a
 * missing, short, or oversized illustration can never break the frame size.
 */
function illustrationRows(
  cardId: CardId,
  orientation: Orientation,
  art: CardArtTable,
): string[] {
  const entry = art[cardId];
  const source: readonly string[] =
    orientation === "reversed" && entry?.reversed !== undefined
      ? entry.reversed
      : (entry?.upright ?? []);

  const rows: string[] = [];
  for (let i = 0; i < ART_ROWS; i++) {
    rows.push(fit(source[i] ?? "", INNER_COLS));
  }
  return rows;
}

/**
 * Render the framed ASCII card for a registered CardId and orientation.
 *
 * The frame, top to bottom: top border, the roman numeral row, the uppercase
 * card name row, a thin divider, `ART_ROWS` illustration rows, a thin divider,
 * and the bottom border — exactly `CARD_ROWS` rows of `CARD_COLS` glyphs.
 *
 * @param art The loaded illustration table (see `render/ascii-art.ts`). Pass an
 *   empty object for a frame with a blank illustration block.
 * @throws NecroError('CARD_UNKNOWN') when `cardId` is not a member of the
 *   Deck_Card_Set, rather than rendering a partial or blank card (R3.10).
 */
export function asciiCard(
  cardId: CardId,
  orientation: Orientation,
  art: CardArtTable = {},
): AsciiCard {
  const def = lookupCard(cardId);
  const numeral = def.numeral.toUpperCase();
  const name = def.name.toUpperCase();

  const rows: string[] = [];
  rows.push(border(TOP_LEFT, TOP_RIGHT)); // 0: top border
  rows.push(framed(center(numeral, INNER_COLS))); // 1: roman numeral
  rows.push(framed(center(name, INNER_COLS))); // 2: card name
  rows.push(border(TEE_LEFT, TEE_RIGHT)); // 3: divider
  for (const line of illustrationRows(cardId, orientation, art)) {
    rows.push(framed(line)); // 4..9: illustration block (ART_ROWS)
  }
  rows.push(border(TEE_LEFT, TEE_RIGHT)); // 10: divider
  rows.push(framed("")); // 11: footer spacer
  rows.push(border(BOTTOM_LEFT, BOTTOM_RIGHT)); // 12: bottom border

  return {
    cardId,
    orientation,
    rows,
    accessibleText: `${numeral} ${name}, ${orientation}`,
  };
}

/**
 * Resolve a CardId to its registry definition, re-raising an unknown id as a
 * typed `NecroError('CARD_UNKNOWN')` in the Oracle_Voice. `getCard` itself
 * throws `CARD_NOT_FOUND`; this renderer's contract (R3.10) names its own
 * `CARD_UNKNOWN` code and message, so the lookup is guarded explicitly rather
 * than letting `getCard`'s error surface. `CARD_UNKNOWN` is a renderer-local
 * code outside the shared `NecroErrorCode` enum, so it is cast in at the single
 * construction site — the same pattern the codebase uses for staged codes.
 */
function lookupCard(cardId: CardId): ReturnType<typeof getCard> {
  try {
    return getCard(cardId);
  } catch {
    throw new NecroError(
      "CARD_UNKNOWN" as never,
      "The deck holds no such card. (Unknown card id.)",
    );
  }
}

/**
 * Build the single shared Card_Back frame (R4.3): the same `CARD_COLS × CARD_ROWS`
 * box as every ASCII card, its inner block filled with one repeating sigil glyph
 * so every face-down position renders an identical frame. Pure and deterministic.
 */
export function asciiCardBack(): readonly string[] {
  const rows: string[] = [];
  rows.push(border(TOP_LEFT, TOP_RIGHT));
  const fill = CARD_BACK_SIGIL.repeat(INNER_COLS);
  for (let i = 0; i < CARD_ROWS - 2; i++) {
    rows.push(framed(fill));
  }
  rows.push(border(BOTTOM_LEFT, BOTTOM_RIGHT));
  return rows;
}
