// @necro/grimoires-py2to3 — `unicode_str` Pre_Pass fixer.
//
// Py2 → Py3:
//   unicode(x)   ->   str(x)
//   u"hello"     ->   "hello"      (the redundant `u` string prefix is dropped)
//   u'hi'        ->   'hi'
//
// Two independent constructs are handled:
//
//   1. The `unicode` builtin, parsed as a `call` whose `function` is the
//      identifier `unicode`. We rewrite ONLY that identifier to `str`; the
//      argument list is copied verbatim.
//
//   2. The redundant `u`/`U` prefix on a string literal. In py3 every `str` is
//      unicode, so the prefix is noise. tree-sitter-python exposes the prefix
//      inside the `string_start` node (e.g. `u"`); we strip just the leading
//      `u`/`U` character from that opening-quote token. The `string_content`
//      node — the actual text of the literal — is NEVER touched, so literal
//      contents and comments are preserved (grimoire-authoring rule). A raw or
//      byte prefix (`r"..."`, `b"..."`, `ur"..."`) is left intact: only a
//      leading `u`/`U` directly before the quote is removed.

import type { Tree } from "@necro/oracle";
import type { FixResult, Fixer } from "@necro/coven";

import type { Node } from "web-tree-sitter";

import { type Collected, type Edit, runFixer, walk } from "./shared.js";

/** Rewrite a `unicode(...)` call's function identifier to `str`. */
function unicodeCallEdit(node: Node): Edit | null {
  if (node.type !== "call") return null;
  const fn = node.childForFieldName("function");
  if (fn === null || fn.type !== "identifier" || fn.text !== "unicode") {
    return null;
  }
  return { start: fn.startIndex, end: fn.endIndex, replacement: "str" };
}

/**
 * Strip a redundant leading `u`/`U` prefix from a string's opening quote token.
 * Returns null when the `string_start` carries no such prefix (plain quote, or
 * a raw/byte/f prefix that must be preserved).
 */
function unicodePrefixEdit(node: Node): Edit | null {
  if (node.type !== "string_start") return null;
  const text = node.text; // e.g. `u"`, `u'`, `"`, `r'`, `b"`, `f"`
  // Only a bare `u`/`U` immediately before the quote is redundant. `ur"..."`,
  // `br"..."`, etc. keep their semantics, so require the quote right after `u`.
  if (!/^[uU]['"]/.test(text)) return null;
  // Remove exactly the one prefix character at the start of the token.
  return { start: node.startIndex, end: node.startIndex + 1, replacement: "" };
}

function collect(tree: Tree): Collected {
  const edits: Edit[] = [];

  walk(tree, (node) => {
    const callEdit = unicodeCallEdit(node);
    if (callEdit !== null) {
      edits.push(callEdit);
      return;
    }
    const prefixEdit = unicodePrefixEdit(node);
    if (prefixEdit !== null) {
      edits.push(prefixEdit);
    }
  });

  return { edits, unconverted: [] };
}

/**
 * Pure, idempotent fixer. After one pass the call reads `str(...)` and the
 * string opens with a bare quote, so a second pass matches neither and output
 * is byte-identical (R3.4).
 */
export const unicodeStrFixer: Fixer = (source, ctx): FixResult =>
  runFixer(source, ctx, collect);
