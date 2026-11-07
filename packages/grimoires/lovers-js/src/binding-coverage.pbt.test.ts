// @necro/grimoires-lovers-js — Property 12 (R17.3): every planned function
// exists on BOTH sides of the emitted binding (task 8.8).
//
// For an arbitrary set of planned functions — derived by the REAL deterministic
// `extractPlan` over generated RESURRECTED Python 3 source — every function the
// plan names must appear on BOTH sides of the accepted `LoversResult` (the LLM
// path, `path === "llm"`): a `jsBeloved` client member AND a Python heart entry,
// with a request/response pair in the contract schema. No planned function is
// dropped and no unplanned function is invented; name equality holds across the
// JavaScript beloved, the Python heart, and the contract `$defs`.
//
// GROUNDING. The property drives the REAL pipeline end to end: the real
// `extractPlan` (task 8.2) produces the plan; the real `LocalLoversRunner`
// (task 8.6) runs PLAN -> GENERATE -> VALIDATE -> EMIT through the real
// `LoversGrimoirePort` built from this grimoire's real barrel exports
// (`PLAN_STEP`, `GENERATE_STEP`, `buildDeterministicHeart`, `buildTemplatePair`,
// `validateLovers`). Only the side-effecting seams are mocked: a deterministic
// Mock `LlmPort` and a pure `ModelRouterPort`, plus an in-memory clock/ledger.
//
// To force the ACCEPTED LLM path (`path === "llm"`) deterministically, the Mock
// `LlmPort` returns, for the GENERATE unit, the four artifacts of the real
// deterministic `buildTemplatePair(plan)` — which are derived purely from the
// plan and therefore pass the real `validateLovers` gate. The runner still
// assembles the full pair with its own deterministic `pythonHeart`, so the
// accepted result exercises the real gate and the real name-equality checks.
//
// Pure / Mock only: no network, no real LLM, no sandbox. The oracle tree-sitter
// parsers are armed once via `initParser()`.
//
// Validates: Requirements 17.3

