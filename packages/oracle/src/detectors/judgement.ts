// src/detectors/judgement.ts
//
// XX — The Judgement (Dead Runtime) detector.
//
// A pure, synchronous Detector that finds Python 2 runtime remnants in a
// repository snapshot. It consumes the PRE-PARSED trees from `opts.trees`
// (never calling parsePython itself) and skips any path recorded in
// `opts.parseErrors`. Python-version signals from the parsed manifests
// (`detectPythonVersion`) decide how fiercely the card burns.
//
// See design.md ("detectJudgement — XX The Judgement (Dead Runtime)") and
// requirements R5.1–R5.6:
//   R5.1 py2 syntax (print_statement, etc.) in python files → judgement drawn
//   R5.2 py2-only manifests (classifiers / python_requires) → severity 3 upright
//   R5.3 six / __future__ / 2to3 straddling alongside py2 syntax → severity 1
//        reversed; PRECEDENCE over R5.2
//   R5.4 one Evidence item per construct type, path + line of first occurrence
//   R5.5 no python files AND no python manifests → null
//   R5.6 linkedGrimoireIds = ["py2to3","pyproject"] (exposed via grimoires)

import type { CardDraw, Evidence } from "../registry/schema.js";
import { detectPythonVersion, type Manifest } from "../parser/manifest.js";
import { hasLegacyPythonNodes, type Tree } from "../parser/tree-sitter.js";
import type { RepoSnapshot } from "../snapshot/types.js";
import type { Detector } from "./types.js";

import type { Node } from "web-tree-sitter";

// --- constants -----------------------------------------------------------

/** Grimoires that can address a dead-runtime verdict (R5.6). */
const JUDGEMENT_GRIMOIRES = ["py2to3", "pyproject"] as const;

/**
 * Path fragments for vendored / toolchain trees whose Python files are never
 * the project's own runtime. Matched as a substring (covering `a/vendor/b`) and
 * as a leading segment (covering `vendor/b`).
 */
const EXCLUDED_SEGMENTS = [
  "vendor",
  ".tox",
  "node_modules",
  "site-packages",
] as const;

/**
 * A single Python 2 construct kind we can surface as evidence, paired with the
 * predicate that recognises its tree-sitter node. Order fixes a deterministic
 * evidence ordering across the detector's output.
 */
interface ConstructKind {
  readonly kind: string;
  readonly detail: string;
  readonly matches: (node: Node) => boolean;
}

const CONSTRUCT_KINDS: readonly ConstructKind[] = [
  {
    kind: "print_statement",
    detail: "Python 2 print statement",
    matches: (node) => node.type === "print_statement",
  },
  {
    kind: "exec_statement",
    detail: "Python 2 exec statement",
    matches: (node) => node.type === "exec_statement",
  },
  {
    kind: "except_comma",
    detail: "Python 2 comma-style except clause (`except E, e:`)",
    matches: (node) =>
      node.type === "except_clause" &&
      node.children.some((child) => child !== null && child.type === ","),
  },
  {
    kind: "ne_operator",
    detail: "Python 2 `<>` inequality operator",
    matches: (node) =>
      node.type === "comparison_operator" &&
      node.children.some((child) => child !== null && child.type === "<>"),
  },
  {
    kind: "long_integer",
    detail: "Python 2 long-integer literal (e.g. `10L`)",
    matches: (node) => node.type === "integer" && /[Ll]$/.test(node.text),
  },
  {
    kind: "legacy_octal",
    detail: "Python 2 legacy octal literal (e.g. `0777`)",
    matches: (node) => node.type === "integer" && /^0[0-7]+$/.test(node.text),
  },
  {
    kind: "backtick_repr",
    detail: "Python 2 backtick repr (`` `x` ``)",
    matches: (node) =>
      (node.isNamed || node.type === "ERROR") && node.text.startsWith("`"),
  },
];

// --- helpers -------------------------------------------------------------

/** True when a path lives under a vendored / toolchain directory. */
function isExcludedPath(path: string): boolean {
  return EXCLUDED_SEGMENTS.some(
    (segment) =>
      path.includes(`/${segment}/`) || path.startsWith(`${segment}/`),
  );
}

/**
 * Walk a parsed tree once and record, per construct kind, the first node that
 * matches it (first occurrence in document order). Returns a map from kind to
 * its first matching node.
 */
