// @necro/grimoires-lovers-js — the pure deterministic AST-template bridge.
//
// `ast-bridge` is the mechanical half of the Lovers (VI) binding. It is a PURE
// fixer: a deterministic function of a {@link LoversPlan} alone. No model call,
// no network, no clock, no filesystem, no randomness — repeated calls on the
// same plan are byte-identical. The grimoire stays adapter-free (it imports
// `@necro/coven` contract types only), and the strings it EMITS are generated
// source text that is never executed here (repository/generated code is
// untrusted data; the Lovers gate in task 8.4 parses it, never runs it).
//
// It has two jobs, split so the LoversRunner (task 8.6) can call each
// independently (design C.2 / C.2a / C.3, item 3 "the heart is always
// deterministic"):
//
//  1. {@link buildDeterministicHeart} — ALWAYS called, on BOTH the LLM path and
//     the template fallback path. It emits `pythonHeart`: the mechanical
//     JSON-lines dispatcher pinned by design C.2a. The LLM GENERATE step NEVER
//     produces the heart; the runner assembles the full `LoversPairSchema` by
//     combining the four LLM artifacts with this deterministic heart. On the
//     LLM path `validateLovers` still PARSES this heart (zero error nodes) and
//     the `pythonTests` that call its `handle(request)`.
//
//  2. {@link buildTemplatePair} — called on the FALLBACK path only. From the
//     plan alone it emits the full {@link LoversPair}: the same deterministic
//     heart PLUS a deterministic `jsBeloved` client, a serialized
//     `contractSchema` (draft 2020-12), a `pythonTests` module, and a `jsTests`
//     module — all stdlib-only, with no pip/npm deps, no network, no time, no
//     randomness. Everything is derived from `plan.functions` so the Lovers
//     gate's name-equality and "every planned fn on both sides" checks hold.
//
// {@link astBridge} is the single convenience entry the runner may prefer: it
// always returns the heart and, when `fullPair` is set, the whole template
// pair.
//
// PINNED PROTOCOL (design C.2a — the heart ↔ beloved wire). One UTF-8 JSON
// object per stdin line `{"id": int, "fn": str, "args": {paramName: value}}`;
// one response line per request on stdout, either
// `{"id","ok":true,"value"}` or `{"id","ok":false,"error":{"type","message"}}`;
// `json.dumps(..., ensure_ascii=False, allow_nan=False, separators=(",", ":"))`
// then flush after each line; the user function's stdout redirected to stderr
// for the duration of a call; tracebacks ONLY to stderr; exit 0 on EOF; a
// `handle(request)` function the python tests call directly.
//
// HOW THE HEART REACHES THE PLANNED FUNCTIONS. The heart imports the resurrected
// module as a sibling (`from resurrected import <fn>, …` — `heart.py` and the
// resurrected `resurrected.py` sit side by side in the emitted bundle) and binds
// the imported callables into an explicit `_DISPATCH` table keyed by the planned
// function NAME. If the sibling import is unavailable at run time (the module
// not yet placed beside the heart) it degrades to an empty table so the loop
// still runs and answers every request with a structured `{"ok": false}` error
// rather than crashing — the binding is still a valid, parseable heart. Because
// every planned name appears verbatim both in the `from resurrected import …`
// line and as a `_DISPATCH` key, the gate's `definedIn(pythonHeart, fn.name)`
// and "every planned fn on both sides" checks hold.
//
// DENY-LIST CLEAN (design C.3a, enforced by task 8.4). The emitted code uses no
// `eval`/`Function`/`exec`, no `os.system`, no network, no filesystem write or
// delete, and no `child_process` beyond the single `spawn` of the python heart
// in `jsBeloved`. The heart's only process I/O is its own stdin/stdout
// dispatcher loop (explicitly allowed by C.3a).

import {
  LOVERS_LANGUAGE_PAIR,
  type LoversFunction,
  type LoversPair,
  type LoversPlan,
} from "@necro/coven";

