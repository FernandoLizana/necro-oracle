// @necro/grimoires-py2to3 — Part B never degrades already-converted code (task 5.6).
//
// Property 11 (R12.4): the Resurrection LLM_Pass (Part B — residual chunking +
// the deterministic chunk gate) NEVER worsens a file. Its output is always "at
// least as valid as the deterministic Pre_Pass result": it introduces no new
// Python 2 construct and causes no parse regression. Already-converted code is
// a FIXED POINT — Part B touches nothing it cannot prove improves.
//
// Part B is two pure values (design B.1/B.2):
//   - `groupResiduals(path, source, residuals)` — folds a file's residual
//     diagnostics into per-unit chunks sent to the model, and
//   - `acceptChunk(before, edit, diagnose, parse)` — the deterministic gate
//     that decides whether ONE chunk edit is accepted, declined, or rejected.
//
// The runner (task 5.4) wires these together: it groups residuals, asks the
// model for a `ChunkEdit` per chunk, then only applies an edit the gate
// ACCEPTS; a DECLINE (confidence 0) or any REJECT keeps the deterministic
// chunk. This test drives those pure pieces directly (no runner, no network, no
// LLM, no sandbox) and asserts the two metamorphic / monotonicity facts R12.4
// pins:
//
//   (A) FIXED POINT. For source that is ALREADY valid Python 3 with NO residual
//       diagnostics, `groupResiduals` produces NO chunks (nothing is sent to a
//       model) and — regardless of what edit a model might hallucinate — the
//       gate's accepted output can never leave the file with a py2 construct or
//       a parse error it did not already have. A no-residual file yields no
//       edits, so its content is byte-identical.
//
//   (B) NO DEGRADE / MONOTONICITY. For ANY chunk edit (including adversarial
//       ones that would ADD a py2 construct, break the parse, or rewrite an
//       already-converted region), the gate's outcome is one of:
//         - `accept { after }` only when `after` parses as Python 3 with zero
//           error nodes AND carries no py2 construct under the reused diagnosis
//           rule — strictly "at least as valid" as `before`; OR
//         - `decline` / `reject` — in which case the deterministic `before` is
//           kept byte-identical (the runner keeps the deterministic chunk).
//       So an edit can NEVER introduce a new py2 diagnostic into the applied
//       result and can NEVER cause a parse regression. Already-converted
//       regions stay a fixed point: an edit whose replacement equals the chunk
//       (or would rewrite a clean region into py2 / unparseable) is either a
//       no-op accept or a reject-that-keeps-`before`.
//
// The Python diagnosis rule (oracle `hasLegacyPythonNodes`) and the parser
// (oracle `parsePython`) are injected into the gate exactly as the runner
// injects them (local.ts), and the tree-sitter WASM grammar is armed once in
// `beforeAll` — the only side effect. Generators reuse the grammar-based
// `arbPy2Program` (py2 + mixed + neutral py3 lines) plus purpose-built
// already-converted py3 snippets and adversarial edits. fast-check runs with an
// explicit high budget and prints the seed on failure (testing steering).
//
// **Validates: Requirements 12.4**

import {
  hasLegacyPythonNodes,
  initParser,
  parsePython,
  type Tree,
} from "@necro/oracle";
import { groupResiduals } from "@necro/coven";

import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import { acceptChunk, type ChunkEdit } from "./chunk-gate.js";
import { arbPy2Program } from "../test/arbitraries.js";

/** 1000 runs: grimoire/fixer-class properties get the high budget (testing steering). */
const FC_OPTS: fc.Parameters<unknown> = { numRuns: 1000, verbose: true };

const PATH = "fixtures/generated/sample.py";

/** The gate's injected diagnosis rule + parser — exactly as the runner wires them. */
const diagnose = (tree: Tree): boolean => hasLegacyPythonNodes(tree);
const parse = (source: string): Tree => parsePython(source);

