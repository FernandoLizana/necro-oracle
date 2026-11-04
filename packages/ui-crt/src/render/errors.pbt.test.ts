// Feature: 03-crt-terminal, Property 12: error rendering
//
// TEST-FIRST (red). This file is written before `render/errors.ts` (task 9.2),
// so the `./errors.js` import below fails to resolve and the whole suite is red
// for the expected reason: the error renderer module does not exist yet.
//
// Validates: Requirements R11.1, R11.3, R11.9
//
// P12 states that `renderError` is total over the error enum and leaks no
// internals:
//   - for every one of the 18 `NecroErrorCode`s, `renderError` produces a block
//     whose first line carries `ERROR <CODE>` (R11.1);
//   - the block carries a non-empty mystical line and a non-empty technical
//     line (R11.3), whether or not the `userMessage` contains a newline;
//   - no stack, cause, or exception-shaped text appears in any line (R11.9) —
//     only `code` and `userMessage` are inputs, so nothing else can surface.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { NecroErrorCodeSchema, type NecroErrorCode } from "@necro/oracle/client";

import { blockText, lineText } from "./blocks.js";
// Not yet implemented — task 9.2 adds this module.
import { renderError } from "./errors.js";

const NUM_RUNS = 200;

/** Every NecroErrorCode literal (the full 18-code enum). */
const ALL_CODES: readonly NecroErrorCode[] = NecroErrorCodeSchema.options;

/** Markers that would betray a leaked stack / cause / raw exception. */
const LEAK_MARKERS = [
  "at ",
  ".ts:",
  ".js:",
  "node_modules",
  "    at",
  "Error:",
  "stack",
  "cause",
  "\tat ",
];

/** An arbitrary two-layer oracle userMessage: mystical line \n technical line. */
const arbTwoLineMessage: fc.Arbitrary<string> = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim() !== ""),
    fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim() !== ""),
  )
  .map(([mystical, technical]) => `${mystical}\n${technical}`);

/** An arbitrary single-line userMessage (no newline). */
const arbOneLineMessage: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((s) => s.trim() !== "" && !s.includes("\n"));

describe("P12 (R11.1, R11.3, R11.9): error rendering", () => {
  it("produces a block whose first line carries ERROR <CODE> for every code", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_CODES),
        fc.oneof(arbTwoLineMessage, arbOneLineMessage),
        (code, userMessage) => {
          const block = renderError({ code, userMessage });
          expect(block.lines.length).toBeGreaterThanOrEqual(1);
          const firstLine = lineText(block.lines[0]!);
          expect(firstLine).toContain(`ERROR ${code}`);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("carries a non-empty mystical line and a non-empty technical line", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_CODES),
        fc.oneof(arbTwoLineMessage, arbOneLineMessage),
        (code, userMessage) => {
          const block = renderError({ code, userMessage });
          // Beyond the `ERROR <CODE>` first line there must be at least two more
          // non-empty text lines (a mystical line and a technical line).
          const bodyLines = (block.lines.slice(1).map(lineText) as string[]).filter(
            (t: string) => t.trim() !== "",
          );
          expect(bodyLines.length).toBeGreaterThanOrEqual(2);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("leaks no stack, cause, or exception text (R11.9)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_CODES),
        fc.oneof(arbTwoLineMessage, arbOneLineMessage),
        (code, userMessage) => {
          const block = renderError({ code, userMessage });
          const text = blockText(block);
          // The only `code`-shaped token allowed is the `ERROR <CODE>` header;
          // strip that one line before scanning for leak markers so that a
          // userMessage mentioning none of them keeps the scan honest.
          const withoutHeader = block.lines
            .slice(1)
            .map(lineText)
            .join("\n");
          for (const marker of LEAK_MARKERS) {
            expect(withoutHeader.includes(marker)).toBe(false);
          }
          // Sanity: the full block is non-empty.
          expect(text.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("renders a block for every one of the 18 codes (totality)", () => {
    expect(ALL_CODES).toHaveLength(18);
    for (const code of ALL_CODES) {
      const block = renderError({ code, userMessage: "The veil tears.\ntechnical detail." });
      expect(lineText(block.lines[0]!)).toContain(`ERROR ${code}`);
    }
  });
});
