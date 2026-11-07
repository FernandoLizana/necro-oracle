// @necro/grimoires-lovers-js — the pure Lovers (VI) validation gate.
//
// `validateLovers` is the deterministic gate that decides whether a generated
// Lovers pair is ACCEPTED (design C.3 "Validation", C.2a protocol, C.3a
// deny-list). It is PURE and ADAPTER-FREE: every capability it needs — the two
// tree-sitter parsers, the JSON-Schema validator, and the deny-list scan — is
// INJECTED, so the gate itself imports no adapter, performs no I/O, and NEVER
// executes the generated code. Repository/generated code is untrusted data the
// gate only ever PARSES (security rule 1, R5.4).
//
// THE SEVEN CHECKS (design C.3, in order; first failure wins):
//   1. The deterministically-emitted `pythonHeart` parses with ZERO error
//      nodes under the python grammar (R17.1).
//   2. The `jsBeloved` parses with ZERO error nodes under the js grammar (R17.1).
//   3. The `pythonTests` parse with ZERO error nodes (python grammar) (R17.1).
//   4. The `jsTests` parse with ZERO error nodes (js grammar) (R17.1).
//   5. The `contractSchema` is a valid JSON Schema draft 2020-12 (via the
//      injected `validateSchema`, backed by `parseContract` from coven), AND
//      its `$defs` keys — read as `<fn>.request`/`<fn>.response` and reduced via
//      {@link contractFnNames} to the set of function names — EQUAL the set of
//      `plan.functions` names (R17.2).
//   6. The static deny-list scan (`denyScan`) over EVERY generated artifact
//      finds no forbidden construct (R17.7). On a hit the gate rejects so the
//      runner retries-or-falls-back WITHOUT executing the code (R17.8).
//   7. Every function in `plan.functions` is defined on BOTH sides: it appears
//      in the heart (its `from resurrected import …` list + `_DISPATCH` table)
//      AND as an `export async function <name>` in the beloved (R17.3).
//
// THE HEART IS ALWAYS DETERMINISTIC (design item 3). `pair.pythonHeart` is the
// mechanical `ast-bridge` heart on BOTH the LLM path and the template path; the
// gate still parses it (check 1) and the `pythonTests` that call its
// `handle(request)` (check 3), but the heart it parses is the deterministic one.
//
// RETURN. A discriminated result: `{ ok: true }` on accept, or
// `{ ok: false; reason }` where `reason` is a short stable label the runner
// maps to the A.8 retry-or-fallback. The labels mirror design C.3's pseudo-code
// (`py_unparseable`, `js_unparseable`, `py_tests_unparseable`,
// `js_tests_unparseable`, `bad_contract`, `deny_list_hit:<token>`,
// `contract_fn_mismatch`, `missing_py_fn:<name>`, `missing_js_fn:<name>`).

import {
  parseContract,
  type DenyScanLang,
  type LoversPair,
  type LoversPlan,
} from "@necro/coven";
import type { Tree } from "@necro/oracle";

// ---------------------------------------------------------------------------
// Injected capability types (keep the gate pure/adapter-free).
// ---------------------------------------------------------------------------

/**
 * A tree-sitter parse function (the oracle's `parsePython`/`parseJavascript`).
 * Injected so the gate stays pure and testable; the runner arms the parser once
 * with `initParser()` before calling.
 */
export type ParseFn = (source: string) => Tree;

/**
 * A JSON-Schema validator for the serialized `contractSchema` string. Returns
 * `true` when the string is a valid JSON Schema draft 2020-12 document.
 * Injected so the gate imports no adapter. The runner supplies one backed by
 * coven's {@link parseContract} (and optionally a stricter meta-schema check).
 */
export type ValidateSchemaFn = (serialized: string) => boolean;

/**
 * The pure static deny-list scan (coven `denyScan`). Returns the first
 * offending token, or `null` when the artifact is clean. Injected so the gate
 * — which lives in a grimoire — never references a forbidden construct itself.
 */
export type DenyScanFn = (code: string, lang: DenyScanLang) => string | null;

/** The gate's discriminated result. */
export type ValidateLoversResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

// ---------------------------------------------------------------------------
// contractFnNames — reduce the contract `$defs` keys to the function-name set.
// ---------------------------------------------------------------------------

/** The `.request`/`.response` suffixes a `$defs` key legitimately carries. */
const DEF_SUFFIXES = [".request", ".response"] as const;

/**
 * Read the function-name set from a serialized `contractSchema` (design C.2a /
 * C.3). Each `$defs` key is `"<fn>.request"` or `"<fn>.response"`; the function
 * name is the key with that suffix stripped. A key WITHOUT one of the two
 * suffixes is carried through verbatim so the gate's set-equality check still
 * catches it as a mismatch (the contract must carry EXACTLY those keys and
 * nothing else). Returns an empty set when the string does not parse as a
 * contract. PURE.
 */
export function contractFnNames(serialized: string): ReadonlySet<string> {
  const parsed = parseContract(serialized);
  if (!parsed.ok) {
    return new Set<string>();
  }
  const names = new Set<string>();
  for (const key of Object.keys(parsed.value.$defs)) {
    const suffix = DEF_SUFFIXES.find((s) => key.endsWith(s));
    names.add(suffix === undefined ? key : key.slice(0, key.length - suffix.length));
  }
  return names;
}

// ---------------------------------------------------------------------------
// Name-presence checks (every planned function defined on both sides).
// ---------------------------------------------------------------------------

