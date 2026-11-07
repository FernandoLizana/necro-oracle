// @necro/coven — deterministic PLAN extraction for the Lovers (VI) binding.
//
// `extractPlan` is a PURE, deterministic read of the RESURRECTED Python 3
// source. It walks the top-level `function_definition` nodes (via tree-sitter)
// and derives a {@link LoversPlan}-shaped object: the bindable functions, their
// params (with Python type + JSON type + JSDoc JS type + required), their
// return-type info, whether each is bindable (with a `skipReason` when not),
// per-function edge cases, and the Python->JSON->JS `typeMap` rows the plan
// carries (design C.2 "Lovers grimoire", C.4 extractPlan).
//
// It has THREE jobs (design C.2):
//   1. the minimal PLAN context the FAST model sees (signatures + source),
//   2. the deterministic PLAN-failure fallback plan, and
//   3. the fixture input for the golden fixtures.
// Because the FAST model never decides whether a function is bindable — the
// deterministic extractor does — the "cards cannot lie" rule holds: a function
// is bindable only when its whole signature is JSON-serialisable.
//
// PURITY (mirrors `residual-chunk.ts`). `extractPlan` is a deterministic
// function of `source`. It needs a tree-sitter parse to read node spans, so —
// exactly like `ParseFn` in `residual-chunk.ts` — the parser is INJECTED as an
// optional `parse` fn defaulting to the oracle's synchronous `parsePython`
// (the runner arms it once with `initParser()` before use). No clock, network,
// filesystem, or ambient state. Unit/property tests inject their own `parse`.
//
// CAPS (design C.2).
//   - MAX_BINDABLE = 8: at most the first 8 BINDABLE top-level functions are
//     carried in the plan (the constant is reused from `./types.js`).
//   - MAX_SOURCE_BYTES = 32768: the PLAN precondition rejects oversized input
//     with an oracle-voice reason and NO model call. A pure helper cannot issue
//     the rejection itself, so `extractPlan` returns a DISCRIMINATED RESULT
//     `{ ok: false; reason }` (rather than throwing) so the runner/route can
//     surface the oracle-voice error and skip the model call. The success case
//     is `{ ok: true; plan }`.
//
// BINDABILITY HEURISTICS (design C.2; documented, intentionally conservative).
// A function is marked `bindable: false` (with a plain-English `skipReason`)
// when ANY of the following holds, because its signature cannot cross the pinned
// JSON-lines contract OR cannot be emitted as valid JavaScript:
//   - the signature uses `*args` (`list_splat_pattern`) or `**kwargs`
//     (`dictionary_splat_pattern`) — variadic arity has no JSON-Schema shape;
//   - a parameter's or the return value's Python type annotation maps to a
//     non-JSON-serialisable type (bytes, set, frozenset, tuple, generator,
//     iterator, callable, file handle/IO, or any un-annotated/unknown type that
//     is not one of the recognised JSON-mappable types below);
//   - the function's own NAME, or any bound parameter NAME, is not a valid
//     JavaScript identifier OR is a JavaScript reserved word. These are all
//     legal PYTHON identifiers (`in`, `class`, `delete`, `new`, …) but the
//     deterministic bridge (`@necro/grimoires-lovers-js` `ast-bridge`) emits
//     `export async function <name>(<params>)`, so a name that is a JS keyword
//     or a non-identifier would produce INVALID JavaScript that the real Lovers
//     gate rejects — forcing a `path:"template"` fallback. Honouring "the cards
//     cannot lie", the DETERMINISTIC extractor is the single source of
//     bindability truth, so it refuses such a function up front rather than
//     letting the bridge emit broken JS. Names are NEVER renamed/mangled: the
//     heart, the beloved and the contract rely on byte-for-byte name equality
//     (gate check 7 / 5b), so mangling would break that equality.
// Everything else is bindable. An UN-annotated param/return is treated as the
// permissive `object`/`any` JSON type and stays bindable (the model + the gate
// refine it); only EXPLICIT non-serialisable annotations flip `bindable` off.

import { parsePython as defaultParsePython, type Tree } from "@necro/oracle";

import {
  MAX_BINDABLE,
  type JsonType,
  type LoversFunction,
  type LoversParam,
  type LoversPlan,
  type LoversReturns,
  type LoversTypeMapEntry,
} from "./types.js";

import type { Node } from "web-tree-sitter";

// ---------------------------------------------------------------------------
// Caps (design C.2)
// ---------------------------------------------------------------------------

/**
 * The PLAN precondition byte cap (design C.2). Source larger than this is
 * rejected BEFORE any model call: `extractPlan` returns `{ ok: false, reason }`
 * so the runner/route can raise the oracle-voice error and skip the LLM.
 */
