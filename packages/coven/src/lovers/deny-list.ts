// @necro/coven — the pure static deny-list scan for the Lovers (VI) binding.
//
// `denyScan` is the ENFORCEMENT POINT for Requirement 17's safety and the
// prompt-injection defence (design C.3a "Static deny-list scan", A.9). Before
// any generated Lovers pair is accepted, the Lovers gate (`validateLovers`,
// task 8.4) runs this scan over EVERY generated artifact. A hit rejects the
// pair so the runner retries-or-falls-back WITHOUT ever executing the generated
// code (R17.8). The scan is a PURE static read of source TEXT — it never
// imports, requires, evals, spawns, or otherwise runs anything (security rule
// 1: repository/generated code is untrusted data the system only ever parses).
//
// WHAT IT REJECTS (design C.3a):
//   - Code execution:   `eval`, `new Function(` / bare `Function(`, Python `exec`.
//   - Network:          `fetch`, Node `net`/`http`/`https`/`http2`/`tls`/`dgram`/
//                       `dns` (node: prefixed or bare), `WebSocket`, `socket`;
//                       Python `urllib`/`requests`/`http`/`httplib`.
//   - Filesystem writes/deletes: JS `writeFile*`/`appendFile*`/`rm`/`rmdir`/
//                       `unlink`/`mkdir`/`rmSync` etc.; Python `open(..., "w"/"a")`,
//                       `os.remove`/`os.unlink`/`os.rmdir`/`shutil.rmtree`.
//   - OS command:       Python `os.system`, `subprocess` (beyond the heart's own
//                       stdin/stdout dispatcher loop, which uses none of these).
//   - Child processes:  ANY `child_process` usage EXCEPT a single `spawn`/
//                       `spawnSync` of `python3`/`python`/`process.env.PYTHON`
//                       running the heart. A second spawn, a `spawn` of anything
//                       else, or `exec`/`execFile`/`fork` from `child_process`
//                       is rejected.
//
// THE SINGLE-PYTHON-SPAWN ALLOWANCE (design C.2a / C.3a). The deterministic and
// LLM `jsBeloved` MUST spawn exactly one long-lived python heart child. So the
// JS scan allows EXACTLY ONE `spawn(...)` / `spawnSync(...)` call whose first
// argument names the python interpreter (`"python3"`, `"python"`, or
// `process.env.PYTHON`) — the heart child. Any additional spawn, or a spawn of
// a non-python binary, is a hit. `exec`/`execFile`/`execSync`/`execFileSync`/
// `fork` from `child_process` are never allowed.
//
// PURITY. `denyScan(code, lang)` depends only on its arguments. It strips
// comments and string/template literals to spaces first (so a token quoted
// inside the generated code — or inside a docstring — is NOT a false positive)
// and then matches forbidden constructs against the stripped code. It returns
// the FIRST offending token/construct (a short stable label) or `null` when the
// artifact is clean. The scan is property/unit tested (design C.3a).

/** The two source languages the Lovers pair spans. */
export type DenyScanLang = "python" | "javascript";

// ---------------------------------------------------------------------------
// Comment / string stripping (shared with the import-ban guard's approach).
// Replace every comment and string/template literal with spaces so a forbidden
// token that only appears inside a quoted string or comment never matches. Line
// structure is preserved (newlines kept) so this stays a cheap linear pass.
// ---------------------------------------------------------------------------

/** Replace every non-newline char of `s` with a space (preserves line count). */
function blank(s: string): string {
  return s.replace(/[^\n]/g, " ");
}

/**
 * Strip JavaScript comments (`//`, block) and string/template literals to
 * spaces. Template literals are blanked whole (their `${...}` substitutions
 * included) — the deterministic beloved never hides a sink in a template, and a
 * forbidden token appearing as template TEXT is data, not a call.
 */
