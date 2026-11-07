// @necro/llm — static no-network import guard for the Mock default path
// (task 2.2) AND the lovers-binding provider-placement invariant (task 4.4).
//
// The Mock provider, the completion cache, and the budget helpers are the
// network-free core of @necro/llm: the local runner, every unit/property test,
// and Demo_Mode rely on them running with NO external account and NO socket
// (R4.7, R4.8, R14.4). This guard asserts that invariant structurally — by
// pure static text analysis, mirroring the apps/web client-boundary guard — so
// a regression that pulls in `fetch`, a Node network builtin, or an HTTP client
// fails here rather than at runtime.
//
// Task 4.4 widens the guard ADDITIVELY to assert the lovers-binding provider
// placement invariant (Property 4; R1.8, R10.2, R10.3): network I/O is CONFINED
// to the ONE OpenRouter provider (`providers/openrouter.ts`), and that provider
// reaches the network only through an INJECTED `fetch` seam (`fetchImpl`), never
// a forbidden network-module import nor a bare global `fetch(` call. Concretely
// the guard now:
//   - keeps the original `GUARDED_FILES` (mock/cache/budget) scan unchanged —
//     the Mock DEFAULT path stays import-and-sink clean (R1.8);
//   - scans the WHOLE `@necro/llm` src tree EXCEPT `providers/openrouter.ts`
//     and test files, asserting every other module is network-import-and-sink
//     clean, so a network import appearing anywhere but the OpenRouter provider
//     is a real bug caught here (R10.2);
//   - asserts the OpenRouter provider itself imports no forbidden network
//     module and performs its network access through the injected `fetchImpl`
//     seam — it declares `fetchImpl` as an option and makes NO bare global
//     `fetch(` call at module scope (the single `fetch` token is the injected
//     default `options.fetchImpl ?? fetch`, a reference, not a call) (R10.3).
//
// For each scanned source file the base scan asserts:
//   1. no import of a network-capable module — a Node builtin (`node:net`,
//      `node:http`, `node:https`, `node:tls`, `node:dgram`, `node:http2`,
//      `node:dns`), the bare `net`/`http`/`https`/... aliases, or a known HTTP
//      client package (axios, undici, node-fetch, got, cross-fetch);
//   2. no network sink in code (comments/strings stripped first): a bare
//      `fetch(`, `XMLHttpRequest`, `WebSocket`, or `EventSource`.
//
// No import, no execution — offline, no network / LLM / sandbox.
//
// Validates: Requirements 4.7, 4.8, 14.4, 1.8, 10.2, 10.3

import { readdirSync, readFileSync } from "node:fs";
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

// --- Task 4.4: network is confined to the ONE OpenRouter provider ----------

/** Absolute path to `packages/llm/src`, resolved relative to this file. */
const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

/**
 * The single network-capable module: the OpenRouter provider. It is the ONLY
 * @necro/llm source allowed to perform network I/O, and it does so through an
 * injected `fetchImpl` seam (asserted separately below). It is therefore
 * EXCLUDED from the tree-wide network-free scan.
 */
const OPENROUTER_FILE = "providers/openrouter.ts";

/**
 * Recursively enumerate every `.ts` source file under `packages/llm/src`
 * (paths relative to that dir, POSIX separators), excluding test files
 * (`*.test.ts`, `*.pbt.test.ts`, `*.e2e.ts`). Pure filesystem read — no import,
 * no execution.
 */
function listSourceFiles(dir: string, base: string, acc: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base === "" ? entry.name : `${base}/${entry.name}`;
    if (entry.isDirectory()) {
      listSourceFiles(`${dir}/${entry.name}`, rel, acc);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (/\.(test|pbt\.test|e2e)\.ts$/.test(entry.name)) continue;
    acc.push(rel);
  }
  return acc;
}

describe("Property 4 (R1.8, R10.2, R10.3): network is confined to the OpenRouter provider", () => {
  it("keeps every @necro/llm source EXCEPT the OpenRouter provider network-import-and-sink clean", () => {
    // Scan the whole src tree (minus the one provider + tests). If any other
    // module imports a network module or calls a bare `fetch(`, that is a real
    // provider-placement bug — network must live ONLY in the OpenRouter
    // provider. The Mock default path (mock/cache/budget) is a subset of this
    // set, so the network-free DEFAULT invariant (R1.8) holds here too.
    const all = listSourceFiles(SRC_DIR, "", []).map((p) => p.replace(/\\/g, "/"));
    const scanned = all.filter((rel) => rel !== OPENROUTER_FILE);

    // Sanity: the sweep must actually reach the known network-free core and
    // must NOT be scanning the OpenRouter provider (which legitimately fetches).
    expect(scanned, "tree sweep missed the Mock provider core").toEqual(
      expect.arrayContaining([...GUARDED_FILES]),
    );
    expect(scanned, "the OpenRouter provider must be excluded from the network-free sweep").not.toContain(
      OPENROUTER_FILE,
    );

    const violations: Violation[] = [];
    for (const rel of scanned) scanFile(rel, violations);
    const report = violations.map((v) => `  - ${v.file}: ${v.reason}`).join("\n");
    expect(
      violations,
      `@necro/llm network I/O escaped the OpenRouter provider:\n${report}`,
    ).toEqual([]);
  });

  it("reaches the network in the OpenRouter provider ONLY through an injected fetch seam", () => {
    // The one network-capable module is allowed to fetch — but only via an
    // INJECTED `fetchImpl`, never a forbidden network-module import and never a
    // bare global `fetch(` call. This proves R10.3: unit/property tests drive
    // the provider with a recorded-fixture responder and open no socket.
    const abs = fileURLToPath(new URL(OPENROUTER_FILE, import.meta.url));
    const text = readFileSync(abs, "utf8");

    // (a) No forbidden network-module import even here — the seam is a plain
    //     function value, not an imported HTTP client or Node network builtin.
    const info = ts.preProcessFile(text, true, true);
    const badImports = info.importedFiles
      .map((r) => r.fileName)
      .filter((spec) => FORBIDDEN_IMPORTS.has(spec));
    expect(
      badImports,
      `the OpenRouter provider imports a network module: ${badImports.join(", ")}`,
    ).toEqual([]);

    const code = stripCommentsAndStrings(text);

    // (b) The injected seam is declared: `fetchImpl` is an option and the call
    //     site invokes `fetchImpl(`, not a bare global `fetch(`.
    expect(/\bfetchImpl\b/.test(code), "the OpenRouter provider declares no `fetchImpl` seam").toBe(true);
    expect(
      /\bfetchImpl\s*\(/.test(code),
      "the OpenRouter provider does not call through the injected `fetchImpl` seam",
    ).toBe(true);

    // (c) No bare global `fetch(` CALL. The only `fetch` token is the injected
    //     default `options.fetchImpl ?? fetch` — a reference, not a call — so
    //     after blanking `fetchImpl` occurrences no `fetch(` sink remains.
    const withoutSeam = code.replace(/\bfetchImpl\b/g, "          ");
    expect(
      /\bfetch\s*\(/.test(withoutSeam),
      "the OpenRouter provider calls a bare global `fetch(` instead of the injected seam",
    ).toBe(false);
    for (const sink of ["XMLHttpRequest", "WebSocket", "EventSource"] as const) {
      expect(
        new RegExp(`\\b${sink}\\b`).test(code),
        `the OpenRouter provider uses ${sink} instead of the injected fetch seam`,
      ).toBe(false);
    }
  });
});
