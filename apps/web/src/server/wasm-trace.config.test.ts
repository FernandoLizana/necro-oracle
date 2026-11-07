// apps/web/scripts/wasm-trace.config.test.ts
//
// Fast guard for the tree-sitter WASM tracing fix (fix-wasm-tracing, task 1),
// extended for the Lovers binding (lovers-binding, task 7.2).
//
// The real post-build acceptance gate is `scripts/check-wasm-trace.mjs`, which
// inspects the @vercel/nft trace of an actual build. This unit test is the
// fast, build-free guard: it imports the pure, exported trace-include builder
// from `next.config.ts` and asserts that every tree-sitter route references the
// wasm it needs — `/api/readings` + `/api/resurrect` (Python) reference the
// runtime + python grammar, and `/api/lovers` (Python AND JavaScript)
// references the runtime + python grammar + javascript grammar — so a
// regression that drops a route or a wasm reference fails `vitest` immediately.

import { describe, expect, it } from "vitest";

import { buildWasmTracingIncludes, wasmTracingIncludes } from "../../next.config.js";

describe("wasm trace config: every route includes the wasm it needs", () => {
  const PY_ROUTES = ["/api/readings", "/api/resurrect"] as const;
  const ALL_ROUTES = [...PY_ROUTES, "/api/lovers"] as const;
  const TREE_SITTER_PYTHON = /tree-sitter-python\/.*\.wasm/;
  const TREE_SITTER_JAVASCRIPT = /tree-sitter-javascript\/.*\.wasm/;
  const WEB_TREE_SITTER = /web-tree-sitter.*\.wasm/;

  it("exposes all three route keys in the include map", () => {
    const includes = buildWasmTracingIncludes();
    for (const route of ALL_ROUTES) {
      expect(includes[route], `missing include key for ${route}`).toBeDefined();
    }
  });

  it.each(ALL_ROUTES)("route %s references the tree-sitter-python grammar wasm", (route) => {
    const list = buildWasmTracingIncludes()[route];
    expect(list, `missing include list for ${route}`).toBeDefined();
    expect((list ?? []).some((entry) => TREE_SITTER_PYTHON.test(entry))).toBe(true);
  });

  it.each(ALL_ROUTES)("route %s references the web-tree-sitter runtime wasm", (route) => {
    const list = buildWasmTracingIncludes()[route];
    expect(list, `missing include list for ${route}`).toBeDefined();
    expect((list ?? []).some((entry) => WEB_TREE_SITTER.test(entry))).toBe(true);
  });

  it("route /api/lovers references all three wasm (python + runtime + javascript)", () => {
    const list = buildWasmTracingIncludes()["/api/lovers"];
    expect(list, "missing include list for /api/lovers").toBeDefined();
    expect((list ?? []).some((entry) => TREE_SITTER_PYTHON.test(entry))).toBe(true);
    expect((list ?? []).some((entry) => WEB_TREE_SITTER.test(entry))).toBe(true);
    expect((list ?? []).some((entry) => TREE_SITTER_JAVASCRIPT.test(entry))).toBe(true);
  });

  it("exports a stable composed map matching the builder", () => {
    expect(wasmTracingIncludes).toEqual(buildWasmTracingIncludes());
  });
});