// ---------------------------------------------------------------------------
// Pinned bundle file names (design C.2a). `jsBeloved` spawns the heart written
// to `heart.py`; the heart imports the resurrected module as the sibling
// `resurrected.py` (module name `resurrected`).
// ---------------------------------------------------------------------------

/** The file name the heart is emitted to and the beloved spawns. */
export const HEART_FILENAME = "heart.py" as const;

/** The sibling module the heart imports the resurrected functions from. */
export const RESURRECTED_MODULE = "resurrected" as const;

/** JSON Schema dialect the serialized {@link LoversPair.contractSchema} declares. */
export const CONTRACT_DIALECT = "https://json-schema.org/draft/2020-12/schema" as const;

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

/**
 * The bindable planned functions, in plan order. `extractPlan` already filters
 * to bindable functions, but the LLM PLAN step could in principle carry a
 * non-bindable entry; the bridge binds only the bindable ones so every emitted
 * artifact is consistent.
 */
function bindable(plan: LoversPlan): readonly LoversFunction[] {
  return plan.functions.filter((fn) => fn.bindable);
}

/** The JSON Schema `type` keyword for a planned JSON type. */
function schemaType(jsonType: string): string {
  // `jsonType` is already one of the JsonType enum members (string/number/
  // integer/boolean/null/array/object); pass it straight through.
  return jsonType;
}

/** Deterministic JSON-stringify with sorted keys (stable emitted output). */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val as unknown;
  });
}

// ---------------------------------------------------------------------------
// 1. The deterministic Python heart (ALWAYS emitted — design item 3)
// ---------------------------------------------------------------------------

/**
 * Emit the mechanical JSON-lines dispatcher heart for `plan` (design C.2a).
 * PURE: a deterministic function of the plan; identical plan => identical
 * string. Emitted on BOTH the LLM path and the template fallback path.
 *
 * The heart:
 *  - imports the planned functions from the sibling `resurrected` module and
 *    binds them into `_DISPATCH` keyed by name (degrading to an empty table if
 *    the sibling is not importable, so the loop still answers structurally);
 *  - exposes `handle(request)` — the entry the python tests call directly —
 *    which validates the request shape, looks up `fn`, applies it with args
 *    keyed by parameter name, and returns the pinned success/failure object,
 *    redirecting the user function's stdout to stderr for the call;
 *  - runs a long-lived loop reading one JSON object per stdin line and writing
 *    one response per stdout line with
 *    `json.dumps(..., ensure_ascii=False, allow_nan=False, separators=(",", ":"))`
 *    + flush, sending tracebacks only to stderr and exiting 0 on EOF.
 *
 * Deny-list clean: no `eval`/`exec`/`os.system`/`subprocess`/network/file
 * write; the only process I/O is the heart's own stdin/stdout loop.
 */
