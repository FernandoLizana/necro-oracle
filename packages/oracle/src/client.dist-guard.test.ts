// @necro/oracle — dist-level import-closure guard (task 2.3).
//
// This is the BUILD-OUTPUT counterpart to src/client.guard.test.ts (the
// source-level guard, task 2.1). Where the source guard walks the `.ts` import
// graph, this guard walks the EMITTED `.js` graph starting at `dist/client.js`
// and applies the identical allowlist and forbidden-import rules. It proves the
// browser-safe Client_Safe_Entry stays browser-safe AFTER TypeScript emits it —
// catching any Node-only, tree-sitter, OSV/TOML or dynamic-import dependency
// that a build step could otherwise introduce into the shipped `./client`
// bundle (R16.1, R16.5).
//
// Like the source guard this is PURE static analysis: it never imports or
// executes the built module, it only reads file text and parses import
// specifiers with TypeScript's `ts.preProcessFile`. The closure walk follows
// only RELATIVE specifiers; the emitted ESM already carries explicit `.js`
// extensions, so those resolve straight to files on disk.
//
// The guard FAILS if any reachable dist module:
//   1. lives outside the allowlist
//      { registry/schema, registry/cards, snapshot/types, reading/schema,
//        util/errors };
//   2. has a bare (package) import other than `zod`;
//   3. imports `node:*`, `web-tree-sitter`, `tree-sitter-python`, `smol-toml`,
//      or contains a dynamic `import(` expression.
//
// Ordering: this guard reads build output. `pnpm --filter @necro/oracle build`
// must run before `pnpm --filter @necro/oracle test` for it to be meaningful.
// If `dist/client.js` is missing, the guard fails with an explicit message
// telling the reader to build first (a stale/missing dist is itself a
// violation, exactly as the design's "second guard runs after build" prescribes).
//
// This is a TEST file, excluded from the browser-safe build, so `node:` imports
// are fine here (R16.3, R16.5).
//
// _Requirements: R16.1, R16.5_

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/** Absolute path to packages/oracle/src, resolved relative to this file. */
const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Absolute path to packages/oracle/dist (sibling of src/). */
const DIST_DIR = resolve(SRC_DIR, "..", "dist");

/** The emitted Client_Safe_Entry whose import closure we audit. */
const ENTRY = resolve(DIST_DIR, "client.js");

/**
 * The only modules reachable from the emitted Client_Safe_Entry, expressed as
 * paths relative to dist/ without extension (POSIX separators). The entry
 * itself is always allowed; everything it reaches transitively must be in this
 * set. This mirrors the source guard's allowlist exactly.
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
 * Resolve a relative specifier found in `fromFile` to an absolute `.js` path.
 * The emitted ESM writes explicit `.js` extensions, so the common case is a
 * direct hit; a bare/extensionless specifier falls back to `<base>.js` then
 * `<base>/index.js`. Returns null if nothing exists on disk (the caller reports
 * that as a violation).
 */
function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = base.endsWith(".js")
    ? [base]
    : [base + ".js", resolve(base, "index.js")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** The import key (path relative to dist/, no extension, POSIX separators). */
function keyOf(absoluteJsPath: string): string {
  return relative(DIST_DIR, absoluteJsPath).replace(/\\/g, "/").replace(/\.js$/, "");
}

interface Violation {
  readonly file: string; // key relative to dist/
  readonly reason: string;
}

/**
 * Walk the static import graph from the emitted ENTRY. Collects every violation
 * it finds rather than stopping at the first, so a failure lists everything
 * wrong at once. A missing entry (stale/unbuilt dist) or a missing relative
 * target is itself a violation.
 */
function walkClosure(): { readonly reached: ReadonlySet<string>; readonly violations: readonly Violation[] } {
  const violations: Violation[] = [];
  const reached = new Set<string>();
  const queue: string[] = [];

  if (!existsSync(ENTRY)) {
    violations.push({
      file: "client",
      reason:
        "build output packages/oracle/dist/client.js does not exist. " +
        "Run `pnpm --filter @necro/oracle build` before the test run so this " +
        "dist-level guard has something to audit.",
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
            reason: `relative import "${specifier}" resolves to no build file on disk`,
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

describe("R16.1, R16.5: @necro/oracle/client import-closure guard (dist)", () => {
  it("reaches only client-safe modules and no forbidden import", () => {
    const { violations } = walkClosure();
    const report = violations.map((v) => `  - ${v.file}: ${v.reason}`).join("\n");
    expect(violations, `emitted Client_Safe_Entry closure violations:\n${report}`).toEqual([]);
  });

  it("stays within the declared allowlist", () => {
    const { reached } = walkClosure();
    const outside = [...reached].filter((key) => !ALLOWLIST.has(key)).sort();
    expect(outside, `reached dist modules outside the allowlist: ${outside.join(", ")}`).toEqual([]);
  });
});
