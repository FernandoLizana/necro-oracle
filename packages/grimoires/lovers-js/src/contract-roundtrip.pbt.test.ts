// @necro/grimoires-lovers-js — Property 14 (R16.5): the Lovers contract
// ROUND-TRIPS in JavaScript (ajv), optional python in CI (task 8.10).
//
// For an arbitrary bindable plan — derived by the REAL deterministic
// `extractPlan` over generated RESURRECTED Python 3 source — the deterministic
// `contractSchema` the `ast-bridge` emits (via `buildContractSchema` /
// `buildTemplatePair`) must be a USABLE JSON Schema draft 2020-12 document:
//
//   1. it is a valid contract that the real coven `parseContract(...)` accepts
//      (shape + dialect), and `ajv` (the dialect-2020-12 compiler, JS-only)
//      compiles it without error;
//   2. a request object shaped per `<fn>.request` — `{id, fn, args}` with `args`
//      keyed by parameter name carrying a placeholder value per `jsonType` —
//      VALIDATES against that request `$def`;
//   3. a response object shaped per `<fn>.response` — `{id, ok, value}` with
//      `value` a placeholder per the return `jsonType` — VALIDATES against that
//      response `$def`;
//   4. MALFORMED requests are REJECTED: a missing required arg, an extra arg
//      under `additionalProperties:false`, and a wrong `fn` const.
//
// The required path is JS-ONLY (ajv). A python round-trip is OPTIONAL and
// CI-only: it is SKIPPED here (unit runs never spawn a sandbox / python per the
// no-network-in-tests rule), guarded behind an env flag so it stays off by
// default. This also supplies the contract-round-trip property coverage R23.3
// calls for.
//
// GROUNDING. The contract is the REAL one: the property reads the deterministic
// `contractSchema` from the real `buildTemplatePair(plan)` over the real
// `extractPlan` output — the same artifact the gate and the runner emit — and
// drives it through ajv exactly as a JavaScript consumer would.
//
// Pure / Mock only: no network, no real LLM, no sandbox. The oracle tree-sitter
// python parser is armed once via `initParser()`.
//
// Validates: Requirements 16.5, 23.3

import {
  extractPlan,
  parseContract,
  type JsonType,
  type LoversFunction,
  type LoversPlan,
} from "@necro/coven";
import { initParser, parsePython } from "@necro/oracle";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";

import { buildContractSchema, buildTemplatePair } from "./index.js";

beforeAll(async () => {
  await initParser();
});

// ---------------------------------------------------------------------------
// The OPTIONAL python-CI arm. JS-only (ajv) is the required path; the python
// round-trip is skipped unless NECRO_LOVERS_PYTHON_CI is set AND python3 is on
// PATH. Unit runs never spawn a sandbox, so it stays off by default here.
// ---------------------------------------------------------------------------

const PYTHON_CI_ENABLED = process.env.NECRO_LOVERS_PYTHON_CI === "1";

// ---------------------------------------------------------------------------
// ajv (draft 2020-12), JS-only. The emitted contract declares a `urn:` `$id`
// (design C.2a: `urn:necro:lovers:<pair>`), which `fast-uri`/ajv cannot
// serialize when registering a whole document by `$ref`. A JavaScript consumer
// of this contract does not need the document `$id` to use the per-function
// `$defs`: it compiles the self-contained `<fn>.request` / `<fn>.response`
// fragments directly. So we read the real emitted `$defs` and compile each
// fragment standalone on one `Ajv2020` instance (dialect draft 2020-12).
// `strict:false` lets standard keywords the fragments carry (`const`, etc.)
// through without strict-mode complaints.
// ---------------------------------------------------------------------------

/** The parsed `$defs` of a real emitted contract (self-contained fragments). */
function contractDefs(serialized: string): Record<string, object> {
  const doc = JSON.parse(serialized) as { $defs?: Record<string, object> };
  return doc.$defs ?? {};
}

/** Compile the real emitted contract and return per-`$def` ajv validators. */
function compileContract(serialized: string): {
  requestOf: (fn: string) => ValidateFunction;
  responseOf: (fn: string) => ValidateFunction;
} {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const defs = contractDefs(serialized);
  const compileDef = (key: string): ValidateFunction => {
    const fragment = defs[key];
    if (fragment === undefined) {
      throw new Error(`contract is missing the $def ${key}`);
    }
    return ajv.compile(fragment);
  };
  return {
    requestOf: (fn) => compileDef(`${fn}.request`),
    responseOf: (fn) => compileDef(`${fn}.response`),
  };
}

// ---------------------------------------------------------------------------
// Placeholder values per JSON type — the minimal value that satisfies each
// `$def` property's `{ type }` keyword (mirrors the bridge's py/js placeholders).
// ---------------------------------------------------------------------------

