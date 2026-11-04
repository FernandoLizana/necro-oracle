// Vitest setup for @necro/oracle.
//
// Initialize the real tree-sitter WASM parser once before all tests in this
// package. This runs in the Vitest worker process and is fast (< 200 ms)
// because the grammar .wasm file is read from disk
// (node_modules/tree-sitter-python/tree-sitter-python.wasm via a file:// URL).
// No network access is required (R3.1, R21.5, R21.6).
//
// Imported from the parser module directly so the import resolves before the
// public barrel (src/index.ts) re-exports it in task 31. Task 11.2 provides the
// full initParser implementation that loads the on-disk grammar.
import { beforeAll } from "vitest";

import { initParser } from "./src/parser/tree-sitter.js";

beforeAll(async () => {
  await initParser();
});
