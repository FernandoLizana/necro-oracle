// apps/web/src/server/wasm-trace.config.test.ts
//
// Fast guard for the tree-sitter WASM tracing fix (fix-wasm-tracing, task 1).
//
// The real post-build acceptance gate is `scripts/check-wasm-trace.mjs`, which
// inspects the @vercel/nft trace of an actual build. This unit test is the
// fast, build-free guard: it imports the pure, exported trace-include builder
// from `next.config.ts` and asserts that BOTH Python-parsing routes
// (`/api/readings` and `/api/resurrect`) reference BOTH wasm files, so a
// regression that drops a route or a wasm reference fails `vitest` immediately.

import { describe, expect, it } from "vitest";

import { buildWasmTracingIncludes, wasmTracingIncludes } from "../../next.config.js";

describe("wasm trace config: both routes include both wasm references", () => {
  const ROUTES = ["/api/readings", "/api/resurrect"] as const;
  const TREE_SITTER_PYTHON = /tree-sitter-python\/.*\.wasm/;
  const WEB_TREE_SITTER = /web-tree-sitter.*\.wasm/;

  it("exposes both route keys in the include map", () => {
    const includes = buildWasmTracingIncludes();
    for (const route of ROUTES) {
      expect(includes[route], `missing include key for ${route}`).toBeDefined();
    }
  });

  it.each(ROUTES)("route %s references the tree-sitter-python grammar wasm", (route) => {
    const list = buildWasmTracingIncludes()[route];
    expect(list, `missing include list for ${route}`).toBeDefined();
    expect((list ?? []).some((entry) => TREE_SITTER_PYTHON.test(entry))).toBe(true);
  });

  it.each(ROUTES)("route %s references the web-tree-sitter runtime wasm", (route) => {
    const list = buildWasmTracingIncludes()[route];
    expect(list, `missing include list for ${route}`).toBeDefined();
    expect((list ?? []).some((entry) => WEB_TREE_SITTER.test(entry))).toBe(true);
  });

  it("exports a stable composed map matching the builder", () => {
    expect(wasmTracingIncludes).toEqual(buildWasmTracingIncludes());
  });
});
