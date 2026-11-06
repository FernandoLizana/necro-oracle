// Unit tests for the Vitality_Delta / changed-card renderer (task 14.10).
//
// Validates: Requirements R6.3, R6.4, R6.5
//
// `renderResurrectVitality` turns the vitality fields of a resurrection
// `RitualResult` (mirrored browser-safe as `VitalityResult`) into one oracle
// block. These examples cover the three required shapes:
//  - a positive delta (after > before) with the signed "+N" and at least one
//    improved changed card rendered (R6.3, R6.4);
//  - a zero delta and a negative delta, both shown with the signed form
//    ("0" / "-N") (R6.3);
//  - the null case (re-diagnosis incomplete): `afterVitality`/`vitalityDelta`
//    null renders the re-diagnosis-incomplete line and NO delta and NO changed
//    cards (R6.5);
//  - an empty changed-card set renders the "unmoved" line (R6.4).
//
// Every assertion also checks the oracle-voice invariants the steering fixes:
// each emitted line is ASCII-only and within the 72-column budget, inspected
// through the public `blockText`/`lineText` flatteners.

import { describe, expect, it } from "vitest";

import type { VitalityResult } from "../protocol.js";
import { LINE_WIDTH } from "../text/wrap.js";
import { blockText, lineText, type BlockDraft } from "./blocks.js";
import { renderResurrectVitality } from "./resurrect-vitality.js";

/** Printable-ASCII (0x20..0x7E) plus newline — the oracle-voice character set. */
const NON_ASCII = /[^\n\x20-\x7e]/u;

/** Assert the block is pure oracle voice: ASCII-only and <= 72 columns/line. */
function assertOracleVoice(block: BlockDraft): void {
  // No control, high-bit, or multi-byte glyph survives into the flattened text.
  expect(blockText(block)).not.toMatch(NON_ASCII);
  // Every physical line fits the phosphor column budget, measured in code
  // points (not UTF-16 units) so a surrogate pair counts as one column.
  for (const line of block.lines) {
    expect([...lineText(line)].length).toBeLessThanOrEqual(LINE_WIDTH);
  }
}

describe("renderResurrectVitality (R6.3, R6.4, R6.5)", () => {
  it("renders a positive delta with the signed +N and an improved card (R6.3, R6.4)", () => {
    const result: VitalityResult = {
      beforeVitality: 30,
      afterVitality: 44,
      vitalityDelta: 14,
      changedCards: [
        { card: "judgement", change: "removed", improved: true },
        { card: "hanged_man", change: "severity", improved: true },
      ],
    };

    const block = renderResurrectVitality(result);
    const text = blockText(block);

    // The before -> after transition carries the signed delta "+14" (R6.3).
    expect(text).toContain("30/100");
    expect(text).toContain("44/100");
    expect(text).toContain("+14");

    // At least one improved changed card is named with a "better" verdict (R6.4).
    expect(text.toUpperCase()).toContain("JUDGEMENT");
    expect(text).toContain("better");

    assertOracleVoice(block);
  });

  it("renders a zero delta with the signed 0 (R6.3)", () => {
    const result: VitalityResult = {
      beforeVitality: 50,
      afterVitality: 50,
      vitalityDelta: 0,
      changedCards: [],
    };

    const block = renderResurrectVitality(result);
    const text = blockText(block);

    // A zero delta prints as "(0)", never "+0" or "-0".
    expect(text).toContain("(0)");
    expect(text).not.toContain("+0");
    expect(text).not.toContain("-0");

    assertOracleVoice(block);
  });

  it("renders a negative delta with the signed -N (R6.3)", () => {
    const result: VitalityResult = {
      beforeVitality: 60,
      afterVitality: 57,
      vitalityDelta: -3,
      changedCards: [{ card: "tower", change: "added", improved: false }],
    };

    const block = renderResurrectVitality(result);
    const text = blockText(block);

    expect(text).toContain("60/100");
    expect(text).toContain("57/100");
    // The signed form keeps the leading "-" for a worsening delta.
    expect(text).toContain("-3");
    // A non-improving change is marked "worse".
    expect(text).toContain("worse");

    assertOracleVoice(block);
  });

  it("renders the incomplete line and NO delta/cards when re-diagnosis failed (R6.5)", () => {
    const result: VitalityResult = {
      beforeVitality: 41,
      afterVitality: null,
      vitalityDelta: null,
      // A non-empty set here must still be suppressed: when re-diagnosis
      // failed the renderer lists no changed cards at all (R6.5).
      changedCards: [{ card: "judgement", change: "removed", improved: true }],
    };

    const block = renderResurrectVitality(result);
    const text = blockText(block);

    // The before-vitality is preserved and named as held.
    expect(text).toContain("41/100");
    // A re-diagnosis-incomplete line stands in for the delta.
    expect(text.toLowerCase()).toContain("re-diagnosis incomplete");

    // No signed delta of any form and no "VITALITY a -> b" transition line.
    expect(text).not.toMatch(/->/u);
    expect(text).not.toMatch(/[+-]\d/u);

    // No changed-card line survives: the (better)/(worse) verdicts never appear
    // and the suppressed card name is not rendered.
    expect(text).not.toContain("better");
    expect(text).not.toContain("worse");
    expect(text.toUpperCase()).not.toContain("JUDGEMENT");

    assertOracleVoice(block);
  });

  it("renders the unmoved line for an empty changed-card set (R6.4)", () => {
    const result: VitalityResult = {
      beforeVitality: 70,
      afterVitality: 75,
      vitalityDelta: 5,
      changedCards: [],
    };

    const block = renderResurrectVitality(result);
    const text = blockText(block);

    // The delta is still rendered...
    expect(text).toContain("+5");
    // ...but with no cards, the spread is reported as unmoved and no verdicts
    // are listed.
    expect(text.toLowerCase()).toContain("unmoved");
    expect(text).not.toContain("better");
    expect(text).not.toContain("worse");

    assertOracleVoice(block);
  });

  it("is pure: the same result always yields the same block", () => {
    const result: VitalityResult = {
      beforeVitality: 20,
      afterVitality: 38,
      vitalityDelta: 18,
      changedCards: [{ card: "wheel", change: "orientation", improved: true }],
    };

    expect(renderResurrectVitality(result)).toStrictEqual(
      renderResurrectVitality(result),
    );
  });
});
