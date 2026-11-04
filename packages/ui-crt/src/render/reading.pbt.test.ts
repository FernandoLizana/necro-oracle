// Feature: 03-crt-terminal, Property 7: reading renderer fidelity
//
// TEST-FIRST (red). This file is written before `render/reading.ts` (task 9.2),
// so the `./reading.js` import below fails to resolve and the whole suite is
// red for the expected reason: the reading renderer module does not exist yet.
//
// Validates: Requirements R7.1, R7.2, R7.11, R7.12
//
// P7 states that `renderReading` is a faithful, deterministic rendering of a
// Reading's spread:
//   - one block per spread position, in the Reading's order (R7.1), followed by
//     the closing block(s);
//   - every drawn card's `card` id, `orientation` and `severity` (rendered
//     exactly as received, an integer 0..3) appear in that position's block
//     (R7.2);
//   - no card id that is not in the Reading appears in any block (R7.12);
//   - equal inputs produce byte-for-byte equal lines (R7.11, determinism);
//   - the renderer adds, removes or alters no draw — the set of rendered card
//     ids equals the set of drawn card ids (R7.12).
//
// Per the testing steering, spread-level properties use 1000 runs.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { CardIdSchema, getCard, type CardId } from "@necro/oracle/client";

import { arbReadingResponse } from "../testing/arbitraries.js";
import { blockText } from "./blocks.js";
// Not yet implemented — task 9.2 adds this module.
import { renderReading } from "./reading.js";

const NUM_RUNS = 1000;

/** The uppercase display name a card block must show for a drawn card. */
function cardName(card: CardId): string {
  return getCard(card).name.toUpperCase();
}

describe("P7 (R7.1, R7.2, R7.11, R7.12): reading renderer fidelity", () => {
  it("emits one block per spread position, in order, before the closing block(s)", () => {
    fc.assert(
      fc.property(arbReadingResponse(), (resp) => {
        const blocks = renderReading(resp);
        const positionCount = resp.reading.spread.length;
        // At least one position block per position, plus closing block(s).
        expect(blocks.length).toBeGreaterThanOrEqual(positionCount + 1);

        // The first `positionCount` blocks correspond to the positions in order:
        // each one names its 1-based position index.
        resp.reading.spread.forEach((position, index) => {
          const text = blockText(blocks[index]!);
          expect(text).toContain(String(position.position));
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("shows each drawn card's id, orientation and severity as received (0..3)", () => {
    fc.assert(
      fc.property(arbReadingResponse(), (resp) => {
        const blocks = renderReading(resp);
        resp.reading.spread.forEach((position, index) => {
          const draw = position.draw;
          if (draw === null) return;
          const text = blockText(blocks[index]!);
          // The uppercase card name identifies the card (R7.2, R7.10).
          expect(text).toContain(cardName(draw.card));
          // Orientation rendered uppercase.
          expect(text).toContain(draw.orientation.toUpperCase());
          // Severity rendered exactly as received, including 0 (Q1 resolved).
          expect(text).toContain(`SEVERITY ${draw.severity}`);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("renders no card that is not drawn in the Reading (adds/removes nothing)", () => {
    fc.assert(
      fc.property(arbReadingResponse(), (resp) => {
        const blocks = renderReading(resp);
        const allText = blocks.map(blockText).join("\n");

        const drawnIds = new Set(
          resp.reading.spread
            .filter((p) => p.draw !== null)
            .map((p) => p.draw!.card),
        );

        // For every CardId, its uppercase name appears in the rendered output
        // only if that card is actually drawn.
        for (const card of CardIdSchema.options) {
          const appears = allText.includes(cardName(card));
          if (!drawnIds.has(card)) {
            expect(appears).toBe(false);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("is deterministic: equal inputs produce byte-for-byte equal lines (R7.11)", () => {
    fc.assert(
      fc.property(arbReadingResponse(), (resp) => {
        const a = renderReading(resp).map(blockText).join("\n");
        const b = renderReading(resp).map(blockText).join("\n");
        expect(a).toBe(b);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