import {
  denyScan,
  extractPlan,
  LocalLoversRunner,
  parseContract,
  type ClockPort,
  type DenyScanLang,
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
import { initParser, parseJavascript, parsePython } from "@necro/oracle";
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
 * each real step emits (PLAN's system names the "JSON contract"; GENERATE's
 * names the "JavaScript side"), and returns:
 *   - PLAN:     the serialized `plan` (so the runner accepts it unchanged), and
 *   - GENERATE: the four LLM artifacts of the real deterministic
 *               `buildTemplatePair(plan)` (which pass the real gate), so the
 *               runner emits the LLM path (`path === "llm"`).
 */
function mockLlm(plan: LoversPlan): LlmPort {
  const planJson = JSON.stringify(plan);
  const template = buildTemplatePair(plan);
  // The GENERATE output shape is LoversPairLlm (the four artifacts, NO heart).
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
// have JSON-serialisable signatures, so `extractPlan` marks them bindable.
// ---------------------------------------------------------------------------

/**
 * Names that are valid identifiers in BOTH Python and JavaScript but reserved
 * (keyword) in one of them, so a generated name must never collide with any of
 * them: the generated source must stay valid Python AND the emitted beloved
 * must stay valid JavaScript (and `extractPlan` would mark a JS-reserved name
 * non-bindable, dropping it from the plan — which would skew this coverage).
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
  "global", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "while",
  "None", "True", "False",
]);

/**
 * A Python identifier that never collides with a keyword and is a safe name —
 * valid in BOTH Python and JavaScript. The `.filter` makes the "never collides
 * with a keyword" guarantee TRUE: any generated name that happens to be a JS
 * reserved word or a Python keyword is rejected by fast-check and regenerated.
 */
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
 * names (a Python signature cannot repeat a name; `extractPlan` would still read
 * them, but distinct names keep the generated source valid and the plan clean).
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
    // Python requires that a non-default param never follows a default one;
    // sort params so all required come before all defaulted.
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
// The property.
// ---------------------------------------------------------------------------

describe("Property 12 (R17.3): every planned function exists on both sides", () => {
  it("every extractPlan function appears in the heart, the beloved, and the contract — and nothing unplanned does", async () => {
    await fc.assert(
      fc.asyncProperty(arbFunctions, async (fns) => {
        const source = renderModule(fns);

        // Ground on the REAL extractPlan output. If extraction rejects this
        // source (e.g. nothing bindable), there is no plan to bind — the
        // property is vacuously true for that input.
        const extracted = extractPlan(source);
        if (!extracted.ok) return;
        const plan: LoversPlan = extracted.plan;
        const plannedNames = plan.functions.map((fn) => fn.name);

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

        const { pythonHeart, jsBeloved, contractSchema } = result.pair;

        // --- Every planned function is on BOTH sides (R17.3) -----------------
        for (const name of plannedNames) {
          // Heart: dispatched by name (`"<name>": <name>,` row) and imported.
          expect(pythonHeart, `heart must dispatch ${name}`).toMatch(
            new RegExp(`["']${escapeRe(name)}["']\\s*:\\s*${escapeRe(name)}\\b`),
          );
          // Beloved: exported as `export async function <name>(...)`.
          expect(jsBeloved, `beloved must export ${name}`).toMatch(
            new RegExp(`export\\s+async\\s+function\\s+${escapeRe(name)}\\s*\\(`),
          );
        }

        // --- Name equality across sides: no extra, no missing ---------------
        const heartNames = dispatchNames(pythonHeart);
        const belovedNames = belovedExportNames(jsBeloved);
        const contractNames = contractDefNames(contractSchema);
        const planned = new Set(plannedNames);

        expect(heartNames).toEqual(planned);
        expect(belovedNames).toEqual(planned);
        expect(contractNames).toEqual(planned);

        // --- Contract has a request AND a response def per function ---------
        const defKeys = new Set(Object.keys(parseDefs(contractSchema)));
        for (const name of plannedNames) {
          expect(defKeys.has(`${name}.request`), `contract missing ${name}.request`).toBe(true);
          expect(defKeys.has(`${name}.response`), `contract missing ${name}.response`).toBe(true);
        }

        // --- Independent cross-check: the real gate accepts this pair -------
        // (The runner already ran the gate to reach path "llm"; re-running it
        // here pins that the emitted artifacts are the gate-accepted ones.)
        const gate = validateLovers(
          plan,
          result.pair,
          (src) => parsePython(src),
          (src) => parseJavascript(src),
          (serialized) => parseContract(serialized).ok,
          (code, lang: DenyScanLang) => denyScan(code, lang),
        );
        expect(gate.ok).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Pure extraction helpers (read the EMITTED artifacts' public surface).
// ---------------------------------------------------------------------------

/** Escape a function name for use inside a RegExp. */
function escapeRe(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The set of function names the heart dispatches. Scoped to the `_DISPATCH = {
 * … }` table block so heart-internal dict literals (`"message": message`,
 * `"value": value` in `_fail`/`handle`) are never miscounted — the dispatch
 * table is the authoritative "what the heart binds" signal (mirrors the gate's
 * `definedInHeart`, which keys off the `_DISPATCH` row).
 */
function dispatchNames(heart: string): Set<string> {
  const names = new Set<string>();
  const block = /_DISPATCH\s*=\s*\{([\s\S]*?)\}/.exec(heart);
  if (block === null) return names;
  const rows = /["']([A-Za-z_$][\w$]*)["']\s*:\s*([A-Za-z_$][\w$]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = rows.exec(block[1] as string)) !== null) {
    const key = m[1];
    if (key !== undefined && key === m[2]) names.add(key);
  }
  return names;
}

/** The set of function names the beloved exports (`export async function <n>`). */
function belovedExportNames(beloved: string): Set<string> {
  const names = new Set<string>();
  const decl = /export\s+async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(beloved)) !== null) {
    names.add(m[1] as string);
  }
  return names;
}

/** Parse the serialized contract and return its `$defs` map. */
function parseDefs(serialized: string): Record<string, unknown> {
  const doc = JSON.parse(serialized) as { $defs?: Record<string, unknown> };
  return doc.$defs ?? {};
}

/** The set of function names the contract `$defs` carry (`<fn>.request/.response`). */
function contractDefNames(serialized: string): Set<string> {
  const names = new Set<string>();
  for (const key of Object.keys(parseDefs(serialized))) {
    if (key.endsWith(".request")) names.add(key.slice(0, -".request".length));
    else if (key.endsWith(".response")) names.add(key.slice(0, -".response".length));
    else names.add(key);
  }
  return names;
}
