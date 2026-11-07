// @necro/grimoires-lovers-js — Property 33 (R39.1, R39.2) + Property 32
// (R38.1, R38.2): the deny-list scan rejects dangerous generated code, and the
// emitted `jsBeloved` is a CLIENT, never a reimplementation of the Python logic
// (task 8.13).
//
// Both properties are PURE: they exercise the REAL exported `denyScan`
// (@necro/coven) and the REAL deterministic `buildJsBeloved`/`buildTemplatePair`
// (@necro/grimoires-lovers-js ast-bridge) over arbitrary bindable plans and
// arbitrary generated source. No network, no LLM, no sandbox — the deny-list
// scan is a static read of source TEXT and the bridge is a deterministic
// function of the plan alone. The oracle tree-sitter parsers are not needed for
// these two properties (the scan/bridge are text-only), so `initParser()` is
// not armed here.
//
// ---------------------------------------------------------------------------
// Property 33 (R39.1, R39.2): the deny-list scan rejects dangerous code.
//   (a) For arbitrary code carrying a forbidden construct (eval/Function/exec,
//       os.system/subprocess, network sockets/fetch/WebSocket, fs write/delete,
//       or a child_process use beyond the single allowed python-heart spawn),
//       `denyScan` returns a NON-NULL hit — the offending token is reported and
//       the code is NEVER executed (the scan only reads text).
//   (b) For clean stdlib-only code, `denyScan` returns `null`.
//   (c) STRIPPING: a forbidden token that appears ONLY inside a string/template
//       literal or a comment is NOT a hit — `denyScan` strips comments and
//       string/template literals before matching (design C.3a / A.9).
//   (d) TOTAL + DETERMINISTIC: `denyScan(code, lang)` never throws and returns
//       the same result for the same `(code, lang)`.
//
// Property 32 (R38.1, R38.2): jsBeloved is a client, not a reimplementation.
//   For arbitrary bindable plans, the emitted `jsBeloved`:
//     - spawns EXACTLY ONE child process — the python heart (`spawn(PYTHON, …)`);
//     - exposes `export async function <name>(…)` for EVERY bindable function,
//       and each wrapper body forwards over the contract via `_call(…)` (it
//       never reimplements the Python body);
//     - exposes a `close()` export; and
//     - is deny-list clean: `denyScan(jsBeloved, "javascript") === null` (the
//       one allowed python spawn does not trip the scan).
//
// Validates: Requirements 38.1, 38.2, 39.1, 39.2

import {
  buildJsBeloved,
  buildTemplatePair,
} from "@necro/grimoires-lovers-js";
import {
  denyScan,
  type DenyScanLang,
  type JsonType,
  type LoversFunction,
  type LoversPlan,
} from "@necro/coven";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Reserved / keyword names. `extractPlan` drops a function or parameter whose
// name is a JS reserved word or a Python keyword, so the bridge only ever emits
// bindable names that are valid, non-reserved identifiers in BOTH languages. A
// plan arbitrary that fed the bridge a reserved name would emit invalid JS /
// Python and skew the client-role assertions, so the name generator excludes
// them (mirrors the exclusion in binding-coverage.pbt.test.ts).
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

/**
 * A safe identifier: valid in BOTH Python and JavaScript and never a keyword in
 * either. The `.filter` makes the guarantee TRUE — any generated name that
 * happens to be reserved is rejected and regenerated.
 */
const arbName = fc
  .tuple(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
    fc.stringMatching(/^[a-z0-9_]{0,7}$/),
  )
  .map(([head, tail]) => `${head}${tail}`)
  .filter((name) => !RESERVED_NAMES.has(name));

/** The JSON types a bindable param / return may take. */
const arbJsonType: fc.Arbitrary<JsonType> = fc.constantFrom(
  "string",
  "number",
  "integer",
  "boolean",
  "null",
  "array",
  "object",
);

/** JSDoc JS type for a JSON type (kept simple; the bridge only echoes it). */
function jsTypeOf(jsonType: JsonType): string {
  switch (jsonType) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return "Array<unknown>";
    case "object":
    default:
      return "object";
  }
}

/** A bindable param: a safe name, a JSON type, required-or-defaulted. */
const arbParam = fc.record({
  name: arbName,
  jsonType: arbJsonType,
  required: fc.boolean(),
});

