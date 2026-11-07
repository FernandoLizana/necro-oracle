// @necro/grimoires-lovers-js — Property 15 (R17.4, R17.5, R17.6): deterministic
// fallback on failure, with the path reported (task 8.11).
//
// For an arbitrary RESURRECTED Python 3 module whose top-level functions are
// bindable, drive the REAL pipeline (the real deterministic `extractPlan` ->
// the real `LocalLoversRunner` PLAN -> GENERATE -> VALIDATE -> EMIT, through the
// real grimoire barrel) under two GENERATE outcomes and assert the result's
// `path` accurately reflects which branch produced the pair:
//
//   - LLM path (R17.5, R17.6): WHEN the Mock `LlmPort` returns the four
//     gate-valid `buildTemplatePair(plan)` artifacts (so the real gate passes),
//     the emitted `LoversResult` reports `path === "llm"` and the pair's four
//     LLM artifacts are byte-identical to `buildTemplatePair(plan)`.
//
//   - Template path (R17.4, R17.6): WHEN the Mock returns a declining /
//     malformed / schema-valid-but-gate-failing output on BOTH the first
//     attempt AND the one retry, the `LocalLoversRunner` falls back to the
//     deterministic AST-template bridge; the emitted `LoversResult` reports
//     `path === "template"` and its pair is BYTE-IDENTICAL to
//     `buildTemplatePair(plan)`.
//
// On BOTH branches the deterministic `pythonHeart` is byte-identical to
// `buildDeterministicHeart(plan)` (design item 3 "the heart is always
// deterministic") — the model never writes it.
//
// GROUNDING. The property drives the REAL exports: `extractPlan` (task 8.2)
// produces the plan (guaranteed to carry only functions whose name + bound
// parameter names are valid, non-reserved JavaScript identifiers), the REAL
// `LocalLoversRunner` (task 8.6) runs the full pipeline through the REAL
// `LoversGrimoirePort` built from this grimoire's REAL barrel exports, and the
// REAL `validateLovers` gate decides accept vs fallback. Only the side-effecting
// seams are faked: a deterministic Mock `LlmPort` (never a network call) and a
// pure `ModelRouterPort`, plus an in-memory clock/ledger.
//
// A fixed clock far from the deadline guarantees the one retry is always taken
// before the fallback (so the template branch exercises the full
// fail-then-retry-then-fall-back path, R17.4), and the generator excludes
// JavaScript reserved words / Python keywords because `extractPlan` drops
// reserved names (which would skew the bindable set).
//
// Pure / Mock only: no network, no real LLM, no sandbox. The oracle tree-sitter
// parsers (python + javascript) are armed once via `initParser()`.
//
// Validates: Requirements 17.4, 17.5, 17.6

import {
  extractPlan,
  LocalLoversRunner,
  type ClockPort,
  type LedgerPort,
  type LlmPort,
  type LlmRequest,
  type LlmResult,
  type UsageRecord,
  type LoversEmit,
  type LoversPair,
  type LoversPlan,
  type LoversPorts,
  type LoversRunnerInput,
  type ModelRouterPort,
  type ModelTier,
  type RouterSignals,
} from "@necro/coven";
import { initParser } from "@necro/oracle";
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

/** A frozen clock at 0 — far from the 90 s budget, so no call/retry is skipped. */
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

/** A no-op phase reporter. */
const nullEmit: LoversEmit = { phase: () => {} };

/** Discriminate GENERATE from PLAN by the fixed system-prompt text each step emits. */
function isGenerateRequest(req: LlmRequest): boolean {
  // The real GENERATE step's system prompt names the "JavaScript side"; the PLAN
  // step's does not. Mirrors `binding-parse.pbt.test.ts`.
  return req.system.includes("JavaScript side");
}

/** A tiny usage record so the souls fold always has something to sum. */
function usageFor(req: LlmRequest): UsageRecord {
  return {
    model: req.model ?? "mock-fast",
    promptTokens: 1,
    completionTokens: 1,
    costUsd: 0,
  };
}

/**
 * A deterministic Mock `LlmPort` that always accepts PLAN (returns the
 * serialized plan) and, for GENERATE, returns the four gate-VALID artifacts of
 * the real deterministic `buildTemplatePair(plan)` — so the real gate passes
 * and the runner emits the LLM path (`path === "llm"`). Never a network call.
 */
function acceptingLlm(plan: LoversPlan): LlmPort {
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
    complete: async (req: LlmRequest): Promise<LlmResult> => ({
      text: isGenerateRequest(req) ? generateJson : planJson,
      cached: false,
      usage: usageFor(req),
    }),
  };
}

/**
 * How a GENERATE response fails. Each kind is rejected by the runner on BOTH
 * the first attempt and the one retry, forcing the deterministic fallback:
 *   - `malformed`: not JSON at all (schema `safeParse` fails — a declining /
 *     garbage model reply);
 *   - `schemaFail`: valid JSON but missing required artifacts (fails the strict
 *     `LoversPairLlmSchema`);
 *   - `gateFail`: schema-VALID four artifacts (non-empty strings) that are NOT
 *     the deterministic template, so the real `validateLovers` gate rejects the
 *     assembled pair (unparseable JS/Python, wrong contract `$defs`, …).
 */
type FailKind = "malformed" | "schemaFail" | "gateFail";

const arbFailKind: fc.Arbitrary<FailKind> = fc.constantFrom(
  "malformed",
  "schemaFail",
  "gateFail",
);

/**
 * A deterministic Mock `LlmPort` that always accepts PLAN but makes EVERY
 * GENERATE attempt fail in the chosen way. The runner therefore calls GENERATE
 * twice (first attempt + the one retry), both fail, and it falls back to the
 * deterministic AST-template bridge (`path === "template"`). Never a network
 * call.
 */
