// Feature: 03-crt-terminal, Property 8: evidence is always shown
//
// TEST-FIRST (red). This file is written before `render/reading.ts` and
// `render/explain.ts` (task 9.2), so the `./reading.js` / `./explain.js`
// imports below fail to resolve and the whole suite is red for the expected
// reason: the reading and explain renderer modules do not exist yet.
//
// Validates: Requirements R7.5, R8.1
//
// P8 states that a drawn card never hides its evidence:
//   - for every drawn card that carries at least one Evidence item, that card's
//     position block in `renderReading` shows at least one evidence line (R7.5);
//   - the `explain` block for that card/position shows EVERY Evidence item the
//     card carries (R8.1) — nothing is dropped.
//
// Evidence is identified by its `detail` text, which the renderer must print
// for each item. Every drawn position here carries at least one path-bearing
// evidence item (via `arbCardDrawWithEvidence`).

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { arbCardDrawWithEvidence, arbReadingResponse } from "../testing/arbitraries.js";
import { blockText } from "./blocks.js";
// Not yet implemented — task 9.2 adds these modules.
import { renderExplain } from "./explain.js";
import { renderReading } from "./reading.js";

const NUM_RUNS = 500;

describe("P8 (R7.5, R8.1): evidence is always shown", () => {
  it("shows at least one evidence line per drawn card in the reading (R7.5)", () => {
    fc.assert(
      fc.property(
        arbReadingResponse({ allDrawn: true, drawArb: arbCardDrawWithEvidence }),
        (resp) => {
          const blocks = renderReading(resp);
          resp.reading.spread.forEach((position, index) => {
            const draw = position.draw;
            if (draw === null || draw.evidence.length === 0) return;
            const text = blockText(blocks[index]!);
            // At least one of the card's evidence details appears in its block.
            const anyShown = draw.evidence.some(
              (item) => item.detail !== "" && text.includes(item.detail),
            );
            // When every detail is the empty string we fall back to checking a
            // path is shown instead (the renderer always surfaces something).
            if (!anyShown) {
              const anyPath = draw.evidence.some(
                (item) => item.path !== undefined && text.includes(item.path),
              );
              expect(anyPath).toBe(true);
            } else {
              expect(anyShown).toBe(true);
            }
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("shows EVERY evidence item of a card in its explain block (R8.1)", () => {
    fc.assert(
      fc.property(
        arbReadingResponse({ allDrawn: true, drawArb: arbCardDrawWithEvidence }),
        (resp) => {
          // Explain every drawn position by its 1-based index.
          resp.reading.spread.forEach((position) => {
            const draw = position.draw;
            if (draw === null) return;
            const blocks = renderExplain(resp, {
              kind: "position",
              position: position.position,
            });
            const text = blocks.map(blockText).join("\n");
            // Every evidence item's path and detail must appear.
            for (const item of draw.evidence) {
              if (item.path !== undefined) {
                expect(text).toContain(item.path);
              }
              if (item.detail !== "") {
                expect(text).toContain(item.detail);
              }
            }
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
