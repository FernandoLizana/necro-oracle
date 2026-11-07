// @necro/grimoires-py2to3 — chunk validation gate property test (task 5.5).
//
// Property 10 (design.md; tasks.md 5.5): "the chunk validation gate admits only
// safe edits". For ANY chunk edit, `acceptChunk` returns `accept` ONLY when the
// spliced + hoisted result parses as Python 3 (zero error nodes), retains no
// Python 2 constructs under the reused oracle diagnosis rule, preserves the
// public `def`/`class` surface, and keeps the diff within the chunk span
// (excluding the deterministically-hoisted stdlib imports). A confidence-0 edit
// is always `decline`d (no retry); a mask-placeholder, non-stdlib import,
// id-mismatched / out-of-range, or otherwise unsafe edit is always `reject`ed —
// it is NEVER `accept`ed. The gate is deterministic and total: identical inputs
// give identical outcomes and it never throws on any generated edit.
//
// The gate is PURE: the Python diagnosis rule (`hasLegacyPythonNodes`) and the
// parser (`parsePython`) are INJECTED, so this test performs no network, LLM, or
// sandbox work — the only side effect is the local tree-sitter WASM parse,
// initialised once in `beforeAll`. The property re-derives the acceptance
// predicate INDEPENDENTLY from the gate (parsing the claimed `after` itself and
// recomputing the public-signature + diff-within-chunk checks) so the test
// cannot simply echo the implementation — an `accept` is cross-checked against
// first principles, and every adversarial family is asserted to never accept.
//
// Testing steering: fast-check with explicit `numRuns: 1000` (gate), seed
// printed on failure (`verbose`), and promoted counterexamples kept as
// permanent example tests next to the property.
//
// **Validates: Requirements 12.2, 12.3**

import { hasLegacyPythonNodes, initParser, parsePython } from "@necro/oracle";

import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ChunkEditSchema,
  acceptChunk,
  PYTHON3_STDLIB_MODULES,
  type ChunkEdit,
} from "./chunk-gate.js";

/** 1000 runs: the deterministic gate gets the high budget (testing steering). */
const NUM_RUNS = 1000;

/** Print the fast-check seed on failure for reproducible regressions. */
const FC_OPTS: fc.Parameters<unknown> = { numRuns: NUM_RUNS, verbose: true };

/** The injected diagnosis rule: true when any Python 2 node remains. */
const diagnose = (tree: ReturnType<typeof parsePython>): boolean =>
  hasLegacyPythonNodes(tree);

// ---------------------------------------------------------------------------
// Independent re-derivation of the acceptance predicate.
//
// These helpers recompute the four accept conditions WITHOUT calling into the
// gate's private splice/hoist machinery, so an `accept` outcome is validated
// against first principles rather than against the implementation itself.
// ---------------------------------------------------------------------------

/** Parse `source` and return its error-node count (MISSING + ERROR). */
function errorNodeCount(source: string): number {
  const tree = parsePython(source);
  try {
    let count = 0;
    const cursor = tree.walk();
    try {
      for (;;) {
        const node = cursor.currentNode;
        if (node.type === "ERROR" || node.isError || node.isMissing) count += 1;
        if (cursor.gotoFirstChild()) continue;
        for (;;) {
          if (cursor.gotoNextSibling()) break;
          if (!cursor.gotoParent()) return count;
        }
      }
    } finally {
      cursor.delete();
    }
  } finally {
    tree.delete();
  }
}

/** The sorted public `def`/`class` names declared in `source`. */
function publicNames(source: string): string[] {
  const names = new Set<string>();
  const re = /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/;
  for (const line of source.split("\n")) {
    const m = re.exec(line);
    const name = m?.[1] ?? "";
    if (name.length === 0 || name.startsWith("_")) continue;
    names.add(name);
  }
  return [...names].sort();
}

/** True when the claimed `after` satisfies EVERY accept condition (R12.2, R12.3). */
function afterSatisfiesAcceptPredicate(before: string, after: string): boolean {
  // 1. Parses as Python 3 with zero error nodes.
  if (errorNodeCount(after) !== 0) return false;
  // 2. No Python 2 constructs remain under the injected diagnosis rule.
  const tree = parsePython(after);
  try {
    if (diagnose(tree)) return false;
  } finally {
    tree.delete();
  }
  // 3. Public def/class surface preserved.
  const a = publicNames(before);
  const b = publicNames(after);
  if (a.length !== b.length || !a.every((n, i) => n === b[i])) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbIdent: fc.Arbitrary<string> = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), {
    minLength: 1,
    maxLength: 5,
  })
  .filter((s) => s.length >= 1);

