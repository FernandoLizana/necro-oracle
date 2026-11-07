// @necro/grimoires-lovers-js — Property 13 (R17.1, R17.2): both sides of the
// emitted binding PARSE and the contract VALIDATES (task 8.9).
//
// For an arbitrary accepted `LoversResult` — produced by driving the REAL
// pipeline (the real deterministic `extractPlan` -> the real `LocalLoversRunner`
// PLAN -> GENERATE -> VALIDATE -> EMIT, through the real grimoire barrel) over
// generated RESURRECTED Python 3 source — the FIVE emitted artifacts must be
// syntactically well-formed:
//   - `pythonHeart`  parses as Python 3 with ZERO error nodes (R17.1),
//   - `pythonTests`  parses as Python 3 with ZERO error nodes (R17.1),
//   - `jsBeloved`    parses as JavaScript with ZERO error nodes (R17.1),
//   - `jsTests`      parses as JavaScript with ZERO error nodes (R17.1),
//   - `contractSchema` is a valid contract — `parseContract(...).ok === true`
//     (a JSON Schema draft 2020-12 document; ajv/JS-only, no python) (R17.2).
//
// GROUNDING. The property drives the REAL pipeline end to end: the real
// `extractPlan` (task 8.2) produces the plan — now GUARANTEED (task 8.9's
// Part-1 fix) to carry only functions whose name and bound parameter names are
// valid, non-reserved JavaScript identifiers, so the bridge always emits valid
// JavaScript; the real `LocalLoversRunner` (task 8.6) runs the full pipeline
// through the real `LoversGrimoirePort` built from this grimoire's real barrel
// exports. Only the side-effecting seams are mocked: a deterministic Mock
// `LlmPort` and a pure `ModelRouterPort`, plus an in-memory clock/ledger.
//
// To exercise the ACCEPTED LLM path (`path === "llm"`) deterministically, the
// Mock `LlmPort` returns, for the GENERATE unit, the four artifacts of the real
// deterministic `buildTemplatePair(plan)` — derived purely from the plan and
// therefore gate-valid. The runner still assembles the full pair with its own
// deterministic `pythonHeart`, so the accepted result exercises the real gate.
//
// Pure / Mock only: no network, no real LLM, no sandbox. The oracle tree-sitter
// parsers (python + javascript) are armed once via `initParser()`.
//
// Validates: Requirements 17.1, 17.2

import {
  extractPlan,
  LocalLoversRunner,
  parseContract,
  type ClockPort,
  type LedgerPort,
  type LlmPort,
  type LlmRequest,
  type LlmResult,
  type LoversEmit,
  type LoversPlan,
  type LoversPorts,
  type LoversRunnerInput,
  type ModelRouterPort,
  type ModelTier,
  type RouterSignals,
} from "@necro/coven";
import { initParser, parseJavascript, parsePython, type Tree } from "@necro/oracle";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildDeterministicHeart,
  buildTemplatePair,
  GENERATE_STEP,
  PLAN_STEP,
  validateLovers,
} from "./index.js";

beforeAll(async () => {
  await initParser();
});

// ---------------------------------------------------------------------------
// The real LoversGrimoirePort, built from this grimoire's real barrel exports.
// ---------------------------------------------------------------------------

const grimoirePort = {
  plan: PLAN_STEP,
  generate: GENERATE_STEP,
  buildDeterministicHeart,
  buildTemplatePair,
  validateLovers,
} as const;

// ---------------------------------------------------------------------------
// Pure in-memory ports (no side effects, no network).
// ---------------------------------------------------------------------------

/** A frozen clock: deterministic time, far from the deadline so no call is skipped. */
function fixedClock(): ClockPort {
  return { nowMs: () => 0 };
}

/** A no-op append-only ledger (we assert on the result, not the ledger here). */
function nullLedger(): LedgerPort {
  return { append: async () => {} };
}

/** A pure router that always resolves to a fixed model id (never routes network). */
function mockRouter(): ModelRouterPort {
  return {
    route: (_signals: RouterSignals): ModelTier => "FAST",
    resolveModel: (tier: ModelTier): string => (tier === "STRONG" ? "mock-strong" : "mock-fast"),
  };
}

