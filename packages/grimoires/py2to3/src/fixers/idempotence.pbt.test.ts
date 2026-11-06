// @necro/grimoires-py2to3 — Pre_Pass idempotence property test.
//
// Property 3 (design.md correctness properties; tasks.md 4.3): the Pre_Pass is
// IDEMPOTENT — applying the whole Pre_Pass (all FIXERS in fixed order) twice
// yields byte-identical output to applying it once. Each fixer removes the py2
// node it matched, so a second application finds no matching span and leaves
// the content unchanged; composing the six fixers must preserve that property
// (R3.4).
//
// The input space is `arbPy2Program` — a grammar-based generator of small py2
// programs mixing the six targeted constructs, an unconverted chevron print,
// and neutral py3 lines — exercised at `numRuns: 1000` per the testing steering
// (1000 for fixers). The seed is printed on failure so a counterexample can be
// reproduced and pinned as a regression next to this property.
//
// No network, LLM, or sandbox: the only side effect is the local tree-sitter
// WASM parse via `parsePython`, initialised once in `beforeAll` (R3.1).
//
// **Validates: Requirements 3.4**

import { initParser, parsePython } from "@necro/oracle";
import type { Fixer, FixerContext, FixResult } from "@necro/coven";

import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import { FIXERS } from "./index.js";
import { arbPy2Program } from "../../test/arbitraries.js";

/** 1000 runs: fixer properties get the high budget (testing steering). */
const NUM_RUNS = 1000;

/** Build the FixerContext the runner uses: inject the real parser. */
function ctxFor(path: string): FixerContext {
  return { parse: parsePython, path };
}

/**
 * Apply the whole Pre_Pass: the FIXERS in fixed order, each operating on the
 * previous fixer's output (the composition the runner performs). Returns only
 * the `after` content, which is what idempotence compares byte-for-byte.
 */
function prePass(source: string, fixers: readonly Fixer[], path: string): string {
  let after = source;
  for (const fixer of fixers) {
    const result: FixResult = fixer(after, ctxFor(path));
    after = result.after;
  }
  return after;
}

describe("P3 (R3.4): Pre_Pass is idempotent", () => {
  beforeAll(async () => {
    await initParser();
  });

  it("applying the Pre_Pass twice equals applying it once (byte-identical)", () => {
    fc.assert(
      fc.property(arbPy2Program, (program) => {
        const path = "fixtures/generated/sample.py";
        const once = prePass(program, FIXERS, path);
        const twice = prePass(once, FIXERS, path);
        expect(twice).toBe(once);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
