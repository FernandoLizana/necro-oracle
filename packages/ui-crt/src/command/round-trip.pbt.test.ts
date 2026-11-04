// Feature: 03-crt-terminal, Property 1: command round-trip
//
// Validates: Requirements R2.7, R2.8, R2.14, R2.15
//
// For every valid, non-`unknown` Command, printing it with `printCommand` and
// parsing that string back with `parseCommand` yields a Command equal to the
// original (R2.15). This simultaneously exercises the canonical printer form
// for `demo`/`demo <name>` and `sound`/`sound on`/`sound off` (R2.7, R2.8,
// R2.14) — every argument-present and argument-absent variant is reachable
// through `arbCommand`.
//
// TEST-FIRST: this file imports `parseCommand`/`printCommand` from the
// not-yet-created `../command/parse.js` and `../command/print.js`. It is
// EXPECTED to fail with a module-resolution error until task 5.2 implements
// those modules. That red is the point.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseCommand } from "./parse.js";
import { printCommand } from "./print.js";
import { arbCommand } from "../testing/arbitraries.js";

describe("P1 (R2.7, R2.8, R2.14, R2.15): command round-trip", () => {
  it("parse(print(c)) deep-equals c for every valid non-unknown Command", () => {
    fc.assert(
      fc.property(arbCommand, (cmd) => {
        const printed = printCommand(cmd);
        const reparsed = parseCommand(printed);
        expect(reparsed).toStrictEqual(cmd);
      }),
      { numRuns: 200 },
    );
  });

  it("the printed form is itself a non-null, non-unknown Command", () => {
    fc.assert(
      fc.property(arbCommand, (cmd) => {
        const reparsed = parseCommand(printCommand(cmd));
        expect(reparsed).not.toBeNull();
        expect(reparsed?.kind).not.toBe("unknown");
      }),
      { numRuns: 200 },
    );
  });
});
