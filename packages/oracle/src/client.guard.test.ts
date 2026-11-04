// @necro/oracle — source-level import-closure guard (task 2.1).
//
// This test proves the Client_Safe_Entry (src/client.ts) is browser-safe by
// statically walking its import graph. It is a PURE static-analysis test: it
// never imports or executes client.ts, it only reads file text and parses the
// import specifiers with TypeScript's `ts.preProcessFile`. That keeps the guard
// honest even if client.ts has a Node-only transitive dependency that would
// otherwise throw at import time.
//
// The closure walk starts at src/client.ts and follows only RELATIVE specifiers
// (resolving `.js` -> `.ts`, the ESM form this repo writes). The test FAILS if
// any reachable module:
//   1. lives outside the allowlist
//      { registry/schema, registry/cards, snapshot/types, reading/schema,
//        util/errors };
//   2. has a bare (package) import other than `zod`;
//   3. imports `node:*`, `web-tree-sitter`, `tree-sitter-python`, `smol-toml`,
//      or contains a dynamic `import(` expression.
//
// Because this is the TEST-FIRST half of the task, src/client.ts does not exist
// yet: the walk starts at a missing file and the test fails with a clear
// message. That red is the expected, meaningful starting state; task 2.2 adds
// client.ts and turns it green.
//
// This is a TEST file, excluded from the browser-safe build, so `node:` imports
// are fine here (R16.3, R16.5).
//
// _Requirements: R16.3, R16.5_

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/** Absolute path to packages/oracle/src, resolved relative to this file. */
const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

/** The Client_Safe_Entry whose import closure we audit. */
const ENTRY = resolve(SRC_DIR, "client.ts");

/**
 * The only modules reachable from the Client_Safe_Entry, expressed as paths
 * relative to src/ without extension (POSIX separators). The entry itself is
 * always allowed; everything it reaches transitively must be in this set.
 */
const ALLOWLIST: ReadonlySet<string> = new Set([
  "client",
  "registry/schema",
  "registry/cards",
  "snapshot/types",
  "reading/schema",
  "util/errors",
]);

/** The only bare (package) specifier the closure may depend on. */
const ALLOWED_BARE_IMPORT = "zod";

/**
 * Bare specifiers that must never be reachable from the Client_Safe_Entry.
 * `node:*` is matched separately by prefix.
 */
const FORBIDDEN_BARE_IMPORTS: ReadonlySet<string> = new Set([
  "web-tree-sitter",
  "tree-sitter-python",
  "smol-toml",
]);

/** True for a relative specifier ("./x", "../x"). */
function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/** True for a Node builtin specifier ("node:fs", "node:path", ...). */
function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:");
}

/**
 * Resolve a relative specifier found in `fromFile` to an absolute `.ts` path,
 * mapping the ESM `.js` extension this repo writes back to its `.ts` source.
 * Returns null if no source file exists on disk (the caller reports that).
 */
function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = base.endsWith(".js")
    ? [base.slice(0, -3) + ".ts"]
    : base.endsWith(".ts")
      ? [base]
      : [base + ".ts", resolve(base, "index.ts")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** The import key (path relative to src/, no extension, POSIX separators). */
function keyOf(absoluteTsPath: string): string {
  return relative(SRC_DIR, absoluteTsPath).replace(/\\/g, "/").replace(/\.ts$/, "");
}

interface Violation {
  readonly file: string; // key relative to src/
  readonly reason: string;
}

/**
 * Walk the static import graph from ENTRY. Collects every violation it finds
 * rather than stopping at the first, so a failure lists everything wrong at
 * once. A missing entry or a missing relative target is itself a violation.
 */
function walkClosure(): { readonly reached: ReadonlySet<string>; readonly violations: readonly Violation[] } {
  const violations: Violation[] = [];
  const reached = new Set<string>();
  const queue: string[] = [];

  if (!existsSync(ENTRY)) {
    violations.push({
      file: "client",
      reason:
        "Client_Safe_Entry packages/oracle/src/client.ts does not exist yet. " +
        "Task 2.2 must create it; until then this guard cannot pass.",
    });
    return { reached, violations };
  }

  queue.push(ENTRY);

  while (queue.length > 0) {
    const file = queue.shift() as string;
    const key = keyOf(file);
    if (reached.has(key)) continue;
    reached.add(key);

    const text = readFileSync(file, "utf8");

    // Static-import specifiers (import/export ... from "x", import "x").
    const info = ts.preProcessFile(text, /*readImportFiles*/ true, /*detectJavaScriptImports*/ true);

    // A dynamic import() expression is forbidden outright.
    if (/\bimport\s*\(/.test(text)) {
      violations.push({ file: key, reason: "contains a dynamic import() expression" });
    }

    for (const ref of info.importedFiles) {
      const specifier = ref.fileName;

      if (isNodeBuiltin(specifier)) {
        violations.push({ file: key, reason: `imports Node builtin "${specifier}"` });
        continue;
      }

      if (isRelative(specifier)) {
        const target = resolveRelative(file, specifier);
        if (target === null) {
          violations.push({
            file: key,
            reason: `relative import "${specifier}" resolves to no source file on disk`,
          });
          continue;
        }
        const targetKey = keyOf(target);
        if (!ALLOWLIST.has(targetKey)) {
          violations.push({
            file: key,
            reason: `reaches "${targetKey}", which is outside the client-safe allowlist`,
          });
        }
        queue.push(target);
        continue;
      }

      // Bare (package) specifier.
      const pkg = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : (specifier.split("/")[0] as string);

      if (FORBIDDEN_BARE_IMPORTS.has(pkg)) {
        violations.push({ file: key, reason: `imports forbidden package "${pkg}"` });
        continue;
      }
      if (pkg !== ALLOWED_BARE_IMPORT) {
        violations.push({
          file: key,
          reason: `has bare import "${specifier}" (only "${ALLOWED_BARE_IMPORT}" is allowed)`,
        });
      }
    }
  }

  return { reached, violations };
}

describe("R16.3, R16.5: @necro/oracle/client import-closure guard (source)", () => {
  it("reaches only client-safe modules and no forbidden import", () => {
    const { violations } = walkClosure();
    const report = violations.map((v) => `  - ${v.file}: ${v.reason}`).join("\n");
    expect(violations, `Client_Safe_Entry closure violations:\n${report}`).toEqual([]);
  });

  it("stays within the declared allowlist", () => {
    const { reached } = walkClosure();
    const outside = [...reached].filter((key) => !ALLOWLIST.has(key)).sort();
    expect(outside, `reached modules outside the allowlist: ${outside.join(", ")}`).toEqual([]);
  });
});
