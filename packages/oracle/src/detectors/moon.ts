// src/detectors/moon.ts
//
// XVIII — The Moon (Complexity and Illusion) detector.
//
// A pure, synchronous Detector that surfaces three species of confusion from a
// repository snapshot, reading only PRE-PARSED trees (it never calls
// parsePython) and skipping any python path listed in opts.parseErrors:
//   - large files: any file (any language) whose line count exceeds 1,000,
//   - deep nesting: each python file's maximum nesting depth across the seven
//     block-forming node types (function/class/if/for/while/with/try),
//   - confusion markers: lines carrying TODO / FIXME / HACK / XXX
//     (case-insensitive; a line matching several markers counts once).
//
// Rules (R14.4 precedence first):
//   - >= 2 large files OR any nesting depth > 6  → severity 2, upright.
//   - else exactly 1 large file OR >= 1 file with > 10 confusion markers
//     → severity 1, reversed.
//   - else → null.
//
// Evidence records the offending path and the exact number (line count, depth,
// or marker count). See design.md ("detectMoon — XVIII The Moon (Complexity)")
// and requirements R14.1–R14.6.

import type { CardDraw, Evidence } from "../registry/schema.js";
import type { Tree } from "../parser/tree-sitter.js";
import type { RepoSnapshot } from "../snapshot/types.js";
import type { Detector } from "./types.js";


// --- constants -----------------------------------------------------------

/** No grimoire is wired to remediate complexity directly. */
const MOON_GRIMOIRES: readonly string[] = [];

/** A file is "large" when its line count is strictly greater than this. */
const LARGE_FILE_LINES = 1000;

/** Nesting depth strictly greater than this is a severity-2 signal (R14.4). */
const MAX_NESTING_DEPTH = 6;

/** Files with strictly more than this many marker lines are recorded (R14.5). */
const MARKER_LINE_THRESHOLD = 10;

/** Evidence cap per category, so a pathological repo cannot flood the draw. */
const EVIDENCE_CAP = 20;

/** Tree-sitter node types that each add one level of nesting (R14.2). */
const NESTING_NODE_TYPES: ReadonlySet<string> = new Set([
  "function_definition",
  "class_definition",
  "if_statement",
  "for_statement",
  "while_statement",
  "with_statement",
  "try_statement",
]);

/**
 * Confusion markers (R14.3), case-insensitive. A single regex with the global +
 * ignore-case flags lets us test whole lines; because we only ask "does this
 * line contain ANY marker", a line matching several markers is counted once.
 */
const MARKER_REGEX = /\b(?:TODO|FIXME|HACK|XXX)\b/i;

// --- line counting -------------------------------------------------------

/** Physical line count of a text blob, handling both newline styles (R14.1). */
function lineCount(content: string): number {
  return content.split(/\r?\n/).length;
}

// --- nesting depth -------------------------------------------------------

/**
 * Maximum nesting depth of the seven block-forming node types across a tree.
 * Walks every node once, tracking how many ancestors-or-self of a nesting type
 * sit above the current node, and returns the greatest such count seen.
 */
function maxNestingDepth(tree: Tree): number {
  let max = 0;
  const cursor = tree.walk();
  // Running count of nesting nodes on the path from the root to the cursor.
  let depth = 0;
  try {
    for (;;) {
      const node = cursor.currentNode;
      const counts = NESTING_NODE_TYPES.has(node.type);
      if (counts) {
        depth += 1;
        if (depth > max) max = depth;
      }

      if (cursor.gotoFirstChild()) continue;

      // Leaf: before stepping to a sibling / climbing out, undo this node's
      // contribution, and each ancestor's contribution as we climb past it.
      if (counts) depth -= 1;
      for (;;) {
        if (cursor.gotoNextSibling()) break;
        if (!cursor.gotoParent()) return max;
        if (NESTING_NODE_TYPES.has(cursor.currentNode.type)) depth -= 1;
      }
    }
  } finally {
    cursor.delete();
  }
}

// --- confusion markers ---------------------------------------------------

