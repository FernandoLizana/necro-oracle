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
  const ALL_ROUTES = ["/api/readings", "/api/resurrect", "/api/lovers"] as const;
  // Grammar WASMs now come from packages/oracle/dist/grammars/ (real files
  // copied by the oracle postbuild step, no symlinks). The glob that covers
  // both python and javascript grammars is dist/grammars/*.wasm.
  const DIST_GRAMMARS = /oracle[\/\\]dist[\/\\]grammars[\/\\]\*\.wasm/;
  const WEB_TREE_SITTER = /web-tree-sitter.*\.wasm/;

  it("exposes all three route keys in the include map", () => {
    const includes = buildWasmTracingIncludes();
    for (const route of ALL_ROUTES) {
      expect(includes[route], `missing include key for ${route}`).toBeDefined();
    }
  });

  it.each(ALL_ROUTES)(
    "route %s includes the dist/grammars/*.wasm glob (covers python + javascript grammars)",
    (route) => {
      const list = buildWasmTracingIncludes()[route];
      expect(list, `missing include list for ${route}`).toBeDefined();
      expect(
        (list ?? []).some((entry) => DIST_GRAMMARS.test(entry)),
        `${route} must include dist/grammars/*.wasm`,
      ).toBe(true);
    },
  );

  it.each(ALL_ROUTES)("route %s references the web-tree-sitter runtime wasm", (route) => {
    const list = buildWasmTracingIncludes()[route];
    expect(list, `missing include list for ${route}`).toBeDefined();
    expect((list ?? []).some((entry) => WEB_TREE_SITTER.test(entry))).toBe(true);
  });

  it("no include entry passes through a node_modules symlink path (Vercel packaging safety)", () => {
    // Grammar entries must NOT name packages/oracle/node_modules/* or apps/web/node_modules/*
    // as those are pnpm symlinks. They must come from dist/grammars/ (real files).
    const SYMLINK_ORACLE_NM = /packages[/\\]oracle[/\\]node_modules[/\\]tree-sitter/;
    for (const route of ALL_ROUTES) {
      const list = buildWasmTracingIncludes()[route] ?? [];
      const bad = list.filter((e) => SYMLINK_ORACLE_NM.test(e));
      expect(bad, `${route} must not include oracle node_modules symlink paths: ${bad.join(", ")}`).toHaveLength(0);
    }
  });

  it("route /api/lovers includes the javascript grammar via the same dist/grammars glob", () => {
    // dist/grammars/*.wasm covers BOTH python and javascript grammars; a single
    // glob entry is all that is needed for lovers (no extra js-specific path required).
    const list = buildWasmTracingIncludes()["/api/lovers"];
    expect(list, "missing include list for /api/lovers").toBeDefined();
    expect((list ?? []).some((entry) => DIST_GRAMMARS.test(entry))).toBe(true);
    expect((list ?? []).some((entry) => WEB_TREE_SITTER.test(entry))).toBe(true);
  });

  it("exports a stable composed map matching the builder", () => {
    expect(wasmTracingIncludes).toEqual(buildWasmTracingIncludes());
  });
});