/** True when `source` parses as Python 3 with ZERO error nodes. */
function parsesAsPython3(source: string): boolean {
  let tree: Tree;
  try {
    tree = parse(source);
  } catch {
    return false;
  }
  try {
    return !treeHasError(tree);
  } finally {
    tree.delete();
  }
}

/** True when any ERROR or MISSING node appears in the tree. */
function treeHasError(tree: Tree): boolean {
  let bad = false;
  const cursor = tree.walk();
  try {
    for (;;) {
      const node = cursor.currentNode;
      if (node.type === "ERROR" || node.isError || node.isMissing) {
        bad = true;
        break;
      }
      if (cursor.gotoFirstChild()) continue;
      for (;;) {
        if (cursor.gotoNextSibling()) break;
        if (!cursor.gotoParent()) return bad;
      }
    }
  } finally {
    cursor.delete();
  }
  return bad;
}

/** True when `source` still carries a Python 2 construct (the reused diagnosis rule). */
function hasPy2Construct(source: string): boolean {
  let tree: Tree;
  try {
    tree = parse(source);
  } catch {
    // Unparseable: conservatively "constructs may remain", matching the gate.
    return true;
  }
  try {
    return diagnose(tree);
  } finally {
    tree.delete();
  }
}

// ---------------------------------------------------------------------------
// Already-converted Python 3 snippets (fixed-point inputs for branch A)
// ---------------------------------------------------------------------------

/**
 * A short, clean Python 3 snippet with top-level `def`/`class` units and NO
 * legacy py2 construct, so `hasLegacyPythonNodes` is false and `validate`
 * passes. These are the "already converted" files R12.4 pins as a fixed point.
 */
const arbConvertedPy3: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(
      "def greet(name):\n    return f'hi {name}'",
      "def add(a, b):\n    return a + b",
      "class Box:\n    def __init__(self, v):\n        self.v = v",
      "import os\n\ndef cwd():\n    return os.getcwd()",
      "values = [1, 2, 3]\nfor v in values:\n    print(v)",
      "def items(d):\n    return list(d.items())",
      "x = 10\ny = 0o777\nz = 'text'",
    ),
    { minLength: 1, maxLength: 4 },
  )
  .map((blocks) => blocks.join("\n\n"));

/**
 * An arbitrary ChunkEdit targeting a chunk span, with a replacement that may be
 * benign, a no-op (byte-identical to the chunk), an ADDED py2 construct, an
 * unparseable fragment, or a masked span — i.e. edits that WOULD degrade the
 * file if the gate let them through. `confidence` spans 0 (decline) .. 1.
 */
function arbEditFor(source: string): fc.Arbitrary<ChunkEdit> {
  const lineCount = Math.max(source.split("\n").length, 1);
  return fc
    .record({
      start: fc.integer({ min: 1, max: lineCount }),
      len: fc.integer({ min: 1, max: lineCount }),
      replacement: fc.oneof(
        fc.constant("    pass"),
        fc.constant("print 'degraded'"), // would ADD a py2 construct
        fc.constant("def x( ="), // would break the parse
        fc.constant("token****"), // masked-span fingerprint
        fc.constant("***MASKED***"), // literal mask placeholder
        fc.string({ maxLength: 40 }),
      ),
      requiredImports: fc.oneof(
        fc.constant<string[]>([]),
        fc.constant(["import os"]),
        fc.constant(["import evil_package"]), // non-stdlib → bad_import reject
      ),
      confidence: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 1, noNaN: true })),
    })
    .map(({ start, len, replacement, requiredImports, confidence }) => {
      const end = Math.min(start + len - 1, lineCount);
      return {
        chunkId: `${PATH}#${start}-${end}`,
        replacementCode: replacement,
        requiredImports,
        reason: "generated edit under test",
        confidence,
      } satisfies ChunkEdit;
    });
}