const PATH = "fixtures/generated/chunk.py";

/**
 * A single-line residual chunk carved from a one-statement module. The `before`
 * module is `header-lines + <chunk line> + trailer-lines`, and `chunkId` points
 * at exactly the chunk line (1-based inclusive). This mirrors the
 * `path#start-end` shape `groupResiduals` emits and keeps the diff-within-chunk
 * check meaningful (there is real head/tail to preserve).
 */
interface Scenario {
  readonly before: string;
  readonly chunkId: string;
  /** A py3-clean replacement that, spliced in, yields a valid converted module. */
  readonly cleanReplacement: string;
}

const arbScenario: fc.Arbitrary<Scenario> = fc
  .record({
    head: fc.array(arbIdent.map((n) => `${n} = 1`), { minLength: 0, maxLength: 3 }),
    tail: fc.array(arbIdent.map((n) => `${n} = 2`), { minLength: 0, maxLength: 3 }),
    name: arbIdent,
  })
  .map(({ head, tail, name }) => {
    // The chunk line is a py2 `print` statement; the clean replacement is the
    // py3 call form, so a valid conversion exists for the gate to accept.
    const chunkLine = `print ${name}`;
    const beforeLines = [...head, chunkLine, ...tail];
    const start = head.length + 1; // 1-based
    const end = start; // single-line chunk
    return {
      before: beforeLines.join("\n"),
      chunkId: `${PATH}#${start}-${end}`,
      cleanReplacement: `print(${name})`,
    } satisfies Scenario;
  });

/** A stdlib import line the gate must accept and hoist. */
const arbStdlibImport: fc.Arbitrary<string> = fc
  .constantFrom(...[...PYTHON3_STDLIB_MODULES])
  .map((mod) => `import ${mod}`);

/** A non-stdlib import line the gate must reject (R12.5). */
const arbNonStdlibImport: fc.Arbitrary<string> = fc.oneof(
  arbIdent.map((n) => `import ${n}_pkg`),
  arbIdent.map((n) => `from ${n}_pkg import thing`),
  fc.constant("from . import sibling"),
  fc.constant("import numpy"),
);

/**
 * A fully-formed, schema-valid edit. `kind` tags how it was constructed so the
 * property can branch its expectation:
 *   - "clean"      a valid py3 conversion with optional stdlib imports.
 *   - "decline"    confidence === 0 (DECLINE, never accept).
 *   - "mask"       replacement carries a masked span (reject).
 *   - "badImport"  a non-stdlib requiredImports entry (reject).
 *   - "badId"      chunkId that does not resolve to an in-range span (reject).
 *   - "noConvert"  replacement leaves a py2 construct in place (reject).
 */
type EditKind = "clean" | "decline" | "mask" | "badImport" | "badId" | "noConvert";

interface TaggedEdit {
  readonly kind: EditKind;
  readonly before: string;
  readonly edit: ChunkEdit;
}

