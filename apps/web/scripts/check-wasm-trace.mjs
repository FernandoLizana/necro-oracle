// apps/web/scripts/check-wasm-trace.mjs
//
// REAL post-build acceptance gate for the tree-sitter WASM tracing.
//
// Extended in the symlink-packaging hotfix to also verify that NO traced
// grammar WASM file has a symlinked directory segment in its path. Vercel
// rejects deployment packages that contain files from symlinked directories
// with:
//   "The framework produced an invalid deployment package for a Serverless
//    Function. Typically this means that the framework produces files in
//    symlinked directories."
//
// For each of readings / resurrect / lovers this gate:
//   1. Reads the @vercel/nft trace (route.js.nft.json).
//   2. Walks every *.wasm entry in the trace and fails if any path segment
//      (resolved from the trace root) is a symbolic link ? that is the Vercel
//      packaging failure condition.
//   3. Copies EXACTLY the traced files into a temp dir, preserving their
//      layout relative to the outputFileTracingRoot (the monorepo root).
//   4. From <tmp>/packages/oracle/dist/parser it resolves and loads the
//      web-tree-sitter runtime, then locates each grammar from
//      <tmp>/packages/oracle/dist/grammars/<name>.wasm (the real path the
//      fixed parser uses), loads + parses a one-line snippet.
// Fails with a clear message on any violation; exits 1. Exits 0 only when
// every route genuinely passes all checks. Temp dirs live under the OS temp
// dir, never the repo.

import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  lstatSync,
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

// Each route and the grammar file names the oracle must find in dist/grammars.
const ROUTES = {
  readings: ["tree-sitter-python.wasm"],
  resurrect: ["tree-sitter-python.wasm"],
  lovers: ["tree-sitter-python.wasm", "tree-sitter-javascript.wasm"],
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
 * Walk the absolute path segment-by-segment and return the first segment
 * that is a symbolic link, or null if none is.
 */
function firstSymlinkSegment(absPath) {
  // Normalise separators
  const parts = absPath.replace(/\\/g, "/").split("/");
  let cur = "";
  for (const part of parts) {
    if (!part) {
      cur = "/";
      continue;
    }
    cur = cur === "/" ? "/" + part : cur + "/" + part;
    if (!cur || cur.length < 2) continue; // skip bare "/" or drive letter
    try {
      if (lstatSync(cur).isSymbolicLink()) return cur;
    } catch {
      // segment does not exist yet (inside temp dirs, etc.) ? skip
    }
  }
  return null;
}

/**
 * Check that every *.wasm file listed in the trace has NO symlinked directory
 * segment in its path. Returns an error message if any violation is found,
 * null if all wasm entries are clean.
 */
function checkNoSymlinkInWasmPaths(trace) {
  for (const entry of trace.files) {
    if (!entry.endsWith(".wasm")) continue;
    const abs = resolve(trace.dir, entry);
    const sym = firstSymlinkSegment(abs);
    if (sym !== null) {
      return (
        "traced wasm '" +
        relative(traceRoot, abs) +
        "' passes through symlink '" +
        sym +
        "' ? Vercel will reject the deployment package."
      );
    }
  }
  return null;
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
 * From the materialised trace, load the web-tree-sitter runtime and then
 * load each grammar from dist/grammars/<name>.wasm (the real path the fixed
 * oracle parser resolves to). Parses a one-line snippet per grammar. Returns
 * null on success or an error message.
 */
async function verifyRouteParser(route, tmp, grammarFileNames) {
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

  for (const grammarFileName of grammarFileNames) {
    // The fixed oracle parser resolves grammars from dist/grammars/<name>.wasm
    // (real file, no symlink). The materialised trace must contain that file.
    const wasmPath = join(
      tmp, "packages", "oracle", "dist", "grammars", grammarFileName,
    );
    if (!existsSync(wasmPath)) {
      return (
        '"packages/oracle/dist/grammars/' +
        grammarFileName +
        '" is not in the traced set' +
        " (grammar wasm must be copied to dist/grammars/ by oracle postbuild)"
      );
    }
    try {
      const language = await Language.load(pathToFileURL(wasmPath));
      const parser = new Parser();
      parser.setLanguage(language);
      const isJs = grammarFileName.includes("javascript");
      const snippet = isJs ? "const x = 1;" : "x = 1\n";
      const tree = parser.parse(snippet);
      if (!tree || !tree.rootNode) {
        return 'parsing with "' + grammarFileName + '" produced no tree';
      }
      tree.delete?.();
      parser.delete?.();
    } catch (cause) {
      return (
        '"' +
        grammarFileName +
        '" failed to load/parse (ABI or missing file?): ' +
        msg(cause)
      );
    }
  }
  return null;
}

let ok = true;
const tmpDirs = [];
try {
  for (const [route, grammarFileNames] of Object.entries(ROUTES)) {
    const trace = readTrace(route);
    if (trace.files === null) {
      console.error(
        "FAIL /api/" + route + ": trace file not found (" +
          relative(webDir, trace.nftPath) + "). Run the web build first.",
      );
      ok = false;
      continue;
    }

    // --- Check 1: no symlinked directory segments in *.wasm trace entries ---
    const symlinkErr = checkNoSymlinkInWasmPaths(trace);
    if (symlinkErr) {
      console.error("FAIL /api/" + route + " [symlink-check]: " + symlinkErr);
      ok = false;
      // Still materialise and run the parser check so we get full diagnostics.
    }

    // --- Check 2: materialise + resolve + init + parse ---
    const tmp = materializeTrace(route, trace);
    tmpDirs.push(tmp);
    const parseErr = await verifyRouteParser(route, tmp, grammarFileNames);
    if (parseErr) {
      console.error("FAIL /api/" + route + " [parser-check]: " + parseErr);
      ok = false;
    }

    if (!symlinkErr && !parseErr) {
      console.log(
        "OK   /api/" + route +
          ": no symlinks in wasm paths + parser resolves/inits/parses (" +
          grammarFileNames.join(" + ") + ").",
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
    "\nWASM trace check FAILED - at least one route has a symlinked wasm path " +
      "or cannot resolve/initialise its tree-sitter parser.",
  );
  process.exit(1);
}
console.log(
  "\nWASM trace check PASSED - every route's traced wasm paths are real + " +
    "the parser resolves, loads and parses.",
);
process.exit(0);