/** Count lines that carry at least one confusion marker (dedup per line). */
function markerLineCount(content: string): number {
  let count = 0;
  for (const line of content.split(/\r?\n/)) {
    if (MARKER_REGEX.test(line)) count += 1;
  }
  return count;
}

// --- detector ------------------------------------------------------------

interface LargeFile {
  readonly path: string;
  readonly lines: number;
}

interface DeepFile {
  readonly path: string;
  readonly depth: number;
}

interface MarkerFile {
  readonly path: string;
  readonly markers: number;
}

export const detectMoon: Detector = (
  snapshot: RepoSnapshot,
  opts,
): CardDraw | null => {
  const largeFiles: LargeFile[] = [];
  const deepFiles: DeepFile[] = [];
  const markerFiles: MarkerFile[] = [];

  for (const file of snapshot.files) {
    const content = snapshot.contents.get(file.path);
    if (content === undefined) continue; // oversize / absent → nothing to read.

    // (1) Large file — language-agnostic, counts every physical line (R14.1).
    const lines = lineCount(content);
    if (lines > LARGE_FILE_LINES) {
      largeFiles.push({ path: file.path, lines });
    }

    // (3) Confusion markers — language-agnostic (R14.3).
    const markers = markerLineCount(content);
    if (markers > MARKER_LINE_THRESHOLD) {
      markerFiles.push({ path: file.path, markers });
    }

    // (2) Nesting depth — python only, from pre-parsed trees, skipping any
    //     file that failed to parse (R14.2). Never calls parsePython.
    if (file.lang !== "python") continue;
    if (opts.parseErrors.has(file.path)) continue;
    const tree = opts.trees.get(file.path);
    if (tree === undefined) continue;
    const depth = maxNestingDepth(tree);
    if (depth > MAX_NESTING_DEPTH) {
      deepFiles.push({ path: file.path, depth });
    }
  }

  // Deterministic ordering for stable evidence output.
  largeFiles.sort((a, b) => a.path.localeCompare(b.path));
  deepFiles.sort((a, b) => a.path.localeCompare(b.path));
  markerFiles.sort((a, b) => a.path.localeCompare(b.path));

  const severity2 = largeFiles.length >= 2 || deepFiles.length > 0;
  const severity1 = largeFiles.length === 1 || markerFiles.length > 0;

  // Nothing found → null (R14.6).
  if (!severity2 && !severity1) {
    return null;
  }

  const evidence: Evidence[] = [];

  // Large-file evidence: path + exact line count (R14.6).
  for (const file of largeFiles.slice(0, EVIDENCE_CAP)) {
    evidence.push({
      kind: "large_file",
      path: file.path,
      detail: `${file.path} spans ${file.lines} lines (over ${LARGE_FILE_LINES}).`,
      source: "static",
    });
  }

  // Deep-nesting evidence: path + exact depth (R14.6).
  for (const file of deepFiles.slice(0, EVIDENCE_CAP)) {
    evidence.push({
      kind: "deep_nesting",
      path: file.path,
      detail: `${file.path} reaches nesting depth ${file.depth} (over ${MAX_NESTING_DEPTH}).`,
      source: "static",
    });
  }

  // Confusion-marker evidence: path + exact marker-line count (R14.6).
  for (const file of markerFiles.slice(0, EVIDENCE_CAP)) {
    evidence.push({
      kind: "confusion_markers",
      path: file.path,
      detail: `${file.path} carries ${file.markers} lines of confusion markers (TODO/FIXME/HACK/XXX).`,
      source: "static",
    });
  }

  if (severity2) {
    return {
      card: "moon",
      severity: 2,
      orientation: "upright",
      evidence,
      summary:
        "A labyrinth under a pale moon: sprawling files and deeply nested " +
        "paths where no reader can keep their bearings.",
      grimoires: [...MOON_GRIMOIRES],
    };
  }

  return {
    card: "moon",
    severity: 1,
    orientation: "reversed",
    evidence,
    summary:
      "Fog lies thick on the path: a single oversized file or a drift of " +
      "unresolved markers clouds the way forward.",
    grimoires: [...MOON_GRIMOIRES],
  };
};