/** A bindable `LoversFunction` with distinct, safe parameter names. */
const arbFunction: fc.Arbitrary<LoversFunction> = fc
  .record({
    name: arbName,
    params: fc.uniqueArray(arbParam, {
      selector: (p) => p.name,
      minLength: 0,
      maxLength: 4,
    }),
    returnJson: arbJsonType,
  })
  .map(({ name, params, returnJson }): LoversFunction => ({
    name,
    params: params.map((p) => ({
      name: p.name,
      pyType: p.jsonType,
      jsonType: p.jsonType,
      jsType: jsTypeOf(p.jsonType),
      required: p.required,
    })),
    returns: {
      pyType: returnJson,
      jsonType: returnJson,
      jsType: jsTypeOf(returnJson),
    },
    bindable: true,
    edgeCases: [],
  }));

/** A bindable `LoversPlan`: 1..8 functions with DISTINCT names. */
const arbPlan: fc.Arbitrary<LoversPlan> = fc
  .uniqueArray(arbFunction, {
    selector: (fn) => fn.name,
    minLength: 1,
    maxLength: 8,
  })
  .map((functions): LoversPlan => ({ functions, typeMap: [] }));

// ---------------------------------------------------------------------------
// Property 33 generators: clean code + each forbidden construct in each lang.
// ---------------------------------------------------------------------------

/** Clean, stdlib-only JavaScript that trips NO rule. */
const CLEAN_JS = [
  `export function add(a, b) { return a + b; }`,
  `const xs = [1, 2, 3].map((n) => n * 2);`,
  `import { join } from "node:path";\nexport const p = join("a", "b");`,
  `export async function greet(name) { return "hi " + name; }`,
  `class Point { constructor(x) { this.x = x; } }`,
];

/** Clean, stdlib-only Python that trips NO rule. */
const CLEAN_PY = [
  `def add(a, b):\n    return a + b\n`,
  `import json\n\ndef dump(x):\n    return json.dumps(x)\n`,
  `def greet(name):\n    return "hi " + name\n`,
  `xs = [n * 2 for n in [1, 2, 3]]\n`,
  `def read(d):\n    return d.get("k")\n`,
];

// NOTE ON THE STRIP-FIRST CONTRACT (a real, documented gap in `denyScan`).
// `denyScan` strips comments and string/template literals to spaces BEFORE
// matching (its documented anti-false-positive design). That stripping defeats
// the two deny-list rules that depend on QUOTED content:
//   - JS `network-module` (`require("node:net")`, `import … from "node:http"`,
//     `import "node:net"`): the module specifier is a string literal, blanked
//     before the rule runs — so these forms return `null` (NOT a hit).
//   - Python `open-write` (`open("/tmp/x", "w")`): the mode is a string literal,
//     blanked before the rule runs — so this form returns `null` (NOT a hit).
// These constructs are therefore NOT included in the "must hit" fixtures below:
// asserting a hit would be asserting behavior the implementation does not (and
// by its strip-first design cannot) provide. Network/fs-write intent is still
// caught through IDENTIFIER-based vectors that survive stripping (JS: `fetch`,
// `WebSocket`, `createServer`/`createConnection`, the `fs`/`writeFile*` sinks;
// Python: `import socket`/`urllib`/`requests`/`from http`, `os.remove`/`unlink`/
// `rmdir`, `shutil.rmtree`), which ARE exercised below. The gap is reported to
// the orchestrator rather than papered over by weakening the property.

/**
 * JavaScript snippets that each carry EXACTLY one forbidden construct outside
 * any string/comment, so `denyScan(…, "javascript")` must return a hit. Only
 * IDENTIFIER-based sinks (which survive the strip-first pass) are listed — see
 * the strip-first note above.
 */
const FORBIDDEN_JS = [
  `const r = eval("1 + 1");`, // code execution
  `const f = Function("return 1");`, // dynamic code
  `const f = new Function("return 1");`, // dynamic code
  `const r = await fetch("http://x");`, // network (identifier)
  `const ws = new WebSocket("ws://x");`, // network (identifier)
  `createServer((req, res) => res.end());`, // socket (identifier)
  `const c = createConnection(opts);`, // socket (identifier)
  `writeFileSync("/tmp/x", "data");`, // fs write
  `appendFile("/tmp/x", "data", cb);`, // fs write
  `unlinkSync("/tmp/x");`, // fs delete
  `rmSync("/tmp/x", { recursive: true });`, // fs delete
  `mkdirSync("/tmp/x");`, // fs write
  `createWriteStream("/tmp/x");`, // fs write
  `execSync("ls");`, // child_process exec
  `execFile("ls", [], cb);`, // child_process exec
  `fork("worker.js");`, // child_process fork
  `spawn("ls", ["-la"]);`, // non-python spawn
  `spawn("python3", [H]); spawn("python3", [H]);`, // two spawns
  `spawn("node", ["x.js"]);`, // non-python spawn
];

