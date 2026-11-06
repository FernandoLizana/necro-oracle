// Vitality_Delta and changed-card renderer for @necro/ui-crt (task 14.9).
//
// Validates: Requirements R6.3, R6.4, R6.5, R9.3
//
// `renderResurrectVitality` turns the vitality fields of a resurrection
// `RitualResult` (mirrored browser-safe as `VitalityResult` in `protocol.ts`)
// into a single oracle block: a mystical line, then the before -> after
// vitality with the signed `Vitality_Delta` (e.g. "+14" / "-3" / "0"), then one
// line per changed card naming the card, how its draw changed, and whether that
// change was an improvement. When re-diagnosis failed — `afterVitality` and
// `vitalityDelta` are both `null` (R6.5) — it prints a re-diagnosis-incomplete
// line in place of the delta and skips the changed-card lines.
//
// It reuses the same `vitalityVoice` band phrasing the reading renderer uses
// for its closing block, so the resurrection view narrates vitality in the one
// canonical voice. Pure and deterministic: the same `VitalityResult` always
// yields the same block. All text passes through `sanitizeText` and is wrapped
// to 72 columns, and every line is ASCII-only oracle voice.

import type { ChangedCard, VitalityResult } from "../protocol.js";
import { sanitizeText } from "../text/sanitize.js";
import { wrapText } from "../text/wrap.js";
import { vitalityVoice } from "../voice/phrases.js";
import type { BlockDraft, OutputLine } from "./blocks.js";

/** Build wrapped `OutputLine`s of sanitised plain text. */
function textLines(text: string): OutputLine[] {
  return wrapText(sanitizeText(text)).map((line) => ({
    segments: [{ text: line }],
  }));
}

/** The signed form of a delta: "+14", "-3", or "0" (non-negative keeps "+"). */
function signedDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

/** The human phrasing of how a card's draw changed (technical half). */
const CHANGE_PHRASE: Readonly<Record<ChangedCard["change"], string>> = {
  added: "newly drawn",
  removed: "no longer drawn",
  severity: "severity changed",
  orientation: "orientation changed",
};

/** One changed-card line: `<CARD>  <change>  (better|worse)`. */
function changedCardText(entry: ChangedCard): string {
  const card = entry.card.toUpperCase();
  const change = CHANGE_PHRASE[entry.change];
  const verdict = entry.improved ? "better" : "worse";
  return `${card}  ${change}  (${verdict})`;
}

/**
 * Render the Vitality_Delta and the changed-card set of a resurrection result
 * as a single oracle block (R6.3, R6.4, R6.5, R9.3). When re-diagnosis failed
 * (`afterVitality`/`vitalityDelta` are `null`) a re-diagnosis-incomplete line
 * replaces the delta and no changed cards are listed.
 */
export function renderResurrectVitality(result: VitalityResult): BlockDraft {
  const lines: OutputLine[] = [];

  // Re-diagnosis failed: preserve the before-vitality, name the incomplete
  // re-diagnosis instead of a delta, and list no changed cards (R6.5).
  if (result.afterVitality === null || result.vitalityDelta === null) {
    lines.push(
      ...textLines("The second reading never came; the delta is unknown."),
    );
    lines.push(
      ...textLines(
        `Re-diagnosis incomplete; vitality held at ${result.beforeVitality}/100.`,
      ),
    );
    return { kind: "oracle", demo: false, lines };
  }

  // Mystical band line for the resulting vitality, then the before -> after
  // transition carrying the signed Vitality_Delta (R6.3).
  lines.push(...textLines(vitalityVoice(result.afterVitality)));
  lines.push(
    ...textLines(
      `VITALITY ${result.beforeVitality}/100 -> ${result.afterVitality}/100 ` +
        `(${signedDelta(result.vitalityDelta)}).`,
    ),
  );

  // The changed-card set (R6.4): one line per entry, or a line stating that no
  // card's draw changed when the set is empty.
  if (result.changedCards.length === 0) {
    lines.push(...textLines("No card changed its face; the spread is unmoved."));
  } else {
    lines.push(...textLines("The spread shifts. These cards changed:"));
    for (const entry of result.changedCards) {
      lines.push(...textLines(changedCardText(entry)));
    }
  }

  return { kind: "oracle", demo: false, lines };
}
