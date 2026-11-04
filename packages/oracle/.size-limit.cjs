// size-limit configuration for @necro/oracle.
//
// This budget enforces R21.7: the browser-safe MAIN entry point (`dist/index.js`,
// i.e. `@necro/oracle`) must stay <= 50 KB gzipped when bundled for a browser.
//
// Scope / exemptions:
//   - Only `dist/index.js` is measured. The Node-only entry `dist/node.js`
//     (which pulls in `fs` via buildSnapshotFromDirectory) is EXEMPT from this
//     budget per R21.7 and is intentionally not listed here.
//   - The tree-sitter-python `.wasm` grammar is NOT bundled into `dist/index.js`.
//     It is loaded separately at runtime from `node_modules` (via a file:// URL
//     in the parser) and lazily initialized on the first `parsePython` call, so
//     it is excluded from this measurement exactly as R21.7 requires.
//
// What size-limit measures here is the gzipped size of `dist/index.js` together
// with its own JavaScript import graph. The heavy runtime dependencies
// (web-tree-sitter, zod, smol-toml, tree-sitter-python) are external packages
// resolved at runtime rather than part of the oracle's own browser payload, so
// they are marked `ignore`d below to keep the measurement focused on the
// oracle's own code — the contribution R21.7's terminal-route budget concerns.
//
// The `node:module` / `node:url` builtins are referenced only inside the
// parser's lazy, Node-only grammar-resolution path (dynamic `import(...)`); the
// browser bundle never pulls them in, so they are marked external here as well
// to keep the bundler from trying to resolve Node builtins for a browser target.
module.exports = [
  {
    name: "@necro/oracle main entry (dist/index.js, gzipped)",
    path: "dist/index.js",
    limit: "50 KB",
    gzip: true,
    ignore: [
      "web-tree-sitter",
      "zod",
      "smol-toml",
      "tree-sitter-python",
      "node:module",
      "node:url",
    ],
  },
];