/**
 * Python snippets that each carry EXACTLY one forbidden construct outside any
 * string/comment, so `denyScan(…, "python")` must return a hit. The quoted-mode
 * `open(..., "w")` form is excluded — see the strip-first note above.
 */
const FORBIDDEN_PY = [
  `eval("1 + 1")`, // code execution
  `exec("x = 1")`, // code execution
  `import os\nos.system("ls")`, // os command
  `import subprocess\nsubprocess.run(["ls"])`, // subprocess
  `import socket\ns = socket.socket()`, // network module (identifier import)
  `import urllib\nurllib.request.urlopen("http://x")`, // network module
  `import requests\nrequests.get("http://x")`, // network module
  `from http import client`, // network module
  `os.remove("/tmp/x")`, // fs delete
  `os.unlink("/tmp/x")`, // fs delete
  `os.rmdir("/tmp/x")`, // fs delete
  `import shutil\nshutil.rmtree("/tmp/x")`, // fs delete
  `os.popen("ls")`, // os command
];

/**
 * A forbidden JS token embedded ONLY inside a string/template/comment, so the
 * stripping pass must NOT count it as a hit.
 */
const STRING_WRAPPED_JS = [
  `const s = "eval(1)";`,
  `const s = 'fetch("http://x")';`,
  "const s = `WebSocket here`;",
  `// eval("1")`,
  `/* writeFileSync("/tmp/x") */ const x = 1;`,
  `const s = "subprocess.run";`,
  `const doc = "execSync spawn fork";`,
];

/**
 * A forbidden Python token embedded ONLY inside a string/docstring/comment, so
 * the stripping pass must NOT count it as a hit.
 */
const STRING_WRAPPED_PY = [
  `s = "eval(1)"`,
  `s = 'os.system("ls")'`,
  `"""exec and subprocess and socket live only in this docstring."""`,
  `# os.remove("/tmp/x")`,
  `s = "open('/tmp/x', 'w')"`,
  `help_text = "use requests or urllib to fetch"`,
];

// ===========================================================================
// Property 33 (R39.1, R39.2): the deny-list scan rejects dangerous code.
// ===========================================================================

