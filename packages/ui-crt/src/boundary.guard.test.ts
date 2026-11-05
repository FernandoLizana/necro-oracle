// @necro/ui-crt — source-level boundary + dangerous-sink guard (task 31.1, RED).
//
// This test is the grep-backed companion to the ESLint boundary rules that
// task 31.2 adds to `eslint.config.js`. It proves two things by static text
// analysis (no import, no execution of the scanned modules — pure, offline):
//
//   1. Every `.ts`/`.tsx` module under `packages/ui-crt/src` (excluding test
//      files) obeys the client boundary: it NEVER imports `@necro/github`,
//      `@necro/config`, a Node builtin (`node:*`), or `@necro/oracle` through
//      its main entry (only the `@necro/oracle/client` subpath is allowed),
//      and it NEVER uses a dangerous client sink: `dangerouslySetInnerHTML`,
//      `eval(`, `new Function`, `postMessage`, or a NON-literal dynamic
//      `import(` (a string-literal `import("./engine.js")` is allowed, since
//      the sound engine and demo bundle are deliberate lazy chunks).
//      (R14.1, R14.8, R16.2, R16.3, R16.4, R16.7)
//
//   2. The repo's `eslint.config.js` actually carries a boundary block that
//      backs these rules for `packages/ui-crt/src`. The grep scan above is the
//      evidence; the lint rule is the enforcement. Until task 31.2 adds that
//      block, this assertion FAILS — the expected, meaningful RED for a
//      test-first task ("rules not yet present"), mirroring the
//      `client.guard.test.ts` pattern where the guard is red until the backing
//      artifact exists.
//
// Both halves are offline and make no network / LLM / sandbox call. This is a
// TEST file, so its own `node:` imports are fine.
//
// Validates: Requirements 14.1, 14.8, 16.2, 16.3, 16.4, 16.7

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/** Absolute path to packages/ui-crt/src, resolved relative to this file. */
const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Absolute path to the repo-root ESLint flat config. */
const ESLINT_CONFIG = fileURLToPath(new URL("../../../eslint.config.js", import.meta.url));

/** Bare (package) specifiers that client code must never import. */
const FORBIDDEN_BARE_IMPORTS: ReadonlySet<string> = new Set([
  "@necro/github",
  "@necro/config",
]);

/**
 * Collect every `.ts` / `.tsx` source file under `dir`, skipping test files
 * and any `node_modules` / `dist` subtree. Returns absolute paths.
 */
function collectSources(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...collectSources(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(test|pbt\.test|conformance\.test|spec)\.tsx?$/.test(entry.name)) continue;
    // The `testing/` helpers are test-only fixtures, not shipped client code.
    if (full.replace(/\\/g, "/").includes("/testing/")) continue;
    out.push(full);
  }
  return out;
}

/**
 * Strip line and block comments and string/template literals from TS/TSX text,
 * replacing them with spaces of equal length. This keeps byte offsets stable
 * while ensuring the dangerous-sink regex never matches a sink mentioned only
 * inside a comment (for example the "no dangerouslySetInnerHTML" note) or a
 * quoted string. A conservative scanner: it only needs to blank out comments
 * and quotes well enough to avoid false positives.
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
  readonly file: string; // relative to src/, POSIX separators
  readonly reason: string;
}

/** Path relative to src/, POSIX separators, for stable messages. */
function keyOf(absolute: string): string {
  return absolute.slice(SRC_DIR.length).replace(/\\/g, "/");
}

/**
 * Scan one source file for forbidden imports and dangerous sinks, pushing any
 * violations onto `violations`.
 */
