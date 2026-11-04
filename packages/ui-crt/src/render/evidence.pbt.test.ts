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

import type {
  CardDraw,
  Evidence,
  Reading,
  RepoRef,
  SpreadPosition,
} from "@necro/oracle/client";

import type { ReadingResponse, SummonSummary } from "../protocol.js";
import { arbCardDrawWithEvidence, arbReadingResponse } from "../testing/arbitraries.js";
import { blockText } from "./blocks.js";
// Not yet implemented — task 9.2 adds these modules.
import { renderExplain } from "./explain.js";
import { renderReading } from "./reading.js";

const NUM_RUNS = 500;

// --- Regression fixture builders (shared by the regression example) ----------
//
// Minimal, schema-shaped builders mirroring renderers.test.ts, used to pin the
// resolved behaviour of the sanitise/wrap counterexample below.

const REGRESSION_REF: RepoRef = {
  owner: "_",
  name: "0",
  sha: "0aaa00aa0aa0aaaaa00aa0aaaa0a0aa0a00aaa0a",
  defaultBranch: "main",
};

function regressionResponse(spread: readonly SpreadPosition[]): ReadingResponse {
  const draws = spread
    .filter((p): p is SpreadPosition & { draw: CardDraw } => p.draw !== null)
    .map((p) => p.draw);
  const reading: Reading = {
    id: "00000000-0000-4000-8000-000000000000",
    repo: REGRESSION_REF,
    draws,
    spread: [...spread],
    vitality: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    engineVersion: "1.0.0",
    errors: [],
  };
  const summary: SummonSummary = {
    ref: REGRESSION_REF,
    stars: 0,
    hasWorkflowsDir: false,
    degradedFields: [],
    cache: "hit",
    fileCount: 0,
    truncated: false,
  };
  return { summary, reading };
}

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

  // Regression (seed -354022726): the P8 first property was seed-dependent
  // flaky. On some seeds the generated evidence had `detail:""` and a path made
  // only of characters the renderer legitimately drops — e.g. `path:" / "`
  // (rendered as `"/"` after sanitise + 72-col wrap) or `path:" "` (rendered as
  // `""`). The old assertion required a RAW substring (`" / "` / `" "`) to
  // survive, which it never can: sanitising control/bidi/ANSI (R14.2/R14.3) and
  // dropping whitespace at wrap breaks is a required renderer transformation,
  // not a bug. The fix makes the P8 evidence generator emit printable,
  // sanitiser-surviving detail/path; this example pins the resolved behaviour
  // for the exact counterexample: a whitespace/separator-only path still yields
  // a NON-EMPTY, sanitised evidence fragment in the card block.
  it("shows a non-empty sanitised fragment for whitespace-only evidence (regression, seed -354022726)", () => {
    const evidence: Evidence[] = [
      { kind: "a", path: " / ", detail: "", source: "static" },
    ];
    const draw: CardDraw = {
      card: "judgement",
      severity: 0,
      orientation: "upright",
      evidence,
      summary: "",
      grimoires: [],
    };
    const spread: SpreadPosition[] = [
      { position: 1, label: "POSITION 1", draw },
    ];
    const resp = regressionResponse(spread);

    const blocks = renderReading(resp);
    const text = blockText(blocks[0]!);

    // The raw path (`" / "`) does NOT survive (whitespace dropped at the wrap
    // break) — asserting it would reintroduce the flake. The renderer instead
    // surfaces the sanitised, non-empty fragment `"/"` for this evidence item.
    expect(text.includes(" / ")).toBe(false);
    expect(text).toContain("/");
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
