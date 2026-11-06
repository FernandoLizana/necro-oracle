// @necro/grimoires-py2to3 — `long_literal` Pre_Pass fixer.
//
// Py2 → Py3:
//   0L      ->   0
//   10L     ->   10
//   0x1FL   ->   0x1F
//
// Py3 unified `int`/`long`, so the trailing `L`/`l` long suffix is removed.
// tree-sitter-python parses the whole literal (including the suffix) as a
// single `integer` node; we drop ONLY the final `L`/`l` character, leaving the
// numeric text and any `0x`/`0o`/`0b` radix prefix verbatim. String literals
// and comments contain no `integer` node, so they are never touched.

import type { Tree } from "@necro/oracle";
import type { FixResult, Fixer } from "@necro/coven";

import { type Collected, type Edit, runFixer, walk } from "./shared.js";

function collect(tree: Tree): Collected {
  const edits: Edit[] = [];

  walk(tree, (node) => {
    if (node.type !== "integer") return;
    if (!/[Ll]$/.test(node.text)) return;

    // Drop exactly the final suffix character.
    edits.push({
      start: node.endIndex - 1,
      end: node.endIndex,
      replacement: "",
    });
  });

  return { edits, unconverted: [] };
}

/**
 * Pure, idempotent fixer. After one pass the literal has no `L`/`l` suffix, so
 * a second pass makes no edit (R3.4).
 */
export const longLiteralFixer: Fixer = (source, ctx): FixResult =>
  runFixer(source, ctx, collect);
