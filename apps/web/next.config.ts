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
  "node_modules/tree-sitter-python/*.wasm",
  "node_modules/web-tree-sitter/*.wasm",
  // nested copies resolved via @necro/oracle's own node_modules under pnpm
  "node_modules/.pnpm/**/node_modules/tree-sitter-python/*.wasm",
  "node_modules/.pnpm/**/node_modules/web-tree-sitter/*.wasm",
];

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
  outputFileTracingIncludes: {
    "/api/readings": WASM_TRACING_GLOBS,
  },

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
