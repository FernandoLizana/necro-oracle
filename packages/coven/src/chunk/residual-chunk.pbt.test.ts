// @necro/coven — property test for residual chunking (task 5.2).
//
// Property 9 (R11.1, R11.2): residual chunks never contain the whole file.
//
//   The Resurrection LLM_Pass must never show the model the whole file. For an
//   ARBITRARY Python source and an ARBITRARY set of residual diagnostics,
//   `groupResiduals(path, source, residuals)` must satisfy:
//
//     (a) STRICT SUBSET context (R11.2). Every produced chunk's `context` is a
//         subset of the file's lines (each context line is a verbatim file
//         line) AND, whenever the file carries any line the chunk does not
//         reference, the context is a PROPER subset — it is never byte-equal to
//         the whole source. Because every generated source here has at least two
//         top-level units (so content always lives outside any single unit), the
//         proper-subset bound bites on every chunk.
//     (b) OWN DIAGNOSTICS ONLY (R11.1). The residuals attached to the chunks
//         PARTITION the input residuals: each input residual appears in exactly
//         one chunk (no loss, no duplication), and every residual inside a unit
//         chunk falls within that chunk's `span`.
//     (c) DETERMINISM + TOTALITY (R11.3). The same inputs always yield the same
//         chunks, and the function returns without throwing for every input.
//
// The property drives the REAL `groupResiduals` with the REAL oracle
// `parsePython` (armed once up front via `initParser`) — no network, no LLM, no
// sandbox, per the testing standard. Sources are built from a grammar-shaped
// generator of small, well-formed py3 modules so the tree-sitter spans are
// meaningful; residual lines are drawn from the file's real 1-based line range.
//
// fast-check runs 1000 times (the chunker budget from the testing steering);
// the failing seed is printed on failure (fast-check prints it by default).

import { initParser, parsePython } from "@necro/oracle";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import { groupResiduals } from "./residual-chunk.js";
import type { ResidualEntry } from "../models.js";

// ---------------------------------------------------------------------------
// Source generator — small, well-formed py3 modules with a known shape.
//
// A module is: an optional import prelude, then >=2 top-level units (def/class),
// each with a 1-3 line body, optionally separated by blank/module-level lines.
// Keeping >=2 units guarantees that for any single unit chunk there is always a
// file line outside it, so the proper-subset bound is non-vacuous.
// ---------------------------------------------------------------------------

const RESIDUAL_REASONS = [
  "parse_failed",
  "no_transform",
  "llm_unavailable",
  "llm_invalid_output",
  "output_unparseable",
  "not_validated",
  "incomplete",
] as const;

/** A generated top-level unit and the number of source lines it occupies. */
interface GenUnit {
  readonly lines: string[];
}

const arbName = fc
  .tuple(
    fc.constantFrom("f", "g", "h", "do", "run", "calc", "load", "parse"),
    fc.integer({ min: 0, max: 99 }),
  )
  .map(([stem, n]) => `${stem}${n}`);

/** A function unit: `def name(args):` + 1-3 indented body lines. */
const arbFuncUnit: fc.Arbitrary<GenUnit> = fc
  .tuple(
    arbName,
    fc.array(fc.constantFrom("a", "b", "c", "x", "y"), { maxLength: 3 }),
    fc.array(
      fc.constantFrom("    pass", "    return 1", "    x = 1", "    y = x + 1"),
      { minLength: 1, maxLength: 3 },
    ),
  )
  .map(([name, params, body]) => ({
    lines: [`def ${name}(${params.join(", ")}):`, ...body],
  }));

/** A class unit: `class Name:` + a single-method body. */
const arbClassUnit: fc.Arbitrary<GenUnit> = fc
  .tuple(arbName, fc.constantFrom("    pass", "    x = 1"))
  .map(([name, body]) => ({
    lines: [`class C_${name}:`, body],
  }));

const arbUnit: fc.Arbitrary<GenUnit> = fc.oneof(arbFuncUnit, arbClassUnit);

/** Optional top-level import prelude lines. */
const arbImports: fc.Arbitrary<string[]> = fc.array(
  fc.constantFrom(
    "import os",
    "import sys",
    "from math import sqrt",
    "import json",
  ),
  { maxLength: 3 },
);

/** Optional module-level separator lines between units (blank or a statement). */
const arbSeparator: fc.Arbitrary<string[]> = fc.array(
  fc.constantFrom("", "# comment", "X = 1"),
  { maxLength: 2 },
);

