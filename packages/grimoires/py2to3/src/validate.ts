// @necro/grimoires-py2to3 — Target_Parser validity check (task 5.2).
//
// `validate(after)` proves the produced content is acceptable Python 3 by
// parsing it with the tree-sitter `Target_Parser` and counting error nodes:
// zero error nodes means the content is valid Python 3 (R5.1). The check is
// PARSE-ONLY — it never executes, imports, or evaluates repository code; it
// only walks the resulting syntax tree (R5.4, security rule 1).
//
// This implements the synchronous `Grimoire.validate(after)` contract, so it
// relies on the module-level `parsePython` from `@necro/oracle`, which is
// synchronous once `initParser()` has resolved. The Coven_Runner initializes
// the parser before driving the Ritual, so by the time VALIDATE runs the
// parser is ready; if it is not, `parsePython` throws `PARSER_INIT_FAILED`,
// which — like any parse failure — is reported as "not valid Python 3" rather
// than crashing the phase, keeping the rule "the cards cannot lie": content we
// could not confirm is never presented as converted.

import { hasLegacyPythonNodes, parsePython, type Tree } from "@necro/oracle";
import type { ValidationResult } from "@necro/coven";

import type { Node } from "web-tree-sitter";

/**
 * Run the Target_Parser over `after` and count the error nodes in the
 * resulting syntax tree. Returns `{ valid, errorNodeCount }` where `valid` is
 * `errorNodeCount === 0` (R5.1).
 *
 *   - Parses with the synchronous module-level `parsePython` (parse-only; no
 *     repository code is ever executed — R5.4).
 *   - If parsing throws (parser not initialized, or source over the 1 MB
 *     limit), the content cannot be confirmed as Python 3, so it is reported
 *     as invalid with a non-zero `errorNodeCount` rather than surfacing the
 *     throw — unparseable content is never counted as converted (R5.2, R5.3).
 */
export function validate(after: string): ValidationResult {
  let tree: Tree;
  try {
    tree = parsePython(after);
  } catch {
    // The oracle could not read the content at all (init failure / oversize).
    // Treat it as a single, decisive parse error: not valid Python 3.
    return { valid: false, errorNodeCount: 1 };
  }

  try {
    const errorNodeCount = countErrorNodes(tree);
    // Item 17 (R5.1): zero error nodes is NECESSARY but not SUFFICIENT. Several
    // py2 constructs parse CLEANLY under the py3 grammar (a long literal `10L`,
    // a legacy octal `0777`, even `print 'x'` on some grammar builds), so a
    // file that was never actually migrated would otherwise pass. Require that
    // NO legacy py2 node remains (the SAME oracle AST rule the chunk gate uses).
    // A lingering legacy node is reported as one decisive syntactic defect so
    // `errorNodeCount` stays a positive, non-zero signal for the caller.
    if (errorNodeCount === 0 && hasLegacyPythonNodes(tree)) {
      return { valid: false, errorNodeCount: 1 };
    }
    return { valid: errorNodeCount === 0, errorNodeCount };
  } finally {
    tree.delete();
  }
}

/**
 * Count every error node in the tree with a single pre-order cursor walk. A
 * node is an error node when tree-sitter marks it as an `ERROR` node (a span it
 * could not parse) or as a MISSING node (a token the grammar required but the
 * source omitted). Both are genuine syntactic defects, so both count toward
 * `errorNodeCount`; a tree with neither is valid Python 3.
 */
function countErrorNodes(tree: Tree): number {
  let count = 0;
  const cursor = tree.walk();
  try {
    for (;;) {
      if (isErrorNode(cursor.currentNode)) {
        count += 1;
      }
      if (cursor.gotoFirstChild()) continue;
      for (;;) {
        if (cursor.gotoNextSibling()) break;
        if (!cursor.gotoParent()) return count;
      }
    }
  } finally {
    cursor.delete();
  }
}

/** True when a single node is an `ERROR` node or a MISSING node. */
function isErrorNode(node: Node): boolean {
  return node.type === "ERROR" || node.isError || node.isMissing;
}
