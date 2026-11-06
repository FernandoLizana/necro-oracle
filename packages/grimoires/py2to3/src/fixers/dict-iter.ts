// @necro/grimoires-py2to3 — `dict_iter` Pre_Pass fixer.
//
// Py2 → Py3:
//   d.iteritems()   ->   d.items()
//   d.iterkeys()    ->   d.keys()
//   d.itervalues()  ->   d.values()
//
// tree-sitter-python parses `d.iteritems()` as a `call` whose `function` is an
// `attribute` (`d.iteritems`) with an `attribute`-field identifier holding the
// method name. We rewrite ONLY that method-name identifier span, so the
// receiver expression `d` and the `()` argument list are copied verbatim.
//
// Only the three `iter*` iterator methods are rewritten. Any other attribute
// access (including an already-py3 `.items()`) is not matched and round-trips
// unchanged (R3.4, R3.8).

import type { Tree } from "@necro/oracle";
import type { FixResult, Fixer } from "@necro/coven";

import { type Collected, type Edit, runFixer, walk } from "./shared.js";

/** Maps each py2 iterator method name to its py3 replacement. */
const ITER_METHODS: Readonly<Record<string, string>> = {
  iteritems: "items",
  iterkeys: "keys",
  itervalues: "values",
};

function collect(tree: Tree): Collected {
  const edits: Edit[] = [];

  walk(tree, (node) => {
    if (node.type !== "attribute") return;

    const method = node.childForFieldName("attribute");
    if (method === null) return;

    const replacement = ITER_METHODS[method.text];
    if (replacement === undefined) return;

    // Rewrite only the method-name identifier; receiver and call stay verbatim.
    edits.push({
      start: method.startIndex,
      end: method.endIndex,
      replacement,
    });
  });

  return { edits, unconverted: [] };
}

/**
 * Pure, idempotent fixer. After one pass the attribute reads `.items()` etc.,
 * which is not in `ITER_METHODS`, so a second pass makes no edit (R3.4).
 */
export const dictIterFixer: Fixer = (source, ctx): FixResult =>
  runFixer(source, ctx, collect);
