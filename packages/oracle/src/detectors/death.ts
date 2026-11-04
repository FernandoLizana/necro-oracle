// src/detectors/death.ts
//
// The Death (XIII — Dead Code) detector.
//
// A pure, synchronous Detector that builds an intra-repository import graph
// from the PRE-PARSED trees in `opts.trees` (it never calls parsePython on
// snapshot file trees) and skips any path listed in `opts.parseErrors`. It
// surfaces three kinds of rot:
//   - unreachable modules: python files never imported by any OTHER snapshot
//     file and not an entrypoint candidate;
//   - unused public top-level symbols: functions/classes defined in one file
//     but never referenced by name in any OTHER file;
//   - large commented-out valid-Python blocks: runs of >= 5 consecutive comment
//     lines that, once de-commented, parse as valid Python.
//
// See design.md ("detectDeath — XIII The Death (Dead Code)") and requirements
// R8.1–R8.5.
//
// Note on parsePython: detectors never call parsePython on snapshot file trees
// (those arrive pre-parsed via opts.trees). The commented-out-block validity
// check (R8.4) operates on reconstructed text that has no tree-sitter tree, so
// it calls parsePython on that de-commented text — this is the practical and
// intended validity check and does not re-parse any snapshot file.

import type { CardDraw, Evidence } from "../registry/schema.js";
import { parsePython, type Tree } from "../parser/tree-sitter.js";
import type { Manifest } from "../parser/manifest.js";
import type { RepoSnapshot } from "../snapshot/types.js";
import type { Detector } from "./types.js";

type Node = import("web-tree-sitter").Node;

// --- constants -----------------------------------------------------------

/** No grimoire is wired to remediate dead code directly. */
const DEATH_GRIMOIRES: readonly string[] = [];

/** Evidence cap for both unreachable-module and unused-symbol lists (R8.2/R8.3). */
const EVIDENCE_CAP = 20;

/** Threshold of unused public symbols that constitutes a severity-2 signal. */
const UNUSED_SYMBOL_THRESHOLD = 5;

/** Minimum run length of consecutive comment lines to count as a block (R8.4). */
const COMMENT_BLOCK_MIN_LINES = 5;

/** File basenames that are always treated as runnable entrypoints (R8.2). */
const ENTRYPOINT_BASENAMES: ReadonlySet<string> = new Set([
  "__main__.py",
  "manage.py",
  "wsgi.py",
  "asgi.py",
  "app.py",
  "run.py",
]);

// --- path / module helpers ----------------------------------------------

/** Final path segment (basename), normalising both separator styles. */
function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Directory portion of a path (everything before the final segment), or "". */
function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

/**
 * Candidate snapshot file paths a dotted module name could resolve to. For a
 * module `pkg.mod` relative to a base package directory `baseDir`, this yields
 * `<baseDir>/pkg/mod.py` and `<baseDir>/pkg/mod/__init__.py` (and the same with
 * no base directory, i.e. repo root).
 */
function candidatePaths(moduleDots: string, baseDir: string): string[] {
  const rel = moduleDots.split(".").join("/");
  const prefix = baseDir.length > 0 ? `${baseDir}/` : "";
  return [`${prefix}${rel}.py`, `${prefix}${rel}/__init__.py`];
}

/**
 * Resolve a (possibly relative) module reference against the importing file to
 * a snapshot file path, or null when it resolves to nothing in the snapshot
 * (i.e. the module is external).
 *
 * @param moduleDots  Dotted module path with leading dots already stripped,
 *                    e.g. "helpers", "pkg.mod". May be "" for `from . import x`.
 * @param relativeLevel Number of leading dots on the import (0 = absolute,
 *                    1 = current package, 2 = parent package, ...).
 * @param importerPath The path of the file doing the importing.
 * @param fileSet     The set of all snapshot file paths (python files).
 */
