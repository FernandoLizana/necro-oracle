// @necro/oracle — tree-sitter Python parser (task 11.2).
//
// Real implementation backed by web-tree-sitter + the on-disk
// tree-sitter-python WASM grammar. Everything here is lazy: nothing runs at
// import time (no side effects, no network, no WASM load). The grammar is only
// loaded when initParser() is first awaited, and it is read from disk via a
// file:// URL (R3.1, R21.6) — never fetched over the network.
//
// API (per design "Components / Interfaces" and "Diagram 2"):
//   - initParser(): lazy idempotent singleton; resets initPromise on failure
//     and rejects with NecroError(PARSER_INIT_FAILED).
//   - parsePython(source): SYNCHRONOUS; throws PARSER_INIT_FAILED if called
//     before init resolves, FILE_TOO_LARGE if byte length > 1 MB; best-effort
//     partial tree for invalid UTF-8 (never throws on bad bytes).
//   - parseJavascript(source): SYNCHRONOUS; same contract as parsePython but
//     backed by the tree-sitter-javascript grammar WASM, loaded identically via
//     createRequire(import.meta.url).resolve(...) and armed by the same
//     initParser() call (R18.1). Error-node counting is identical.
//   - queryPython(tree, sexpPattern): throws INVALID_QUERY_PATTERN for an
//     invalid S-expression.
//   - hasLegacyPythonNodes(tree): true on any of the 7 py2 legacy indicators.

import {
  Language,
  Parser,
  Query,
  type Node,
  type QueryMatch,
  type Tree as TsTree,
} from "web-tree-sitter";

import { NecroError } from "../util/errors.js";

/** Re-exported tree-sitter types (per design Components section). */
export type Tree = TsTree;
export type { QueryMatch };


/** Maximum source size the parser will accept, in bytes (1 MB). */
const MAX_SOURCE_BYTES = 1_048_576;

// Module-level singletons. All start null; none is touched at import time.
let initPromise: Promise<void> | null = null;
let parserSingleton: Parser | null = null;
let languageSingleton: Language | null = null;
// JavaScript grammar singletons. Item 1 (judge-ready-pass): these are armed by
// their OWN lazy init (`initJavascript`), NOT by `initParser`. Readings and
// resurrect parse only Python, so they must never force the JavaScript grammar
// WASM to load — otherwise a route whose serverless function does not package
// `tree-sitter-javascript.wasm` fails the whole shared init with
// PARSER_INIT_FAILED even though it only needed Python. Only the Lovers flow
// arms the JS grammar (via `initJavascript`), and only its route packages that
// wasm.
let jsInitPromise: Promise<void> | null = null;
let jsParserSingleton: Parser | null = null;
let jsLanguageSingleton: Language | null = null;

/**
 * Resolve an on-disk grammar WASM specifier to a file:// URL.
 *
 * Locates the `.wasm` grammar (e.g.
 * `node_modules/tree-sitter-python/tree-sitter-python.wasm`) via Node's module
 * resolution (`createRequire(...).resolve`) and converts the absolute path to a
 * `file://` URL. `node:module` and `node:url` are imported dynamically — only
 * inside the async init path — so they never reach the browser-safe main entry
 * at import time. Resolution reads the filesystem's module graph only; there is
 * no network access (R3.1, R21.6).
 */
async function grammarWasmUrl(specifier: string): Promise<URL> {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve(specifier);
  return pathToFileURL(wasmPath);
}

/**
 * Initialize the parser. Idempotent lazy singleton: the first call creates the
 * init promise (loading the WASM runtime and grammar from disk); later calls
 * return the same resolved promise immediately.
 *
 * On failure the internal state is reset (`initPromise = null`) so a subsequent
 * call retries, and the promise rejects with `NecroError(PARSER_INIT_FAILED)`.
 * No network access occurs (R3.1, R21.6).
 */
export function initParser(): Promise<void> {
  initPromise ??= (async (): Promise<void> => {
    try {
      await Parser.init();

      // Python grammar ONLY. Item 1 (judge-ready-pass): the JavaScript grammar
      // is armed separately by `initJavascript`, so a Python-only route
      // (readings, resurrect) never forces `tree-sitter-javascript.wasm` to
      // load and never fails its shared init just because that wasm is not
      // packaged into its serverless function.
      const language = await Language.load(
        await grammarWasmUrl("tree-sitter-python/tree-sitter-python.wasm"),
      );
      const parser = new Parser();
      parser.setLanguage(language);
      parserSingleton = parser;
      languageSingleton = language;
    } catch (cause) {
      // Reset so the next call retries (allows recovery from a transient load
      // failure), then surface the failure in the oracle's voice.
      initPromise = null;
      parserSingleton = null;
      languageSingleton = null;
      throw new NecroError(
        "PARSER_INIT_FAILED",
        "The oracle could not awaken its sight; the grammar of the dead refused to load.",
        cause,
      );
    }
  })();
  return initPromise;
}