function scanFile(file: string, violations: Violation[]): void {
  const key = keyOf(file);
  const text = readFileSync(file, "utf8");

  // ── Imports: use TypeScript's own pre-processor for correctness. ──────────
  const info = ts.preProcessFile(text, /*readImportFiles*/ true, /*detectJavaScriptImports*/ true);
  for (const ref of info.importedFiles) {
    const specifier = ref.fileName;
    if (specifier.startsWith("node:")) {
      violations.push({ file: key, reason: `imports Node builtin "${specifier}"` });
      continue;
    }
    if (FORBIDDEN_BARE_IMPORTS.has(specifier)) {
      violations.push({ file: key, reason: `imports forbidden package "${specifier}"` });
      continue;
    }
    // Only `@necro/oracle/client` is allowed; the bare main entry is not.
    if (specifier === "@necro/oracle") {
      violations.push({
        file: key,
        reason: 'imports "@necro/oracle" main entry (only "@necro/oracle/client" is allowed)',
      });
    }
  }

  // ── Dangerous sinks: scan code only (comments + strings blanked out). ─────
  const code = stripCommentsAndStrings(text);

  if (/\bdangerouslySetInnerHTML\b/.test(code)) {
    violations.push({ file: key, reason: "uses dangerouslySetInnerHTML" });
  }
  if (/\beval\s*\(/.test(code)) {
    violations.push({ file: key, reason: "uses eval(" });
  }
  if (/\bnew\s+Function\b/.test(code)) {
    violations.push({ file: key, reason: "uses new Function" });
  }
  if (/\bpostMessage\s*\(/.test(code)) {
    violations.push({ file: key, reason: "uses postMessage(" });
  }
  // A dynamic import whose argument is NOT a string literal. A literal-path
  // `import("./engine.js")` is allowed (deliberate lazy chunk, R16.12); a
  // `import(someVar)` / `import(`...${x}`)` is forbidden (R14.8).
  const dynImport = /(^|[^.\w$])import\s*\(\s*([^)]*)/g;
  let m: RegExpExecArray | null;
  while ((m = dynImport.exec(code)) !== null) {
    const arg = (m[2] ?? "").trim();
    const isStringLiteral = /^["']/.test(arg);
    // `import.meta` / `import x from` are not call forms and won't match `(`.
    if (!isStringLiteral && arg.length > 0) {
      violations.push({ file: key, reason: `uses a non-literal dynamic import(${arg.slice(0, 24)}…)` });
    }
  }
}

describe("R14.1, R14.8, R16.2, R16.3, R16.4, R16.7: @necro/ui-crt client boundary (grep guard)", () => {
  it("has no forbidden import and no dangerous sink in any shipped module", () => {
    const violations: Violation[] = [];
    for (const file of collectSources(SRC_DIR)) scanFile(file, violations);
    const report = violations.map((v) => `  - ${v.file}: ${v.reason}`).join("\n");
    expect(violations, `ui-crt boundary violations:\n${report}`).toEqual([]);
  });

  it("is backed by an ESLint boundary rule block for packages/ui-crt/src", () => {
    // Enforcement companion to the grep scan: the flat config must carry a
    // block that targets `packages/ui-crt/src` AND bans the forbidden imports
    // and dangerous sinks. Until task 31.2 adds it, this FAILS (expected RED).
    const config = readFileSync(ESLINT_CONFIG, "utf8");

    const targetsUiCrt =
      /packages\/ui-crt\/src/.test(config) &&
      /packages\/ui-crt\/src\/\*\*/.test(config);
    expect(
      targetsUiCrt,
      "eslint.config.js has no block targeting packages/ui-crt/src — task 31.2 must add the boundary rule.",
    ).toBe(true);

    // The block must restrict the client-forbidden imports and the sinks.
    const bansImports =
      /@necro\/github/.test(config) &&
      /@necro\/oracle(?!\/client)/.test(config) &&
      /node:/.test(config);
    expect(
      bansImports,
      "eslint.config.js does not restrict @necro/github / @necro/oracle / node:* for client code.",
    ).toBe(true);

    const bansSinks =
      /dangerouslySetInnerHTML/.test(config) &&
      /postMessage/.test(config) &&
      /Function/.test(config) &&
      /eval/.test(config);
    expect(
      bansSinks,
      "eslint.config.js does not ban dangerouslySetInnerHTML / postMessage / new Function / eval for client code.",
    ).toBe(true);
  });
});
