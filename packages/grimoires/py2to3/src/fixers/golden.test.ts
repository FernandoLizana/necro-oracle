// @necro/grimoires-py2to3 — golden fixtures for the Pre_Pass transforms.
//
// Each `fixtures/<case>/before/sample.py` is pinned against its
// `fixtures/<case>/after/sample.py`: applying the case's fixer(s) to the
// `before` source must produce the `after` source BYTE-FOR-BYTE. Per the
// testing steering, a fixer change that alters a golden output must update the
// pinned `after` in the same commit with a reason — the goldens are the
// contract for the six deterministic fixers (R3.1, R3.8).
//
// The six single-fixer cases cover each transform in isolation:
//   print-statement, except-comma, dict-iter, unicode-str, long-literal,
//   ne-operator.
// The `combined` case applies all six fixers in the fixed FIXERS order (the
// order the runner uses), proving the Pre_Pass composition is stable.
//
// No network, LLM or sandbox is touched: the only side effect is the local
// tree-sitter WASM parse via the injected `parsePython`, initialised once in
// `beforeAll` (R3.1). Reading the pinned fixtures from disk is a test-only read.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { initParser, parsePython } from "@necro/oracle";
import type { FixerContext, Fixer, FixResult } from "@necro/coven";

import { beforeAll, describe, expect, it } from "vitest";

import {
  dictIterFixer,
  exceptCommaFixer,
  longLiteralFixer,
  neOperatorFixer,
  printStatementFixer,
  unicodeStrFixer,
  FIXERS,
} from "./index.js";

// The package-level fixtures directory lives at
// `packages/grimoires/py2to3/fixtures`; this test sits at `src/fixers/`, so the
// goldens are two directories up.
const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

/** Read a pinned fixture file verbatim (UTF-8, no normalisation). */
function readFixture(testCase: string, which: "before" | "after"): string {
  return readFileSync(join(FIXTURES_DIR, testCase, which, "sample.py"), "utf8");
}

/** Build the FixerContext the way the runner does: inject the real parser. */
function ctxFor(path: string): FixerContext {
  return { parse: parsePython, path };
}

/** Apply a chain of fixers left-to-right, each on the previous output. */
function applyFixers(source: string, fixers: readonly Fixer[], path: string): FixResult {
  let after = source;
  const residuals: FixResult["residuals"] = [];
  for (const fixer of fixers) {
    const result = fixer(after, ctxFor(path));
    after = result.after;
    residuals.push(...result.residuals);
  }
  return { after, residuals };
}

/** The six single-fixer golden cases: case directory ↔ the fixer under test. */
const SINGLE_FIXER_CASES: ReadonlyArray<{ readonly dir: string; readonly fixer: Fixer }> = [
  { dir: "print-statement", fixer: printStatementFixer },
  { dir: "except-comma", fixer: exceptCommaFixer },
  { dir: "dict-iter", fixer: dictIterFixer },
  { dir: "unicode-str", fixer: unicodeStrFixer },
  { dir: "long-literal", fixer: longLiteralFixer },
  { dir: "ne-operator", fixer: neOperatorFixer },
];

describe("Pre_Pass golden fixtures (R3.1, R3.8)", () => {
  beforeAll(async () => {
    await initParser();
  });

  describe("each fixer maps its before to its pinned after", () => {
    for (const { dir, fixer } of SINGLE_FIXER_CASES) {
      it(`${dir}: before -> pinned after (byte-identical)`, () => {
        const before = readFixture(dir, "before");
        const after = readFixture(dir, "after");
        const path = `fixtures/${dir}/before/sample.py`;

        const result = fixer(before, ctxFor(path));

        expect(result.after).toBe(after);
        // A clean single-fixer golden converts everything it targets: no
        // unconverted construct remains (R3.8).
        expect(result.residuals).toEqual([]);
      });

      it(`${dir}: pinned after is a fixed point (idempotent, R3.4)`, () => {
        const after = readFixture(dir, "after");
        const path = `fixtures/${dir}/after/sample.py`;

        // Re-applying the fixer to its own output changes nothing.
        expect(fixer(after, ctxFor(path)).after).toBe(after);
      });
    }
  });

  describe("combined: all six fixers in FIXERS order", () => {
    it("before -> pinned after (byte-identical)", () => {
      const before = readFixture("combined", "before");
      const after = readFixture("combined", "after");
      const path = "fixtures/combined/before/sample.py";

      const result = applyFixers(before, FIXERS, path);

      expect(result.after).toBe(after);
      expect(result.residuals).toEqual([]);
    });

    it("pinned after is a fixed point of the whole Pre_Pass (idempotent, R3.4)", () => {
      const after = readFixture("combined", "after");
      const path = "fixtures/combined/after/sample.py";

      expect(applyFixers(after, FIXERS, path).after).toBe(after);
    });
  });
});