/**
 * Arm the JavaScript grammar. Item 1 (judge-ready-pass): a SEPARATE lazy
 * singleton from `initParser`, so only the Lovers flow (the one flow that
 * parses JavaScript) loads `tree-sitter-javascript.wasm`. Idempotent: the first
 * call creates the init promise; later calls return it. On failure the internal
 * JS state is reset so a later call retries, and the promise rejects with
 * `NecroError(PARSER_INIT_FAILED)`. It depends on the web-tree-sitter runtime,
 * so it arms the Python side first (which also runs `Parser.init()`); that call
 * is itself idempotent. No network access occurs (R3.1, R21.6).
 */
export function initJavascript(): Promise<void> {
  jsInitPromise ??= (async (): Promise<void> => {
    try {
      // The runtime (`Parser.init()`) is shared; arm it via initParser first.
      await initParser();
      const jsLanguage = await Language.load(
        await grammarWasmUrl(
          "tree-sitter-javascript/tree-sitter-javascript.wasm",
        ),
      );
      const jsParser = new Parser();
      jsParser.setLanguage(jsLanguage);
      jsParserSingleton = jsParser;
      jsLanguageSingleton = jsLanguage;
    } catch (cause) {
      jsInitPromise = null;
      jsParserSingleton = null;
      jsLanguageSingleton = null;
      throw new NecroError(
        "PARSER_INIT_FAILED",
        "The oracle could not awaken its sight; the grammar of the dead refused to load.",
        cause,
      );
    }
  })();
  return jsInitPromise;
}

/**
 * Parse Python source into a tree-sitter `Tree`. Synchronous; `initParser()`
 * must have resolved first.
 *
 *   - throws NecroError(PARSER_INIT_FAILED) if called before init resolves
 *   - throws NecroError(FILE_TOO_LARGE) if source byte length > 1_048_576
 *   - returns a best-effort partial Tree for invalid UTF-8 (never throws on
 *     bad bytes); a lone surrogate is encoded as the replacement character by
 *     the runtime rather than raising.
 */
export function parsePython(source: string): Tree {
  if (parserSingleton === null) {
    throw new NecroError(
      "PARSER_INIT_FAILED",
      "The oracle's sight is not yet bound to the grammar; call initParser() before reading.",
    );
  }

  // Measure the true UTF-8 byte length (not the UTF-16 string length) so the
  // 1 MB limit matches the bytes the parser will actually consume.
  const byteLength = Buffer.byteLength(source, "utf8");
  if (byteLength > MAX_SOURCE_BYTES) {
    throw new NecroError(
      "FILE_TOO_LARGE",
      "This scroll is too vast for the oracle to read; its corpse exceeds one megabyte.",
    );
  }

  const tree = parserSingleton.parse(source);
  if (tree === null) {
    // parse() only returns null when no language is set, which cannot happen
    // once parserSingleton is non-null. Guard anyway rather than return null.
    throw new NecroError(
      "PARSER_INIT_FAILED",
      "The oracle's sight faltered mid-reading; the grammar slipped from its grasp.",
    );
  }
  return tree;
}

/**
 * Parse JavaScript source into a tree-sitter `Tree`. Synchronous;
 * `initParser()` must have resolved first. This mirrors `parsePython` exactly,
 * differing only in the grammar it is backed by (R18.1):
 *
 *   - throws NecroError(PARSER_INIT_FAILED) if called before init resolves
 *   - throws NecroError(FILE_TOO_LARGE) if source byte length > 1_048_576
 *   - returns a best-effort partial Tree for invalid UTF-8 (never throws on
 *     bad bytes); a lone surrogate is encoded as the replacement character by
 *     the runtime rather than raising.
 */