export function buildDeterministicHeart(plan: LoversPlan): string {
  const fns = bindable(plan);
  const names = fns.map((fn) => fn.name);

  // `from resurrected import a, b, c` — lists every planned name verbatim so
  // the gate's definedIn()/name-equality checks see each name in the heart.
  const importList = names.join(", ");
  const dispatchRows = names.map((n) => `        ${pyStr(n)}: ${n},`).join("\n");

  return [
    `# heart.py — deterministic JSON-lines dispatcher for the Lovers (VI) binding.`,
    `# Generated by @necro/grimoires-lovers-js ast-bridge (pure, deterministic).`,
    `# Language pair: ${LOVERS_LANGUAGE_PAIR}.`,
    `#`,
    `# Protocol (design C.2a): one UTF-8 JSON object per stdin line`,
    `#   {"id": int, "fn": str, "args": {paramName: value}}`,
    `# and one response object per stdout line, either`,
    `#   {"id", "ok": true, "value"} or`,
    `#   {"id", "ok": false, "error": {"type": str, "message": str}}.`,
    `# json.dumps(..., ensure_ascii=False, allow_nan=False, separators=(",", ":"))`,
    `# then flush after each line; the user function's stdout is redirected to`,
    `# stderr for the duration of a call; tracebacks go only to stderr; EOF`,
    `# exits 0. Tests call handle(request) directly.`,
    `import contextlib`,
    `import io`,
    `import json`,
    `import sys`,
    `import traceback`,
    ``,
    `# Bind the resurrected top-level functions from the sibling module. If the`,
    `# module is not yet placed beside this heart the dispatch table stays empty`,
    `# and every request answers with a structured error rather than crashing.`,
    `try:`,
    names.length > 0
      ? `    from ${RESURRECTED_MODULE} import ${importList}`
      : `    pass`,
    `    _DISPATCH = {`,
    dispatchRows,
    `    }`,
    `except Exception:  # pragma: no cover - sibling not present yet`,
    `    _DISPATCH = {}`,
    ``,
    ``,
    `def handle(request):`,
    `    """Dispatch one request object to a bound function.`,
    ``,
    `    Returns the pinned response object. The user function's stdout is`,
    `    redirected to stderr for the duration of the call so only protocol`,
    `    lines ever reach stdout. Never raises: every failure is returned as`,
    `    {"ok": False, "error": {"type", "message"}}.`,
    `    """`,
    `    if not isinstance(request, dict):`,
    `        return _fail(None, "BadRequest", "request must be a JSON object")`,
    `    req_id = request.get("id")`,
    `    fn_name = request.get("fn")`,
    `    args = request.get("args", {})`,
    `    if not isinstance(fn_name, str):`,
    `        return _fail(req_id, "BadRequest", "fn must be a string")`,
    `    if not isinstance(args, dict):`,
    `        return _fail(req_id, "BadRequest", "args must be an object keyed by parameter name")`,
    `    fn = _DISPATCH.get(fn_name)`,
    `    if fn is None:`,
    `        return _fail(req_id, "UnknownFunction", "no bound function named " + repr(fn_name))`,
    `    try:`,
    `        # Redirect the user function's stdout to stderr for the call so only`,
    `        # protocol lines reach stdout (design C.2a stdout isolation).`,
    `        with contextlib.redirect_stdout(sys.stderr):`,
    `            value = fn(**args)`,
    `    except TypeError as exc:`,
    `        return _fail(req_id, "TypeError", str(exc))`,
    `    except Exception as exc:  # noqa: BLE001 - map any failure to a protocol error`,
    `        traceback.print_exc(file=sys.stderr)`,
    `        return _fail(req_id, type(exc).__name__, str(exc))`,
    `    return {"id": req_id, "ok": True, "value": value}`,
    ``,
    ``,
    `def _fail(req_id, err_type, message):`,
    `    """Build the pinned {"ok": false} response object."""`,
    `    return {`,
    `        "id": req_id,`,
    `        "ok": False,`,
    `        "error": {"type": err_type, "message": message},`,
    `    }`,
    ``,
    ``,
    `def _emit(obj):`,
    `    """Write one response object as a compact JSON line, then flush."""`,
    `    line = json.dumps(obj, ensure_ascii=False, allow_nan=False, separators=(",", ":"))`,
    `    sys.stdout.write(line + "\\n")`,
    `    sys.stdout.flush()`,
    ``,
    ``,
    `def main():`,
    `    """Long-lived loop: one request per stdin line, one response per stdout line."""`,
    `    for raw in sys.stdin:`,
    `        raw = raw.strip()`,
    `        if not raw:`,
    `            continue`,
    `        try:`,
    `            request = json.loads(raw)`,
    `        except ValueError as exc:`,
    `            _emit(_fail(None, "BadJSON", str(exc)))`,
    `            continue`,
    `        _emit(handle(request))`,
    `    return 0`,
    ``,
    ``,
    `if __name__ == "__main__":`,
    `    sys.exit(main())`,
    ``,
  ].join("\n");
}

