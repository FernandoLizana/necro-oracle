// apps/web — client-boundary + dangerous-sink guard (task 31.1, RED).
//
// The grep-backed companion to the ESLint boundary rules task 31.2 adds to the
// repo-root `eslint.config.js`. It audits ONLY the client-safe `apps/web`
// modules — the code that is bundled into the browser: the Terminal browser
// adapters (`terminal/api-client.ts`, `terminal/browser-ports.ts`,
// `terminal/ndjson.ts`), the client screen (`components/TerminalScreen.tsx`),
// and the lazily-loaded demo bundle loader (`demo/load-bundle.ts`). The
// server-only trees (`server/**`, `app/api/**`, `demo/build-demo.ts`) are
// deliberately NOT scanned: they are allowed to import `@necro/github` and
// `node:*` and never reach the browser (R16.4 / R16.6).
//
// For every scanned module this asserts, by pure static text analysis (no
// import, no execution — offline, no network / LLM / sandbox):
//
//   1. no import of `@necro/github`, `@necro/config`, a Node builtin
//      (`node:*`), or `@necro/oracle` through its main entry (only the
//      `@necro/oracle/client` subpath is allowed) — R16.2, R16.3, R16.4;
//   2. no dangerous sink: `dangerouslySetInnerHTML`, `eval(`, `new Function`,
//      `postMessage`, or a NON-literal dynamic `import(` (a literal-path
//      `import("./bundle.generated.json")` is allowed — the demo bundle is a
//      deliberate lazy chunk, R16.12) — R14.1, R14.8.
//
// It also asserts the root `eslint.config.js` carries a boundary block that
// backs these rules for the `apps/web` client files. Until task 31.2 adds that
// block, that assertion FAILS — the expected, meaningful RED for a test-first
// task ("rules not yet present").
//
// Validates: Requirements 14.1, 14.8, 16.2, 16.3, 16.4, 16.7

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/** Absolute path to apps/web/src, resolved relative to this file. */
const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Absolute path to the repo-root ESLint flat config. */
const ESLINT_CONFIG = fileURLToPath(new URL("../../../eslint.config.js", import.meta.url));

/**
 * The client-safe modules that are bundled into the browser. Paths are
 * relative to apps/web/src. Server-only modules are intentionally absent.
 */
const CLIENT_SAFE_FILES: readonly string[] = [
  "terminal/api-client.ts",
  "terminal/browser-ports.ts",
  "terminal/ndjson.ts",
  "components/TerminalScreen.tsx",
  "demo/load-bundle.ts",
];

/** Bare (package) specifiers that client code must never import. */
const FORBIDDEN_BARE_IMPORTS: ReadonlySet<string> = new Set([
  "@necro/github",
  "@necro/config",
]);

/**
 * Strip line/block comments and string/template literals, replacing them with
 * spaces so the dangerous-sink regex never matches inside a comment (e.g. a
 * "no dangerouslySetInnerHTML" note) or a quoted string.
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
  const abs = join(SRC_DIR, rel);
  const text = readFileSync(abs, "utf8");

  const info = ts.preProcessFile(text, /*readImportFiles*/ true, /*detectJavaScriptImports*/ true);
  for (const ref of info.importedFiles) {
    const specifier = ref.fileName;
    if (specifier.startsWith("node:")) {
      violations.push({ file: rel, reason: `imports Node builtin "${specifier}"` });
      continue;
    }
    if (FORBIDDEN_BARE_IMPORTS.has(specifier)) {
      violations.push({ file: rel, reason: `imports forbidden package "${specifier}"` });
      continue;
    }
    if (specifier === "@necro/oracle") {
      violations.push({
        file: rel,
        reason: 'imports "@necro/oracle" main entry (only "@necro/oracle/client" is allowed)',
      });
    }
  }

  const code = stripCommentsAndStrings(text);
  if (/\bdangerouslySetInnerHTML\b/.test(code)) {
    violations.push({ file: rel, reason: "uses dangerouslySetInnerHTML" });
  }
  if (/\beval\s*\(/.test(code)) {
    violations.push({ file: rel, reason: "uses eval(" });
  }
  if (/\bnew\s+Function\b/.test(code)) {
    violations.push({ file: rel, reason: "uses new Function" });
  }
  if (/\bpostMessage\s*\(/.test(code)) {
    violations.push({ file: rel, reason: "uses postMessage(" });
  }
  const dynImport = /(^|[^.\w$])import\s*\(\s*([^)]*)/g;
  let m: RegExpExecArray | null;
  while ((m = dynImport.exec(code)) !== null) {
    const arg = (m[2] ?? "").trim();
    const isStringLiteral = /^["']/.test(arg);
    if (!isStringLiteral && arg.length > 0) {
      violations.push({ file: rel, reason: `uses a non-literal dynamic import(${arg.slice(0, 24)}…)` });
    }
  }
}

describe("R14.1, R14.8, R16.2, R16.3, R16.4, R16.7: apps/web client boundary (grep guard)", () => {
  it("has no forbidden import and no dangerous sink in any client-safe module", () => {
    const violations: Violation[] = [];
    for (const rel of CLIENT_SAFE_FILES) scanFile(rel, violations);
    const report = violations.map((v) => `  - ${v.file}: ${v.reason}`).join("\n");
    expect(violations, `apps/web client boundary violations:\n${report}`).toEqual([]);
  });

  it("is backed by an ESLint boundary rule block for apps/web client files", () => {
    // Enforcement companion. Until task 31.2 adds a block that targets the
    // apps/web client files and bans the forbidden imports + dangerous sinks,
    // this FAILS (expected RED). The github package already has a block, so a
    // naive substring match is not enough: the block must name apps/web.
    const config = readFileSync(ESLINT_CONFIG, "utf8");

    const targetsWebClient = /apps\/web\/src/.test(config) || /apps\/\*\/src/.test(config);
    expect(
      targetsWebClient,
      "eslint.config.js has no boundary block targeting apps/web client files — task 31.2 must add it.",
    ).toBe(true);

    const bansImports =
      /@necro\/github/.test(config) &&
      /@necro\/oracle(?!\/client)/.test(config) &&
      /node:/.test(config);
    expect(
      bansImports,
      "eslint.config.js does not restrict @necro/github / @necro/oracle / node:* for apps/web client code.",
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
