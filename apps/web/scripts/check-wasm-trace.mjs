// apps/web/scripts/check-wasm-trace.mjs
//
// REAL post-build acceptance gate for the tree-sitter WASM tracing (prod
// hotfix). The old gate only checked that a file NAMED tree-sitter-python.wasm
// existed somewhere in the trace - it never verified the oracle could RESOLVE
// it. On Vercel the oracle resolves each grammar with
// createRequire(packages/oracle/dist/parser/...).resolve("tree-sitter-python/
// tree-sitter-python.wasm"), which goes THROUGH packages/oracle/node_modules/
// <grammar> (a pnpm symlink) to the real file in the virtual store. If either
// is missing from the trace, the resolution fails with PARSER_INIT_FAILED -
// exactly the production failure - yet a name-only check still passes.
//
// This gate, for each of readings / resurrect / lovers:
//   1. reads the @vercel/nft trace (route.js.nft.json),
//   2. copies EXACTLY the traced files into a temp dir, preserving their layout
//      relative to the outputFileTracingRoot (the monorepo root),
//   3. from <tmp>/packages/oracle/dist/parser it RESOLVES
//      tree-sitter-python/tree-sitter-python.wasm (and, for lovers,
//      tree-sitter-javascript/...wasm) via createRequire, then actually loads
//      the web-tree-sitter runtime + grammar and PARSES a one-line snippet.
// It fails with a clear message if any resolve / load / parse fails, and exits
// 1. It exits 0 only when every route can genuinely initialise its parser from
// its own traced file set. Temp dirs live under the OS temp dir, never the repo.

import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(scriptDir, "..");
const nextDir = resolve(webDir, ".next");
// outputFileTracingRoot in next.config.ts is the monorepo root (apps/web/../../).
const traceRoot = resolve(webDir, "..", "..");

// Each route and the grammar specifiers the oracle must resolve from its traced
// copy. Lovers parses BOTH Python and JavaScript.
const ROUTES = {
  readings: ["tree-sitter-python/tree-sitter-python.wasm"],
  resurrect: ["tree-sitter-python/tree-sitter-python.wasm"],
  lovers: [
    "tree-sitter-python/tree-sitter-python.wasm",
    "tree-sitter-javascript/tree-sitter-javascript.wasm",
  ],
};

function msg(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The parsed nft trace for a route, or files:null when its nft.json is absent. */
function readTrace(route) {
  const nftPath = resolve(
    nextDir, "server", "app", "api", route, "route.js.nft.json",
  );
  if (!existsSync(nftPath)) return { nftPath, dir: null, files: null };
  const nft = JSON.parse(readFileSync(nftPath, "utf8"));
  return { nftPath, dir: dirname(nftPath), files: nft.files ?? [] };
}

/**
 * Rebuild a route's traced file set under a fresh OS-temp dir, preserving each
 * file's path RELATIVE TO the monorepo trace root, so <tmp>/packages/oracle/...
 * and <tmp>/node_modules/.pnpm/... land where the oracle's resolution expects.
 */
function materializeTrace(route, trace) {
  const tmp = mkdtempSync(join(tmpdir(), "necro-wasm-" + route + "-"));
  for (const entry of trace.files) {
    const abs = resolve(trace.dir, entry);
    const rel = relative(traceRoot, abs);
    if (rel.startsWith("..") || rel.includes(":")) continue; // outside the root
    if (!existsSync(abs)) continue; // dangling entry -> caught at resolve time
    const dest = join(tmp, rel);
    mkdirSync(dirname(dest), { recursive: true });
    try {
      cpSync(abs, dest, { recursive: true, dereference: true });
    } catch {
      // ignore one un-copyable entry; a genuinely missing wasm is caught below
    }
  }
  return tmp;
}

/**
 * From the materialised trace, resolve each grammar the SAME way the oracle
 * does (createRequire anchored at the traced tree-sitter.js), load it against
 * the traced web-tree-sitter runtime, and parse a snippet. Returns null on
 * success or an error message.
 */
async function verifyRouteParser(route, tmp, specifiers) {
  const parserFile = join(
    tmp, "packages", "oracle", "dist", "parser", "tree-sitter.js",
  );
  if (!existsSync(parserFile)) {
    return "the traced oracle parser is missing at packages/oracle/dist/parser/tree-sitter.js";
  }
  const oracleRequire = createRequire(parserFile);

  let Language;
  let Parser;
  try {
    const wtsEntry = oracleRequire.resolve("web-tree-sitter");
    const mod = await import(pathToFileURL(wtsEntry).href);
    ({ Language, Parser } = mod);
    await Parser.init();
  } catch (cause) {
    return "could not load the traced web-tree-sitter runtime: " + msg(cause);
  }

  for (const spec of specifiers) {
    let wasmPath;
    try {
      wasmPath = oracleRequire.resolve(spec);
    } catch (cause) {
      return 'the traced oracle CANNOT resolve "' + spec +
        '" (the exact prod PARSER_INIT_FAILED cause): ' + msg(cause);
    }
    if (!existsSync(wasmPath)) {
      return '"' + spec + '" resolved to ' + wasmPath + " but that file is not in the trace";
    }
    try {
      const language = await Language.load(pathToFileURL(wasmPath));
      const parser = new Parser();
      parser.setLanguage(language);
      const snippet = spec.includes("javascript") ? "const x = 1;" : "x = 1\n";
      const tree = parser.parse(snippet);
      if (!tree || !tree.rootNode) {
        return 'parsing with "' + spec + '" produced no tree';
      }
      tree.delete?.();
      parser.delete?.();
    } catch (cause) {
      return 'the traced "' + spec + '" failed to load/parse (ABI or missing file?): ' + msg(cause);
    }
  }
  return null;
}

let ok = true;
const tmpDirs = [];
try {
  for (const [route, specifiers] of Object.entries(ROUTES)) {
    const trace = readTrace(route);
    if (trace.files === null) {
      console.error(
        "FAIL /api/" + route + ": trace file not found (" +
          relative(webDir, trace.nftPath) + "). Run the web build first.",
      );
      ok = false;
      continue;
    }
    const tmp = materializeTrace(route, trace);
    tmpDirs.push(tmp);
    const err = await verifyRouteParser(route, tmp, specifiers);
    if (err) {
      console.error("FAIL /api/" + route + ": " + err);
      ok = false;
    } else {
      console.log(
        "OK   /api/" + route +
          ": the traced lambda resolves + initialises its parser (" +
          specifiers.join(" + ") + ").",
      );
    }
  }
} finally {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

if (!ok) {
  console.error(
    "\nWASM trace check FAILED - at least one route's traced serverless " +
      "function cannot resolve/initialise its tree-sitter parser " +
      "(this is the production PARSER_INIT_FAILED).",
  );
  process.exit(1);
}
console.log(
  "\nWASM trace check PASSED - every route's traced files genuinely " +
    "resolve, load and parse with their tree-sitter grammar(s).",
);
process.exit(0);