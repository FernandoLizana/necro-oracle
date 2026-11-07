// @necro/coven — pure residual chunking for the Resurrection LLM_Pass (B.1).
//
// The Resurrection LLM_Pass must never show the model the whole file. Instead,
// `groupResiduals` folds a file's residual diagnostics into per-unit
// `ResidualChunk`s: one chunk per enclosing top-level `def`/`class` that holds
// at least one residual, plus a single synthetic module-level chunk for any
// residuals that fall outside every top-level unit. Each chunk carries ONLY the
// diagnostics that live inside it, and its `context` is a STRICT subset of the
// file — the enclosing unit's source plus the referenced top-level import lines
// — so the model sees the smallest span that still lets it fix the residual
// (design B.1; R11.1, R11.2, R11.3).
//
// PURITY (R11.3). `groupResiduals` is a deterministic function of its three
// inputs `(path, source, residuals)`: no clock, no network, no filesystem, no
// ambient state. It does need a tree-sitter parse of `source` to read node
// spans, but — following the `FixerContext.parse` injection pattern in
// `ports.ts` — the parser is INJECTED as an optional `parse` function. The
// default is the oracle's synchronous `parsePython`, which the runner arms once
// up front with `initParser()` before PRE_PASS/VALIDATE (see
// `runners/local.ts`), so in production the default is always ready. Unit and
// property tests inject their own `parse` (or arm the real parser in a
// `beforeAll`), keeping the module network-free and fully testable. If parsing
// fails for any reason, grouping degrades safely: every residual collapses into
// the module-level chunk whose context is only the referenced lines, never the
// whole file — the "cards cannot lie" rule holds (content we cannot confirm is
// never widened to the whole file).

import { parsePython as defaultParsePython, type Tree } from "@necro/oracle";

import type { ResidualEntry } from "../models.js";

import type { Node } from "web-tree-sitter";

// ---------------------------------------------------------------------------
// Public types (design B.1)
// ---------------------------------------------------------------------------

/**
 * A per-unit grouping of a file's residual diagnostics plus the minimal
 * referenced context. A `ResidualChunk` is the unit the LLM_Pass sends to the
 * model: it carries ONLY this chunk's `residuals` and a `context` that is a
 * strict subset of the file (never the whole file).
 */
export interface ResidualChunk {
  /**
   * Stable chunk id of the form `${path}#${startLine}-${endLine}` (1-based,
   * inclusive), so the same file + span always yields the same id and the id
   * can be echoed back by a `ChunkEdit` and splice-located deterministically.
   */
  readonly chunkId: string;
  /** Repo-relative source path the residuals belong to. */
  readonly path: string;
  /** ONLY this chunk's residual diagnostics (R11.1). */
  readonly residuals: readonly ResidualEntry[];
  /** The enclosing unit's line span, 1-based and inclusive. */
  readonly span: { readonly startLine: number; readonly endLine: number };
  /**
   * The minimal masked-ready source the model needs: the enclosing
   * function/class unit plus the referenced top-level import lines. A STRICT
   * subset of the file — never the whole file (R11.2).
   */
  readonly context: string;
}

/**
 * Injected parser (mirrors `FixerContext.parse`). Defaults to the oracle's
 * `parsePython`; tests may inject their own so the module stays pure and
 * network-free.
 */
export type ParseFn = (source: string) => Tree;

// ---------------------------------------------------------------------------
// Grouping (pure)
// ---------------------------------------------------------------------------

/**
 * Group a file's `residuals` into `ResidualChunk`s by their enclosing top-level
 * `function_definition`/`class_definition`, carrying only each chunk's own
 * diagnostics and setting `context` to a strict subset of the file (the
 * enclosing unit + referenced top-level import lines) — never the whole file
 * (R11.1, R11.2, R11.3).
 *
 * Pure: a deterministic function of `(path, source, residuals)`. The optional
 * `parse` is injected for testability and defaults to the oracle parser the
 * runner has already armed (see the module header). Chunks are returned in
 * ascending `span.startLine` order; the module-level chunk (if any) sorts last.
 *
 * @param path       repo-relative path the residuals belong to.
 * @param source     the file's current source (After_Content under repair).
 * @param residuals  the file's residual diagnostics.
 * @param parse      optional injected parser; defaults to oracle `parsePython`.
 */
