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

import type { ExplainTarget } from "../command/types.js";
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

/**
 * Resolve an `ExplainTarget` to the index of the matching drawn card within the
 * order-preserving `visualCards` list, or `-1` when no drawn card matches.
 *
 * This is the pure bridge the Terminal uses to decide whether an `explain`
 * command should OPEN the Fullscreen_Card_View (R2.3): a `position` target
 * matches the drawn card at that 1-based spread position, a `card` target
 * matches the first drawn position holding that card id. A target that names a
 * void position, an out-of-range position, or a card absent from the reading
 * resolves to `-1`, so the Terminal leaves the view unchanged and the log's
 * `renderExplain` path still prints the oracle-voice error (R2.4). The lookup
 * is over the SAME `visualCards` list the Spread_View and Fullscreen_Card_View
 * render from, so the opened index always points at the same drawn card the
 * log explains.
 */
export function visualCardIndex(
  cards: readonly VisualCard[],
  target: ExplainTarget,
): number {
  if (target.kind === "position") {
    return cards.findIndex((card) => card.position === target.position);
  }
  return cards.findIndex((card) => card.draw.card === target.card);
}

/**
 * Item 26 (CORRECTED): THE LOVERS (VI) is NOT a diagnosis card -- the oracle
 * `CardId` enum is the 12 diagnosis cards and deliberately has NO "lovers"
 * member (a reading carrying `card: "lovers"` fails `CardDrawSchema` and the
 * client/server reject the whole reading). The bindability signal is instead
 * the DRAW'S GRIMOIRE LINKAGE: a draw whose `grimoires` includes the Lovers
 * grimoire id ("lovers-js") marks a repo the Lovers binding can address. That
 * field is `z.array(z.string())` on every draw, so the signal rides on a LEGAL
 * card (no new card id, no schema change). Matched here as a pure, total scan.
 */
const LOVERS_GRIMOIRE_ID = "lovers-js";

/**
 * The card id JUDGEMENT carries in the deck. JUDGEMENT is the resurrection
 * summons - it is drawn exactly when the reading found Python-2 constructs
 * (resurrectable candidates), so its presence is the client signal that a
 * `resurrect` can be offered (item 4). Matched as a widened string so the
 * comparison stays pure and total.
 */
const JUDGEMENT_CARD_ID = "judgement";

/**
 * Item 4 (guided buttons): is a `resurrect` affordance eligible right now? True
 * WHEN the in-scope reading drew JUDGEMENT (Python-2 candidates exist, so a bare
 * `resurrect` has something to raise). Pure: reads SessionState only. The
 * authoritative server precondition (R1.6) still owns the final decision and
 * terminates with a typed error when nothing is resurrectable - this selector
 * only decides whether to OFFER the clickable RESURRECT chip (every typed
 * command also clickable, tarot-ux), never whether the ritual will succeed.
 */
export function resurrectEligible(state: SessionState): boolean {
  return visualCards(state).some(
    (card) => (card.draw.card as string) === JUDGEMENT_CARD_ID,
  );
}

/**
 * The lovers-binding eligibility signal the Terminal gates the `lovers <file>
 * js` chip + hint on (lovers-binding R14.3): the pure answer to "WHILE THE
 * LOVERS (VI) was drawn AND the file is resurrectable". It reads `SessionState`
 * only — no clock, DOM, network — and returns:
 *
 *   - `null` when THE LOVERS was not drawn in the current reading, OR no
 *     resurrectable file is in scope. The chip/hint is NOT offered.
 *   - `{ file }` when THE LOVERS was drawn AND a resurrectable Python file is in
 *     scope, carrying that file's path so the Terminal can prefill `lovers
 *     <file> ` exactly as SUMMON prefills `summon ` (R14.3).
 *
 * "The file is resurrectable" is derived from the most recent completed
 * resurrection (`state.lastRitual`): the Lovers pipeline binds the RESURRECTED
 * Python 3 source, so a file that has already been resurrected is the file a
 * binding can act on. The first resurrected file path is surfaced as the
 * prefill target; when the deck's `lovers` card + detector land, a drawn LOVERS
 * over a resurrected file immediately lights the chip with no further wiring.
 *
 * SEAM: the authoritative server gate (R14.4) still owns the final
 * resurrectable check and terminates with a typed `VALIDATION_FAILED`
 * oracle-voice error when THE LOVERS was not drawn OR the file has no bindable
 * top-level functions — this client selector only decides whether to OFFER the
 * affordance, never whether the binding will succeed.
 */
export function loversEligible(
  state: SessionState,
): { readonly file: string } | null {
  const loversDrawn = visualCards(state).some((card) =>
    // Defensive `?? []`: a partial/legacy draw may omit `grimoires`; absent
    // means not Lovers-linked, never a crash.
    (card.draw.grimoires ?? []).includes(LOVERS_GRIMOIRE_ID),
  );
  if (!loversDrawn) return null;

  const ritual = state.lastRitual;
  if (ritual === null) return null;
  const file = ritual.files[0];
  if (file === undefined) return null;

  return { file: file.path };
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