/**
 * A deterministic Mock `LlmPort` for ONE binding of `plan`. It never touches a
 * network: it discriminates PLAN from GENERATE by the fixed system-prompt text
 * each real step emits (GENERATE's system names the "JavaScript side"), and
 * returns:
 *   - PLAN:     the serialized `plan` (so the runner accepts it unchanged), and
 *   - GENERATE: the four LLM artifacts of the real deterministic
 *               `buildTemplatePair(plan)` (which pass the real gate), so the
 *               runner emits the LLM path (`path === "llm"`).
 */
function mockLlm(plan: LoversPlan): LlmPort {
  const planJson = JSON.stringify(plan);
  const template = buildTemplatePair(plan);
  const generateJson = JSON.stringify({
    jsBeloved: template.jsBeloved,
    contractSchema: template.contractSchema,
    pythonTests: template.pythonTests,
    jsTests: template.jsTests,
  });
  return {
    providerId: "mock",
    complete: async (req: LlmRequest): Promise<LlmResult> => {
      const isGenerate = req.system.includes("JavaScript side");
      return {
        text: isGenerate ? generateJson : planJson,
        cached: false,
        usage: {
          model: req.model ?? "mock-fast",
          promptTokens: 1,
          completionTokens: 1,
          costUsd: 0,
        },
      };
    },
  };
}

/** A no-op phase reporter. */
const nullEmit: LoversEmit = { phase: () => {} };

// ---------------------------------------------------------------------------
// Smart generator: small RESURRECTED Python 3 modules whose top-level functions
// have JSON-serialisable signatures AND emittable-JS names, so `extractPlan`
// marks them bindable.
// ---------------------------------------------------------------------------

/**
 * Names that are valid identifiers in BOTH Python and JavaScript but reserved
 * (keyword) in one of them. A generated name must never collide with any of
 * them: the source must stay valid Python AND the emitted beloved must stay
 * valid JavaScript (and a JS-reserved name is marked non-bindable upstream, so
 * it would be dropped from the plan and skew the property).
 */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
  // JavaScript reserved words (all legal Python identifiers).
  "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for",
  "function", "if", "import", "in", "instanceof", "new", "null", "return", "super",
  "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while",
  "with", "let", "static", "yield", "await", "implements", "interface", "package",
  "private", "protected", "public",
  // Python keywords (would make the generated module invalid Python).
  "and", "as", "assert", "async", "def", "del", "elif", "except", "from",
  "global", "is", "lambda", "nonlocal", "not", "or", "pass", "raise",
  "None", "True", "False",
]);

/** A name valid in BOTH Python and JavaScript, never a keyword in either. */
const arbName = fc
  .tuple(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
    fc.stringMatching(/^[a-z0-9_]{0,7}$/),
  )
  .map(([head, tail]) => `${head}${tail}`)
  .filter((name) => !RESERVED_NAMES.has(name));

/** A JSON-serialisable Python parameter type (keeps the function bindable). */
const arbPyType = fc.constantFrom("int", "str", "float", "bool", "list", "dict");

/** A single parameter: `name` (required) or `name=<default>` (optional). */
const arbParam = fc.record({
  name: arbName,
  pyType: arbPyType,
  hasDefault: fc.boolean(),
});

/** Default literal for a Python type (used only for optional params). */
function pyDefault(pyType: string): string {
  switch (pyType) {
    case "int":
      return "0";
    case "float":
      return "0.0";
    case "str":
      return '""';
    case "bool":
      return "False";
    case "list":
      return "[]";
    case "dict":
    default:
      return "{}";
  }
}

/** A single top-level function definition with a JSON-serialisable signature. */
interface GenFn {
  readonly name: string;
  readonly params: ReadonlyArray<{ name: string; pyType: string; hasDefault: boolean }>;
  readonly returnType: string;
}

/**
 * Generate 1..8 functions with DISTINCT names and, within each, DISTINCT param
 * names (a Python signature cannot repeat a name).
 */