function resolveModule(
  moduleDots: string,
  relativeLevel: number,
  importerPath: string,
  fileSet: ReadonlySet<string>,
): string | null {
  if (relativeLevel > 0) {
    // Relative import: resolve against the importer's package directory,
    // walking up one directory per extra leading dot beyond the first.
    let baseDir = dirname(importerPath);
    for (let up = 1; up < relativeLevel; up++) {
      baseDir = dirname(baseDir);
    }
    if (moduleDots.length === 0) {
      // `from . import name` — the package itself; nothing module-specific to
      // resolve to a single file, so treat as internal-but-unresolved.
      return null;
    }
    for (const candidate of candidatePaths(moduleDots, baseDir)) {
      if (fileSet.has(candidate)) return candidate;
    }
    return null;
  }

  // Absolute import. Try, in order: relative to the importer's own directory
  // (implicit-relative, py2 style and common in flat repos), then repo root.
  const importerDir = dirname(importerPath);
  if (importerDir.length > 0) {
    for (const candidate of candidatePaths(moduleDots, importerDir)) {
      if (fileSet.has(candidate)) return candidate;
    }
  }
  for (const candidate of candidatePaths(moduleDots, "")) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

// --- import extraction ---------------------------------------------------

/**
 * A single imported module reference extracted from an import statement:
 * its dotted name (leading dots stripped) and the relative-import level.
 */
interface ImportRef {
  readonly moduleDots: string;
  readonly relativeLevel: number;
}

/**
 * Parse a `dotted_name` / `relative_import` style node's text into an
 * ImportRef. Leading dots denote relative imports.
 */
function importRefFromText(text: string): ImportRef {
  let relativeLevel = 0;
  let rest = text;
  while (rest.startsWith(".")) {
    relativeLevel += 1;
    rest = rest.slice(1);
  }
  return { moduleDots: rest.trim(), relativeLevel };
}

/**
 * Collect the module references imported by a single file's tree.
 *
 *   import a.b.c            → a.b.c
 *   import a.b as x         → a.b
 *   from a.b import c, d    → a.b
 *   from . import x         → "" (level 1)
 *   from ..pkg import y     → pkg (level 2)
 */
function collectImports(tree: Tree): ImportRef[] {
  const refs: ImportRef[] = [];
  const cursor = tree.walk();
  try {
    for (;;) {
      const node = cursor.currentNode;

      if (node.type === "import_statement") {
        // `import a.b, c.d` — one or more dotted_name / aliased_import names.
        for (const child of node.namedChildren) {
          if (child === null) continue;
          if (child.type === "dotted_name") {
            refs.push(importRefFromText(child.text));
          } else if (child.type === "aliased_import") {
            const nameNode = child.childForFieldName("name");
            if (nameNode !== null) refs.push(importRefFromText(nameNode.text));
          }
        }
      } else if (node.type === "import_from_statement") {
        // The module name sits in the `module_name` field. For relative
        // imports it may be a `relative_import` node whose text carries the
        // leading dots (and an optional dotted_name tail).
        const moduleNode = node.childForFieldName("module_name");
        if (moduleNode !== null) {
          refs.push(importRefFromText(moduleNode.text));
        } else {
          // `from . import x` with no explicit module_name field: reconstruct
          // the relative level from leading `.`/`...` import_prefix tokens.
          const prefix = node.children
            .filter((c): c is Node => c !== null && c.type === "import_prefix")
            .map((c) => c.text)
            .join("");
          if (prefix.length > 0) {
            refs.push(importRefFromText(prefix));
          }
        }
      }

      if (cursor.gotoFirstChild()) continue;
      for (;;) {
        if (cursor.gotoNextSibling()) break;
        if (!cursor.gotoParent()) return refs;
      }
    }
  } finally {
    cursor.delete();
  }
}

// --- top-level symbol extraction ----------------------------------------

/** A public top-level function/class definition in a file. */
interface TopLevelSymbol {
  readonly name: string;
  readonly line: number; // 1-based line of the definition.
}

/**
 * Extract public (name not starting with `_`) top-level function and class
 * definitions from a module tree. Only direct children of the `module` root
 * are considered top-level.
 */
function topLevelSymbols(tree: Tree): TopLevelSymbol[] {
  const symbols: TopLevelSymbol[] = [];
  const root = tree.rootNode;
  for (const child of root.namedChildren) {
    if (child === null) continue;
    if (
      child.type === "function_definition" ||
      child.type === "class_definition"
    ) {
      const nameNode = child.childForFieldName("name");
      if (nameNode === null) continue;
      const name = nameNode.text;
      if (name.startsWith("_")) continue; // non-public → skip.
      symbols.push({ name, line: child.startPosition.row + 1 });
    }
  }
  return symbols;
}

/**
 * Collect every identifier text that appears in a file's tree. Used to decide
 * whether a symbol defined in one file is referenced BY NAME in another.
 */
function identifierNames(tree: Tree): Set<string> {
  const names = new Set<string>();
  const cursor = tree.walk();
  try {
    for (;;) {
      const node = cursor.currentNode;
      if (node.type === "identifier") {
        names.add(node.text);
      }
      if (cursor.gotoFirstChild()) continue;
      for (;;) {
        if (cursor.gotoNextSibling()) break;
        if (!cursor.gotoParent()) return names;
      }
    }
  } finally {
    cursor.delete();
  }
}

// --- commented-out block detection --------------------------------------

/** A detected large commented-out valid-Python block. */
interface CommentBlock {
  readonly path: string;
  readonly startLine: number; // 1-based line of the first comment line.
}

/** Strip a single leading `#` (and an optional following space) from a line. */
function stripCommentMarker(line: string): string {
  // Preserve indentation after the marker: match leading whitespace, then the
  // '#', then an optional single space.
  const match = /^(\s*)#\s?(.*)$/.exec(line);
  if (match === null) return line;
  return `${match[1] ?? ""}${match[2] ?? ""}`;
}

/** True when a line is a comment line (optional leading whitespace then `#`). */
function isCommentLine(line: string): boolean {
  return /^\s*#/.test(line);
}

/** True when parsing the given text yields a tree with no ERROR node. */
function parsesCleanly(text: string): boolean {
  let tree: Tree;
  try {
    tree = parsePython(text);
  } catch {
    return false;
  }
  try {
    return !treeHasError(tree.rootNode);
  } finally {
    tree.delete();
  }
}

/** Depth-first check for any ERROR node (or an otherwise-errored tree). */
function treeHasError(root: Node): boolean {
  // hasError covers missing/error descendants in one call when available.
  if (root.hasError) return true;
  // Belt-and-suspenders: explicit scan for a literal ERROR node type.
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;
    if (node.type === "ERROR") return true;
    for (const child of node.children) {
      if (child !== null) stack.push(child);
    }
  }
  return false;
}

