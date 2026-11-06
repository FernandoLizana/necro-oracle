// src/session/visual-reading.ts
//
// Feature: visual-necromancy, task 16.1.
//
// Pure selectors that turn the current `SessionState` into the data the
// Visual_Layer card overlay draws, without the view reaching into the reducer.
// They mirror exactly how the reducer resolves the reading `read`/`explain`
// render from (`currentReading`): a demo session reads the loaded bundle entry
// for the last spread, a live session reads the held reading for the last
// spread. The authoritative per-card text already lives in the `role="log"`
// region (rendered by `renderReading`, design D1); these selectors only expose
// the drawn CardDraws so `AsciiCardView` can draw the decorative framed card
// over the terminal in the Reading's exact order (R4.6, R12.2).
//
// This module is pure: it reads `SessionState` only. No clock, network, DOM or
// unseeded randomness.
//
// _Requirements: R4.1, R4.6, R12.1, R12.2_

import type { CardDraw, SpreadPosition } from "@necro/oracle/client";

import type { PlayableSpread, ReadingResponse } from "../protocol.js";
import type { SessionState } from "./state.js";
import { isDemoSession } from "./demo-seed.js";

/**
 * One drawn position of the current reading, surfaced for the card overlay. It
 * carries the 1-based spread `position`, the position `label`, and the
 * non-null `draw` (card id, orientation, severity) exactly as received — the
 * overlay renders it in place, never reordering, adding or omitting a position
 * (R4.6, R12.2).
 */
export interface VisualCard {
  readonly position: number;
  readonly label: string;
  readonly draw: CardDraw;
}

/**
 * The `ReadingResponse` the current session would render a card overlay from:
 * the demo bundle entry for the last spread on a demo session, or the held
 * live reading for the last spread otherwise. `null` when no reading is in
 * scope — mirrors the reducer's `currentReading` resolution so the overlay and
 * the log always agree on which reading is shown.
 */
export function currentVisualReading(
  state: SessionState,
): ReadingResponse | null {
  const spread = state.lastSpread;
  if (spread === null) return null;
  return readingForSpread(state, spread) ?? null;
}

/** Resolve the in-scope reading for an explicit spread (demo or live). */
function readingForSpread(
  state: SessionState,
  spread: PlayableSpread,
): ReadingResponse | undefined {
  if (
    isDemoSession(state) &&
    state.demoBundle !== null &&
    state.pendingDemo !== null
  ) {
    return state.demoBundle[state.pendingDemo]?.[spread];
  }
  return state.readings[spread];
}

/**
 * The drawn cards of the current reading, in the Reading's spread order. Void
 * positions (no draw) are skipped — there is no face to frame — but the
 * surviving order and labels are preserved exactly (R4.6, R12.2). Returns an
 * empty array when no reading is in scope or the spread is empty (R4.8), so the
 * overlay renders nothing and raises no error.
 */
export function visualCards(state: SessionState): readonly VisualCard[] {
  const response = currentVisualReading(state);
  if (response === null) return [];
  return drawnPositions(response.reading.spread);
}

/** Keep only the drawn positions of a spread, preserving order. */
function drawnPositions(
  spread: readonly SpreadPosition[],
): readonly VisualCard[] {
  const cards: VisualCard[] = [];
  for (const position of spread) {
    if (position.draw === null) continue;
    cards.push({
      position: position.position,
      label: position.label,
      draw: position.draw,
    });
  }
  return cards;
}