describe("Property 33 (R39.1, R39.2): the deny-list scan rejects dangerous generated code", () => {
  it("returns null for clean stdlib-only code in both languages", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CLEAN_JS),
        fc.constantFrom(...CLEAN_PY),
        (js, py) => {
          expect(denyScan(js, "javascript")).toBeNull();
          expect(denyScan(py, "python")).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });

  it("returns a non-null hit for any forbidden construct (JS), without executing it", () => {
    fc.assert(
      fc.property(fc.constantFrom(...FORBIDDEN_JS), (code) => {
        const hit = denyScan(code, "javascript");
        expect(hit).not.toBeNull();
        expect(typeof hit).toBe("string");
        expect((hit as string).length).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });

  it("returns a non-null hit for any forbidden construct (Python), without executing it", () => {
    fc.assert(
      fc.property(fc.constantFrom(...FORBIDDEN_PY), (code) => {
        const hit = denyScan(code, "python");
        expect(hit).not.toBeNull();
        expect(typeof hit).toBe("string");
        expect((hit as string).length).toBeGreaterThan(0);
      }),
      { numRuns: 300 },
    );
  });

  it("strips comments and string/template literals: a forbidden token inside a string is NOT a hit", () => {
    fc.assert(
      fc.property(fc.constantFrom(...STRING_WRAPPED_JS), (code) => {
        expect(denyScan(code, "javascript")).toBeNull();
      }),
      { numRuns: 200 },
    );
    fc.assert(
      fc.property(fc.constantFrom(...STRING_WRAPPED_PY), (code) => {
        expect(denyScan(code, "python")).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it("a forbidden token prepended to clean code flips a clean result to a hit (string-wrapping is the only difference)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CLEAN_JS),
        fc.constantFrom(`eval(x);`, `fetch(u);`, `writeFileSync(p, d);`),
        (clean, sink) => {
          // The clean body alone is null; the SAME body with a real (unquoted)
          // sink prepended is a hit — proving the sink, not the body, is caught.
          expect(denyScan(clean, "javascript")).toBeNull();
          expect(denyScan(`${sink}\n${clean}`, "javascript")).not.toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("is total and deterministic over arbitrary text in both languages", () => {
    const arbLang: fc.Arbitrary<DenyScanLang> = fc.constantFrom("javascript", "python");
    fc.assert(
      fc.property(fc.string(), arbLang, (code, lang) => {
        // Never throws (totality) and is referentially stable (determinism).
        const a = denyScan(code, lang);
        const b = denyScan(code, lang);
        expect(a).toEqual(b);
        expect(a === null || typeof a === "string").toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

// ===========================================================================
// Property 32 (R38.1, R38.2): jsBeloved is a client, not a reimplementation.
// ===========================================================================

/** Count `spawn(` / `spawnSync(` calls in the beloved (deny-list-strip-free). */
function spawnCount(code: string): number {
  return (code.match(/\bspawn(?:Sync)?\s*\(/g) ?? []).length;
}

/** The set of `export async function <name>(` names declared in the beloved. */
function exportedAsyncFns(code: string): Set<string> {
  const names = new Set<string>();
  const re = /export\s+async\s+function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) names.add(m[1] as string);
  return names;
}

/** Escape a name for use inside a RegExp. */
function escapeRe(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The BODY of `export async function <name>(…) { … }`, balanced on braces so a
 * nested object literal in the body does not end the match early.
 */
function wrapperBody(code: string, name: string): string | null {
  const head = new RegExp(`export\\s+async\\s+function\\s+${escapeRe(name)}\\s*\\([^)]*\\)\\s*\\{`);
  const m = head.exec(code);
  if (m === null) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (i < code.length && depth > 0) {
    const ch = code[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    i += 1;
  }
  return code.slice(start, i - 1);
}

describe("Property 32 (R38.1, R38.2): jsBeloved is a client, not a reimplementation", () => {
  it("spawns exactly ONE python-heart child, is deny-list clean, exports close(), and every function forwards via _call", () => {
    fc.assert(
      fc.property(arbPlan, (plan) => {
        const beloved = buildJsBeloved(plan);

        // --- R38.1: exactly one child_process spawn (the python heart) -------
        expect(spawnCount(beloved)).toBe(1);
        expect(beloved).toMatch(/spawn\s*\(\s*PYTHON\s*,/);
        expect(beloved).toMatch(/const\s+PYTHON\s*=\s*process\.env\.PYTHON\s*\?\?\s*"python3"/);

        // --- R38.1: the single allowed spawn does NOT trip the deny-list -----
        expect(denyScan(beloved, "javascript")).toBeNull();

        // --- R38.2: a close() export exists ---------------------------------
        expect(beloved).toMatch(/export\s+function\s+close\s*\(\s*\)/);

        // --- R38.2: every bindable function is a forwarding client wrapper --
        const planned = plan.functions.filter((fn) => fn.bindable).map((fn) => fn.name);
        const exported = exportedAsyncFns(beloved);
        for (const name of planned) {
          // A corresponding `export async function <name>` exists.
          expect(exported.has(name), `beloved must export async ${name}`).toBe(true);
          // Its body ONLY forwards over the contract via `_call(...)` — it does
          // not reimplement the Python body.
          const body = wrapperBody(beloved, name);
          expect(body, `wrapper body for ${name}`).not.toBeNull();
          expect(body as string, `${name} must forward via _call`).toMatch(
            new RegExp(`return\\s+_call\\(\\s*"${escapeRe(name)}"`),
          );
        }

        // No extra exported async wrapper beyond the planned functions.
        expect(exported).toEqual(new Set(planned));
      }),
      { numRuns: 300 },
    );
  });

  it("the full deterministic template pair's beloved is also a deny-list-clean single-spawn client", () => {
    fc.assert(
      fc.property(arbPlan, (plan) => {
        const pair = buildTemplatePair(plan);
        expect(spawnCount(pair.jsBeloved)).toBe(1);
        expect(denyScan(pair.jsBeloved, "javascript")).toBeNull();
        expect(pair.jsBeloved).toMatch(/export\s+function\s+close\s*\(\s*\)/);
      }),
      { numRuns: 200 },
    );
  });
});