/**
 * Find large commented-out valid-Python blocks in a file's raw source. A block
 * is a run of >= 5 consecutive comment lines which, once de-commented and
 * joined, parses as valid Python with no ERROR node.
 */
function commentBlocksInSource(path: string, source: string): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  const lines = source.split(/\r?\n/);

  let i = 0;
  while (i < lines.length) {
    if (!isCommentLine(lines[i] ?? "")) {
      i += 1;
      continue;
    }
    // Accumulate the maximal run of consecutive comment lines.
    const runStart = i;
    const runLines: string[] = [];
    while (i < lines.length && isCommentLine(lines[i] ?? "")) {
      runLines.push(lines[i] ?? "");
      i += 1;
    }
    if (runLines.length < COMMENT_BLOCK_MIN_LINES) continue;

    const decommented = runLines.map(stripCommentMarker).join("\n");
    // A de-commented block that is entirely blank/whitespace is not code.
    if (decommented.trim().length === 0) continue;
    if (parsesCleanly(decommented)) {
      blocks.push({ path, startLine: runStart + 1 });
    }
  }

  return blocks;
}

// --- entrypoint detection ------------------------------------------------

/**
 * Build the set of python file paths that are entrypoint candidates: files
 * whose basename is a well-known entrypoint, plus any path referenced by an
 * entry-point field in setup.py / pyproject.toml manifests.
 */
