// Feature: 03-crt-terminal, Property 2: parser totality
//
// Validates: Requirements R2.12, R2.16
//
// `parseCommand` accepts EVERY input string — any length, any Unicode content,
// including hostile control/escape/bidi payloads — and always returns a
// `Command` or `null` without throwing (R2.12). It never touches the clock,
// environment, network or DOM (R2.16); the unit/property harness makes no such
// call, so a thrown error or a non-`Command | null` return is the only way this
// property can fail.
//
// TEST-FIRST: imports `parseCommand` from the not-yet-created
// `../command/parse.js`; EXPECTED to fail with a module-resolution error until
// task 5.2 lands the parser.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseCommand } from "./parse.js";

const COMMAND_KINDS = [
  "help",
  "clear",
  "summon",
  "read",
  "explain",
  "motion",
  "demo",
  "sound",
  "unknown",
] as const;

/** Assert the value is a `Command | null`: either `null` or a tagged object. */
function expectCommandOrNull(value: unknown): void {
  if (value === null) return;
  expect(value).toBeTypeOf("object");
  expect(value).not.toBeNull();
  const kind = (value as { kind?: unknown }).kind;
  expect(COMMAND_KINDS).toContain(kind);
}

describe("P2 (R2.12, R2.16): parser totality", () => {
  it("never throws and returns Command|null for arbitrary full-Unicode strings", () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (input) => {
        let result: unknown;
        expect(() => {
          result = parseCommand(input);
        }).not.toThrow();
        expectCommandOrNull(result);
      }),
      { numRuns: 200 },
    );
  });

  it("never throws for huge strings (length well past the entry limit)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 500, maxLength: 5_000 }), (input) => {
        let result: unknown;
        expect(() => {
          result = parseCommand(input);
        }).not.toThrow();
        expectCommandOrNull(result);
      }),
      { numRuns: 200 },
    );
  });

  it("never throws for hostile control / escape / bidi payloads", () => {
    const arbHostile = fc
      .array(
        fc.oneof(
          fc.fullUnicode(),
          fc.constant("\u001B"),
          fc.constant("\u0000"),
          fc.constant("\u202E"),
          fc.constant("\u2066"),
          fc.constant("\t"),
          fc.constant("\n"),
          fc.constant(" "),
        ),
        { maxLength: 80 },
      )
      .map((parts) => parts.join(""));

    fc.assert(
      fc.property(arbHostile, (input) => {
        let result: unknown;
        expect(() => {
          result = parseCommand(input);
        }).not.toThrow();
        expectCommandOrNull(result);
      }),
      { numRuns: 200 },
    );
  });
});