export function parseJavascript(source: string): Tree {
  if (jsParserSingleton === null || jsLanguageSingleton === null) {
    throw new NecroError(
      "PARSER_INIT_FAILED",
      "The oracle's sight is not yet bound to the grammar; call initParser() before reading.",
    );
  }

  // Measure the true UTF-8 byte length (not the UTF-16 string length) so the
  // 1 MB limit matches the bytes the parser will actually consume.
  const byteLength = Buffer.byteLength(source, "utf8");
  if (byteLength > MAX_SOURCE_BYTES) {
    throw new NecroError(
      "FILE_TOO_LARGE",
      "This scroll is too vast for the oracle to read; its corpse exceeds one megabyte.",
    );
  }

  const tree = jsParserSingleton.parse(source);
  if (tree === null) {
    // parse() only returns null when no language is set, which cannot happen
    // once jsParserSingleton is non-null. Guard anyway rather than return null.
    throw new NecroError(
      "PARSER_INIT_FAILED",
      "The oracle's sight faltered mid-reading; the grammar slipped from its grasp.",
    );
  }
  return tree;
}

/**
 * Run a tree-sitter S-expression query against a parsed tree, returning the
 * matches.
 *
 *   - throws NecroError(INVALID_QUERY_PATTERN) for an invalid S-expression.
 */
export function queryPython(tree: Tree, sexpPattern: string): QueryMatch[] {
  if (languageSingleton === null) {
    throw new NecroError(
      "PARSER_INIT_FAILED",
      "The oracle's sight is not yet bound to the grammar; call initParser() before querying.",
    );
  }

  let query: Query;
  try {
    query = new Query(languageSingleton, sexpPattern);
  } catch (cause) {
    throw new NecroError(
      "INVALID_QUERY_PATTERN",
      "That incantation is malformed; the oracle cannot trace its sigils.",
      cause,
    );
  }

  try {
    return query.matches(tree.rootNode);
  } finally {
    query.delete();
  }
}

/**
 * Return true when the tree contains any of the 7 Python 2 legacy construct
 * indicators. A single cursor walk visits every node once and checks:
 *
 *   (a) named node type `print_statement`
 *   (b) named node type `exec_statement`
 *   (c) `except_clause` with a comma child (`except E, e:`)
 *   (d) `comparison_operator` containing the `<>` token
 *   (e) `integer` whose text matches `/[Ll]$/` (long literal, e.g. `10L`)
 *   (f) `integer` whose text matches `/^0[0-7]+$/` (legacy octal, e.g. `0777`)
 *   (g) backtick repr (`` `x` ``): any node — named OR an `ERROR` node — whose
 *       text starts with a backtick character. tree-sitter-python often emits
 *       an `ERROR` node rather than a structured node for backtick repr, so the
 *       ERROR-node fallback is required.
 */
export function hasLegacyPythonNodes(tree: Tree): boolean {
  const cursor = tree.walk();
  try {
    // Iterative depth-first walk over every node (named and unnamed), so the
    // ERROR-node backtick fallback is reachable.
    for (;;) {
      if (nodeIsLegacy(cursor.currentNode)) {
        return true;
      }

      if (cursor.gotoFirstChild()) {
        continue;
      }
      // No children: advance to the next sibling, climbing as needed.
      for (;;) {
        if (cursor.gotoNextSibling()) {
          break;
        }
        if (!cursor.gotoParent()) {
          return false; // Walked the entire tree with no legacy node found.
        }
      }
    }
  } finally {
    cursor.delete();
  }
}

/** True if a single node is one of the 7 legacy Python 2 indicators. */
function nodeIsLegacy(node: Node): boolean {
  const type = node.type;

  // (a) print statement, (b) exec statement.
  if (type === "print_statement" || type === "exec_statement") {
    return true;
  }

  // (c) comma-style except: `except Exception, e:`.
  if (type === "except_clause") {
    for (const child of node.children) {
      if (child !== null && child.type === ",") {
        return true;
      }
    }
  }

  // (d) `<>` inequality operator (py2 not-equal).
  if (type === "comparison_operator") {
    for (const child of node.children) {
      if (child !== null && child.type === "<>") {
        return true;
      }
    }
  }

  // (e) long literal `10L` and (f) legacy octal `0777`.
  if (type === "integer") {
    const text = node.text;
    if (/[Ll]$/.test(text) || /^0[0-7]+$/.test(text)) {
      return true;
    }
  }

  // (g) backtick repr: match named nodes whose text starts with a backtick AND
  // ERROR nodes whose text starts with a backtick (tree-sitter-python usually
  // emits an ERROR node here).
  if (node.isNamed || type === "ERROR") {
    if (node.text.startsWith("`")) {
      return true;
    }
  }

  return false;
}
