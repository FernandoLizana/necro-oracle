// src/detectors/hermit.ts
//
// The Hermit (IX — Missing Documentation) detector.
//
// A pure, synchronous Detector that reports on absent or thin documentation.
// It reads README content from `snapshot.contents` and computes docstring
// coverage from the PRE-PARSED trees in `opts.trees` — it never calls
// parsePython itself. Any Python path recorded in `opts.parseErrors` is
// skipped for coverage and surfaced as a parse-error evidence item.
//
// See design.md ("detectHermit — IX The Hermit (Missing Documentation)") and
// requirements R10.1–R10.5:
//   R10.1 root README matched case-insensitively (no "/" in path), first
//         lexicographic match used.
//   R10.2 no root README → severity 2 upright.
//   R10.3 README < 200 bytes OR missing every keyword (install / usage /
//         getting started / quickstart) → severity 1 reversed, with evidence
//         naming which sub-condition triggered.
//   R10.4 docstring coverage < 0.25 with >= 4 public top-level symbols → a
//         docstring-coverage evidence item (regardless of orientation);
//         unparseable py file → parse-error evidence item + excluded from the
//         coverage denominator.
//   R10.5 healthy README (>= 200 bytes AND a keyword) + adequate coverage
//         (>= 0.25 OR < 4 public symbols) → null.

import type { CardDraw, Evidence } from "../registry/schema.js";
import type { Tree } from "../parser/tree-sitter.js";
import type { RepoSnapshot } from "../snapshot/types.js";
import type { Detector } from "./types.js";

type Node = import("web-tree-sitter").Node;

// --- constants -----------------------------------------------------------

/** Case-insensitive root README filenames we recognise (R10.1). */
const README_NAMES: readonly string[] = [
  "readme",
  "readme.md",
  "readme.rst",
  "readme.txt",
  "readme.adoc",
];

/** Minimum README size, in UTF-8 bytes, before it reads as substantive. */
const MIN_README_BYTES = 200;

/** Documentation keywords a healthy README is expected to contain (R10.3). */
const README_KEYWORDS: readonly string[] = [
  "install",
  "usage",
  "getting started",
  "quickstart",
];

/** Below this docstring ratio, coverage is considered inadequate (R10.4). */
const MIN_COVERAGE_RATIO = 0.25;

/** Coverage only matters once this many public symbols exist (R10.4). */
const MIN_PUBLIC_SYMBOLS = 4;

// --- helpers -------------------------------------------------------------

/** True when a path has no "/" — i.e. it lives at the repository root. */
function isRootPath(path: string): boolean {
  return !path.includes("/");
}

/**
 * Find the root README path, matched case-insensitively against README_NAMES.
 * When several root files match, the first in lexicographic order of the
 * actual path is returned (R10.1). Returns undefined when none is found.
 */
function findRootReadme(snapshot: RepoSnapshot): string | undefined {
  const matches = snapshot.files
    .map((file) => file.path)
    .filter(
      (path) => isRootPath(path) && README_NAMES.includes(path.toLowerCase()),
    )
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return matches[0];
}