/** Escape a function name for safe use inside a RegExp. */
function escapeRe(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when `name` is defined in the Python heart. The deterministic heart
 * lists every planned name verbatim both in its `from resurrected import …`
 * line and as a `_DISPATCH` key (`"<name>": <name>,`), so the presence of the
 * `_DISPATCH` key is the authoritative signal that the heart dispatches it.
 */
function definedInHeart(heart: string, name: string): boolean {
  const n = escapeRe(name);
  // The _DISPATCH row is `"<name>": <name>,` — the key and the bound callable.
  const dispatchRow = new RegExp(`["']${n}["']\\s*:\\s*${n}\\b`);
  return dispatchRow.test(heart);
}

/**
 * True when `name` is defined in the JavaScript beloved as an
 * `export async function <name>(...)` (how both the deterministic bridge and
 * the generated beloved expose each bound function; design C.2a).
 */
function definedInBeloved(beloved: string, name: string): boolean {
  const n = escapeRe(name);
  const exported = new RegExp(`export\\s+async\\s+function\\s+${n}\\s*\\(`);
  return exported.test(beloved);
}

// ---------------------------------------------------------------------------
// setEqual helper.
// ---------------------------------------------------------------------------

/** True when two string sets contain exactly the same members. */
function setEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// countErrorNodes — zero error nodes means the artifact parses cleanly.
// ---------------------------------------------------------------------------

/**
 * Parse `source` with the injected `parse` and count error nodes. Mirrors
 * py2to3's `validate()`: an `ERROR` or MISSING node is a genuine syntactic
 * defect; a tree with neither parses cleanly. If the parse THROWS (parser not
 * armed, oversize), the artifact cannot be confirmed, so it is reported as a
 * single decisive error (never counted as clean). PURE given `parse`.
 */
function countErrorNodes(parse: ParseFn, source: string): number {
  let tree: Tree;
  try {
    tree = parse(source);
  } catch {
    return 1;
  }
  try {
    let count = 0;
    const cursor = tree.walk();
    try {
      for (;;) {
        const node = cursor.currentNode;
        if (node.type === "ERROR" || node.isError || node.isMissing) {
          count += 1;
        }
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
// The gate.
// ---------------------------------------------------------------------------

/**
 * The pure Lovers validation gate (design C.3). Runs the seven checks in order
 * over the full assembled `pair` (deterministic `pythonHeart` + the four
 * LLM/template artifacts) against the `plan`. Returns `{ ok: true }` on accept
 * or `{ ok: false; reason }` on the first failure.
 *
 * Every capability is INJECTED — `parsePy`, `parseJs`, `validateSchema`, and
 * `denyScan` — so the gate stays pure and adapter-free and NEVER executes the
 * generated code (R17.7, R17.8, security rule 1).
 */
export function validateLovers(
  plan: LoversPlan,
  pair: LoversPair,
  parsePy: ParseFn,
  parseJs: ParseFn,
  validateSchema: ValidateSchemaFn,
  denyScan: DenyScanFn,
): ValidateLoversResult {
  // 1-4. Every generated code artifact parses with ZERO error nodes (R17.1).
  if (countErrorNodes(parsePy, pair.pythonHeart) > 0) {
    return { ok: false, reason: "py_unparseable" };
  }
  if (countErrorNodes(parseJs, pair.jsBeloved) > 0) {
    return { ok: false, reason: "js_unparseable" };
  }
  if (countErrorNodes(parsePy, pair.pythonTests) > 0) {
    return { ok: false, reason: "py_tests_unparseable" };
  }
  if (countErrorNodes(parseJs, pair.jsTests) > 0) {
    return { ok: false, reason: "js_tests_unparseable" };
  }

  // 5a. The contract is a valid JSON Schema draft 2020-12 document (R17.2).
  if (!validateSchema(pair.contractSchema)) {
    return { ok: false, reason: "bad_contract" };
  }

  // 6. Static deny-list scan over EVERY generated artifact (R17.7). On a hit,
  //    reject WITHOUT executing the code (R17.8). Python artifacts use the
  //    python ruleset; JS artifacts use the js ruleset (incl. the single
  //    python-spawn allowance).
  const artifacts: ReadonlyArray<readonly [string, DenyScanLang]> = [
    [pair.pythonHeart, "python"],
    [pair.pythonTests, "python"],
    [pair.jsBeloved, "javascript"],
    [pair.jsTests, "javascript"],
  ];
  for (const [code, lang] of artifacts) {
    const hit = denyScan(code, lang);
    if (hit !== null) {
      return { ok: false, reason: `deny_list_hit:${hit}` };
    }
  }

  // 5b. The contract `$defs` function-name set EQUALS plan.functions (R17.2).
  const planNames = new Set(plan.functions.map((fn) => fn.name));
  if (!setEqual(contractFnNames(pair.contractSchema), planNames)) {
    return { ok: false, reason: "contract_fn_mismatch" };
  }

  // 7. Every planned function is defined on BOTH sides (R17.3).
  for (const fn of plan.functions) {
    if (!definedInHeart(pair.pythonHeart, fn.name)) {
      return { ok: false, reason: `missing_py_fn:${fn.name}` };
    }
    if (!definedInBeloved(pair.jsBeloved, fn.name)) {
      return { ok: false, reason: `missing_js_fn:${fn.name}` };
    }
  }

  return { ok: true };
}
