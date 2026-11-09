// packages/oracle/scripts/copy-grammars.mjs
//
// Postbuild: copy the two tree-sitter grammar WASM files as REAL
// (dereferenced) files into dist/grammars/. This guarantees that the built
// oracle carries the grammar bytes at a REAL path with no symlink in it, so
// Vercel's packaging step never sees a symlinked directory (which it rejects).
//
// The Vercel deployment error was:
//   "The framework produced an invalid deployment package for a Serverless
//    Function. Typically this means that the framework produces files in
//    symlinked directories."
//
// Root cause: apps/web/next.config.ts outputFileTracingIncludes pointed at
// packages/oracle/node_modules/tree-sitter-* (symlinks -> .pnpm store). Vercel
// resolves those through the symlinks and then refuses the package.
//
// Fix: build the grammars into a real path (dist/grammars/) at oracle build
// time; next.config.ts then names only that real path in the trace includes.

import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const oracleRoot = resolve(__dirname, "..");

// Resolve grammars from oracle's own package graph ? the same resolution the
// parser performs at runtime, anchored at packages/oracle so tree-sitter-
// javascript (an oracle dep, not a root dep) is found.
const req = createRequire(join(oracleRoot, "src", "index.ts"));

const GRAMMARS = [
  {
    specifier: "tree-sitter-python/tree-sitter-python.wasm",
    dest: "tree-sitter-python.wasm",
  },
  {
    specifier: "tree-sitter-javascript/tree-sitter-javascript.wasm",
    dest: "tree-sitter-javascript.wasm",
  },
];

const destDir = join(oracleRoot, "dist", "grammars");
mkdirSync(destDir, { recursive: true });

for (const { specifier, dest } of GRAMMARS) {
  const src = req.resolve(specifier);
  const destPath = join(destDir, dest);
  copyFileSync(src, destPath);
  console.log(`copied ${specifier} -> dist/grammars/${dest}`);
}

console.log("grammar copy done.");