/** True when the content contains any documentation keyword (R10.3). */
function hasReadmeKeyword(content: string): boolean {
  const lower = content.toLowerCase();
  return README_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/**
 * Count public top-level functions/classes in a parsed tree and how many carry
 * a leading docstring. A symbol is public when its name does not start with
 * "_". A symbol is documented when the first statement of its body is an
 * expression statement wrapping a string literal.
 */
function coverageOf(tree: Tree): { total: number; documented: number } {
  let total = 0;
  let documented = 0;

  for (const child of tree.rootNode.children) {
    if (child === null) continue;
    if (
      child.type !== "function_definition" &&
      child.type !== "class_definition"
    ) {
      continue;
    }

    const nameNode = child.childForFieldName("name");
    const name = nameNode?.text ?? "";
    if (name === "" || name.startsWith("_")) continue; // non-public / unnamed.

    total += 1;
    if (hasLeadingDocstring(child)) documented += 1;
  }

  return { total, documented };
}

/**
 * True when the first statement in a definition's body is a docstring: an
 * `expression_statement` whose first named child is a `string`.
 */
function hasLeadingDocstring(definition: Node): boolean {
  const body = definition.childForFieldName("body");
  if (body === null) return false;

  // The first named statement in the block is the candidate docstring.
  const firstStatement = body.namedChildren.find((n) => n !== null) ?? null;
  if (firstStatement === null) return false;
  if (firstStatement.type !== "expression_statement") return false;

  const expr = firstStatement.namedChildren.find((n) => n !== null) ?? null;
  return expr !== null && expr.type === "string";
}

// --- detector ------------------------------------------------------------

export const detectHermit: Detector = (
  snapshot: RepoSnapshot,
  opts,
): CardDraw | null => {
  const evidence: Evidence[] = [];

  // 1) Root README (R10.1).
  const readmePath = findRootReadme(snapshot);

  // 2) No root README → severity 2 upright (R10.2).
  if (readmePath === undefined) {
    return {
      card: "hermit",
      severity: 2,
      orientation: "upright",
      evidence: [
        {
          kind: "no-readme",
          detail:
            "No README lives at the repository root; the project keeps its silence.",
          source: "static",
        },
      ],
      summary:
        "The Hermit walks alone: this repository has no README at its root, " +
        "leaving every traveller to guess at its purpose.",
      grimoires: [],
    };
  }

  // 3) README health: size and keyword sub-conditions (R10.3).
  const content = snapshot.contents.get(readmePath) ?? "";
  const byteLength = Buffer.byteLength(content, "utf8");
  const tooShort = byteLength < MIN_README_BYTES;
  const missingKeyword = !hasReadmeKeyword(content);

  if (tooShort) {
    evidence.push({
      kind: "readme-too-short",
      path: readmePath,
      detail: `The README is only ${byteLength} bytes; a short, small scroll under ${MIN_README_BYTES} bytes cannot guide the living.`,
      source: "static",
    });
  }
  if (missingKeyword) {
    evidence.push({
      kind: "readme-missing-keyword",
      path: readmePath,
      detail:
        "The README names no keyword among install / usage / getting started / quickstart; the reader is left without a path.",
      source: "static",
    });
  }

  const readmeReversed = tooShort || missingKeyword;

  // 4) Docstring coverage over the parsed trees (R10.4). Parse-error files are
  //    surfaced as evidence and excluded from the coverage denominator.
  let total = 0;
  let documented = 0;

  for (const path of opts.parseErrors.keys()) {
    evidence.push({
      kind: "parse-error",
      path,
      detail: `The scroll at ${path} could not be parsed; its symbols are excluded from the reading.`,
      source: "static",
    });
  }

  for (const file of snapshot.files) {
    if (file.lang !== "python") continue;
    if (opts.parseErrors.has(file.path)) continue; // excluded from denominator.
    const tree = opts.trees.get(file.path);
    if (tree === undefined) continue; // oversize / absent content.

    const { total: fileTotal, documented: fileDocumented } = coverageOf(tree);
    total += fileTotal;
    documented += fileDocumented;
  }

  const ratio = total === 0 ? 1 : documented / total;
  const lowCoverage = ratio < MIN_COVERAGE_RATIO && total >= MIN_PUBLIC_SYMBOLS;

  if (lowCoverage) {
    const pct = Math.round(ratio * 100);
    evidence.push({
      kind: "docstring-coverage",
      detail: `Docstring coverage sits at ${pct}% (${documented}/${total} public top-level symbols documented); the code keeps its meaning hidden.`,
      source: "static",
    });
  }

  // 5) Decide the draw.
  if (readmeReversed) {
    // README sub-condition → severity 1 reversed. The coverage item and any
    // parse-error items remain attached as additional evidence.
    return {
      card: "hermit",
      severity: 1,
      orientation: "reversed",
      evidence,
      summary:
        "The Hermit's lantern burns low: the README is present but thin, " +
        "offering too little light for a newcomer to find their way.",
      grimoires: [],
    };
  }

  // README is healthy. Coverage alone never draws the card upright/reversed in
  // this detector — it only annotates a draw — so a healthy README means null.
  // (R10.5: healthy README + adequate coverage OR < 4 public symbols → null.)
  return null;
};
