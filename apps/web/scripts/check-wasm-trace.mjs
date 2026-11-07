// apps/web/scripts/check-wasm-trace.mjs
//
// Post-build acceptance gate for the tree-sitter WASM tracing fix, extended for
// the Lovers binding (lovers-binding, task 7.2).
//
// Production bug (fix-wasm-tracing, task 1): `POST /api/readings` failed at
// READING with PARSER_INIT_FAILED on Vercel because `tree-sitter-python.wasm`
// was not traced into the serverless function — the glob-only
// `outputFileTracingIncludes` emitted a HOISTED path that does not exist on
// disk, while the real file lives only in pnpm's virtual store. `/api/resurrect`
// had the same latent gap.
//
// This script reads the @vercel/nft trace (`route.js.nft.json`) for each route,
// resolves each traced entry relative to the nft.json's own directory, keeps
// only entries that END IN `.wasm` AND actually exist on disk, and asserts that
// the set of existing wasm BASENAMES for each route includes every wasm that
// route needs:
//   - `/api/readings` + `/api/resurrect` parse Python  => runtime + python grammar;
//   - `/api/lovers` parses BOTH Python AND JavaScript   => runtime + python
//     grammar + javascript grammar (all three).
//
// ABI pin (R44.2): it ALSO loads the tree-sitter-javascript grammar WASM once
// against the installed web-tree-sitter runtime, failing fast on an ABI
// mismatch (a transitive bump that drifts LANGUAGE_VERSION away from the
// runtime). It exits 0 only when every route packages its required wasm AND the
// JS grammar loads; otherwise it names the offending route + missing file (or
// the ABI failure) and exits 1.

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// scripts/ lives at apps/web/scripts, so .next is one level up.
const nextDir = resolve(scriptDir, "..", ".next");

const WEB_TREE_SITTER = "web-tree-sitter.wasm";
const PYTHON_GRAMMAR = "tree-sitter-python.wasm";
const JS_GRAMMAR = "tree-sitter-javascript.wasm";

/**
 * The routes that must package tree-sitter WASM, each with the exact set of
 * wasm basenames it needs. `/api/lovers` parses both languages, so it needs all
 * three; the Python routes need the runtime + python grammar.
 */
const ROUTE_REQUIREMENTS = {
  readings: [WEB_TREE_SITTER, PYTHON_GRAMMAR],
  resurrect: [WEB_TREE_SITTER, PYTHON_GRAMMAR],
  lovers: [WEB_TREE_SITTER, PYTHON_GRAMMAR, JS_GRAMMAR],
};

/**
 * Return the set of EXISTING wasm basenames traced for a route, or null when
 * the route's nft.json is absent.
 */
function existingTracedWasm(route) {
  const nftPath = resolve(
    nextDir,
    "server",
    "app",
    "api",
    route,
    "route.js.nft.json",
  );
  if (!existsSync(nftPath)) return null;

  const nft = JSON.parse(readFileSync(nftPath, "utf8"));
  const nftDir = dirname(nftPath);
  const found = new Set();
  for (const entry of nft.files ?? []) {
    if (!entry.endsWith(".wasm")) continue;
    // Trace entries are relative to the nft.json's own directory.
    const abs = resolve(nftDir, entry);
    if (existsSync(abs)) found.add(basename(abs));
  }
  return found;
}

/**
 * Load the tree-sitter-javascript grammar once against the installed
 * web-tree-sitter runtime to fail fast on an ABI mismatch (R44.2). Mirrors the
 * oracle's load path: Parser.init() -> Language.load(file://...wasm) ->
 * new Parser().setLanguage(...) -> parse a trivial program. Returns an error
 * message string on failure, or null on success.
 */
async function checkJsGrammarAbi() {
  try {
    const require = createRequire(import.meta.url);
    const { Language, Parser } = await import("web-tree-sitter");
    await Parser.init();
    // Resolve the JS grammar the SAME way the oracle does at runtime: anchor a
    // require at @necro/oracle's own entry (its createRequire(import.meta.url)),
    // so we validate the exact file the /api/lovers lambda will load, including
    // pnpm's virtual-store path.
    const oracleEntry = require.resolve("@necro/oracle");
    const oracleRequire = createRequire(oracleEntry);
    const wasmPath = oracleRequire.resolve(
      "tree-sitter-javascript/tree-sitter-javascript.wasm",
    );
    const language = await Language.load(pathToFileURL(wasmPath));
    const parser = new Parser();
    // An ABI mismatch surfaces here: setLanguage rejects a grammar whose
    // LANGUAGE_VERSION is incompatible with the runtime.
    parser.setLanguage(language);
    const tree = parser.parse("const x = 1;");
    if (!tree || tree.rootNode.type !== "program") {
      return `JS grammar produced an unexpected root node: ${tree?.rootNode?.type ?? "none"}`;
    }
    tree.delete?.();
    parser.delete?.();
    return null;
  } catch (cause) {
    return `JS grammar failed to load against the installed web-tree-sitter (ABI mismatch?): ${
      cause instanceof Error ? cause.message : String(cause)
    }`;
  }
}

let ok = true;

for (const [route, required] of Object.entries(ROUTE_REQUIREMENTS)) {
  const found = existingTracedWasm(route);
  if (found === null) {
    console.error(
      `FAIL /api/${route}: trace file not found ` +
        `(expected .next/server/app/api/${route}/route.js.nft.json). ` +
        `Run the web build first.`,
    );
    ok = false;
    continue;
  }
  const missing = required.filter((name) => !found.has(name));
  if (missing.length > 0) {
    console.error(
      `FAIL /api/${route}: missing real wasm in trace: ${missing.join(", ")}. ` +
        `Existing traced wasm: [${[...found].join(", ") || "none"}].`,
    );
    ok = false;
  } else {
    console.log(
      `OK   /api/${route}: packages ${required.join(" + ")} ` +
        `(existing traced wasm: [${[...found].join(", ")}]).`,
    );
  }
}

// ABI load-check for the JavaScript grammar (R44.2) — independent of the build.
const abiError = await checkJsGrammarAbi();
if (abiError) {
  console.error(`FAIL ABI: ${abiError}`);
  ok = false;
} else {
  console.log(
    `OK   ABI: ${JS_GRAMMAR} loads against the installed web-tree-sitter runtime.`,
  );
}

if (!ok) {
  console.error(
    "\nWASM trace check FAILED — a required grammar wasm is not packaged, " +
      "or the JS grammar is ABI-incompatible with the runtime.",
  );
  process.exit(1);
}
console.log("\nWASM trace check PASSED for all routes (incl. JS grammar ABI).");
process.exit(0);