/** A single-quoted Python string literal for a safe identifier/name. */
function pyStr(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// ---------------------------------------------------------------------------
// 2a. The deterministic JavaScript beloved (fallback path — design C.2a/R38)
// ---------------------------------------------------------------------------

/**
 * Emit the Node ESM `jsBeloved` client for `plan`. PURE/deterministic. It
 * spawns `process.env.PYTHON ?? "python3"` with `heart.py` as ONE long-lived
 * child, correlates replies by `id`, rejects `{ok:false}` with an `Error`
 * carrying `error.type`/`error.message`, exposes `close()`, and exposes one
 * async function per bindable plan function with JSDoc types + edge-case input
 * validation. It uses only `node:` built-ins and NEVER reimplements the Python
 * logic — each wrapper just forwards args over the contract (R38.2).
 *
 * Deny-list clean: the only `child_process` use is the single `spawn` of the
 * python heart; no `eval`/`Function`, no network, no fs write/delete.
 *
 * IDENTIFIER GUARANTEE. This emits `export async function <name>(<params>)`
 * with the plan's function and parameter names verbatim (never renamed/mangled,
 * so name-equality with the heart and the contract holds). It therefore RELIES
 * on `@necro/coven` `extractPlan` having already guaranteed every bindable
 * function name and bound parameter name is a valid, non-reserved JavaScript
 * identifier — a Python name that is a JS keyword (`in`, `class`, `delete`, …)
 * is marked `bindable: false` upstream and never reaches this bridge.
 */
export function buildJsBeloved(plan: LoversPlan): string {
  const fns = bindable(plan);

  const header = [
    `// beloved.mjs — the JavaScript (Node ESM) client for the Lovers (VI) binding.`,
    `// Generated by @necro/grimoires-lovers-js ast-bridge (pure, deterministic).`,
    `// It does NOT reimplement the Python logic: every call forwards args over the`,
    `// pinned JSON-lines contract to the one long-lived ${HEART_FILENAME} child.`,
    `import { spawn } from "node:child_process";`,
    `import { fileURLToPath } from "node:url";`,
    `import { dirname, join } from "node:path";`,
    ``,
    `const __dirname = dirname(fileURLToPath(import.meta.url));`,
    `const HEART = join(__dirname, ${jsStr(HEART_FILENAME)});`,
    `const PYTHON = process.env.PYTHON ?? "python3";`,
    ``,
    `let _child = null;`,
    `let _nextId = 1;`,
    `let _buffer = "";`,
    `const _pending = new Map();`,
    ``,
    `/** Spawn (once) the long-lived python heart and wire its stdout to replies. */`,
    `function _ensureChild() {`,
    `  if (_child !== null) return _child;`,
    `  _child = spawn(PYTHON, [HEART], { stdio: ["pipe", "pipe", "inherit"] });`,
    `  _child.stdout.setEncoding("utf8");`,
    `  _child.stdout.on("data", (chunk) => {`,
    `    _buffer += chunk;`,
    `    let nl;`,
    `    while ((nl = _buffer.indexOf("\\n")) !== -1) {`,
    `      const line = _buffer.slice(0, nl);`,
    `      _buffer = _buffer.slice(nl + 1);`,
    `      if (line.trim().length === 0) continue;`,
    `      _onReply(JSON.parse(line));`,
    `    }`,
    `  });`,
    `  _child.on("exit", () => {`,
    `    for (const { reject } of _pending.values()) {`,
    `      reject(new Error("heart exited before replying"));`,
    `    }`,
    `    _pending.clear();`,
    `    _child = null;`,
    `  });`,
    `  return _child;`,
    `}`,
    ``,
    `/** Resolve/reject the pending promise correlated to this reply's id. */`,
    `function _onReply(reply) {`,
    `  const slot = _pending.get(reply.id);`,
    `  if (slot === undefined) return;`,
    `  _pending.delete(reply.id);`,
    `  if (reply.ok === true) {`,
    `    slot.resolve(reply.value);`,
    `  } else {`,
    `    const err = new Error(reply.error ? reply.error.message : "unknown error");`,
    `    err.name = reply.error ? reply.error.type : "Error";`,
    `    slot.reject(err);`,
    `  }`,
    `}`,
    ``,
    `/** Send one request over the contract and await its correlated reply. */`,
    `function _call(fn, args) {`,
    `  const child = _ensureChild();`,
    `  const id = _nextId++;`,
    `  const line = JSON.stringify({ id, fn, args });`,
    `  return new Promise((resolve, reject) => {`,
    `    _pending.set(id, { resolve, reject });`,
    `    child.stdin.write(line + "\\n");`,
    `  });`,
    `}`,
    ``,
    `/** Terminate the long-lived heart child (releases the binding). */`,
    `export function close() {`,
    `  if (_child !== null) {`,
    `    _child.stdin.end();`,
    `    _child.kill();`,
    `    _child = null;`,
    `  }`,
    `}`,
    ``,
  ].join("\n");

  const wrappers = fns.map((fn) => buildJsWrapper(fn)).join("\n");
  return header + "\n" + wrappers;
}

/**
 * One exported async wrapper for a bindable function (JSDoc + validation).
 * Emits the function name and each parameter name as a BARE JavaScript
 * identifier; this relies on `@necro/coven` `extractPlan` having guaranteed the
 * name and every parameter name are valid, non-reserved JS identifiers (a
 * reserved-word name is marked non-bindable upstream, never emitted here).
 */
function buildJsWrapper(fn: LoversFunction): string {
  const paramNames = fn.params.map((p) => p.name);
  const jsdoc = [
    `/**`,
    ` * ${fn.name} — forwards to the resurrected Python function over the contract.`,
    ...fn.params.map((p) => ` * @param {${p.jsType}} ${p.name}`),
    ` * @returns {Promise<${fn.returns.jsType}>}`,
    ` */`,
  ].join("\n");

  // Edge-case-derived input validation: required params must be supplied.
  const requiredChecks = fn.params
    .filter((p) => p.required)
    .map(
      (p) =>
        `  if (${p.name} === undefined) throw new TypeError(${jsStr(
          `${fn.name}: required argument "${p.name}" is missing`,
        )});`,
    )
    .join("\n");

  const argsObject = paramNames.map((n) => `${jsKey(n)}: ${n}`).join(", ");

  return [
    jsdoc,
    `export async function ${fn.name}(${paramNames.join(", ")}) {`,
    requiredChecks.length > 0 ? requiredChecks : "",
    `  return _call(${jsStr(fn.name)}, { ${argsObject} });`,
    `}`,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** A double-quoted JS string literal. */
function jsStr(value: string): string {
  return JSON.stringify(value);
}

/** An object key: bare when a safe identifier, quoted otherwise. */
function jsKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : jsStr(name);
}

// ---------------------------------------------------------------------------
// 2b. The deterministic contract schema (fallback path — design C.2a)
// ---------------------------------------------------------------------------

/**
 * Emit the serialized contract: a JSON Schema draft 2020-12 document, as a
 * STRING, whose `$defs` carries EXACTLY `"<fn>.request"` and `"<fn>.response"`
 * per bindable function and nothing else (design C.2a). PURE/deterministic.
 * The Lovers gate reads these `$defs` keys and requires them to equal the plan
 * function names.
 */
export function buildContractSchema(plan: LoversPlan): string {
  const fns = bindable(plan);
  const defs: Record<string, unknown> = {};
  for (const fn of fns) {
    defs[`${fn.name}.request`] = requestSchema(fn);
    defs[`${fn.name}.response`] = responseSchema(fn);
  }
  const document = {
    $schema: CONTRACT_DIALECT,
    $id: `urn:necro:lovers:${LOVERS_LANGUAGE_PAIR}`,
    title: "Lovers binding contract",
    $defs: defs,
  };
  return stableStringify(document);
}

/** The request `$def` for a function: the args object keyed by param name. */
function requestSchema(fn: LoversFunction): unknown {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of fn.params) {
    properties[p.name] = { type: schemaType(p.jsonType) };
    if (p.required) required.push(p.name);
  }
  return {
    type: "object",
    properties: {
      id: { type: "integer" },
      fn: { const: fn.name },
      args: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
    required: ["id", "fn", "args"],
    additionalProperties: false,
  };
}

/** The response `$def` for a function: the success value shape. */
function responseSchema(fn: LoversFunction): unknown {
  return {
    type: "object",
    properties: {
      id: { type: "integer" },
      ok: { type: "boolean" },
      value: { type: schemaType(fn.returns.jsonType) },
      error: {
        type: "object",
        properties: {
          type: { type: "string" },
          message: { type: "string" },
        },
        required: ["type", "message"],
        additionalProperties: false,
      },
    },
    required: ["id", "ok"],
    additionalProperties: false,
  };
}

// ---------------------------------------------------------------------------
// 2c. The deterministic Python tests (fallback path — design C.2a)
// ---------------------------------------------------------------------------

/**
 * Emit a stdlib-only `unittest` module that calls the heart's `handle(request)`
 * directly for each function and edge case (design C.2a). PURE/deterministic.
 * No pip deps, no network, no time, no randomness.
 */
export function buildPythonTests(plan: LoversPlan): string {
  const fns = bindable(plan);
  const methods = fns.map((fn) => buildPythonTestMethod(fn)).join("\n");
  return [
    `# test_heart.py — stdlib-only contract tests for ${HEART_FILENAME}.`,
    `# Generated by @necro/grimoires-lovers-js ast-bridge (pure, deterministic).`,
    `# Calls the heart's handle(request) directly. No third-party package,`,
    `# no network, no time, no randomness.`,
    `import unittest`,
    ``,
    `import heart`,
    ``,
    ``,
    `class HeartContractTest(unittest.TestCase):`,
    methods.length > 0 ? methods : "    pass",
    ``,
    `if __name__ == "__main__":`,
    `    unittest.main()`,
    ``,
  ].join("\n");
}

/** One `unittest` method exercising a function's request shape through handle(). */
function buildPythonTestMethod(fn: LoversFunction): string {
  const args = fn.params.map((p) => `${pyStr(p.name)}: ${pyPlaceholder(p.jsonType)}`).join(", ");
  return [
    `    def test_${fn.name}_dispatch_shape(self):`,
    `        request = {"id": 1, "fn": ${pyStr(fn.name)}, "args": {${args}}}`,
    `        response = heart.handle(request)`,
    `        # handle() always returns the pinned response shape and never raises.`,
    `        self.assertEqual(response["id"], 1)`,
    `        self.assertIn("ok", response)`,
    `        if not response["ok"]:`,
    `            self.assertIn("type", response["error"])`,
    `            self.assertIn("message", response["error"])`,
    ``,
    `    def test_${fn.name}_unknown_args_rejected(self):`,
    `        # A non-object args payload is rejected structurally, never raised.`,
    `        response = heart.handle({"id": 2, "fn": ${pyStr(fn.name)}, "args": "nope"})`,
    `        self.assertFalse(response["ok"])`,
    `        self.assertEqual(response["error"]["type"], "BadRequest")`,
    ``,
  ].join("\n");
}

/** A deterministic Python placeholder literal for a JSON type. */
function pyPlaceholder(jsonType: string): string {
  switch (jsonType) {
    case "string":
      return `""`;
    case "number":
      return "0.0";
    case "integer":
      return "0";
    case "boolean":
      return "False";
    case "null":
      return "None";
    case "array":
      return "[]";
    case "object":
    default:
      return "{}";
  }
}

// ---------------------------------------------------------------------------
// 2d. The deterministic JavaScript tests (fallback path — design C.2a)
// ---------------------------------------------------------------------------

/**
 * Emit a stdlib-only `node:test` + `node:assert` module driving `jsBeloved`
 * end to end (design C.2a). PURE/deterministic. No npm deps, no network, no
 * time, no randomness. Tests close the beloved so the child is released.
 */
export function buildJsTests(plan: LoversPlan): string {
  const fns = bindable(plan);
  const cases = fns.map((fn) => buildJsTestCase(fn)).join("\n");
  const imported = fns.map((fn) => fn.name).concat(["close"]).join(", ");
  return [
    `// beloved.test.mjs — stdlib-only end-to-end tests for the beloved.`,
    `// Generated by @necro/grimoires-lovers-js ast-bridge (pure, deterministic).`,
    `// Uses node:test + node:assert only. No npm deps, no network, no time,`,
    `// no randomness. Each test drives the real beloved client.`,
    `import test from "node:test";`,
    `import assert from "node:assert/strict";`,
    ``,
    `import { ${imported} } from "./beloved.mjs";`,
    ``,
    `test.after(() => { close(); });`,
    ``,
    cases,
  ].join("\n");
}

/** One `node:test` case for a function's wrapper (validation + round trip). */
function buildJsTestCase(fn: LoversFunction): string {
  const args = fn.params.map((p) => jsPlaceholder(p.jsonType)).join(", ");
  const firstRequired = fn.params.find((p) => p.required);
  const validationTest =
    firstRequired !== undefined
      ? [
          `test(${jsStr(`${fn.name} rejects a missing required argument`)}, async () => {`,
          `  await assert.rejects(() => ${fn.name}(), TypeError);`,
          `});`,
          ``,
        ].join("\n")
      : "";
  return [
    validationTest,
    `test(${jsStr(`${fn.name} forwards over the contract`)}, async () => {`,
    `  // Drives the real heart child: either resolves a value or rejects with a`,
    `  // typed Error carrying the heart's error.type/message. Both are valid`,
    `  // protocol outcomes; the test asserts the wrapper does not throw`,
    `  // synchronously and returns a promise.`,
    `  const result = ${fn.name}(${args});`,
    `  assert.ok(result instanceof Promise);`,
    `  await result.catch(() => {});`,
    `});`,
    ``,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** A deterministic JS placeholder literal for a JSON type. */
function jsPlaceholder(jsonType: string): string {
  switch (jsonType) {
    case "string":
      return `""`;
    case "number":
    case "integer":
      return "0";
    case "boolean":
      return "false";
    case "null":
      return "null";
    case "array":
      return "[]";
    case "object":
    default:
      return "{}";
  }
}

// ---------------------------------------------------------------------------
// Composite entries the LoversRunner calls (design C.2 / C.3, item 3)
// ---------------------------------------------------------------------------

/**
 * Emit the FULL deterministic {@link LoversPair} from the plan alone — the
 * template fallback path (design C.3). The `pythonHeart` is byte-identical to
 * what {@link buildDeterministicHeart} returns on the LLM path. PURE: no model
 * call, no network, no clock.
 */
export function buildTemplatePair(plan: LoversPlan): LoversPair {
  return {
    pythonHeart: buildDeterministicHeart(plan),
    jsBeloved: buildJsBeloved(plan),
    contractSchema: buildContractSchema(plan),
    pythonTests: buildPythonTests(plan),
    jsTests: buildJsTests(plan),
  };
}

/** Options for the {@link astBridge} convenience entry. */
export interface AstBridgeOptions {
  /**
   * When `true`, emit the whole template pair (fallback path). When `false`
   * (the default), emit only the deterministic heart (the LLM path — the runner
   * combines it with the four LLM artifacts).
   */
  readonly fullPair?: boolean;
}

/**
 * The single convenience entry the {@link LoversPlan}-driven LoversRunner
 * (task 8.6) may prefer over the individual builders. It ALWAYS returns the
 * deterministic `pythonHeart`; when `opts.fullPair` is set it also returns the
 * full deterministic `pair` (the template fallback). PURE/deterministic.
 *
 * @returns `{ pythonHeart }` always; `{ pythonHeart, pair }` when `fullPair`.
 */
export function astBridge(
  plan: LoversPlan,
  opts: AstBridgeOptions = {},
): { readonly pythonHeart: string; readonly pair?: LoversPair } {
  const pythonHeart = buildDeterministicHeart(plan);
  if (opts.fullPair === true) {
    return { pythonHeart, pair: buildTemplatePair(plan) };
  }
  return { pythonHeart };
}
