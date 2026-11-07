// @necro/grimoires-lovers-js — static import-ban guard for the grimoire core.
//
// The Lovers grimoire is a PURE binding plugin: its two declarative LLM steps
// (PLAN, GENERATE), the deterministic `ast-bridge` heart/fallback, the
// `validate()` gate, and the grimoire barrel must stay free of any
// side-effecting adapter. Side effects (LLM calls, sandbox execution, GitHub,
// voice, network) only ever live behind the ports the coven runner injects —
// never inside a grimoire. The grimoire reaches the LLM exclusively through the
// injected `LlmPort`; it never imports `@necro/llm` (or any other adapter)
// itself (R15.6, R15.7). And since repository code is untrusted data a grimoire
// only ever parses — never executes — the steps and `validate()` must never
// `eval`, spawn a child process, or `require()` anything at runtime (R3.2,
// R3.3, R5.4).
//
// This guard proves those invariants STRUCTURALLY, by pure static text
// analysis — it never imports or executes any grimoire module. It mirrors the
// py2to3 grimoire's `import-ban.test.ts`: parse the import specifiers with
// TypeScript's `ts.preProcessFile`, then scan the comment/string-stripped code
// for forbidden sinks. A regression that pulls in an adapter or reaches for
// `eval`/`child_process` fails here, not at runtime.
//
// No import, no execution — offline, no network / LLM / sandbox.
//
// Validates: Requirements 3.2, 3.3, 5.4, 15.6, 15.7

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/** Absolute path to packages/grimoires/lovers-js/src, resolved from this file. */
const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

/**
 * Adapter packages a grimoire must never import directly — side effects reach
 * the grimoire only through the ports the coven runner injects (R15.7).
 */
const FORBIDDEN_ADAPTER_IMPORTS: ReadonlySet<string> = new Set([
  "@necro/llm",
  "@necro/sandbox",
  "@necro/github",
  "@necro/voice",
]);

/**
 * Specifiers that imply network capability or process execution: Node network
 * and child-process builtins (node: prefixed and bare aliases) plus known
 * HTTP-client packages. `node:crypto` (used by the LLM steps for the sha256
 * cache key) is stdlib, not an adapter, and is deliberately NOT listed.
 */
const FORBIDDEN_MODULE_IMPORTS: ReadonlySet<string> = new Set([
  // Node network + process builtins (node: prefixed and bare aliases).
  "node:net",
  "node:http",
  "node:https",
  "node:http2",
  "node:tls",
  "node:dgram",
  "node:dns",
  "node:child_process",
  "net",
  "http",
  "https",
  "http2",
  "tls",
  "dgram",
  "dns",
  "child_process",
  // Common HTTP-client packages.
  "axios",
  "undici",
  "node-fetch",
  "cross-fetch",
  "got",
]);

/**
 * Collect every non-test `.ts` source file under src/ as a path relative to
 * src/ (POSIX separators). The guard audits the whole grimoire surface.
 */
function collectSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      if (entry.name.endsWith(".test.ts")) continue;
      out.push(relative(SRC_DIR, abs).replace(/\\/g, "/"));
    }
  };
  walk(SRC_DIR);
  return out.sort();
}

/**
 * Strip line/block comments and string/template literals, replacing them with
 * spaces so a sink regex never matches inside a comment or a quoted string.
 */
function stripCommentsAndStrings(text: string): string {
  const out: string[] = [];
  let i = 0;
  const n = text.length;
  const blank = (s: string): string => s.replace(/[^\n]/g, " ");
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

/** The npm package of a bare specifier ("@scope/x/y" -> "@scope/x", "x/y" -> "x"). */
function packageOf(specifier: string): string {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : (specifier.split("/")[0] as string);
}

/** True for a Node builtin specifier ("node:fs", "node:child_process", ...). */
function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:");
}

interface Violation {
  readonly file: string;
  readonly reason: string;
}

function scanFile(rel: string, violations: Violation[]): void {
  const abs = join(SRC_DIR, rel);
  const text = readFileSync(abs, "utf8");

  const info = ts.preProcessFile(text, /*readImportFiles*/ true, /*detectJavaScriptImports*/ true);
  for (const ref of info.importedFiles) {
    const specifier = ref.fileName;
    if (FORBIDDEN_MODULE_IMPORTS.has(specifier)) {
      violations.push({ file: rel, reason: `imports forbidden module "${specifier}"` });
      continue;
    }
    if (isNodeBuiltin(specifier)) continue;
    const pkg = packageOf(specifier);
    if (FORBIDDEN_ADAPTER_IMPORTS.has(pkg)) {
      violations.push({ file: rel, reason: `imports adapter package "${pkg}" (adapters are injected via ports only)` });
    } else if (FORBIDDEN_MODULE_IMPORTS.has(pkg)) {
      violations.push({ file: rel, reason: `imports network module "${pkg}"` });
    }
  }

  const code = stripCommentsAndStrings(text);
  if (/\beval\s*\(/.test(code)) {
    violations.push({ file: rel, reason: "calls eval(" });
  }
  if (/\brequire\s*\(/.test(code)) {
    violations.push({ file: rel, reason: "calls require(" });
  }
  if (/\bchild_process\b/.test(code)) {
    violations.push({ file: rel, reason: "references child_process" });
  }
}

describe("R3.2, R3.3, R5.4, R15.6, R15.7: the lovers-js grimoire imports no adapter and executes nothing", () => {
  it("audits every grimoire source file (sanity: the walk finds the known modules)", () => {
    const files = collectSourceFiles();
    // The grimoire surface present at scaffold time: the barrel + the two steps.
    expect(files).toContain("index.ts");
    expect(files).toContain("llm/plan.ts");
    expect(files).toContain("llm/generate.ts");
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it("has no adapter/network import and no eval/child_process/require sink", () => {
    const violations: Violation[] = [];
    for (const rel of collectSourceFiles()) scanFile(rel, violations);
    const report = violations.map((v) => `  - ${v.file}: ${v.reason}`).join("\n");
    expect(violations, `lovers-js grimoire import-ban violations:\n${report}`).toEqual([]);
  });
});
