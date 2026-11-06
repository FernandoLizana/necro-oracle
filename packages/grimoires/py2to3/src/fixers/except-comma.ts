// @necro/grimoires-py2to3 — `except_comma` Pre_Pass fixer.
//
// Py2 → Py3:
//   except Exception, e:     ->   except Exception as e:
//   except (A, B), e:        ->   except (A, B) as e:
//
// tree-sitter-python parses a comma-style except clause as an `except_clause`
// with two `value`-field children (the exception type/tuple and the bound
// name) separated by an anonymous `,` token. The py3 form replaces that comma
// (and surrounding spacing) with ` as `. We replace exactly the span from the
// end of the first value to the start of the name with ` as `, leaving both the
// type expression and the name text verbatim.
//
// A modern `except Exception as e:` has no comma child, so it is not matched
// and round-trips unchanged (idempotence, R3.4).

import type { Tree } from "@necro/oracle";
import type { FixResult, Fixer } from "@necro/coven";

import type { Node } from "web-tree-sitter";

import { type Collected, type Edit, runFixer, walk } from "./shared.js";

function collect(tree: Tree): Collected {
  const edits: Edit[] = [];

  walk(tree, (node) => {
    if (node.type !== "except_clause") return;

    const values = node.childrenForFieldName("value").filter((c): c is Node => c !== null);
    // The py2 comma form binds a name: two `value` children with a `,` between.
    if (values.length < 2) return;

    const hasComma = node.children.some((c) => c !== null && c.type === ",");
    if (!hasComma) return;

    const exceptionType = values[0]!;
    const boundName = values[1]!;

    // Replace everything between the type expression and the name — the comma
    // and its surrounding whitespace — with ` as `. The type and name text are
    // untouched, so a tuple like `(A, B)` keeps its internal comma.
    edits.push({
      start: exceptionType.endIndex,
      end: boundName.startIndex,
      replacement: " as ",
    });
  });

  return { edits, unconverted: [] };
}

/**
 * Pure, idempotent fixer. After one pass the clause reads `except E as e:`,
 * which has no comma child, so a second pass makes no edit (R3.4).
 */
export const exceptCommaFixer: Fixer = (source, ctx): FixResult =>
  runFixer(source, ctx, collect);