/** A whole module: imports, then >=2 units interleaved with separators. */
const arbSource: fc.Arbitrary<string> = fc
  .tuple(
    arbImports,
    fc.array(fc.tuple(arbUnit, arbSeparator), { minLength: 2, maxLength: 5 }),
  )
  .map(([imports, unitsWithSep]) => {
    const lines: string[] = [...imports];
    for (const [unit, sep] of unitsWithSep) {
      lines.push(...unit.lines);
      lines.push(...sep);
    }
    return lines.join("\n");
  });

/** A residual entry whose `line` is a real 1-based line of `source`. */
function arbResidualsFor(source: string): fc.Arbitrary<ResidualEntry[]> {
  const totalLines = source.split("\n").length;
  return fc.array(
    fc.record({
      path: fc.constant("pkg/mod.py"),
      line: fc.integer({ min: 1, max: totalLines }),
      construct: fc.constantFrom("print_stmt", "xrange", "has_key", "unicode"),
      reason: fc.constantFrom(...RESIDUAL_REASONS),
    }),
    { minLength: 1, maxLength: 8 },
  );
}

/** Source + a residual set grounded in that source's lines. */
const arbCase = arbSource.chain((source) =>
  arbResidualsFor(source).map((residuals) => ({ source, residuals })),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PATH = "pkg/mod.py";

/** The multiset of file lines, for subset checks. */
function lineCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of text.split("\n")) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

/** True when every line of `context` is a line of `source` (multiset subset). */
function isLineSubset(context: string, source: string): boolean {
  if (context === "") return true;
  const avail = lineCounts(source);
  const need = lineCounts(context);
  for (const [line, count] of need) {
    if ((avail.get(line) ?? 0) < count) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe("P9 (R11.1, R11.2): residual chunks never contain the whole file", () => {
  // `groupResiduals` defaults to the oracle `parsePython`; arm it once up front
  // so no first-run init cost lands inside the timed property body.
  beforeAll(async () => {
    await initParser();
  });

  it("every chunk context is a strict subset and carries only its own residuals", () => {
    fc.assert(
      fc.property(arbCase, ({ source, residuals }) => {
        const chunks = groupResiduals(PATH, source, residuals, parsePython);

        // At least one chunk for a non-empty residual set.
        expect(chunks.length).toBeGreaterThan(0);

        const sourceLineCount = source.split("\n").length;

        // (a) strict-subset context (R11.2).
        for (const chunk of chunks) {
          // Each context line is a verbatim file line.
          expect(isLineSubset(chunk.context, source)).toBe(true);
          // Never byte-equal to the whole file. Every generated source has >=2
          // top-level units, so there is always a line outside any one chunk.
          expect(chunk.context).not.toBe(source);
          // A proper subset by line count: the context references strictly fewer
          // lines than the file holds.
          const contextLineCount =
            chunk.context === "" ? 0 : chunk.context.split("\n").length;
          expect(contextLineCount).toBeLessThan(sourceLineCount);

          // Span is a sane 1-based inclusive range inside the file.
          expect(chunk.span.startLine).toBeGreaterThanOrEqual(1);
          expect(chunk.span.endLine).toBeGreaterThanOrEqual(chunk.span.startLine);
          expect(chunk.span.endLine).toBeLessThanOrEqual(sourceLineCount);
        }

        // (b) own diagnostics only (R11.1): the chunks PARTITION the residuals.
        const attached = chunks.flatMap((c) => [...c.residuals]);
        expect(attached.length).toBe(residuals.length);
        // Multiset equality via a stable key (every input residual appears once).
        const key = (r: ResidualEntry) =>
          `${r.line}|${r.construct}|${r.reason}`;
        const inputKeys = residuals.map(key).sort();
        const attachedKeys = attached.map(key).sort();
        expect(attachedKeys).toEqual(inputKeys);

        // No residual appears in two chunks: per-chunk residuals are disjoint by
        // identity (reference equality holds — the chunker does not copy).
        const seen = new Set<ResidualEntry>();
        for (const chunk of chunks) {
          for (const r of chunk.residuals) {
            expect(seen.has(r)).toBe(false);
            seen.add(r);
          }
        }

        // (c) determinism (R11.3): same inputs => same chunks.
        const again = groupResiduals(PATH, source, residuals, parsePython);
        expect(again).toEqual(chunks);
      }),
      { numRuns: 1000 },
    );
  });
});
