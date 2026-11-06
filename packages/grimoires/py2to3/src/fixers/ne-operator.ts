// @necro/grimoires-py2to3 — `ne_operator` Pre_Pass fixer.
//
// Py2 → Py3:
//   a <> b   ->   a != b
//
// tree-sitter-python parses the py2 inequality operator as an anonymous `<>`
// token child of a `comparison_operator` node. We replace exactly that token's
// span with `!=`, leaving both operand expressions and surrounding spacing
// verbatim. A `<>` sequence inside a string literal or comment is not a `<>`
// token node, so it is never matched.

import type { Tree } from "@necro/oracle";
import type { FixResult, Fixer } from "@necro/coven";

import { type Collected, type Edit, runFixer, walk } from "./shared.js";

function collect(tree: Tree): Collected {
  const edits: Edit[] = [];

  walk(tree, (node) => {
    // The operator surfaces as a standalone `<>` token (type === "<>").
    if (node.type !== "<>") return;

    edits.push({
      start: node.startIndex,
      end: node.endIndex,
      replacement: "!=",
    });
  });

  return { edits, unconverted: [] };
}

/**
 * Pure, idempotent fixer. After one pass the operator is `!=`, so the `<>`
 * token no longer exists and a second pass makes no edit (R3.4).
 */
export const neOperatorFixer: Fixer = (source, ctx): FixResult =>
  runFixer(source, ctx, collect);
