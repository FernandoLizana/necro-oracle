import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

// Minimal structural shape of the webpack config object Next hands to the
// `webpack` hook. We only touch `externals`, so a narrow local type avoids a
// dependency on the full `webpack` type package.
interface WebpackConfig {
  externals?: unknown;
  resolve?: {
    extensionAlias?: Record<string, string[]>;
    [key: string]: unknown;
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(__dirname, "../../");

// A module resolver anchored at this config so `require.resolve(...)` finds the
// same real files the oracle parser loads at runtime (it resolves the grammar
// with `createRequire(import.meta.url).resolve("tree-sitter-python/...wasm")`).
const require = createRequire(import.meta.url);
// Resolver anchored at @necro/oracle so tree-sitter-javascript (a dep of oracle,
// not of apps/web) resolves to its real pnpm virtual-store path (lovers-binding
// task 7.2 / 15.3). Mirrors the approach check-wasm-trace.mjs uses.
const requireOracle = createRequire(
  path.join(__dirname, "../../packages/oracle/src/index.ts"),
);

// Tree-sitter WASM file tracing (decision D11, task 1.2 / Q8b).
//
// The oracle's parser loads two WASM files at runtime on the Node.js server:
//   1. the web-tree-sitter runtime, resolved by web-tree-sitter itself with
//      `new URL("web-tree-sitter.wasm", import.meta.url)`;
//   2. the tree-sitter-python grammar, resolved by the oracle with
//      `createRequire(import.meta.url).resolve(
//         "tree-sitter-python/tree-sitter-python.wasm")`.
//
// In production these packages are externalised (not bundled) so those
// resolutions run against real files in node_modules. Vercel / @vercel/nft
// statically analyses both the `new URL(..., import.meta.url)` and the
// `require.resolve(...)` references and traces the files, but under pnpm the
// real files live in the virtual store (`node_modules/.pnpm/...`), so we also
// name them explicitly in `outputFileTracingIncludes` to guarantee they are
// packaged into the `/api/readings` serverless function. The globs below cover
// both the pnpm virtual store and any hoisted/nested copy.
const WASM_TRACING_GLOBS = [
  "node_modules/.pnpm/tree-sitter-python@*/node_modules/tree-sitter-python/*.wasm",
  "node_modules/.pnpm/web-tree-sitter@*/node_modules/web-tree-sitter/*.wasm",
  "node_modules/.pnpm/tree-sitter-javascript@*/node_modules/tree-sitter-javascript/*.wasm",
  "node_modules/tree-sitter-python/*.wasm",
  "node_modules/web-tree-sitter/*.wasm",
  "node_modules/tree-sitter-javascript/*.wasm",
  // nested copies resolved via @necro/oracle's own node_modules under pnpm
  "node_modules/.pnpm/**/node_modules/tree-sitter-python/*.wasm",
  "node_modules/.pnpm/**/node_modules/web-tree-sitter/*.wasm",
  "node_modules/.pnpm/**/node_modules/tree-sitter-javascript/*.wasm",
];

// The two WASM specifiers the oracle parser resolves at runtime. Resolving them
// here, at config time, with the SAME module resolution the parser uses, yields
// the exact real file on disk — including pnpm's virtual-store path — which we
// can then name explicitly in the trace. The globs above stay as a belt-and-
// braces fallback, but a glob that matches nothing (or a hoisted path Next
// emits that does not exist) is what let `tree-sitter-python.wasm` slip out of
// the `/api/readings` lambda in production. A resolved real path cannot.
const WASM_TRACING_SPECIFIERS = [
  "tree-sitter-python/tree-sitter-python.wasm",
  "web-tree-sitter/web-tree-sitter.wasm",
  "tree-sitter-javascript/tree-sitter-javascript.wasm",
];

/**
 * Resolve a module-relative WASM specifier to a path RELATIVE to
 * `monorepoRoot` (the `outputFileTracingRoot`), POSIX-normalized so it is a
 * valid trace-include entry on every OS — but only when the resolved absolute
 * file actually exists on disk. Returns null (and warns) when the specifier
 * cannot be resolved, so a missing optional package never breaks the build.
 */
function resolvedWasmRelPath(spec: string): string | null {
  // Try both resolvers: apps/web-anchored first (covers python grammar and
  // web-tree-sitter), then oracle-anchored (covers tree-sitter-javascript, which
  // is a dep of @necro/oracle rather than apps/web). A resolved real path is
  // authoritative — it cannot be absent at build time unlike a glob (lovers-binding
  // task 7.2 / 15.3).
  for (const r of [require, requireOracle]) {
    try {
      const abs = r.resolve(spec);
      if (!existsSync(abs)) continue;
      return path.relative(monorepoRoot, abs).split(path.sep).join("/");
    } catch {
      // try the next resolver
    }
  }
  console.warn(`[next.config] could not resolve ${spec} for tracing`);
  return null;
}

/**
 * Build the `outputFileTracingIncludes` map. `/api/readings` and
 * `/api/resurrect` parse Python; `/api/lovers` parses BOTH Python (the
 * resurrected heart) AND JavaScript (the generated beloved), so every route
 * needs the grammar + runtime WASM packaged into its serverless function. All
 * three routes get the SAME include list — the resolved REAL paths first
 * (authoritative: python grammar + web-tree-sitter runtime + javascript
 * grammar), then the globs as a fallback. Adding the javascript grammar to the
 * shared list only ADDS a real file to the python-only routes, which is a
 * harmless superset.
 *
 * Exported so the config can be asserted by a fast unit test without running a
 * full `next build`.
 */
export function buildWasmTracingIncludes(): Record<string, string[]> {
  const resolvedRelPaths = WASM_TRACING_SPECIFIERS.map(resolvedWasmRelPath);
  const includes = [
    ...resolvedRelPaths.filter((p): p is string => p !== null),
    ...WASM_TRACING_GLOBS,
  ];
  return {
    "/api/readings": includes,
    "/api/resurrect": includes,
    // Lovers parses BOTH python (heart) and javascript (beloved), so it needs
    // all three WASM: python grammar + runtime + javascript grammar.
    // The JS grammar is a dep of @necro/oracle (not apps/web), so the
    // apps/web-anchored require cannot resolve it in the shared `includes`.
    // Explicit literal globs relative to apps/web (the directory Next resolves
    // outputFileTracingIncludes paths against) guarantee the JS WASM is
    // traced regardless (lovers-binding task 7.2 / 15.3).
    "/api/lovers": [
      ...includes,
      "../../node_modules/.pnpm/tree-sitter-javascript@*/node_modules/tree-sitter-javascript/*.wasm",
      "../../node_modules/tree-sitter-javascript/*.wasm",
    ],
  };
}

/** The composed trace-include map, shared by the config and the unit test. */
export const wasmTracingIncludes = buildWasmTracingIncludes();

// Server packages that must stay external (not bundled by webpack) so their
// runtime WASM resolution survives (decision D11). `@necro/oracle` is consumed
// from its built `dist` (plain ESM, no transpile needed); `web-tree-sitter` and
// `tree-sitter-python` are the real node packages that load the WASM files.
//
// Next's `serverExternalPackages` is ineffective here: it does not externalise
// a workspace package (`@necro/oracle`), and once that package is in
// `transpilePackages` webpack follows and inlines its `web-tree-sitter` import
// too. The reliable lever is the webpack `externals` escape hatch below, which
// turns a bare import of any of these specifiers into a runtime
// `import("<spec>")` resolved from node_modules (confirmed working in the
// spike; `serverExternalPackages` alone left everything bundled).
const SERVER_EXTERNAL_PACKAGES = [
  "@necro/oracle",
  "web-tree-sitter",
  "tree-sitter-python",
];

const nextConfig: NextConfig = {
  // Workspace packages that ship raw `src/index.ts` (no build step) are
  // transpiled by Next. `@necro/oracle` is deliberately NOT transpiled: it is
  // consumed from its built `dist` and kept external on the server (see
  // SERVER_EXTERNAL_PACKAGES / the webpack hook below), so its
  // `createRequire(...).resolve("tree-sitter-python/...wasm")` keeps working.
  transpilePackages: ["@necro/ui-crt", "@necro/config", "@necro/github"],

  // Trace the monorepo root so pnpm's virtual store is in scope for tracing.
  outputFileTracingRoot: monorepoRoot,
  // /api/readings and /api/resurrect parse Python; /api/lovers parses BOTH
  // Python and JavaScript. Each needs the grammar + runtime WASM packaged into
  // its lambda (resolved real paths first, globs as fallback). See
  // buildWasmTracingIncludes above.
  outputFileTracingIncludes: wasmTracingIncludes,

  // Externalise the WASM-loading packages on the server build via webpack.
  // `serverExternalPackages` is kept for the two real node packages (it is a
  // no-op on the workspace oracle); the webpack `externals` hook below is what
  // actually externalises all three, including the workspace package.
  serverExternalPackages: ["web-tree-sitter", "tree-sitter-python"],

  webpack(config: WebpackConfig, { isServer }: { isServer: boolean }) {
    // Resolve ESM `.js` import specifiers that point at TypeScript source.
    // The server/route modules import siblings with explicit `.js` extensions
    // (NodeNext/ESM style, matching `tsc` + Vitest), but webpack does not map
    // `.js` → `.ts(x)` by default, so a bare `next build` fails to resolve
    // `../../../server/composition.js` (a `.ts` file). `extensionAlias` makes
    // webpack try `.ts`/`.tsx` (then the literal `.js`) for a `.js` request,
    // the same way `moduleResolution: "bundler"` does for the type-checker.
    config.resolve ??= {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };

    if (isServer) {
      const existing = config.externals ?? [];
      const externalsArray = Array.isArray(existing) ? existing : [existing];
      const externalizeWasmPackages = (
        data: { request?: string },
        callback: (err?: unknown, result?: string) => void,
      ): void => {
        const request = data.request;
        if (
          typeof request === "string" &&
          SERVER_EXTERNAL_PACKAGES.some(
            (pkg) => request === pkg || request.startsWith(`${pkg}/`),
          )
        ) {
          // Emit a runtime ESM import instead of bundling.
          callback(undefined, `module ${request}`);
          return;
        }
        callback();
      };
      config.externals = [...externalsArray, externalizeWasmPackages];
    }
    return config;
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