function entrypointPaths(
  snapshot: RepoSnapshot,
  pythonPaths: ReadonlySet<string>,
): Set<string> {
  const entrypoints = new Set<string>();

  // Basename signal (primary).
  for (const path of pythonPaths) {
    if (ENTRYPOINT_BASENAMES.has(basename(path))) {
      entrypoints.add(path);
    }
  }

  // Manifest entry-point fields (secondary). We scan the raw manifest data for
  // any string that looks like a module reference and map resolvable modules to
  // their snapshot file path. This is best-effort; the basename signal above is
  // the primary mechanism the tests exercise.
  const manifests = snapshot.manifests as Manifest[];
  for (const manifest of manifests) {
    if (manifest.raw === undefined) continue;
    for (const value of collectEntryPointStrings(manifest.raw)) {
      // Entry-point targets look like "pkg.module:func" — take the module part.
      const moduleDots = (value.split(":")[0] ?? "").trim();
      if (moduleDots.length === 0) continue;
      for (const candidate of candidatePaths(moduleDots, "")) {
        if (pythonPaths.has(candidate)) entrypoints.add(candidate);
      }
    }
  }

  return entrypoints;
}

/** Keys under which entry-point style strings may live in parsed manifests. */
const ENTRY_POINT_KEYS: ReadonlySet<string> = new Set([
  "entry_points",
  "entry-points",
  "scripts",
  "console_scripts",
  "gui_scripts",
]);

/**
 * Recursively gather entry-point target strings from a manifest's raw data,
 * looking under common entry-point keys (setup.py `entry_points`, pyproject
 * `[project.scripts]` / `[project.entry-points]`, `[options.entry_points]`).
 */
function collectEntryPointStrings(raw: Record<string, unknown>): string[] {
  const out: string[] = [];
  const visit = (value: unknown, underEntryKey: boolean): void => {
    if (typeof value === "string") {
      if (underEntryKey) out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, underEntryKey);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value)) {
        visit(child, underEntryKey || ENTRY_POINT_KEYS.has(key));
      }
    }
  };
  visit(raw, false);
  return out;
}

// --- detector ------------------------------------------------------------