export const MAX_SOURCE_BYTES = 32768 as const;

// `MAX_BINDABLE` (8) is re-exported through the package barrel from `./types.js`.

// ---------------------------------------------------------------------------
// JavaScript identifier guarantee (design C.2; "the cards cannot lie")
// ---------------------------------------------------------------------------

/**
 * A valid bare JavaScript identifier (the shape the `ast-bridge` emits as both
 * the exported `function <name>` and each `(<param>)`). ASCII-only on purpose:
 * the generated beloved and the contract keys must round-trip byte-for-byte, so
 * we only admit the conservative ASCII identifier grammar rather than the full
 * Unicode `ID_Start`/`ID_Continue` set.
 */
const JS_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * The JavaScript reserved words that are ALL legal Python identifiers but
 * CANNOT be emitted as a bare `export async function <name>` / `(<param>)` in
 * the beloved (they would produce invalid JavaScript the Lovers gate rejects).
 * A Python function or parameter named any of these is therefore not bindable.
 *
 * This is the set of ECMAScript reserved words plus the contextual/future words
 * the bridge's bare-identifier emission cannot safely use as a function or
 * parameter name. It intentionally does NOT include globals that are legal
 * identifiers (e.g. `undefined`, `NaN`); those bind fine.
 */
const JS_RESERVED_WORDS: ReadonlySet<string> = new Set([
  // ECMAScript keywords.
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  // Strict-mode / module future reserved words the bridge must also avoid.
  "let",
  "static",
  "yield",
  "await",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
]);

/**
 * True when `name` can be emitted verbatim by the `ast-bridge` as a bare
 * JavaScript function name or parameter name: it is a valid JS identifier AND
 * not a reserved word. Pure.
 */
