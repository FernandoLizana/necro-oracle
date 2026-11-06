// @necro/llm — static no-network import guard for the Mock provider path
// (task 2.2).
//
// The Mock provider, the completion cache, and the budget helpers are the
// network-free core of @necro/llm: the local runner, every unit/property test,
// and Demo_Mode rely on them running with NO external account and NO socket
// (R4.7, R4.8, R14.4). This guard asserts that invariant structurally — by
// pure static text analysis, mirroring the apps/web client-boundary guard — so
// a regression that pulls in `fetch`, a Node network builtin, or an HTTP client
// fails here rather than at runtime.
//
// For each scanned source file it asserts:
//   1. no import of a network-capable module — a Node builtin (`node:net`,
//      `node:http`, `node:https`, `node:tls`, `node:dgram`, `node:http2`,
//      `node:dns`), the bare `net`/`http`/`https`/... aliases, or a known HTTP
//      client package (axios, undici, node-fetch, got, cross-fetch);
//   2. no network sink in code (comments/strings stripped first): a bare
//      `fetch(`, `XMLHttpRequest`, `WebSocket`, or `EventSource`.
//
// No import, no execution — offline, no network / LLM / sandbox.
//
// Validates: Requirements 4.7, 4.8, 14.4

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/** Source files that make up the network-free Mock provider core. */
const GUARDED_FILES: readonly string[] = [
  "providers/mock.ts",
  "cache.ts",
  "budget.ts",
];

/** Bare/aliased specifiers that imply network capability. */
const FORBIDDEN_IMPORTS: ReadonlySet<string> = new Set([
  // Node network builtins (node: prefixed and bare aliases).
  "node:net",
  "node:http",
  "node:https",
  "node:http2",
  "node:tls",
  "node:dgram",
  "node:dns",
  "net",
  "http",
  "https",
  "http2",
  "tls",
  "dgram",
  "dns",
  // Common HTTP-client packages.
  "axios",
  "undici",
  "node-fetch",
  "cross-fetch",
  "got",
]);

/**
 * Strip line/block comments and string/template literals, replacing them with
 * spaces so a network-sink regex never matches inside a comment (e.g. this
 * file's own "no fetch(" note) or a quoted string.
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

interface Violation {
  readonly file: string;
  readonly reason: string;
}

function scanFile(rel: string, violations: Violation[]): void {
  const abs = fileURLToPath(new URL(rel, import.meta.url));
  const text = readFileSync(abs, "utf8");

  const info = ts.preProcessFile(text, /*readImportFiles*/ true, /*detectJavaScriptImports*/ true);
  for (const ref of info.importedFiles) {
    const specifier = ref.fileName;
    if (FORBIDDEN_IMPORTS.has(specifier)) {
      violations.push({ file: rel, reason: `imports network module "${specifier}"` });
    }
  }

  const code = stripCommentsAndStrings(text);
  if (/\bfetch\s*\(/.test(code)) {
    violations.push({ file: rel, reason: "calls fetch(" });
  }
  if (/\bXMLHttpRequest\b/.test(code)) {
    violations.push({ file: rel, reason: "uses XMLHttpRequest" });
  }
  if (/\bWebSocket\b/.test(code)) {
    violations.push({ file: rel, reason: "uses WebSocket" });
  }
  if (/\bEventSource\b/.test(code)) {
    violations.push({ file: rel, reason: "uses EventSource" });
  }
}

describe("R4.7, R4.8, R14.4: the Mock provider core imports no network module", () => {
  it("has no network import and no network sink in mock/cache/budget", () => {
    const violations: Violation[] = [];
    for (const rel of GUARDED_FILES) scanFile(rel, violations);
    const report = violations.map((v) => `  - ${v.file}: ${v.reason}`).join("\n");
    expect(violations, `@necro/llm network violations:\n${report}`).toEqual([]);
  });
});