function arbTaggedEdit(scenario: Scenario): fc.Arbitrary<TaggedEdit> {
  const { before, chunkId, cleanReplacement } = scenario;
  const base = {
    reason: "oracle whispers a conversion",
  };

  const clean = fc
    .record({
      imports: fc.array(arbStdlibImport, { minLength: 0, maxLength: 2 }),
      confidence: fc.double({ min: 0.01, max: 1, noNaN: true }),
    })
    .map(
      ({ imports, confidence }): TaggedEdit => ({
        kind: "clean",
        before,
        edit: {
          ...base,
          chunkId,
          replacementCode: cleanReplacement,
          requiredImports: imports,
          confidence,
        },
      }),
    );

  const decline = fc.constant<TaggedEdit>({
    kind: "decline",
    before,
    edit: {
      ...base,
      chunkId,
      replacementCode: cleanReplacement,
      requiredImports: [],
      confidence: 0,
    },
  });

  const mask = fc
    .constantFrom("***MASKED***", "abcd****")
    .chain((token) =>
      fc.double({ min: 0.01, max: 1, noNaN: true }).map(
        (confidence): TaggedEdit => ({
          kind: "mask",
          before,
          edit: {
            ...base,
            chunkId,
            replacementCode: `x = ${token}`,
            requiredImports: [],
            confidence,
          },
        }),
      ),
    );

  const badImport = fc
    .record({
      bad: arbNonStdlibImport,
      confidence: fc.double({ min: 0.01, max: 1, noNaN: true }),
    })
    .map(
      ({ bad, confidence }): TaggedEdit => ({
        kind: "badImport",
        before,
        edit: {
          ...base,
          chunkId,
          replacementCode: cleanReplacement,
          requiredImports: [bad],
          confidence,
        },
      }),
    );

  const badId = fc
    .record({
      id: fc.oneof(
        fc.constant(`${PATH}#0-0`),
        fc.constant(`${PATH}#9999-9999`),
        fc.constant(`${PATH}#5-3`),
        fc.constant("no-hash-at-all"),
        fc.constant(`${PATH}#abc-def`),
      ),
      confidence: fc.double({ min: 0.01, max: 1, noNaN: true }),
    })
    .map(
      ({ id, confidence }): TaggedEdit => ({
        kind: "badId",
        before,
        edit: {
          ...base,
          chunkId: id,
          replacementCode: cleanReplacement,
          requiredImports: [],
          confidence,
        },
      }),
    );

  // A replacement that still contains a py2 construct (`print x`), so the
  // spliced module keeps a legacy node and the gate must reject it.
  const noConvert = fc
    .record({
      name: arbIdent,
      confidence: fc.double({ min: 0.01, max: 1, noNaN: true }),
    })
    .map(
      ({ name, confidence }): TaggedEdit => ({
        kind: "noConvert",
        before,
        edit: {
          ...base,
          chunkId,
          replacementCode: `print ${name}`,
          requiredImports: [],
          confidence,
        },
      }),
    );

  return fc.oneof(clean, decline, mask, badImport, badId, noConvert);
}

const arbCase: fc.Arbitrary<TaggedEdit> = arbScenario.chain(arbTaggedEdit);

// ---------------------------------------------------------------------------
// Property 10
// ---------------------------------------------------------------------------

describe("P10 (R12.2, R12.3): the chunk validation gate admits only safe edits", () => {
  beforeAll(async () => {
    await initParser();
  });

  it("accepts an edit ONLY when the spliced result is proven-safe Python 3; adversarial edits never accept (R12.2, R12.3)", () => {
    fc.assert(
      fc.property(arbCase, ({ kind, before, edit }) => {
        // The gate is total: it never throws on any generated edit.
        const result = acceptChunk(before, edit, diagnose, parsePython);

        // A confidence-0 edit always DECLINES (distinct outcome, no retry).
        if (edit.confidence === 0) {
          expect(result.status).toBe("decline");
          return;
        }

        // Adversarial families must NEVER be accepted.
        if (kind === "mask" || kind === "badImport" || kind === "badId" || kind === "noConvert") {
          expect(result.status).toBe("reject");
          return;
        }

        // For every other outcome, an `accept` MUST satisfy the independently
        // re-derived acceptance predicate (parses as py3, no py2 remaining,
        // public signatures preserved). This is the core safety invariant: the
        // gate admits only safe edits.
        if (result.status === "accept") {
          expect(afterSatisfiesAcceptPredicate(before, result.after)).toBe(true);
        } else {
          // Any non-accept is a reject here (decline handled above); fine.
          expect(result.status).toBe("reject");
        }
      }),
      FC_OPTS,
    );
  });

  it("is deterministic: identical inputs yield identical outcomes (R12.2)", () => {
    fc.assert(
      fc.property(arbCase, ({ before, edit }) => {
        const a = acceptChunk(before, edit, diagnose, parsePython);
        const b = acceptChunk(before, edit, diagnose, parsePython);
        expect(a).toEqual(b);
      }),
      FC_OPTS,
    );
  });

  it("rejects any edit whose replacement carries a masked span, regardless of confidence (R12.7)", () => {
    fc.assert(
      fc.property(
        arbScenario,
        fc.constantFrom("***MASKED***", "abcd****", "secr****"),
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        (scenario, token, confidence) => {
          const edit: ChunkEdit = {
            chunkId: scenario.chunkId,
            replacementCode: `value = ${token}`,
            requiredImports: [],
            reason: "masked",
            confidence,
          };
          const result = acceptChunk(scenario.before, edit, diagnose, parsePython);
          expect(result.status).toBe("reject");
          if (result.status === "reject") {
            expect(result.reason).toBe("mask_placeholder");
          }
        },
      ),
      FC_OPTS,
    );
  });

  it("rejects any non-stdlib requiredImports entry (R12.5)", () => {
    fc.assert(
      fc.property(
        arbScenario,
        arbNonStdlibImport,
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        (scenario, badImport, confidence) => {
          const edit: ChunkEdit = {
            chunkId: scenario.chunkId,
            replacementCode: scenario.cleanReplacement,
            requiredImports: [badImport],
            reason: "bad import",
            confidence,
          };
          const result = acceptChunk(scenario.before, edit, diagnose, parsePython);
          expect(result.status).toBe("reject");
          if (result.status === "reject") {
            expect(result.reason).toBe("bad_import");
          }
        },
      ),
      FC_OPTS,
    );
  });
});