function firstOccurrences(tree: Tree): Map<string, Node> {
  const found = new Map<string, Node>();
  const cursor = tree.walk();
  try {
    for (;;) {
      const node = cursor.currentNode;
      for (const construct of CONSTRUCT_KINDS) {
        if (!found.has(construct.kind) && construct.matches(node)) {
          found.set(construct.kind, node);
        }
      }

      if (cursor.gotoFirstChild()) continue;
      for (;;) {
        if (cursor.gotoNextSibling()) break;
        if (!cursor.gotoParent()) return found;
      }
    }
  } finally {
    cursor.delete();
  }
}

/**
 * True when a file's source shows py2/py3 straddling intent: a `six` import, a
 * `from __future__ import ...` statement, or a `2to3` shim reference. These
 * signal a migration already in progress (R5.3).
 */
function isStraddlingSource(source: string): boolean {
  return (
    /^\s*import\s+six(\s|$|\.)/m.test(source) ||
    /^\s*from\s+six(\s|\.)/m.test(source) ||
    /^\s*from\s+__future__\s+import\s+/m.test(source) ||
    /2to3/.test(source)
  );
}

/** True when a manifest describes Python packaging (not package.json). */
function isPythonManifest(manifest: Manifest): boolean {
  return (
    manifest.kind === "requirements_txt" ||
    manifest.kind === "setup_py" ||
    manifest.kind === "pyproject_toml" ||
    manifest.kind === "pipfile"
  );
}

// --- detector ------------------------------------------------------------

export const detectJudgement: Detector = (
  snapshot: RepoSnapshot,
  opts,
): CardDraw | null => {
  const manifests = snapshot.manifests as Manifest[];
  const hasPythonManifest = manifests.some(isPythonManifest);

  // 1) Collect non-excluded Python files.
  const pythonFiles = snapshot.files.filter(
    (file) => file.lang === "python" && !isExcludedPath(file.path),
  );

  // R5.5: no python files (after exclusions) AND no python manifests → null.
  if (pythonFiles.length === 0 && !hasPythonManifest) {
    return null;
  }

  // 2) Scan every parsed, non-error tree for py2 constructs and gather evidence
  //    (one item per construct kind, at its first occurrence path + line).
  const evidence: Evidence[] = [];
  let anyLegacySyntax = false;
  let anyStraddling = false;

  for (const file of pythonFiles) {
    if (opts.parseErrors.has(file.path)) continue; // could not be parsed.
    const tree = opts.trees.get(file.path);
    if (tree === undefined) continue; // oversize / absent content.

    if (!hasLegacyPythonNodes(tree)) continue;
    anyLegacySyntax = true;

    const occurrences = firstOccurrences(tree);
    for (const construct of CONSTRUCT_KINDS) {
      const node = occurrences.get(construct.kind);
      if (node === undefined) continue;
      evidence.push({
        kind: construct.kind,
        path: file.path,
        line: node.startPosition.row + 1, // 1-based.
        detail: `${construct.detail} in ${file.path}`,
        source: "static",
      });
    }

    // Straddling intent is read from the raw source of a file that already
    // carries py2 syntax.
    const source = snapshot.contents.get(file.path);
    if (source !== undefined && isStraddlingSource(source)) {
      anyStraddling = true;
    }
  }

  // No py2 syntax found anywhere → the runtime is not (visibly) dead.
  if (!anyLegacySyntax) {
    return null;
  }

  // 3) Manifest signal for the version constraint.
  const versionSignal = detectPythonVersion(manifests);

  // 4) Orientation rules, in precedence order.
  let severity: CardDraw["severity"];
  let orientation: CardDraw["orientation"];
  let summary: string;

  if (anyStraddling) {
    // R5.3 — straddling wins over py2-only manifests.
    severity = 1;
    orientation = "reversed";
    summary =
      "The runtime straddles two worlds: Python 2 syntax lingers beside six / " +
      "__future__ shims. A migration has begun but is not yet complete.";
  } else if (versionSignal === "py2_only") {
    // R5.2 — manifests pin the package to Python 2 only.
    severity = 3;
    orientation = "upright";
    summary =
      "The runtime is dead: Python 2 syntax burns in the code and the " +
      "manifests pin the package to Python 2 only.";
  } else {
    // R5.1 — py2 syntax with no manifest constraint.
    severity = 2;
    orientation = "upright";
    summary =
      "Python 2 syntax haunts the code; the runtime cannot rise on a modern " +
      "interpreter without resurrection.";
  }

  return {
    card: "judgement",
    severity,
    orientation,
    evidence,
    summary,
    grimoires: [...JUDGEMENT_GRIMOIRES],
  };
};
