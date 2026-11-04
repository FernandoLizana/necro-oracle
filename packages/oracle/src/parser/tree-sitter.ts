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
//   - queryPython(tree, sexpPattern): throws INVALID_QUERY_PATTERN for an
//     invalid S-expression.
//   - hasLegacyPythonNodes(tree): true on any of the 7 py2 legacy indicators.

import { Language, Parser, Query } from "web-tree-sitter";

import { NecroError } from "../util/errors.js";

/** Re-exported tree-sitter types (per design Components section). */
export type Tree = import("web-tree-sitter").Tree;
export type QueryMatch = import("web-tree-sitter").QueryMatch;
type Node = import("web-tree-sitter").Node;

/** Maximum source size the parser will accept, in bytes (1 MB). */
const MAX_SOURCE_BYTES = 1_048_576;

// Module-level singletons. Both start null; neither is touched at import time.
let initPromise: Promise<void> | null = null;
let parserSingleton: Parser | null = null;
let languageSingleton: Language | null = null;

/**
 * Resolve the on-disk tree-sitter-python grammar to a file:// URL.
 *
 * Locates `node_modules/tree-sitter-python/tree-sitter-python.wasm` via Node's
 * module resolution (`createRequire(...).resolve`) and converts the absolute
 * path to a `file://` URL. `node:module` and `node:url` are imported
 * dynamically — only inside the async init path — so they never reach the
 * browser-safe main entry at import time. Resolution reads the filesystem's
 * module graph only; there is no network access (R3.1, R21.6).
 */
async function grammarWasmUrl(): Promise<URL> {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve(
    "tree-sitter-python/tree-sitter-python.wasm",
  );
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
      const language = await Language.load(await grammarWasmUrl());
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
