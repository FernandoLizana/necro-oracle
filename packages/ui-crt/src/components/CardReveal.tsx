"use client";

// src/components/CardReveal.tsx
//
// Feature: visual-necromancy, task 16.1.
//
// `CardReveal` is the decorative card layer of a reading: it draws one framed
// ASCII tarot card per drawn position, in the Reading's exact order, over the
// already-mounted terminal. Each position starts as the single shared
// `Card_Back` and flips to its `AsciiCard` once the one-by-one reveal reaches
// it; the card then carries `glitchProfile(severity)` in full motion. The
// typewritten diagnosis itself is NOT drawn here — it stays in the authoritative
// `role="log"` region (rendered by `renderReading`, driven by the reused
// `useReveal`), so the Live_Region announces each card exactly once (design D1,
// R4.7, R10.1). This whole layer is therefore `aria-hidden`: it is a visual
// flourish over the log, never a second copy of the card text for assistive
// technology.
//
// Order and fidelity (R4.6, R12.1, R12.2): the cards render in the spread order
// the Reading produced, with no reorder/add/omit — `visualCards` already strips
// only void positions and preserves order. An empty spread draws nothing and
// raises no error (R4.8).
//
// Reveal timing (R4.1, R4.2, R4.4): in full motion a position is face-up once
// `flippedCount` has reached it; before that it shows the Card_Back. In reduced
// motion the reducer seeds `flippedCount` to the full count, so every card is
// face-up in one render with no flip. Escape marks every card flipped (R4.5),
// which lands here as every position face-up.
//
// _Requirements: R4.1, R4.2, R4.4, R4.6, R4.7, R4.8, R10.1, R12.1, R12.2_

import { useMemo } from "react";

import type { MotionMode } from "../motion/motion-mode.js";
import { glitchProfile } from "../motion/glitch.js";
import {
  asciiCard,
  asciiCardBack,
  type CardArtTable,
} from "../render/ascii-card.js";
import type { VisualCard } from "../session/visual-reading.js";
import { AsciiCardView } from "./AsciiCardView.js";

/** Props for the decorative card-reveal layer. */
export interface CardRevealProps {
  /** The drawn cards of the current reading, in spread order (may be empty). */
  readonly cards: readonly VisualCard[];
  /** How many positions have finished flipping face-up (R4.1). */
  readonly flippedCount: number;
  /** The effective Motion_Mode; `reduced` suppresses all glitch effects. */
  readonly motionMode: MotionMode;
  /**
   * The lazily-loaded per-CardId illustration table. Defaults to an empty table
   * so the first render (before the art chunk resolves) draws the generic motif
   * and the card layer never blocks on the lazy chunk (R11.4).
   */
  readonly art?: CardArtTable;
}

/** The single shared Card_Back frame, built once (identical at every position). */
const CARD_BACK_ROWS = asciiCardBack();

/**
 * Draw the decorative framed cards of a reading over the terminal. Face-down
 * positions show the shared Card_Back; face-up positions show the card's
 * `AsciiCard` with its severity glitch (full motion only). Renders nothing for
 * an empty reading (R4.8). The whole region is `aria-hidden` — the log owns the
 * announced card text (R4.7, R10.1).
 */
export function CardReveal({
  cards,
  flippedCount,
  motionMode,
  art = {},
}: CardRevealProps): React.JSX.Element | null {
  // Build the face AsciiCards once per reading/art change; the Card_Back is a
  // shared constant. `asciiCard` is pure and falls back to the generic motif
  // for any CardId the (possibly not-yet-loaded) art table lacks.
  const faces = useMemo(
    () => cards.map((card) => asciiCard(card.draw.card, card.draw.orientation, art)),
    [cards, art],
  );

  if (cards.length === 0) return null;

  return (
    <div className="crt-card-reveal" aria-hidden="true">
      {cards.map((card, index) => {
        // In full motion a position is face-up once the one-by-one reveal has
        // reached it; in reduced motion `flippedCount` is the full count, so
        // every position is already face-up (R4.1, R4.4).
        const flipped = index < flippedCount;
        return (
          <div
            key={card.position}
            className="crt-card-slot"
            data-position={card.position}
            data-flipped={flipped ? "true" : "false"}
          >
            {flipped ? (
              <AsciiCardView
                card={faces[index]!}
                glitch={glitchProfile(card.draw.severity)}
                motionMode={motionMode}
              />
            ) : (
              <pre className="crt-ascii-card-art crt-card-back">
                {CARD_BACK_ROWS.join("\n")}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