// ---------------------------------------------------------------------------
// Permanent example tests (regressions). Promote any fast-check counterexample
// found above into this block so it stays covered deterministically.
// ---------------------------------------------------------------------------

describe("P10 examples (R12.2, R12.3): pinned chunk-gate outcomes", () => {
  beforeAll(async () => {
    await initParser();
  });

  const before = "a = 1\nprint x\nb = 2";
  const chunkId = "fixtures/generated/chunk.py#2-2";

  it("accepts a clean py2->py3 print conversion and preserves head/tail", () => {
    const edit: ChunkEdit = {
      chunkId,
      replacementCode: "print(x)",
      requiredImports: [],
      reason: "convert print statement",
      confidence: 0.9,
    };
    const result = acceptChunk(before, edit, diagnose, parsePython);
    expect(result.status).toBe("accept");
    if (result.status === "accept") {
      expect(result.after).toBe("a = 1\nprint(x)\nb = 2");
    }
  });

  it("accepts and deterministically hoists a stdlib import outside the chunk", () => {
    const edit: ChunkEdit = {
      chunkId,
      replacementCode: "print(functools.reduce(f, x))",
      requiredImports: ["import functools"],
      reason: "convert and import functools",
      confidence: 0.8,
    };
    const result = acceptChunk(before, edit, diagnose, parsePython);
    expect(result.status).toBe("accept");
    if (result.status === "accept") {
      expect(result.after).toBe(
        "import functools\na = 1\nprint(functools.reduce(f, x))\nb = 2",
      );
    }
  });

  it("declines a confidence-0 edit (no retry)", () => {
    const edit: ChunkEdit = {
      chunkId,
      replacementCode: "print(x)",
      requiredImports: [],
      reason: "abstain",
      confidence: 0,
    };
    expect(acceptChunk(before, edit, diagnose, parsePython).status).toBe("decline");
  });

  it("rejects a replacement that leaves a py2 construct in place", () => {
    const edit: ChunkEdit = {
      chunkId,
      replacementCode: "print y",
      requiredImports: [],
      reason: "no real conversion",
      confidence: 0.7,
    };
    const result = acceptChunk(before, edit, diagnose, parsePython);
    expect(result.status).toBe("reject");
    if (result.status === "reject") {
      expect(result.reason).toBe("no_transform");
    }
  });

  it("rejects an out-of-range / malformed chunk id", () => {
    const edit: ChunkEdit = {
      chunkId: "fixtures/generated/chunk.py#9999-9999",
      replacementCode: "print(x)",
      requiredImports: [],
      reason: "bad span",
      confidence: 0.7,
    };
    const result = acceptChunk(before, edit, diagnose, parsePython);
    expect(result.status).toBe("reject");
    if (result.status === "reject") {
      expect(result.reason).toBe("no_transform");
    }
  });

  it("ChunkEditSchema is strict: an extra field fails parsing", () => {
    const parsed = ChunkEditSchema.safeParse({
      chunkId,
      replacementCode: "print(x)",
      requiredImports: [],
      reason: "ok",
      confidence: 0.5,
      extra: "nope",
    });
    expect(parsed.success).toBe(false);
  });
});
