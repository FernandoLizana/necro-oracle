// @necro/grimoires-py2to3 — Property 4: Pre_Pass is deterministic.
//
// The Pre_Pass is the six deterministic fixers (`FIXERS`) applied in their
// fixed order, each operating on the previous fixer's output, from a clean
// state (a fresh `FixerContext` per invocation). This property asserts that the
// transform is a pure function of its input: two completely independent
// invocations over the same source — each parsing from scratch via the injected
// `parsePython`, with no shared mutable state — produce byte-identical
// `After_Content` AND an identical `Residual_List` (deep-equal residuals).
//
// It also covers R3.8 directly: when no supported construct applies, the output
// is byte-identical to the input. The `arbPy2Program` distribution includes
// inert programs (clean lines, comments, already-py3 `print()`, and the empty
// program), so the "no applicable transform" boundary is exercised inside the
// property; a dedicated example case pins it explicitly as a regression anchor.
//
// Testing steering: fast-check with explicit `numRuns: 1000` (fixer budget),
// seed printed on failure. No network / LLM / sandbox — the only side effect is
// the local tree-sitter WASM parse, initialised once in `beforeAll` (R3.1).
//
// **Validates: Requirements 3.6, 3.8**

import { initParser, parsePython } from "@necro/oracle";
import type { FixerContext, Fixer, FixResult } from "@necro/coven";

import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import { FIXERS } from "./index.js";
import { arbPy2Program } from "../../test/arbitraries.js";

/** P4 runs the fixer property budget. */
const NUM_RUNS = 1000;

/** Print the fast-check seed on failure for reproducible regressions. */
const FC_OPTS: fc.Parameters<unknown> = { numRuns: NUM_RUNS, verbose: true };

/**
 * Build the FixerContext the way the runner does — a fresh context injecting
 * the real parser. A new context per invocation is what makes each run
 * "independent from a clean state": no residual object or edit buffer is
 * carried between invocations.
 */
function ctxFor(path: string): FixerContext {
  return { parse: parsePython, path };
}

/**
 * One full Pre_Pass invocation: apply every fixer in `FIXERS` order,
 * left-to-right, each on the previous fixer's `after`, accumulating residuals.
 * This mirrors `applyFixers` in the golden test and the runner's Pre_Pass.
 */
function prePass(source: string, path: string): FixResult {
  let after = source;
  const residuals: FixResult["residuals"] = [];
  for (const fixer of FIXERS as readonly Fixer[]) {
    const result = fixer(after, ctxFor(path));
    after = result.after;
    residuals.push(...result.residuals);
  }
  return { after, residuals };
}

const PATH = "fixtures/generated/sample.py";

describe("P4 (R3.6, R3.8): Pre_Pass is deterministic", () => {
  beforeAll(async () => {
    await initParser();
  });

  it("two independent invocations agree byte-for-byte and on residuals (R3.6)", () => {
    fc.assert(
      fc.property(arbPy2Program, (source) => {
        // Two independent Pre_Pass runs from a clean state over the same input.
        const first = prePass(source, PATH);
        const second = prePass(source, PATH);

        // Byte-identical After_Content.
        expect(second.after).toBe(first.after);
        // Identical Residual_List (deep-equal residual entries, same order).
        expect(second.residuals).toStrictEqual(first.residuals);
      }),
      FC_OPTS,
    );
  });

  it("no applicable transform leaves output byte-identical to input (R3.8)", () => {
    // Lines that no fixer targets: a py3 print(), a plain assignment, a
    // comment, a bare pass. The whole program must come back unchanged.
    const inert = ["print(\"ok\")", "x = 1", "# comment", "pass"].join("\n") + "\n";

    const result = prePass(inert, PATH);

    expect(result.after).toBe(inert);
    expect(result.residuals).toStrictEqual([]);

    // And it is still deterministic on the inert input (independent re-run).
    const again = prePass(inert, PATH);
    expect(again.after).toBe(inert);
    expect(again.residuals).toStrictEqual(result.residuals);
  });
});
