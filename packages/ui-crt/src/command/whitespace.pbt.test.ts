// Feature: 03-crt-terminal, Property 3: whitespace insensitivity
//
// Validates: Requirements R2.9
//
// Leading and trailing whitespace, and repeated internal whitespace between
// tokens, are surplus: the parser ignores them (R2.9). The property re-inflates
// a valid Command's canonical printed form with arbitrary extra whitespace at
// the ends and between tokens, then asserts `parseCommand` returns a Command
// equal to the Command parsed from the un-padded canonical form. The `summon`
// repo token is never split (its value may legitimately contain no spaces), so
// padding only the gaps between tokens is a faithful model of "surplus
// whitespace".
//
// TEST-FIRST: imports `parseCommand`/`printCommand` from the not-yet-created
// `../command/parse.js` / `../command/print.js`; EXPECTED to fail with a
// module-resolution error until task 5.2.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseCommand } from "./parse.js";
import { printCommand } from "./print.js";
import { arbCommand } from "../testing/arbitraries.js";

/** A run of mixed Unicode whitespace (spaces, tabs, form feeds, NBSP, …). */
const arbWhitespaceRun: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(" ", "\t", "\u000B", "\u000C", "\u00A0", "\u2003"), {
    minLength: 1,
    maxLength: 4,
  })
  .map((parts) => parts.join(""));

/**
 * Re-pad the canonical single-space-separated form: surround the whole string
 * with whitespace and widen each internal single-space gap to an arbitrary
 * whitespace run. Token characters themselves are left untouched.
 */
function padWhitespace(
  canonical: string,
  lead: string,
  trail: string,
  gaps: readonly string[],
): string {
  const tokens = canonical.split(" ");
  let out = tokens[0] ?? "";
  for (let i = 1; i < tokens.length; i++) {
    out += (gaps[i - 1] ?? " ") + tokens[i];
  }
  return lead + out + trail;
}

describe("P3 (R2.9): whitespace insensitivity", () => {
  it("surplus leading, trailing and internal whitespace does not change the parse", () => {
    fc.assert(
      fc.property(
        arbCommand,
        arbWhitespaceRun,
        arbWhitespaceRun,
        fc.array(arbWhitespaceRun, { maxLength: 8 }),
        (cmd, lead, trail, gaps) => {
          const canonical = printCommand(cmd);
          const baseline = parseCommand(canonical);
          const padded = padWhitespace(canonical, lead, trail, gaps);
          expect(parseCommand(padded)).toStrictEqual(baseline);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("a whitespace-only entry parses to null regardless of the characters used", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(" ", "\t", "\u000B", "\u000C", "\u00A0", "\u2003", "\n"),
          { minLength: 1, maxLength: 12 },
        ),
        (parts) => {
          expect(parseCommand(parts.join(""))).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });
});