function stripJs(text: string): string {
  const out: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const two = text.slice(i, i + 2);
    if (two === "//") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out.push(blank(text.slice(i, stop)));
      i = stop;
      continue;
    }
    if (two === "/*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out.push(blank(text.slice(i, stop)));
      i = stop;
      continue;
    }
    const ch = text[i] as string;
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n) {
        const cj = text[j] as string;
        if (cj === "\\") {
          j += 2;
          continue;
        }
        if (cj === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      out.push(blank(text.slice(i, j)));
      i = j;
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join("");
}

/**
 * Strip Python comments (`#`) and string literals (including triple-quoted
 * strings and `r`/`b`/`f`/`u` prefixes) to spaces. String PREFIXES are left in
 * place as ordinary text; only the quoted body is blanked. This keeps a
 * forbidden token that appears only inside a docstring/string from matching.
 */
function stripPy(text: string): string {
  const out: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i] as string;
    if (ch === "#") {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out.push(blank(text.slice(i, stop)));
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const triple = text.slice(i, i + 3);
      const isTriple = triple === '"""' || triple === "'''";
      const quote = isTriple ? triple : ch;
      let j = i + quote.length;
      while (j < n) {
        const cj = text[j] as string;
        if (cj === "\\") {
          j += 2;
          continue;
        }
        if (text.slice(j, j + quote.length) === quote) {
          j += quote.length;
          break;
        }
        j += 1;
      }
      out.push(blank(text.slice(i, Math.min(j, n))));
      i = Math.min(j, n);
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join("");
}

// ---------------------------------------------------------------------------
// Shared forbidden constructs (code execution). Rejected in BOTH languages.
// ---------------------------------------------------------------------------

/** `label` is the stable offending token reported on a hit. */
interface Rule {
  readonly label: string;
  readonly re: RegExp;
}

/** Code-execution sinks forbidden in every artifact (JS + Python). */
const SHARED_RULES: readonly Rule[] = [
  { label: "eval", re: /\beval\s*\(/ },
];

/** JavaScript-only forbidden constructs (network, fs write/delete, Function). */
const JS_RULES: readonly Rule[] = [
  // Dynamic code execution.
  { label: "Function", re: /\bFunction\s*\(/ },
  // Network sinks.
  { label: "fetch", re: /\bfetch\s*\(/ },
  { label: "WebSocket", re: /\bWebSocket\b/ },
  {
    label: "network-module",
    re: /\b(?:require\s*\(\s*["'](?:node:)?(?:net|http|https|http2|tls|dgram|dns)["']\s*\)|from\s+["'](?:node:)?(?:net|http|https|http2|tls|dgram|dns)["']|import\s+["'](?:node:)?(?:net|http|https|http2|tls|dgram|dns)["'])/,
  },
  { label: "socket", re: /\bcreateServer\s*\(|\bcreateConnection\s*\(/ },
  // Filesystem writes/deletes (promise + sync + callback variants). Scoped to
  // the `fs`-named functions ONLY — a bare `.write(`/`.end(` on a child
  // process's stdin/stdout stream is legitimate protocol I/O (the single
  // python-heart child), so it is NOT matched here. `createWriteStream` IS a
  // filesystem write sink and is rejected.
  {
    label: "fs-write-or-delete",
    re: /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|unlink|unlinkSync|rmdir|rmdirSync|rmSync|mkdir|mkdirSync|createWriteStream|truncate|truncateSync)\s*\(|\bfs\s*\.\s*rm\s*\(|\brm\s*\(\s*["']/,
  },
];

/** Python-only forbidden constructs (exec, os.system, network, fs write/delete). */
const PY_RULES: readonly Rule[] = [
  { label: "exec", re: /\bexec\s*\(/ },
  { label: "os.system", re: /\bos\s*\.\s*system\s*\(/ },
  { label: "os.popen", re: /\bos\s*\.\s*popen\s*\(/ },
  // Any subprocess use in Python code (the heart uses none — its only process
  // I/O is its own stdin/stdout loop). child_process is a JS concept; the
  // python heart must never shell out.
  { label: "subprocess", re: /\bsubprocess\b/ },
  // Network modules / clients.
  {
    label: "network-module",
    re: /\bimport\s+(?:socket|urllib|requests|http|httplib|ftplib|telnetlib|asyncio)\b|\bfrom\s+(?:socket|urllib|requests|http|httplib)\b/,
  },
  // Filesystem deletes.
  { label: "os.remove", re: /\bos\s*\.\s*(?:remove|unlink|rmdir)\s*\(/ },
  { label: "shutil.rmtree", re: /\bshutil\s*\.\s*rmtree\s*\(/ },
  // File writes: open(..., "w"/"a"/"x"/"+") in any mode containing a write char.
  {
    label: "open-write",
    re: /\bopen\s*\([^)]*,\s*["'][^"']*[wax+][^"']*["']/,
  },
];

// ---------------------------------------------------------------------------
// child_process allowance (JS). Any `child_process` usage is a hit EXCEPT a
// single spawn/spawnSync of the python heart.
// ---------------------------------------------------------------------------

/** Matches a `spawn(` / `spawnSync(` call and captures its first argument text. */
const SPAWN_CALL_RE = /\bspawnSync\s*\(|\bspawn\s*\(/g;

/** The forbidden `child_process` functions other than spawn (always a hit). */
const CP_FORBIDDEN_FN_RE =
  /\b(?:execFileSync|execFile|execSync|exec|fork)\s*\(/;

/**
 * Interpreter spellings the single allowed spawn may name as its first arg:
 *   - a `"python3"` / `"python"` string literal,
 *   - `process.env.PYTHON` / `process.env["PYTHON"]` (with or without a
 *     `?? "python3"` default), or
 *   - a bare `PYTHON` identifier (the conventional
 *     `const PYTHON = process.env.PYTHON ?? "python3"` binding the deterministic
 *     and generated beloved both use).
 */
const PYTHON_INTERP_RE =
  /^\s*(?:(?:process\s*\.\s*env\s*\.\s*PYTHON)|(?:process\s*\.\s*env\s*\[\s*["']PYTHON["']\s*\])|(?:["'](?:python3|python)["'])|(?:PYTHON\b))/;

/**
 * Scan the (comment/string-stripped) JS code for `child_process` misuse. The
 * ONLY permitted use is exactly one `spawn(...)`/`spawnSync(...)` whose first
 * argument names the python interpreter (`"python3"`, `"python"`, or
 * `process.env.PYTHON`, including the `process.env.PYTHON ?? "python3"` form).
 * Returns the offending label, or `null` when the allowance holds.
 */
function scanChildProcess(stripped: string): string | null {
  // exec/execFile/execSync/execFileSync/fork from child_process are never ok.
  if (CP_FORBIDDEN_FN_RE.test(stripped)) {
    return "child_process-exec";
  }

  const spawnMatches = [...stripped.matchAll(SPAWN_CALL_RE)];
  if (spawnMatches.length === 0) {
    return null;
  }
  // Only ONE spawn is allowed in the whole artifact (the single heart child).
  if (spawnMatches.length > 1) {
    return "child_process-multiple-spawn";
  }
  const match = spawnMatches[0] as RegExpMatchArray;
  const argStart = (match.index ?? 0) + match[0].length;
  const firstArg = stripped.slice(argStart, argStart + 80);
  if (!PYTHON_INTERP_RE.test(firstArg)) {
    return "child_process-non-python-spawn";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Statically scan one generated artifact for a forbidden construct (design
 * C.3a). PURE: a function of `(code, lang)` only; it strips comments/strings to
 * spaces, then matches the deny-list rules. Returns the FIRST offending token
 * (a short stable label such as `"eval"`, `"fetch"`, `"os.system"`,
 * `"child_process-multiple-spawn"`) or `null` when the artifact is clean.
 *
 * It NEVER executes the code — it only reads the text (R17.7, R17.8,
 * security rule 1).
 *
 * The single-python-spawn allowance (JS): exactly one `spawn`/`spawnSync` of
 * `"python3"`/`"python"`/`process.env.PYTHON` is permitted (the heart child);
 * every other `child_process` use — a second spawn, a non-python spawn, or
 * `exec`/`execFile`/`fork` — is a hit.
 */
export function denyScan(code: string, lang: DenyScanLang): string | null {
  const stripped = lang === "javascript" ? stripJs(code) : stripPy(code);

  for (const rule of SHARED_RULES) {
    if (rule.re.test(stripped)) return rule.label;
  }

  if (lang === "javascript") {
    for (const rule of JS_RULES) {
      if (rule.re.test(stripped)) return rule.label;
    }
    return scanChildProcess(stripped);
  }

  for (const rule of PY_RULES) {
    if (rule.re.test(stripped)) return rule.label;
  }
  return null;
}