function isEmittableJsIdentifier(name: string): boolean {
  return JS_IDENTIFIER_RE.test(name) && !JS_RESERVED_WORDS.has(name);
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * The discriminated outcome of {@link extractPlan}. `ok: true` carries the
 * derived {@link LoversPlan}; `ok: false` carries an oracle-voice `reason` the
 * caller surfaces when the PLAN precondition rejects the input (oversized
 * source or no bindable function), with NO model call made.
 */
export type ExtractPlanResult =
  | { readonly ok: true; readonly plan: LoversPlan }
  | { readonly ok: false; readonly reason: string };

// ---------------------------------------------------------------------------
// Python type -> (JSON type, JSDoc JS type) mapping
// ---------------------------------------------------------------------------

/** One resolved mapping row for a concrete Python type annotation. */
interface TypeMapping {
  readonly json: JsonType;
  readonly js: string;
  /** false => the Python type is not JSON-serialisable (flips bindable off). */
  readonly serialisable: boolean;
}

/**
 * Normalise a Python type annotation's text to a bare base type (lower-cased,
 * generic arguments and module prefixes stripped): `typing.List[int]` -> `list`,
 * `Dict[str, int]` -> `dict`, `t.Optional[str]` -> `optional`.
 */
function baseType(pyType: string): string {
  const trimmed = pyType.trim();
  const withoutArgs = trimmed.split("[")[0] ?? trimmed;
  const parts = withoutArgs.split(".");
  return (parts[parts.length - 1] ?? withoutArgs).trim().toLowerCase();
}

/**
 * Resolve a Python type annotation to its JSON + JSDoc mapping. Un-annotated
 * (empty) types resolve to the permissive `object`/`*` and stay serialisable;
 * explicitly non-serialisable Python types resolve with `serialisable: false`.
 */
function resolveType(pyType: string): TypeMapping {
  const base = baseType(pyType);
  switch (base) {
    case "":
    case "any":
    case "object":
      return { json: "object", js: "*", serialisable: true };
    case "str":
    case "unicode":
    case "basestring":
      return { json: "string", js: "string", serialisable: true };
    case "int":
    case "long":
      return { json: "integer", js: "number", serialisable: true };
    case "float":
    case "complex":
      return { json: "number", js: "number", serialisable: true };
    case "bool":
      return { json: "boolean", js: "boolean", serialisable: true };
    case "none":
    case "nonetype":
      return { json: "null", js: "null", serialisable: true };
    case "list":
    case "sequence":
    case "iterable":
      return { json: "array", js: "Array<*>", serialisable: true };
    case "dict":
    case "mapping":
      return { json: "object", js: "Object<string,*>", serialisable: true };
    // Explicitly NOT JSON-serialisable over the pinned contract.
    case "bytes":
    case "bytearray":
    case "memoryview":
    case "set":
    case "frozenset":
    case "tuple":
    case "generator":
    case "iterator":
    case "callable":
    case "type":
    case "file":
    case "io":
    case "textio":
    case "bufferedreader":
      return { json: "object", js: "*", serialisable: false };
    default:
      // Unknown annotated type: treat as a non-serialisable object (conservative
      // — an explicit annotation we cannot map should not be silently bound).
      return { json: "object", js: "*", serialisable: false };
  }
}

// ---------------------------------------------------------------------------
// extractPlan (pure)
// ---------------------------------------------------------------------------

/**
 * Injected parser (mirrors `residual-chunk.ts`'s `ParseFn`). Defaults to the
 * oracle's synchronous `parsePython`; tests inject their own so the module
 * stays pure and network-free.
 */
export type ParseFn = (source: string) => Tree;

/**
 * Derive the deterministic {@link LoversPlan} from RESURRECTED Python 3
 * `source` (design C.2 / C.4). Pure: a deterministic function of `source`; the
 * optional `parse` is injected for testability and defaults to the armed oracle
 * parser.
 *
 * Returns a discriminated result:
 *   - `{ ok: false, reason }` when `source` exceeds {@link MAX_SOURCE_BYTES}
 *     (the PLAN byte precondition) or when no bindable top-level function is
 *     found (`LoversPlanSchema` requires `functions.min(1)`); the caller
 *     surfaces the oracle-voice `reason` and makes NO model call.
 *   - `{ ok: true, plan }` otherwise, carrying at most the first
 *     {@link MAX_BINDABLE} bindable functions plus the derived `typeMap`.
 *
 * @param source the resurrected Python 3 source.
 * @param parse  optional injected parser; defaults to oracle `parsePython`.
 */
export function extractPlan(
  source: string,
  parse: ParseFn = defaultParsePython,
): ExtractPlanResult {
  // PLAN byte precondition (design C.2): reject oversized source before any
  // model call. Measured in UTF-8 bytes, not characters.
  const byteLength = Buffer.byteLength(source, "utf8");
  if (byteLength > MAX_SOURCE_BYTES) {
    return {
      ok: false,
      reason:
        "The binding is too heavy to lift. " +
        `(Source is ${byteLength} bytes; the Lovers bind at most ${MAX_SOURCE_BYTES} bytes per file.)`,
    };
  }

  // Read every top-level function definition from the tree. On any parse
  // failure we degrade to "no bindable function" rather than widening scope.
  let functions: LoversFunction[] = [];
  try {
    const tree = parse(source);
    try {
      functions = topLevelFunctions(tree.rootNode);
    } finally {
      tree.delete();
    }
  } catch {
    functions = [];
  }

  // Cap at the first MAX_BINDABLE BINDABLE functions, preserving source order.
  // Non-bindable functions are not carried in the plan at all (the plan is the
  // set the binding acts on); their skip reasons are a diagnostic concern of
  // the runner, which can re-derive them, so the plan stays minimal and valid.
  const bindable = functions.filter((fn) => fn.bindable).slice(0, MAX_BINDABLE);

  if (bindable.length === 0) {
    return {
      ok: false,
      reason:
        "No lover answers the call. " +
        "(No top-level function with a JSON-serialisable signature was found to bind.)",
    };
  }

  const plan: LoversPlan = {
    functions: bindable,
    typeMap: deriveTypeMap(bindable),
  };
  return { ok: true, plan };
}

// ---------------------------------------------------------------------------
// Internal helpers (pure)
// ---------------------------------------------------------------------------

/** Collect every top-level `function_definition` as a {@link LoversFunction}. */
function topLevelFunctions(root: Node): LoversFunction[] {
  const out: LoversFunction[] = [];
  for (const child of root.namedChildren) {
    if (child === null) continue;
    if (child.type !== "function_definition") continue;
    const fn = functionFromNode(child);
    if (fn !== null) out.push(fn);
  }
  return out;
}

/** Build a {@link LoversFunction} from one `function_definition` node. */
function functionFromNode(node: Node): LoversFunction | null {
  const nameNode = node.childForFieldName("name");
  if (nameNode === null) return null;
  const name = nameNode.text;
  if (name.length === 0) return null;

  const paramsNode = node.childForFieldName("parameters");
  const { params, variadic } = readParams(paramsNode);

  const returnTypeNode = node.childForFieldName("return_type");
  const returnPyType = returnTypeNode === null ? "" : returnTypeNode.text;
  const returnMapping = resolveType(returnPyType);
  const returns: LoversReturns = {
    pyType: returnPyType.length > 0 ? returnPyType : "Any",
    jsonType: returnMapping.json,
    jsType: returnMapping.js,
  };

  // Bindability: variadic signatures, any non-serialisable param/return, and
  // any function/param name that is not an emittable JavaScript identifier flip
  // it off, with a specific, plain-English skip reason (design C.2).
  let bindable = true;
  let skipReason: string | undefined;
  if (variadic) {
    bindable = false;
    skipReason = `${name} uses *args/**kwargs, which has no fixed JSON contract shape`;
  } else if (!isEmittableJsIdentifier(name)) {
    // The bridge emits `export async function <name>(...)`; a JS reserved word
    // or non-identifier name would be invalid JavaScript (and names are never
    // mangled, so the heart/beloved/contract stay name-equal). Refuse it here.
    bindable = false;
    skipReason = `${name} is a JavaScript reserved word or not a valid JavaScript identifier, so it cannot be bound as an exported JavaScript function`;
  } else {
    const badIdentParam = params.find((p) => !isEmittableJsIdentifier(p.name));
    const badParam = params.find((p) => !resolveType(p.pyType).serialisable);
    if (badIdentParam !== undefined) {
      // A parameter named a JS reserved word / non-identifier would be invalid
      // in the emitted `(<params>)` list; refuse the whole function.
      bindable = false;
      skipReason = `parameter "${badIdentParam.name}" of ${name} is a JavaScript reserved word or not a valid JavaScript identifier, so it cannot be bound`;
    } else if (badParam !== undefined) {
      bindable = false;
      skipReason = `parameter "${badParam.name}" of ${name} is not JSON-serialisable (${badParam.pyType})`;
    } else if (!returnMapping.serialisable) {
      bindable = false;
      skipReason = `the return value of ${name} is not JSON-serialisable (${returns.pyType})`;
    }
  }

  const fn: LoversFunction = {
    name,
    params,
    returns,
    bindable,
    edgeCases: [],
    ...(skipReason !== undefined ? { skipReason } : {}),
  };
  return fn;
}

/**
 * Read a `parameters` node into typed {@link LoversParam}s, reporting whether
 * the signature is variadic (`*args`/`**kwargs`). `self`/`cls` leading params on
 * a bare function are kept as-is (top-level functions rarely carry them; the
 * gate/model handle any that slip through).
 */
function readParams(
  paramsNode: Node | null,
): { params: LoversParam[]; variadic: boolean } {
  const params: LoversParam[] = [];
  let variadic = false;
  if (paramsNode === null) return { params, variadic };

  for (const child of paramsNode.namedChildren) {
    if (child === null) continue;
    switch (child.type) {
      case "list_splat_pattern": // *args
      case "dictionary_splat_pattern": // **kwargs
        variadic = true;
        break;
      case "identifier": // bare `a`
        params.push(makeParam(child.text, "", true));
        break;
      case "default_parameter": {
        // `a=1`
        const n = child.childForFieldName("name");
        params.push(makeParam(n?.text ?? child.text, "", false));
        break;
      }
      case "typed_parameter": {
        // `a: int` — name is the first identifier child, type is the `type` field.
        const n = firstIdentifier(child);
        const t = child.childForFieldName("type");
        params.push(makeParam(n, t?.text ?? "", true));
        break;
      }
      case "typed_default_parameter": {
        // `a: int = 1`
        const n = child.childForFieldName("name");
        const t = child.childForFieldName("type");
        params.push(makeParam(n?.text ?? firstIdentifier(child), t?.text ?? "", false));
        break;
      }
      default:
        // keyword/positional separators ("*", "/") and anything unexpected:
        // ignore — they carry no bindable parameter.
        break;
    }
  }
  return { params, variadic };
}

/** The text of the first named identifier child, or "" when absent. */
function firstIdentifier(node: Node): string {
  for (const child of node.namedChildren) {
    if (child !== null && child.type === "identifier") return child.text;
  }
  return "";
}

/** Build a {@link LoversParam} from a name + Python type annotation text. */
function makeParam(name: string, pyType: string, required: boolean): LoversParam {
  const mapping = resolveType(pyType);
  return {
    name: name.length > 0 ? name : "_",
    pyType: pyType.length > 0 ? pyType : "Any",
    jsonType: mapping.json,
    jsType: mapping.js,
    required,
  };
}

/**
 * Derive the de-duplicated Python->JSON->JS `typeMap` rows the plan carries,
 * from every param and return across the bindable functions. Deterministic
 * order: first appearance.
 */
function deriveTypeMap(functions: readonly LoversFunction[]): LoversTypeMapEntry[] {
  const seen = new Set<string>();
  const rows: LoversTypeMapEntry[] = [];
  const add = (py: string, json: JsonType, js: string): void => {
    const key = `${py}\u0000${json}\u0000${js}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ py, json, js });
  };
  for (const fn of functions) {
    for (const p of fn.params) add(p.pyType, p.jsonType, p.jsType);
    add(fn.returns.pyType, fn.returns.jsonType, fn.returns.jsType);
  }
  return rows;
}