function failingLlm(plan: LoversPlan, kind: FailKind): LlmPort {
  const planJson = JSON.stringify(plan);
  const failingGenerate = (): string => {
    switch (kind) {
      case "malformed":
        // Not JSON — a declining / garbage reply the schema cannot parse.
        return "I'm sorry, I cannot complete this binding request.";
      case "schemaFail":
        // Valid JSON, but missing required artifacts => strict schema fails.
        return JSON.stringify({ jsBeloved: "export const x = 1;" });
      case "gateFail":
      default:
        // Schema-valid four artifacts that are NOT the deterministic template,
        // so the real gate rejects the assembled pair (the JS/Python do not
        // parse cleanly and the contract $defs do not equal the plan names).
        return JSON.stringify({
          jsBeloved: "this is ( not valid javascript {{{",
          contractSchema: "{ not a json schema",
          pythonTests: "def (:: broken python",
          jsTests: "}}} also not valid js",
        });
    }
  };
  return {
    providerId: "mock",
    complete: async (req: LlmRequest): Promise<LlmResult> => ({
      text: isGenerateRequest(req) ? failingGenerate() : planJson,
      cached: false,
      usage: usageFor(req),
    }),
  };
}

// ---------------------------------------------------------------------------
// Smart generator: small RESURRECTED Python 3 modules whose top-level functions
// have JSON-serialisable signatures AND emittable-JS names, so `extractPlan`
// marks them bindable. Excludes JS reserved words / Python keywords because
// `extractPlan` drops reserved names (a dropped name would skew the plan).
// ---------------------------------------------------------------------------

/**
 * Names that are valid identifiers in BOTH Python and JavaScript but reserved
 * (keyword) in one of them. A generated name must never collide with any: the
 * source must stay valid Python AND the emitted beloved must stay valid
 * JavaScript, and a JS-reserved name is marked non-bindable upstream (so it
 * would be dropped from the plan and skew the property).
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
// Shared driver: build the real runner input + ports for a given LlmPort.
// ---------------------------------------------------------------------------

function portsFor(llm: LlmPort): LoversPorts {
  return {
    clock: fixedClock(),
    ledger: nullLedger(),
    llm,
    router: mockRouter(),
  };
}

const INPUT = (source: string): LoversRunnerInput => ({
  source,
  file: "resurrected.py",
  targetLang: "javascript",
  soulSource: "ORACLE",
  demo: false,
});

// ---------------------------------------------------------------------------
// The property.
// ---------------------------------------------------------------------------

describe("Property 15 (R17.4, R17.5, R17.6): deterministic fallback on failure, with path reported", () => {
  it("reports path=llm on a gate-valid generation and path=template (byte-identical fallback) on repeated failure", async () => {
    await fc.assert(
      fc.asyncProperty(arbFunctions, arbFailKind, async (fns, failKind) => {
        const source = renderModule(fns);

        // Ground on the REAL extractPlan output. If extraction rejects this
        // source (nothing bindable), there is no plan to bind — vacuously true.
        const extracted = extractPlan(source);
        if (!extracted.ok) return;
        const plan: LoversPlan = extracted.plan;

        // The deterministic artifacts the runner must reproduce byte-for-byte.
        const expectedTemplate: LoversPair = buildTemplatePair(plan);
        const expectedHeart = buildDeterministicHeart(plan);
        // Internal consistency: the heart buildTemplatePair embeds IS the
        // deterministic heart (anchors the "identical on both paths" claim).
        expect(expectedTemplate.pythonHeart).toBe(expectedHeart);

        const runner = new LocalLoversRunner(grimoirePort);

        // --- Branch A: a gate-valid generation reports path === "llm" --------
        const llmResult = await runner.run(
          INPUT(source),
          portsFor(acceptingLlm(plan)),
          nullEmit,
        );
        expect(llmResult.path).toBe("llm");
        // The four LLM artifacts are exactly what the Mock returned (the
        // deterministic template artifacts).
        expect(llmResult.pair.jsBeloved).toBe(expectedTemplate.jsBeloved);
        expect(llmResult.pair.contractSchema).toBe(expectedTemplate.contractSchema);
        expect(llmResult.pair.pythonTests).toBe(expectedTemplate.pythonTests);
        expect(llmResult.pair.jsTests).toBe(expectedTemplate.jsTests);
        // The deterministic heart is byte-identical on the LLM path (item 3).
        expect(llmResult.pair.pythonHeart).toBe(expectedHeart);

        // --- Branch B: repeated failure falls back, reports path==="template"-
        const templateResult = await runner.run(
          INPUT(source),
          portsFor(failingLlm(plan, failKind)),
          nullEmit,
        );
        expect(templateResult.path).toBe("template");
        // The fallback pair is BYTE-IDENTICAL to buildTemplatePair(plan) (R17.4).
        expect(templateResult.pair.pythonHeart).toBe(expectedTemplate.pythonHeart);
        expect(templateResult.pair.jsBeloved).toBe(expectedTemplate.jsBeloved);
        expect(templateResult.pair.contractSchema).toBe(expectedTemplate.contractSchema);
        expect(templateResult.pair.pythonTests).toBe(expectedTemplate.pythonTests);
        expect(templateResult.pair.jsTests).toBe(expectedTemplate.jsTests);

        // --- The pythonHeart is byte-identical across BOTH paths (item 3) ----
        expect(templateResult.pair.pythonHeart).toBe(llmResult.pair.pythonHeart);

        // --- The path field accurately reflects the producing branch (R17.6) -
        // Two runs over the SAME input/plan differ ONLY in the generation
        // outcome, and the reported path differs accordingly.
        expect(llmResult.path).not.toBe(templateResult.path);
      }),
      { numRuns: 300 },
    );
  });
});