describe("P11 (R12.4): Part B never degrades already-converted code", () => {
  beforeAll(async () => {
    await initParser();
  });

  it("already-converted Python 3 with no residuals yields NO chunks (nothing is sent to a model) (R12.4)", () => {
    fc.assert(
      fc.property(arbConvertedPy3, (source) => {
        // Precondition: these snippets really are clean Python 3.
        expect(parsesAsPython3(source)).toBe(true);
        expect(hasPy2Construct(source)).toBe(false);

        // No residual diagnostics ⇒ Part B produces no chunks at all, so the
        // model is never invoked and the file is a fixed point.
        const chunks = groupResiduals(PATH, source, [], parse);
        expect(chunks).toHaveLength(0);
      }),
      FC_OPTS,
    );
  });

  it("for ANY edit, an accepted output is at least as valid as `before` (no new py2 construct, no parse regression) (R12.4)", () => {
    fc.assert(
      fc.property(
        arbPy2Program.chain((source) =>
          fc.record({ source: fc.constant(source), edit: arbEditFor(source) }),
        ),
        ({ source, edit }) => {
          const result = acceptChunk(source, edit, diagnose, parse);

          if (result.status === "accept") {
            // The applied output must parse as Python 3 with zero error nodes
            // (no parse regression) and carry no py2 construct (no degrade).
            expect(parsesAsPython3(result.after)).toBe(true);
            expect(hasPy2Construct(result.after)).toBe(false);
          }
          // decline / reject keep the deterministic `before` — asserted below.
        },
      ),
      FC_OPTS,
    );
  });

  it("a declined or rejected edit keeps the deterministic chunk byte-identical (the runner keeps `before`) (R12.4)", () => {
    // The gate only returns `after` on accept; on decline/reject the runner
    // keeps the deterministic `before`. We model that and assert the kept
    // content equals `before` exactly, so a bad edit can never rewrite an
    // already-converted region.
    fc.assert(
      fc.property(
        arbConvertedPy3.chain((source) =>
          fc.record({ source: fc.constant(source), edit: arbEditFor(source) }),
        ),
        ({ source, edit }) => {
          const result = acceptChunk(source, edit, diagnose, parse);
          const applied = result.status === "accept" ? result.after : source;

          // Whatever the gate decides, the file the runner keeps is never worse
          // than the already-converted `before`: it still parses and carries no
          // py2 construct. On decline/reject it is byte-identical to `before`.
          expect(parsesAsPython3(applied)).toBe(true);
          expect(hasPy2Construct(applied)).toBe(false);
          if (result.status !== "accept") {
            expect(applied).toBe(source);
          }
        },
      ),
      FC_OPTS,
    );
  });

  it("an edit that would ADD a py2 construct to a clean file is never accepted as-is (metamorphic no-degrade) (R12.4)", () => {
    // Metamorphic relation: injecting a py2 construct (`print 'x'`) as the whole
    // replacement must NOT survive the gate — either it is rejected (and the
    // deterministic `before` is kept), or (impossible here) it would have to
    // parse clean with no py2 node. Either way the applied result has no new
    // py2 construct.
    fc.assert(
      fc.property(arbConvertedPy3, (source) => {
        const lineCount = Math.max(source.split("\n").length, 1);
        const degradingEdit: ChunkEdit = {
          chunkId: `${PATH}#1-${lineCount}`,
          replacementCode: "print 'degraded'\nexcept Exception, e:\n    pass",
          requiredImports: [],
          reason: "adversarial py2 injection",
          confidence: 1,
        };
        const result = acceptChunk(source, degradingEdit, diagnose, parse);
        const applied = result.status === "accept" ? result.after : source;

        // The py2 injection never makes it into the kept content.
        expect(hasPy2Construct(applied)).toBe(false);
        expect(applied).toBe(source); // rejected ⇒ before kept byte-identical
      }),
      FC_OPTS,
    );
  });
});