export const detectDeath: Detector = (
  snapshot: RepoSnapshot,
  opts,
): CardDraw | null => {
  // 1) The set of python files we can actually analyse: parsed trees only
  //    (skip parse errors and oversize/absent content).
  const analysed: { path: string; tree: Tree }[] = [];
  const pythonPaths = new Set<string>();
  for (const file of snapshot.files) {
    if (file.lang !== "python") continue;
    pythonPaths.add(file.path);
    if (opts.parseErrors.has(file.path)) continue;
    const tree = opts.trees.get(file.path);
    if (tree === undefined) continue;
    analysed.push({ path: file.path, tree });
  }

  // 2) Build the intra-repo import graph: a module is "imported" if some OTHER
  //    file resolves an import to it.
  const importedByOther = new Set<string>();
  for (const { path, tree } of analysed) {
    for (const ref of collectImports(tree)) {
      const target = resolveModule(
        ref.moduleDots,
        ref.relativeLevel,
        path,
        pythonPaths,
      );
      if (target !== null && target !== path) {
        importedByOther.add(target);
      }
    }
  }

  // 3) Unreachable modules: analysed python files never imported by another and
  //    not an entrypoint candidate (R8.2).
  const entrypoints = entrypointPaths(snapshot, pythonPaths);
  const unreachable: string[] = [];
  for (const { path } of analysed) {
    if (importedByOther.has(path)) continue;
    if (entrypoints.has(path)) continue;
    unreachable.push(path);
  }
  unreachable.sort((a, b) => a.localeCompare(b));

  // 4) Unused public top-level symbols: defined in one file, never referenced
  //    by name in any OTHER file (R8.3).
  const symbolsByFile = new Map<string, TopLevelSymbol[]>();
  const namesByFile = new Map<string, Set<string>>();
  for (const { path, tree } of analysed) {
    symbolsByFile.set(path, topLevelSymbols(tree));
    namesByFile.set(path, identifierNames(tree));
  }

  const unusedSymbols: { name: string; path: string; line: number }[] = [];
  for (const { path } of analysed) {
    const symbols = symbolsByFile.get(path) ?? [];
    for (const symbol of symbols) {
      let referencedElsewhere = false;
      for (const [otherPath, names] of namesByFile) {
        if (otherPath === path) continue;
        if (names.has(symbol.name)) {
          referencedElsewhere = true;
          break;
        }
      }
      if (!referencedElsewhere) {
        unusedSymbols.push({ name: symbol.name, path, line: symbol.line });
      }
    }
  }
  // Order by file path then line (R8.3).
  unusedSymbols.sort(
    (a, b) => a.path.localeCompare(b.path) || a.line - b.line,
  );

  // 5) Large commented-out valid-Python blocks (R8.4).
  const commentBlocks: CommentBlock[] = [];
  for (const { path } of analysed) {
    const source = snapshot.contents.get(path);
    if (source === undefined) continue;
    commentBlocks.push(...commentBlocksInSource(path, source));
  }
  commentBlocks.sort(
    (a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine,
  );

  // 6) Orientation rules (R8.2–R8.5).
  const hasUnreachable = unreachable.length > 0;
  const hasEnoughUnused = unusedSymbols.length >= UNUSED_SYMBOL_THRESHOLD;
  const hasSeverity2Signal = hasUnreachable || hasEnoughUnused;
  const hasBlocks = commentBlocks.length > 0;

  // Nothing found → null (R8.5).
  if (!hasSeverity2Signal && !hasBlocks) {
    return null;
  }

  const evidence: Evidence[] = [];

  // Unreachable-module evidence, capped at 20 lexicographic paths.
  for (const path of unreachable.slice(0, EVIDENCE_CAP)) {
    evidence.push({
      kind: "unreachable_module",
      path,
      detail: `Module ${path} is never imported by any other file and is not an entrypoint.`,
      source: "static",
    });
  }

  // Unused-symbol evidence (only surfaced as a severity-2 driver at >= 5), but
  // when it drives severity we include up to 20 ordered items. Symbols that
  // live inside an already-reported unreachable module are redundant (the whole
  // module is dead), so exclude them to avoid double-counting the same file.
  if (hasEnoughUnused) {
    const unreachableSet = new Set(unreachable);
    const reportableUnused = unusedSymbols.filter(
      (sym) => !unreachableSet.has(sym.path),
    );
    for (const sym of reportableUnused.slice(0, EVIDENCE_CAP)) {
      evidence.push({
        kind: "unused_symbol",
        path: sym.path,
        line: sym.line,
        detail: `Public top-level symbol ${sym.name} in ${sym.path} is never referenced by name in any other file.`,
        source: "static",
      });
    }
  }

  // Commented-out-block evidence — always added when present (as the sole
  // signal at severity 1, or as additional evidence at severity 2).
  if (hasBlocks) {
    for (const block of commentBlocks.slice(0, EVIDENCE_CAP)) {
      evidence.push({
        kind: "commented_out_code",
        path: block.path,
        line: block.startLine,
        detail: `Large commented-out code block in ${block.path} starting at line ${block.startLine}.`,
        source: "static",
      });
    }
  }

  let severity: CardDraw["severity"];
  let orientation: CardDraw["orientation"];
  let summary: string;

  if (hasSeverity2Signal) {
    severity = 2;
    orientation = "upright";
    summary =
      "Dead code festers in the repository: modules no living path reaches, or " +
      "public symbols nothing ever calls. The corpse carries weight it no longer uses.";
  } else {
    // Only commented-out blocks, no severity-2 signal → severity 1 reversed.
    severity = 1;
    orientation = "reversed";
    summary =
      "Ghosts of old code linger in large commented-out blocks — valid Python " +
      "entombed behind hash marks, neither alive nor fully buried.";
  }

  return {
    card: "death",
    severity,
    orientation,
    evidence,
    summary,
    grimoires: [...DEATH_GRIMOIRES],
  };
};
