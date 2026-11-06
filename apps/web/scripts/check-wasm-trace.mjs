// apps/web/scripts/check-wasm-trace.mjs
//
// Post-build acceptance gate for the tree-sitter WASM tracing fix.
//
// Production bug (fix-wasm-tracing, task 1): `POST /api/readings` failed at
// READING with PARSER_INIT_FAILED on Vercel because `tree-sitter-python.wasm`
// was not traced into the serverless function — the glob-only
// `outputFileTracingIncludes` emitted a HOISTED path that does not exist on
// disk, while the real file lives only in pnpm's virtual store. `/api/resurrect`
// had the same latent gap.
//
// This script reads the @vercel/nft trace (`route.js.nft.json`) for BOTH
// routes, resolves each traced entry relative to the nft.json's own directory,
// keeps only entries that END IN `.wasm` AND actually exist on disk, and
// asserts that the set of existing wasm BASENAMES for each route includes BOTH
// `web-tree-sitter.wasm` and `tree-sitter-python.wasm`. It exits 0 only when
// BOTH routes package BOTH real wasm files; otherwise it names the offending
// route + missing file and exits 1.

import { existsSync, readFileSync } from "node:fs";
import { dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// scripts/ lives at apps/web/scripts, so .next is one level up.
const nextDir = resolve(scriptDir, "..", ".next");

/** The routes that parse Python and must package both wasm files. */
const ROUTES = ["readings", "resurrect"];

/** The wasm basenames every Python-parsing route must package. */
const REQUIRED_WASM = ["web-tree-sitter.wasm", "tree-sitter-python.wasm"];

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

let ok = true;
for (const route of ROUTES) {
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
  const missing = REQUIRED_WASM.filter((name) => !found.has(name));
  if (missing.length > 0) {
    console.error(
      `FAIL /api/${route}: missing real wasm in trace: ${missing.join(", ")}. ` +
        `Existing traced wasm: [${[...found].join(", ") || "none"}].`,
    );
    ok = false;
  } else {
    console.log(
      `OK   /api/${route}: packages ${REQUIRED_WASM.join(" + ")} ` +
        `(existing traced wasm: [${[...found].join(", ")}]).`,
    );
  }
}

if (!ok) {
  console.error("\nWASM trace check FAILED — the grammar wasm is not packaged.");
  process.exit(1);
}
console.log("\nWASM trace check PASSED for both routes.");
process.exit(0);
