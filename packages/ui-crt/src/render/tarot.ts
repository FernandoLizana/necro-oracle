// src/render/tarot.ts
//
// Pure render helper for a tarot reading (judge-ready-pass items 31-33).
//
// Turns a drawn Past/Present/Future spread plus a `TarotReading` text into the
// terminal's line-oriented form: a header, one labelled card line per position
// (numeral, NAME, orientation, mystical meaning), the three reading paragraphs,
// and the one-line verdict. Pure: no DOM, clock, RNG, or network. The reducer
// wraps the result in an oracle block; the animated reveal (item 31) consumes
// the same per-card lines.

import {
  getTarotCard,
  type TarotDraw,
  type TarotReading,
} from "@necro/oracle/client";

/** Title-case a position id ("past" -> "Past"). */
function positionLabel(position: string): string {
  return position.charAt(0).toUpperCase() + position.slice(1);
}

/** One header + card line per drawn position (used by the reveal, item 31). */
export function tarotCardLines(draw: TarotDraw): readonly string[] {
  return draw.cards.map((c) => {
    const card = getTarotCard(c.cardId);
    const meaning = c.orientation === "upright" ? card.upright : card.reversed;
    const orient = c.orientation === "upright" ? "upright" : "reversed";
    return `${positionLabel(c.position)} - ${card.numeral} ${card.name.toUpperCase()} (${orient}): ${meaning}`;
  });
}

/**
 * Render a full tarot reading to a single multi-line string for the terminal
 * oracle block: the ceremonial header, the three card lines, a blank line, the
 * three reading paragraphs, a blank line, and the verdict.
 */
export function renderTarotReading(
  draw: TarotDraw,
  reading: TarotReading,
): string {
  const header = "The cards are cut. Past, Present, Future.";
  const cards = tarotCardLines(draw);
  const paragraphs = reading.paragraphs;
  const verdict = `VERDICT: ${reading.verdict}`;
  return [header, ...cards, "", ...paragraphs, "", verdict].join("\n");
}


/**
 * The ordered blocks of the CEREMONIAL tarot reveal (judge-ready-pass item 31).
 *
 * Each returned string becomes its own terminal block, so the shell's existing
 * reveal queue deals + types them ONE BY ONE in full motion and renders them
 * all at once in reduced motion / Escape (the same typewriter machinery the
 * diagnosis reading uses). The sequence is:
 *   1. the shuffle/cut opener (the oracle-voice pre-reading phrase),
 *   2. one block PER CARD: the dealt card line (numeral + NAME + orientation)
 *      followed by its single Seer line (the card's mystical meaning, <=16
 *      words), revealed as the card "flips" face-up,
 *   3. the three reading paragraphs, then the one-line VERDICT.
 *
 * Pure: no DOM, clock, RNG, audio or network.
 */
export function tarotRevealBlocks(
  draw: TarotDraw,
  reading: TarotReading,
): readonly string[] {
  const blocks: string[] = [];
  // 1. Shuffle + cut, cards dealt face-down (the ceremonial opener).
  blocks.push("Shuffle. Cut. Three cards fall face-down in the dark.");
  // 2. One block per card: the flip line + its Seer line.
  for (const c of draw.cards) {
    const card = getTarotCard(c.cardId);
    const meaning = c.orientation === "upright" ? card.upright : card.reversed;
    const orient = c.orientation === "upright" ? "upright" : "reversed";
    const header = `${positionLabel(c.position)} - ${card.numeral} ${card.name.toUpperCase()} (${orient})`;
    // The Seer speaks one short line as the card turns face-up (<=16 words).
    blocks.push([header, meaning].join("\n"));
  }
  // 3. The reading, typed paragraph by paragraph, then the verdict.
  for (const paragraph of reading.paragraphs) blocks.push(paragraph);
  blocks.push(`VERDICT: ${reading.verdict}`);
  return blocks;
}
