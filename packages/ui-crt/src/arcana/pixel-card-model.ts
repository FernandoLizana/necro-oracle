// Pure module: pixel-card model for @necro/ui-crt (Arcana_Visions, task 6.1).
//
// Validates: Requirements R1.6, R1.7, R2.9, R5.1, R5.2, R10.1
//
// `pixelCardModel` is a total, pure function: it reads no clock, DOM, network,
// or audio. It maps a Spec 05 `VisualCard` (which carries the oracle `CardDraw`
// plus the spread position label) into the display model `PixelCard` renders —
// the Roman numeral and uppercase title for the header band (R1.6), the
// position label for the footer band, the one-line Diagnosis_Caption shown
// below the image (R1.7), the Severity that flows unchanged into the glitch
// contract (R5.1, R5.2), and the screen-reader alt text (R10.1).
//
// No display data is invented here. The numeral and name come from the oracle
// `CARD_REGISTRY`; the one-line meaning reuses the `VOICE_TABLE` mystical line
// (already ≤ 72 columns and Oracle_Voice compliant). Reversed orientation flows
// through unchanged so the view can rotate the image while keeping this text
// upright (R2.9).

import { CARD_REGISTRY, type CardId } from "@necro/oracle/client";

import { VOICE_TABLE, type Orientation } from "../voice/voice-table.js";
import type { VisualCard } from "../session/visual-reading.js";

/** The longest alt-text meaning clause allowed, measured in code points (R10.1). */
const ALT_MEANING_MAX = 120;

/** The display model one Pixel_Card renders from a drawn card. */
export interface PixelCardModel {
  /** The drawn card's id. */
  readonly card: CardId;
  /** Orientation: `"upright"` (active) or `"reversed"` (latent/partial). */
  readonly orientation: Orientation;
  /** The spread position label, e.g. `"III · THE SHADOW"` (footer band). */
  readonly positionLabel: string;
  /** The card's Roman numeral, e.g. `"XVI"` (header band). */
  readonly numeral: string;
  /** The card's display name in uppercase, e.g. `"THE TOWER"` (header band). */
  readonly title: string;
  /** The 0–3 diagnosis severity, passed straight to the glitch contract. */
  readonly severity: 0 | 1 | 2 | 3;
  /** The one-line Diagnosis_Caption shown below the image (≤ 72 cols). */
  readonly caption: string;
  /** `"<Name>, <upright|reversed> — <one-line meaning ≤ 120 chars>"` (R10.1). */
  readonly altText: string;
}

/** Truncate `text` to at most `max` code points, keeping surrogate pairs whole. */
function clampCodePoints(text: string, max: number): string {
  const points = [...text];
  return points.length <= max ? text : points.slice(0, max).join("");
}

/**
 * The one-line meaning for a card and orientation: the `VOICE_TABLE` mystical
 * line, clamped to `ALT_MEANING_MAX` code points for the alt-text clause.
 */
function oneLineMeaning(card: CardId, orientation: Orientation): string {
  return clampCodePoints(VOICE_TABLE[card][orientation], ALT_MEANING_MAX);
}

/**
 * Alt text per R10.1: the card name, the orientation stated as `"upright"` or
 * `"reversed"`, and a one-line meaning of at most 120 characters, joined as
 * `"<Name>, <orientation> — <meaning>"`. Pure; reuses `CARD_REGISTRY` for the
 * name and `VOICE_TABLE` for the meaning, inventing no display data.
 */
export function cardAltText(card: CardId, orientation: Orientation): string {
  const name = CARD_REGISTRY.get(card)?.name ?? card;
  return `${name}, ${orientation} — ${oneLineMeaning(card, orientation)}`;
}

/**
 * Build the display model from a Spec 05 `VisualCard`. Pure: `numeral`/`title`
 * come from `CARD_REGISTRY`, `caption` reuses the `VOICE_TABLE` line, and
 * `severity`/`orientation` flow through unchanged for the glitch and rotation
 * contracts (R2.9, R5.1, R5.2).
 */
export function pixelCardModel(card: VisualCard): PixelCardModel {
  const { draw, label } = card;
  const definition = CARD_REGISTRY.get(draw.card);
  return {
    card: draw.card,
    orientation: draw.orientation,
    positionLabel: label,
    numeral: definition?.numeral ?? "",
    title: (definition?.name ?? draw.card).toUpperCase(),
    severity: draw.severity,
    caption: VOICE_TABLE[draw.card][draw.orientation],
    altText: cardAltText(draw.card, draw.orientation),
  };
}