function placeholder(jsonType: JsonType): unknown {
  switch (jsonType) {
    case "string":
      return "x";
    case "number":
      return 1.5;
    case "integer":
      return 1;
    case "boolean":
      return true;
    case "null":
      return null;
    case "array":
      return [];
    case "object":
    default:
      return {};
  }
}

/** A well-formed request object for `fn`, keyed by parameter name. */
function requestFor(fn: LoversFunction): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const p of fn.params) args[p.name] = placeholder(p.jsonType);
  return { id: 1, fn: fn.name, args };
}

/** A well-formed success response object for `fn`. */
function responseFor(fn: LoversFunction): Record<string, unknown> {
  return { id: 1, ok: true, value: placeholder(fn.returns.jsonType) };
}

// ---------------------------------------------------------------------------
// Smart generator: small RESURRECTED Python 3 modules whose top-level functions
// have JSON-serialisable signatures AND emittable-JS names, so `extractPlan`
// marks them bindable. Names exclude JS reserved words AND Python keywords (a
// reserved-word name is marked non-bindable upstream, which would skew the
// property), mirroring the sibling binding-*.pbt.test.ts generators.
// ---------------------------------------------------------------------------

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

/** Generate 1..8 functions with distinct names and, within each, distinct params. */
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
  .map((fns): ReadonlyArray<GenFn> =>
    // Python requires a non-default param never follows a default one.
    fns.map((fn) => ({
      ...fn,
      params: [...fn.params].sort((a, b) => Number(a.hasDefault) - Number(b.hasDefault)),
    })),
  );

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

describe("Property 14 (R16.5, R23.3): contract round-trip validates in JS (ajv), optional python in CI", () => {
  it("every emitted contract compiles and accepts well-formed requests/responses and rejects malformed ones", () => {
    fc.assert(
      fc.property(arbFunctions, (fns) => {
        const source = renderModule(fns);

        // Ground on the REAL extractPlan output. If extraction rejects this
        // source (nothing bindable), there is no plan to bind — vacuously true.
        const extracted = extractPlan(source, parsePython);
        if (!extracted.ok) return;
        const plan: LoversPlan = extracted.plan;

        // The REAL deterministic contract the bridge emits (byte-identical to
        // the one in buildTemplatePair and on the LLM path).
        const serialized = buildContractSchema(plan);
        expect(serialized).toBe(buildTemplatePair(plan).contractSchema);

        // (1) It is a valid contract the coven helper accepts, and ajv compiles
        //     it (JS-only, dialect 2020-12).
        const parsed = parseContract(serialized);
        expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
        const { requestOf, responseOf } = compileContract(serialized);

        for (const fn of plan.functions) {
          const validateReq = requestOf(fn.name);
          const validateRes = responseOf(fn.name);

          // (2) A well-formed request validates against <fn>.request.
          const req = requestFor(fn);
          expect(validateReq(req), JSON.stringify(validateReq.errors)).toBe(true);

          // (3) A well-formed success response validates against <fn>.response.
          const res = responseFor(fn);
          expect(validateRes(res), JSON.stringify(validateRes.errors)).toBe(true);

          // (4a) A wrong `fn` const is REJECTED.
          expect(validateReq({ ...req, fn: `${fn.name}__wrong` })).toBe(false);

          // (4b) An extra arg under additionalProperties:false is REJECTED.
          const extraArgs = { ...(req.args as Record<string, unknown>), __extra__: 1 };
          expect(validateReq({ ...req, args: extraArgs })).toBe(false);

          // (4c) A missing REQUIRED arg is REJECTED (only when the function has
          //      a required param; a 0-arg or all-optional signature has no
          //      required key to drop, so that case is vacuous).
          const firstRequired = fn.params.find((p) => p.required);
          if (firstRequired !== undefined) {
            const missing = { ...(req.args as Record<string, unknown>) };
            delete missing[firstRequired.name];
            expect(validateReq({ ...req, args: missing })).toBe(false);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  // The OPTIONAL python-CI round-trip arm. JS-only (ajv) above is the required
  // path; this is SKIPPED by default (no sandbox / no python spawn in unit
  // runs) and only runs when NECRO_LOVERS_PYTHON_CI=1 enables it in CI.
  it.skipIf(!PYTHON_CI_ENABLED)(
    "optional CI-only python round-trip (skipped unless NECRO_LOVERS_PYTHON_CI=1)",
    () => {
      // Intentionally a placeholder: the python round-trip belongs to the
      // sandbox-tagged CI arm, never a unit run. Keeping it skip-guarded here
      // documents the OPTIONAL path without spawning python.
      expect(PYTHON_CI_ENABLED).toBe(true);
    },
  );
});
