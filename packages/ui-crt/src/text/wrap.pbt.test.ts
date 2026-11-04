// Feature: 03-crt-terminal, Property 4: Line width and character preservation
//
// TEST-FIRST (red). This file is written before `text/wrap.ts` (task 6.2), so
// the import below fails to resolve and the whole suite is red for the expected
// reason: the wrapper module does not exist yet.
//
// Validates: Requirements R17.1, R17.3
//
// P4 states: for all strings (including those with words longer than 72
// columns), every wrapped Output_Line is at most 72 code points wide, and the
// concatenation of the wrapped lines with whitespace removed equals the input
// with whitespace removed — i.e. all non-whitespace characters are preserved in
// order. Over-long tokens are cut by code point (surrogate pairs stay whole).

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  arbLongToken,
  arbWrappableText,
  codePointLength,
  stripWhitespace,
} from "../testing/arbitraries.js";

// Not yet implemented — task 6.2 adds this module.
import { LINE_WIDTH, wrapText } from "./wrap.js";

const NUM_RUNS = 200;

describe("P4 (R17.1, R17.3): line width", () => {
  it("LINE_WIDTH is 72", () => {
    expect(LINE_WIDTH).toBe(72);
  });

  it("every wrapped line is at most LINE_WIDTH code points", () => {
    fc.assert(
      fc.property(arbWrappableText, (input) => {
        for (const line of wrapText(input)) {
          expect(codePointLength(line)).toBeLessThanOrEqual(LINE_WIDTH);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("every wrapped line is at most the custom width when one is given", () => {
    fc.assert(
      fc.property(arbWrappableText, fc.integer({ min: 1, max: 40 }), (input, width) => {
        for (const line of wrapText(input, width)) {
          expect(codePointLength(line)).toBeLessThanOrEqual(width);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("preserves all non-whitespace characters in order", () => {
    fc.assert(
      fc.property(arbWrappableText, (input) => {
        const lines = wrapText(input);
        expect(stripWhitespace(lines.join(""))).toBe(stripWhitespace(input));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("never returns an empty array (splits on newlines, keeps blank lines)", () => {
    fc.assert(
      fc.property(arbWrappableText, (input) => {
        expect(wrapText(input).length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("cuts an over-long whitespace-free token by code point without reordering", () => {
    fc.assert(
      fc.property(arbLongToken, fc.integer({ min: 1, max: 20 }), (token, width) => {
        const lines = wrapText(token, width);
        for (const line of lines) {
          expect(codePointLength(line)).toBeLessThanOrEqual(width);
        }
        // Surrogate pairs stay whole: reassembled code points equal the input.
        expect(stripWhitespace(lines.join(""))).toBe(stripWhitespace(token));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
