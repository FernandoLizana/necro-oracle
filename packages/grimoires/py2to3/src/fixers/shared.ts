// @necro/grimoires-py2to3 — shared Pre_Pass fixer mechanics (pure, adapter-free).
//
// Every deterministic fixer follows the same discipline (design "Pre_Pass
// transforms"): parse ONCE with the injected `parsePython`, walk the tree once
// collecting the spans to rewrite in document order, then apply the edits
// RIGHT-TO-LEFT so earlier byte offsets stay valid as later text is replaced.
// Because each edit removes the py2 node it matched, a second application finds
// no matching span and returns byte-identical output (idempotence, R3.4), and
// two independent runs from a clean state agree byte-for-byte (determinism,
// R3.6). A file tree-sitter cannot parse is left unchanged with a single
// `parse_failed` residual (R3.7); when no supported construct applies the
// output is byte-identical to the input (R3.8).
//
// This module imports ONLY `@necro/oracle` (for the `Tree`/`parsePython` type
// surface) and `@necro/coven` (for the `FixResult`/`ResidualEntry` contracts).
// No adapters, no clock, no network, no filesystem (R3.2, R3.3).

import type { Tree } from "@necro/oracle";
import type { FixResult, FixerContext, ResidualEntry } from "@necro/coven";

import type { Node } from "web-tree-sitter";

/**
 * A single rewrite: replace the half-open byte range `[start, end)` of the
 * source with `replacement`. Spans are collected in document order and applied
 * right-to-left; they must never overlap.
 */
export interface Edit {
  readonly start: number; // inclusive UTF-16 index into the source
  readonly end: number; // exclusive UTF-16 index into the source
  readonly replacement: string;
}

/**
 * A construct the fixer recognised as py2 but deliberately did not rewrite
 * (e.g. a shape it cannot mechanically convert). Recorded as a residual so the
 * LLM_Pass / report can account for it. `line` is 1-based.
 */
export interface Unconverted {
  readonly node: Node;
  readonly construct: string;
}

/** Outcome of a tree walk: the edits to apply and any unconverted constructs. */
export interface Collected {
  readonly edits: readonly Edit[];
  readonly unconverted: readonly Unconverted[];
}

/**
 * True when tree-sitter produced a tree it could not fully parse: the root is
 * an error node, is marked missing, or any `ERROR` node appears in the walk.
 * On this signal a fixer leaves content unchanged and records `parse_failed`.
 */
export function treeHasParseError(tree: Tree): boolean {
  const root = tree.rootNode;
  if (root.type === "ERROR" || root.isError || root.hasError) {
    // `hasError` is true when any descendant failed to parse; that is exactly
    // the "tree-sitter could not parse" signal we treat as a parse failure.
    return true;
  }
  return false;
}

/**
 * Walk every node of a tree once, in document (pre-order) order, invoking
 * `visit` for each. A single shared cursor walk keeps all fixers to one pass.
 */
export function walk(tree: Tree, visit: (node: Node) => void): void {
  const cursor = tree.walk();
  try {
    for (;;) {
      visit(cursor.currentNode);
      if (cursor.gotoFirstChild()) continue;
      for (;;) {
        if (cursor.gotoNextSibling()) break;
        if (!cursor.gotoParent()) return;
      }
    }
  } finally {
    cursor.delete();
  }
}

/**
 * Apply non-overlapping edits to `source`. Edits are sorted by start offset and
 * applied RIGHT-TO-LEFT so that splicing later text never shifts the offsets of
 * edits still to come. Overlapping edits would corrupt the output, so they are
 * a programming error: the caller guarantees disjoint spans (one node → one
 * edit, and the six fixers target disjoint node kinds).
 */
export function applyEdits(source: string, edits: readonly Edit[]): string {
  if (edits.length === 0) return source;
  const ordered = [...edits].sort((a, b) => a.start - b.start);
  let out = source;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const edit = ordered[i]!;
    out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  }
  return out;
}

/** 1-based source line of a node (tree-sitter rows are 0-based). */
function lineOf(node: Node): number {
  return node.startPosition.row + 1;
}

/**
 * The shared fixer skeleton. Parses once, short-circuits to a `parse_failed`
 * residual on a parse error (R3.7), otherwise collects edits + unconverted
 * constructs with `collect`, applies the edits right-to-left, and turns every
 * unconverted construct into a `no_transform` residual.
 *
 * When `collect` yields no edits the output is the original `source` (same
 * reference), guaranteeing byte-identity when nothing applies (R3.8).
 */
export function runFixer(
  source: string,
  ctx: FixerContext,
  collect: (tree: Tree) => Collected,
): FixResult {
  let tree: Tree;
  try {
    tree = ctx.parse(source);
  } catch {
    // tree-sitter / parser threw (e.g. oversize or init) — leave unchanged.
    return parseFailed(source, ctx.path);
  }

  try {
    if (treeHasParseError(tree)) {
      return parseFailed(source, ctx.path);
    }

    const { edits, unconverted } = collect(tree);
    const after = applyEdits(source, edits);
    const residuals: ResidualEntry[] = unconverted.map((u) => ({
      path: ctx.path,
      line: lineOf(u.node),
      construct: u.construct,
      reason: "no_transform" as const,
    }));
    return { after, residuals };
  } finally {
    tree.delete();
  }
}

/** Build the single `parse_failed` residual and leave content unchanged (R3.7). */
function parseFailed(source: string, path: string): FixResult {
  const residual: ResidualEntry = {
    path,
    line: 1,
    construct: "parse_failed",
    reason: "parse_failed",
  };
  return { after: source, residuals: [residual] };
}
