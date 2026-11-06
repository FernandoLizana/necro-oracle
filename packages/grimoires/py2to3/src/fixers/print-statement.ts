// @necro/grimoires-py2to3 — `print_statement` Pre_Pass fixer.
//
// Py2 → Py3:
//   print "summoned", name   ->   print("summoned", name)
//   print x                  ->   print(x)
//
// The tree-sitter-python grammar parses a py2 print statement as a
// `print_statement` node whose printed operands are its `argument`-field
// children. We wrap the operand list in parentheses by splicing `(` right
// before the first argument and `)` at the end of the statement, so the
// argument text (which may contain string literals or commas) is copied
// verbatim and never altered.
//
// Non-convertible shapes are left untouched and recorded as residuals:
//   - the bareword `print` with no operands is NOT a `print_statement` (the
//     grammar treats it as an `identifier`), so it never reaches this fixer and
//     already round-trips as the py3 builtin reference.
//   - the chevron redirect `print >> stream, x` (→ `print(x, file=stream)`) is
//     a non-mechanical rewrite, so it is recorded as a `no_transform` residual
//     rather than converted incorrectly.

import type { Tree } from "@necro/oracle";
import type { FixResult, Fixer } from "@necro/coven";

import type { Node } from "web-tree-sitter";

import { type Collected, type Edit, type Unconverted, runFixer, walk } from "./shared.js";

/** True when a `print_statement` uses the `print >> stream, …` chevron form. */
function isChevronPrint(node: Node): boolean {
  // tree-sitter-python surfaces the redirect as a `chevron` child node
  // (its text is e.g. ">> sys.stderr").
  return node.children.some((c) => c !== null && c.type === "chevron");
}

function collect(tree: Tree): Collected {
  const edits: Edit[] = [];
  const unconverted: Unconverted[] = [];

  walk(tree, (node) => {
    if (node.type !== "print_statement") return;

    if (isChevronPrint(node)) {
      unconverted.push({ node, construct: "print >> stream (chevron redirect)" });
      return;
    }

    const args = node.childrenForFieldName("argument").filter((c): c is Node => c !== null);

    if (args.length === 0) {
      // A `print_statement` with no `argument` operands after dropping the
      // chevron case is just a bare `print` — nothing to wrap; leave it.
      return;
    }

    // `print` occupies [startIndex, startIndex + 5); the whitespace that
    // follows is the py2 separator before the operand list.
    const printEnd = node.startIndex + "print".length;
    const firstArgStart = args[0]!.startIndex;
    const stmtEnd = node.endIndex;

    // Replace the whitespace between `print` and the first operand with `(` so
    // the result is the canonical `print(x)` (no stray space), then close with
    // `)` at the statement end. The operand text itself is copied verbatim.
    edits.push({ start: printEnd, end: firstArgStart, replacement: "(" });
    edits.push({ start: stmtEnd, end: stmtEnd, replacement: ")" });
  });

  return { edits, unconverted };
}

/**
 * Pure, idempotent fixer. After one pass the `print_statement` node becomes a
 * `call` (`print(...)`), so a second parse finds no `print_statement` and the
 * output is byte-identical (R3.4). String-literal and comment contents are
 * never touched — only `(` and `)` are inserted around the operand list.
 */
export const printStatementFixer: Fixer = (source, ctx): FixResult =>
  runFixer(source, ctx, collect);
