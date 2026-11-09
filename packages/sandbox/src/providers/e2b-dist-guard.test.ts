//
// Item 29d (P0.5): dist guard — the optional `e2b` SDK must stay a RUNTIME-ONLY
// dynamic import in the BUILT output, never a static top-level import. The
// whole point of the `E2B_MODULE_ID` indirection (`await import(E2B_MODULE_ID)`)
// is that the default/local path costs nothing and never needs the `e2b`
// package installed (R5.7, R10.1). A regression that turns it into a static
// `import ... from "e2b"` / `require("e2b")` would pull the SDK onto every path
// — this guard scans the compiled dist and fails if that ever happens.
//
// Reads the built dist (run `pnpm --filter @necro/sandbox build` first). Pure.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIST_E2B = fileURLToPath(new URL("../../dist/providers/e2b.js", import.meta.url));

describe("Item 29d (R5.7/R10.1): built e2b provider keeps `e2b` a runtime-only dynamic import", () => {
  const code = readFileSync(DIST_E2B, "utf8");

  it("contains NO static import/require of the e2b SDK", () => {
    // A static ESM import of the bare `e2b` specifier (any quote style).
    expect(code).not.toMatch(/\bimport\b[^;\n]*\bfrom\s*["']e2b["']/);
    // A top-level side-effect import `import "e2b";`.
    expect(code).not.toMatch(/\bimport\s*["']e2b["']/);
    // A CommonJS require of e2b.
    expect(code).not.toMatch(/\brequire\(\s*["']e2b["']\s*\)/);
  });

  it("STILL loads the SDK via the dynamic import indirection", () => {
    // The specifier lives in a variable and is loaded with a dynamic import().
    expect(code).toMatch(/E2B_MODULE_ID\s*=\s*["']e2b["']/);
    expect(code).toMatch(/import\(\s*E2B_MODULE_ID\s*\)/);
  });
});
