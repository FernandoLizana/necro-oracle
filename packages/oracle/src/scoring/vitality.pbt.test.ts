// src/scoring/vitality.pbt.test.ts
//
// Property-based tests for vitality scoring (task 27.3).
//
// Properties (design.md / requirements.md):
//   P10 — Vitality bounds: computeVitality(draws) is always an integer in
//         [0, 100], for any valid CardDraw[].        (R18.1, R18.4, R18.5)
//   P7  — Vitality monotonic: lowering the severities of the drawn cards
//         (keeping the same card ids) never lowers vitality. Because the score
//         is 100 − Σ(weight × severity) clamped to [0, 100], shrinking any
//         severity can only shrink the penalty, so vitality can only stay the
//         same or rise.                              (R18.1, R18.2, R18.3)
//
// Testing steering: vitality PBTs use numRuns 1000; print the seed on failure;
// a counterexample becomes a permanent regression example next to the property.
// No network / LLM / sandbox here — pure computation only (R21.5).
//
// _Validates: Requirements R18.1, R18.2, R18.3, R18.4, R18.5 / Properties P7, P10_
import fc from "fast-check";
import { describe, it } from "vitest";

import type { CardDraw, Severity } from "../registry/schema.js";
import { computeVitality } from "./vitality.js";
import { arbCardDrawArray } from "../../test/arbitraries.js";

/** Vitality PBTs run 1000 cases (testing steering). */
const NUM_RUNS = 1000;

/**
 * Orientation convention shared with `arbCardDrawArray` (test/arbitraries.ts):
 * severity 0 / 1 → "reversed" (latent / partial), 2 / 3 → "upright" (active).
 * We reuse it when reconstructing lowered-severity draws so the CardDraw shape
 * stays consistent (Property 4 convention); orientation is irrelevant to the
 * score, which depends only on card weight × severity.
 */
function orientationForSeverity(severity: Severity): "upright" | "reversed" {
  return severity <= 1 ? "reversed" : "upright";
}

/**
 * Given an original draw array, generate a "lowered" copy: the same card ids in
 * the same order, but each draw's severity replaced by some value in
 * [0, originalSeverity]. Orientation is re-derived to keep the draw consistent.
 */
const arbLoweredFrom = (
  draws: CardDraw[],
): fc.Arbitrary<CardDraw[]> =>
  draws.length === 0
    ? fc.constant<CardDraw[]>([])
    : fc.tuple(
        ...draws.map((d) =>
          fc
            .integer({ min: 0, max: d.severity })
            .map((s): CardDraw => {
              const severity = s as Severity;
              return {
                ...d,
                severity,
                orientation: orientationForSeverity(severity),
              };
            }),
        ),
      );

describe("P10 (R18.1, R18.4, R18.5): vitality bounds", () => {
  it("computeVitality is always an integer in [0, 100]", () => {
    fc.assert(
      fc.property(arbCardDrawArray, (draws) => {
        const v = computeVitality(draws);
        return (
          Number.isInteger(v) && v >= 0 && v <= 100
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("P7 (R18.1, R18.2, R18.3): vitality monotonic", () => {
  it("lowering severities never lowers vitality", () => {
    fc.assert(
      fc.property(
        arbCardDrawArray.chain((draws) =>
          arbLoweredFrom(draws).map((lowered) => ({ draws, lowered })),
        ),
        ({ draws, lowered }) => {
          const original = computeVitality(draws);
          const after = computeVitality(lowered);
          return after >= original;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