export function groupResiduals(
  path: string,
  source: string,
  residuals: readonly ResidualEntry[],
  parse: ParseFn = defaultParsePython,
): readonly ResidualChunk[] {
  if (residuals.length === 0) return [];

  const lines = source.split("\n");
  const totalLines = lines.length;

  // Read the top-level unit spans and the top-level import lines from the tree.
  // On any parse failure we fall back to a unit-free layout: every residual
  // collapses into the module-level chunk (referenced lines only), so the
  // context can never widen to the whole file.
  let units: readonly Unit[] = [];
  let importLineNumbers: readonly number[] = [];
  try {
    const tree = parse(source);
    try {
      units = topLevelUnits(tree.rootNode, totalLines);
      importLineNumbers = topLevelImportLines(tree.rootNode);
    } finally {
      tree.delete();
    }
  } catch {
    units = [];
    importLineNumbers = [];
  }

  // Bucket each residual into the enclosing unit (if any) or the module bucket.
  const byUnit = new Map<number, ResidualEntry[]>(); // key: unit index
  const moduleBucket: ResidualEntry[] = [];
  for (const residual of residuals) {
    const unitIndex = enclosingUnitIndex(units, residual.line);
    if (unitIndex === null) {
      moduleBucket.push(residual);
      continue;
    }
    const existing = byUnit.get(unitIndex);
    if (existing === undefined) byUnit.set(unitIndex, [residual]);
    else existing.push(residual);
  }

  const chunks: ResidualChunk[] = [];

  // One chunk per unit that actually holds residuals.
  for (const [unitIndex, unitResiduals] of byUnit) {
    const unit = units[unitIndex];
    if (unit === undefined) continue;
    chunks.push(
      buildChunk(
        path,
        lines,
        unit.startLine,
        unit.endLine,
        importLineNumbers,
        unitResiduals,
      ),
    );
  }

  // One synthetic module-level chunk for residuals outside every unit. Its span
  // is the minimal line range covering those residuals, and its context is only
  // the referenced import lines plus each residual's own line — never the file.
  if (moduleBucket.length > 0) {
    const residualLines = moduleBucket
      .map((r) => clampLine(r.line, totalLines))
      .sort((a, b) => a - b);
    const startLine = residualLines[0] ?? 1;
    const endLine = residualLines[residualLines.length - 1] ?? startLine;
    const referencedLines = unionSorted(importLineNumbers, residualLines);
    const context = pickLines(lines, referencedLines);
    chunks.push({
      chunkId: `${path}#${startLine}-${endLine}`,
      path,
      residuals: moduleBucket,
      span: { startLine, endLine },
      context,
    });
  }

  // Deterministic order: ascending by start line, then end line.
  chunks.sort(
    (a, b) =>
      a.span.startLine - b.span.startLine || a.span.endLine - b.span.endLine,
  );
  return chunks;
}

// ---------------------------------------------------------------------------
// Internal helpers (pure)
// ---------------------------------------------------------------------------

/** A top-level def/class span, 1-based inclusive line numbers. */
interface Unit {
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Collect the top-level `function_definition`/`class_definition` spans, each as
 * a 1-based inclusive `{ startLine, endLine }`. Nested defs stay inside their
 * enclosing top-level unit — the whole unit body is the chunk — so the spans
 * are non-overlapping and ascending.
 */
function topLevelUnits(root: Node, totalLines: number): Unit[] {
  const units: Unit[] = [];
  for (const child of root.namedChildren) {
    if (child === null) continue;
    if (
      child.type === "function_definition" ||
      child.type === "class_definition"
    ) {
      const startLine = child.startPosition.row + 1;
      // endPosition.row is the row of the last character; a trailing newline can
      // place it one past the body, so clamp into the file's real line range.
      const endLine = clampLine(child.endPosition.row + 1, totalLines);
      units.push({ startLine, endLine: Math.max(endLine, startLine) });
    }
  }
  units.sort((a, b) => a.startLine - b.startLine);
  return units;
}

/** The 1-based line numbers of every top-level `import`/`from ... import`. */
function topLevelImportLines(root: Node): number[] {
  const lines: number[] = [];
  for (const child of root.namedChildren) {
    if (child === null) continue;
    if (
      child.type === "import_statement" ||
      child.type === "import_from_statement" ||
      child.type === "future_import_statement"
    ) {
      // An import may span multiple lines (parenthesised list); include each.
      for (let row = child.startPosition.row; row <= child.endPosition.row; row++) {
        lines.push(row + 1);
      }
    }
  }
  return lines;
}

/**
 * The index of the top-level unit whose span contains `line` (1-based), or
 * `null` when the line is module-level (outside every unit).
 */
function enclosingUnitIndex(
  units: readonly Unit[],
  line: number,
): number | null {
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (unit === undefined) continue;
    if (line >= unit.startLine && line <= unit.endLine) return i;
  }
  return null;
}

/**
 * Build a unit chunk: context is the referenced top-level import lines (those
 * OUTSIDE the unit span, so the signature/import context is additive) followed
 * by the unit's own source lines. Always a strict subset of the file.
 */
function buildChunk(
  path: string,
  lines: readonly string[],
  startLine: number,
  endLine: number,
  importLineNumbers: readonly number[],
  residuals: readonly ResidualEntry[],
): ResidualChunk {
  // Imports that sit outside the unit body are prepended as referenced context;
  // imports already inside the unit are carried by the unit lines themselves.
  const referencedImports = importLineNumbers.filter(
    (n) => n < startLine || n > endLine,
  );
  const unitLineNumbers: number[] = [];
  for (let n = startLine; n <= endLine; n++) unitLineNumbers.push(n);
  const contextLineNumbers = unionSorted(referencedImports, unitLineNumbers);
  const context = pickLines(lines, contextLineNumbers);
  return {
    chunkId: `${path}#${startLine}-${endLine}`,
    path,
    residuals,
    span: { startLine, endLine },
    context,
  };
}

/** Clamp a 1-based line into `[1, totalLines]` (empty file => 1). */
function clampLine(line: number, totalLines: number): number {
  const max = Math.max(totalLines, 1);
  if (line < 1) return 1;
  if (line > max) return max;
  return line;
}

/** Sorted union of two 1-based line-number lists, de-duplicated. */
function unionSorted(a: readonly number[], b: readonly number[]): number[] {
  const set = new Set<number>();
  for (const n of a) set.add(n);
  for (const n of b) set.add(n);
  return [...set].sort((x, y) => x - y);
}

/**
 * Join the file lines named by `lineNumbers` (1-based) in order. Out-of-range
 * numbers are skipped, so the result is always a subset of the file's lines.
 */
function pickLines(
  lines: readonly string[],
  lineNumbers: readonly number[],
): string {
  const picked: string[] = [];
  for (const n of lineNumbers) {
    const text = lines[n - 1];
    if (text !== undefined) picked.push(text);
  }
  return picked.join("\n");
}