const arbFunctions = fc
  .uniqueArray(
    fc.record({
      name: arbName,
      params: fc.uniqueArray(arbParam, {
        selector: (p) => p.name,
        minLength: 0,
        maxLength: 4,
      }),
      returnType: arbPyType,
    }),
    { selector: (fn) => fn.name, minLength: 1, maxLength: 8 },
  )
  .map((fns): ReadonlyArray<GenFn> => {
    // Python requires that a non-default param never follows a default one.
    return fns.map((fn) => ({
      ...fn,
      params: [...fn.params].sort((a, b) => Number(a.hasDefault) - Number(b.hasDefault)),
    }));
  });

/** Render a module of top-level functions to RESURRECTED Python 3 source. */
function renderModule(fns: ReadonlyArray<GenFn>): string {
  return fns
    .map((fn) => {
      const params = fn.params
        .map((p) => (p.hasDefault ? `${p.name}: ${p.pyType} = ${pyDefault(p.pyType)}` : `${p.name}: ${p.pyType}`))
        .join(", ");
      return `def ${fn.name}(${params}) -> ${fn.returnType}:\n    return ${pyDefault(fn.returnType)}\n`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Pure parse helper: count tree-sitter error nodes (zero == clean parse).
// ---------------------------------------------------------------------------

/**
 * Count `ERROR`/MISSING nodes in the tree `parse(source)` produces. Zero means
 * the artifact is syntactically well-formed under that grammar. Mirrors the
 * gate's `countErrorNodes`. Deletes the tree/cursor so the WASM runtime frees.
 */
function errorNodeCount(parse: (source: string) => Tree, source: string): number {
  const tree = parse(source);
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

// ---------------------------------------------------------------------------
// The property.
// ---------------------------------------------------------------------------

describe("Property 13 (R17.1, R17.2): both sides parse and the contract validates", () => {
  it("every accepted LoversResult emits Python/JS that parse with zero error nodes and a valid contract", async () => {
    await fc.assert(
      fc.asyncProperty(arbFunctions, async (fns) => {
        const source = renderModule(fns);

        // Ground on the REAL extractPlan output. If extraction rejects this
        // source (nothing bindable), there is no plan to bind — the property is
        // vacuously true for that input.
        const extracted = extractPlan(source);
        if (!extracted.ok) return;
        const plan: LoversPlan = extracted.plan;

        // Drive the REAL runner through the accepted LLM path.
        const runner = new LocalLoversRunner(grimoirePort);
        const ports: LoversPorts = {
          clock: fixedClock(),
          ledger: nullLedger(),
          llm: mockLlm(plan),
          router: mockRouter(),
        };
        const input: LoversRunnerInput = {
          source,
          file: "resurrected.py",
          targetLang: "javascript",
          soulSource: "ORACLE",
          demo: false,
        };

        const result = await runner.run(input, ports, nullEmit);

        // The Mock returns the deterministic template artifacts, which pass the
        // real gate, so the accepted result must take the LLM path.
        expect(result.path).toBe("llm");

        const { pythonHeart, pythonTests, jsBeloved, jsTests, contractSchema } = result.pair;

        // --- Both Python artifacts parse with ZERO error nodes (R17.1) ------
        expect(errorNodeCount(parsePython, pythonHeart), "pythonHeart must parse cleanly").toBe(0);
        expect(errorNodeCount(parsePython, pythonTests), "pythonTests must parse cleanly").toBe(0);

        // --- Both JavaScript artifacts parse with ZERO error nodes (R17.1) --
        expect(errorNodeCount(parseJavascript, jsBeloved), "jsBeloved must parse cleanly").toBe(0);
        expect(errorNodeCount(parseJavascript, jsTests), "jsTests must parse cleanly").toBe(0);

        // --- The contract is a valid contract (R17.2; ajv/JS-only, no python) -
        const contract = parseContract(contractSchema);
        expect(contract.ok, "contractSchema must be a valid contract").toBe(true);
        if (contract.ok) {
          // The validated contract declares the draft 2020-12 dialect.
          expect(contract.value.$schema).toContain("2020-12");
        }
      }),
      { numRuns: 300 },
    );
  });
});
