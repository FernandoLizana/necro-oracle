// src/parser/manifest.ts
//
// Manifest parsing for the Oracle Deck Engine.
//
// parseAllManifests(snapshot) identifies every manifest file in a snapshot
// (requirements*.txt at any depth, setup.py, pyproject.toml, Pipfile,
// package.json), parses each one, and returns one Manifest per file. Parsing is
// total: malformed content yields { parsed:false, parseError, dependencies:[] }
// rather than throwing (R4.6).
//
// setup.py is parsed via the tree-sitter AST only and NEVER executed (R4.2):
// only static literals (string / list-of-string keyword arguments to the
// setup(...) call) are extracted; dynamic (computed) fields are omitted.
//
// detectPythonVersion(manifests) synthesises a Python-version signal in
// priority order: setup.py classifiers > pyproject requires-python > Pipfile
// python_version, falling back to "unknown" (R4.7).
//
// Covers: R4.1, R4.2, R4.3, R4.4, R4.5, R4.6, R4.7, R4.8

import { parse as parseToml } from "smol-toml";
import { z } from "zod";

import type { RepoSnapshot } from "../snapshot/types.js";
import { parsePython, type Tree } from "./tree-sitter.js";

import type { Node } from "web-tree-sitter";

// --- ParsedDependency ---
export const ParsedDependencySchema = z.object({
  name: z.string().min(1),
  versionSpec: z
    .string()
    .describe("Raw specifier as written, e.g. '>=1.2', or '' when absent"),
  extras: z
    .array(z.string())
    .describe("Package extras, e.g. ['security'], empty array when absent"),
});
export type ParsedDependency = z.infer<typeof ParsedDependencySchema>;

// --- PythonVersionSignal ---
export const PythonVersionSignalSchema = z.enum([
  "py2_only",
  "py3_only",
  "straddling",
  "unknown",
]);
export type PythonVersionSignal = z.infer<typeof PythonVersionSignalSchema>;

// --- Manifest ---
export const ManifestKindSchema = z.enum([
  "requirements_txt",
  "setup_py",
  "pyproject_toml",
  "pipfile",
  "package_json",
]);
export type ManifestKind = z.infer<typeof ManifestKindSchema>;

export const ManifestSchema = z.object({
  path: z.string(),
  kind: ManifestKindSchema,
  parsed: z.boolean(),
  parseError: z.string().optional(),
  dependencies: z.array(ParsedDependencySchema),
  raw: z.record(z.unknown()).optional().describe("Kind-specific parsed data"),
});
export type Manifest = z.infer<typeof ManifestSchema>;

// --- file classification --------------------------------------------------

/** Classify a snapshot path as a manifest kind, or null if it is not one. */
function classifyManifest(path: string): ManifestKind | null {
  // Base file name (last path segment), normalising Windows-style separators.
  const base = path.split(/[\\/]/).pop() ?? path;

  if (base === "setup.py") return "setup_py";
  if (base === "pyproject.toml") return "pyproject_toml";
  if (base === "Pipfile") return "pipfile";
  if (base === "package.json") return "package_json";
  // requirements*.txt at any depth: requirements.txt, requirements-dev.txt, ...
  if (/^requirements.*\.txt$/.test(base)) return "requirements_txt";
  return null;
}

// --- requirements*.txt (R4.1) --------------------------------------------

/**
 * Split a requirements line into { name, extras, versionSpec }.
 * Grammar handled: `name[extra1,extra2]<spec>`, with the extras and spec both
 * optional. The version specifier is kept raw (e.g. ">=2.0", "==4.4.7").
 */
function parseRequirementLine(line: string): ParsedDependency | null {
  // Strip inline comments and surrounding whitespace.
  const withoutComment = line.split("#")[0] ?? "";
  const trimmed = withoutComment.trim();
  if (trimmed.length === 0) return null;
  // Skip pip options / includes (-r, -e, --hash, etc.) — not plain deps.
  if (trimmed.startsWith("-")) return null;

  // Match: name, optional [extras], optional version specifier (the rest).
  const match = /^([A-Za-z0-9._-]+)\s*(?:\[([^\]]*)\])?\s*(.*)$/.exec(trimmed);
  if (match === null) return null;

  const name = match[1];
  if (name === undefined || name.length === 0) return null;

  const extras =
    match[2] === undefined
      ? []
      : match[2]
          .split(",")
          .map((e) => e.trim())
          .filter((e) => e.length > 0);

  const versionSpec = (match[3] ?? "").trim();

  return { name, versionSpec, extras };
}

function parseRequirementsTxt(content: string): {
  dependencies: ParsedDependency[];
} {
  const dependencies: ParsedDependency[] = [];
  for (const line of content.split(/\r?\n/)) {
    const dep = parseRequirementLine(line);
    if (dep !== null) dependencies.push(dep);
  }
  return { dependencies };
}

// --- PEP 508 dependency strings (pyproject [project].dependencies) --------

/**
 * Parse a PEP 508-ish dependency string into { name, extras, versionSpec }.
 * Mirrors parseRequirementLine but also drops any environment marker that
 * follows a `;` (e.g. 'requests>=2.28; python_version < "3.8"').
 */
function parsePep508(spec: string): ParsedDependency | null {
  const beforeMarker = spec.split(";")[0] ?? "";
  return parseRequirementLine(beforeMarker);
}

// --- setup.py (R4.2) — AST extraction, never executed --------------------

/** Unquote a tree-sitter `string` node's text to its literal value, or null. */
function stringLiteralValue(node: Node): string | null {
  if (node.type !== "string") return null;
  // Concatenate the content between the start/end quote markers. The grammar
  // exposes `string_start`, `string_content`, and `string_end` children.
  let value = "";
  let sawContent = false;
  for (const child of node.children) {
    if (child === null) continue;
    if (child.type === "string_content") {
      value += child.text;
      sawContent = true;
    } else if (child.type === "escape_sequence") {
      value += child.text;
      sawContent = true;
    }
  }
  if (sawContent) return value;
  // Empty string literal ("" / '') has no string_content child.
  const text = node.text;
  if (text.length >= 2) {
    // Strip a single pair of matching quotes (handles '' and "").
    return text.slice(1, -1);
  }
  return "";
}

/**
 * Extract the list of string-literal values from a tree-sitter `list` node.
 * Returns null if the node is not a list or contains any non-string element
 * (so dynamic lists are treated as "not a static literal").
 */
function stringListValue(node: Node): string[] | null {
  if (node.type !== "list") return null;
  const values: string[] = [];
  for (const child of node.namedChildren) {
    if (child === null) continue;
    const value = stringLiteralValue(child);
    if (value === null) return null; // non-literal element → dynamic list.
    values.push(value);
  }
  return values;
}

/** Find the single top-level `setup(...)` call node, if present. */
function findSetupCall(tree: Tree): Node | null {
  let found: Node | null = null;
  const cursor = tree.walk();
  try {
    for (;;) {
      const node = cursor.currentNode;
      if (node.type === "call") {
        const fn = node.childForFieldName("function");
        if (fn !== null && fn.text === "setup") {
          found = node;
          break;
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
  return found;
}

interface SetupExtraction {
  raw: Record<string, unknown>;
  dependencies: ParsedDependency[];
}

/**
 * Walk the setup(...) call's keyword arguments and extract ONLY static
 * literals: string values and lists of string literals. Dynamic (computed)
 * arguments are omitted entirely. Never executes the file (R4.2).
 */
function extractSetupArgs(call: Node): SetupExtraction {
  const raw: Record<string, unknown> = {};
  const dependencies: ParsedDependency[] = [];

  const args = call.childForFieldName("arguments");
  if (args === null) return { raw, dependencies };

  for (const child of args.namedChildren) {
    if (child === null || child.type !== "keyword_argument") continue;
    const keyNode = child.childForFieldName("name");
    const valueNode = child.childForFieldName("value");
    if (keyNode === null || valueNode === null) continue;
    const key = keyNode.text;

    if (key === "name") {
      const value = stringLiteralValue(valueNode);
      if (value !== null) raw.name = value;
    } else if (key === "version") {
      const value = stringLiteralValue(valueNode);
      if (value !== null) raw.version = value;
    } else if (key === "python_requires") {
      const value = stringLiteralValue(valueNode);
      if (value !== null) raw.python_requires = value;
    } else if (key === "classifiers") {
      const list = stringListValue(valueNode);
      if (list !== null) raw.classifiers = list;
    } else if (key === "install_requires") {
      const list = stringListValue(valueNode);
      if (list !== null) {
        raw.install_requires = list;
        for (const spec of list) {
          const dep = parseRequirementLine(spec);
          if (dep !== null) dependencies.push(dep);
        }
      }
      // Dynamic install_requires (non-literal) → omit entirely.
    }
  }

  return { raw, dependencies };
}

function parseSetupPy(content: string): {
  parsed: boolean;
  parseError?: string;
  raw?: Record<string, unknown>;
  dependencies: ParsedDependency[];
} {
  let tree: Tree;
  try {
    tree = parsePython(content);
  } catch (err) {
    return {
      parsed: false,
      parseError: err instanceof Error ? err.message : String(err),
      dependencies: [],
    };
  }

  try {
    const call = findSetupCall(tree);
    if (call === null) {
      // No setup() call: parsed successfully, but nothing to extract.
      return { parsed: true, raw: {}, dependencies: [] };
    }
    const { raw, dependencies } = extractSetupArgs(call);
    return { parsed: true, raw, dependencies };
  } finally {
    tree.delete();
  }
}

// --- pyproject.toml (R4.3) -----------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePyproject(content: string): {
  parsed: boolean;
  parseError?: string;
  raw?: Record<string, unknown>;
  dependencies: ParsedDependency[];
} {
  let data: unknown;
  try {
    data = parseToml(content);
  } catch (err) {
    return {
      parsed: false,
      parseError: err instanceof Error ? err.message : String(err),
      dependencies: [],
    };
  }

  const raw: Record<string, unknown> = {};
  const dependencies: ParsedDependency[] = [];

  if (!isRecord(data)) {
    return { parsed: true, raw, dependencies };
  }

  // [project] — PEP 621.
  const project = data.project;
  if (isRecord(project)) {
    if (typeof project.name === "string") raw.name = project.name;
    if (typeof project.version === "string") raw.version = project.version;
    if (typeof project["requires-python"] === "string") {
      raw["requires-python"] = project["requires-python"];
    }
    if (Array.isArray(project.dependencies)) {
      for (const spec of project.dependencies) {
        if (typeof spec !== "string") continue;
        const dep = parsePep508(spec);
        if (dep !== null) dependencies.push(dep);
      }
    }
  }

  // [tool.poetry].
  const tool = data.tool;
  const poetry = isRecord(tool) ? tool.poetry : undefined;
  if (isRecord(poetry)) {
    // Poetry's name/version only fill in when [project] did not provide them.
    if (raw.name === undefined && typeof poetry.name === "string") {
      raw.name = poetry.name;
    }
    if (raw.version === undefined && typeof poetry.version === "string") {
      raw.version = poetry.version;
    }
    if (Array.isArray(poetry.packages)) {
      raw.packages = poetry.packages;
    }

    const poetryDeps = poetry.dependencies;
    if (isRecord(poetryDeps)) {
      for (const [name, value] of Object.entries(poetryDeps)) {
        if (name === "python") {
          // The interpreter constraint, NOT a runtime dependency.
          if (typeof value === "string") raw.python = value;
          continue;
        }
        const versionSpec = typeof value === "string" ? value : "";
        dependencies.push({ name, versionSpec, extras: [] });
      }
    }
  }

  return { parsed: true, raw, dependencies };
}

// --- Pipfile (R4.4) ------------------------------------------------------

function parsePipfile(content: string): {
  parsed: boolean;
  parseError?: string;
  raw?: Record<string, unknown>;
  dependencies: ParsedDependency[];
} {
  let data: unknown;
  try {
    data = parseToml(content);
  } catch (err) {
    return {
      parsed: false,
      parseError: err instanceof Error ? err.message : String(err),
      dependencies: [],
    };
  }

  const raw: Record<string, unknown> = {};
  const dependencies: ParsedDependency[] = [];

  if (!isRecord(data)) {
    return { parsed: true, raw, dependencies };
  }

  for (const section of ["packages", "dev-packages"]) {
    const table = data[section];
    if (!isRecord(table)) continue;
    for (const [name, value] of Object.entries(table)) {
      const versionSpec =
        typeof value === "string" && value !== "*" ? value : "";
      dependencies.push({ name, versionSpec, extras: [] });
    }
  }

  const requires = data.requires;
  if (isRecord(requires) && typeof requires.python_version === "string") {
    raw.python_version = requires.python_version;
  }

  return { parsed: true, raw, dependencies };
}

// --- package.json (R4.5) -------------------------------------------------

function parsePackageJson(content: string): {
  parsed: boolean;
  parseError?: string;
  raw?: Record<string, unknown>;
  dependencies: ParsedDependency[];
} {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (err) {
    return {
      parsed: false,
      parseError: err instanceof Error ? err.message : String(err),
      dependencies: [],
    };
  }

  const raw: Record<string, unknown> = {};
  const dependencies: ParsedDependency[] = [];

  if (!isRecord(data)) {
    return { parsed: true, raw, dependencies };
  }

  for (const section of ["dependencies", "devDependencies"]) {
    const table = data[section];
    if (!isRecord(table)) continue;
    for (const [name, value] of Object.entries(table)) {
      const versionSpec = typeof value === "string" ? value : "";
      dependencies.push({ name, versionSpec, extras: [] });
    }
  }

  if (isRecord(data.engines)) raw.engines = data.engines;
  if (isRecord(data.scripts)) raw.scripts = data.scripts;

  return { parsed: true, raw, dependencies };
}

// --- public API ----------------------------------------------------------

/**
 * Identify and parse every manifest file in a snapshot (R4.8). Returns one
 * Manifest per recognised file. Parsing is total — malformed content yields a
 * { parsed:false, parseError, dependencies:[] } manifest rather than throwing
 * (R4.6).
 */
export function parseAllManifests(snapshot: RepoSnapshot): Manifest[] {
  const manifests: Manifest[] = [];

  for (const file of snapshot.files) {
    const kind = classifyManifest(file.path);
    if (kind === null) continue;

    const content = snapshot.contents.get(file.path);
    if (content === undefined) continue; // oversize / absent content → skip.

    let result: {
      parsed: boolean;
      parseError?: string;
      raw?: Record<string, unknown>;
      dependencies: ParsedDependency[];
    };

    switch (kind) {
      case "requirements_txt":
        result = { parsed: true, ...parseRequirementsTxt(content) };
        break;
      case "setup_py":
        result = parseSetupPy(content);
        break;
      case "pyproject_toml":
        result = parsePyproject(content);
        break;
      case "pipfile":
        result = parsePipfile(content);
        break;
      case "package_json":
        result = parsePackageJson(content);
        break;
    }

    const manifest: Manifest = {
      path: file.path,
      kind,
      parsed: result.parsed,
      dependencies: result.dependencies,
    };
    if (result.parseError !== undefined) manifest.parseError = result.parseError;
    if (result.raw !== undefined) manifest.raw = result.raw;
    manifests.push(manifest);
  }

  return manifests;
}

// --- detectPythonVersion (R4.7) ------------------------------------------

/** Infer a py2/py3 signal from a Python version constraint string. */
function signalFromConstraint(constraint: string): PythonVersionSignal {
  // Look for the first major version digit referenced by the constraint.
  // e.g. ">=3.9" → 3, "^3.8" → 3, "2.7" → 2, ">=3.6,<4" → 3.
  const match = /(\d+)(?:\.\d+)?/.exec(constraint);
  if (match === null) return "unknown";
  const major = Number.parseInt(match[1] ?? "", 10);
  if (major === 2) return "py2_only";
  if (major >= 3) return "py3_only";
  return "unknown";
}

/** Infer a signal from a set of setup.py Trove classifiers. */
function signalFromClassifiers(classifiers: string[]): PythonVersionSignal {
  let hasPy2 = false;
  let hasPy3 = false;
  for (const classifier of classifiers) {
    if (!/Programming Language :: Python/.test(classifier)) continue;
    // Match the major version segment after "Python ::", e.g. "Python :: 2.7".
    const match = /Python\s*::\s*(\d+)/.exec(classifier);
    if (match === null) continue;
    const major = Number.parseInt(match[1] ?? "", 10);
    if (major === 2) hasPy2 = true;
    else if (major >= 3) hasPy3 = true;
  }
  if (hasPy2 && hasPy3) return "straddling";
  if (hasPy2) return "py2_only";
  if (hasPy3) return "py3_only";
  return "unknown";
}

/**
 * Synthesise a Python-version signal from parsed manifests in priority order:
 * setup.py classifiers > pyproject requires-python > Pipfile python_version,
 * falling back to "unknown" (R4.7).
 */
export function detectPythonVersion(
  manifests: Manifest[],
): PythonVersionSignal {
  // 1) setup.py classifiers (highest priority).
  for (const m of manifests) {
    if (m.kind !== "setup_py" || !m.parsed) continue;
    const classifiers = m.raw?.classifiers;
    if (Array.isArray(classifiers) && classifiers.length > 0) {
      const signal = signalFromClassifiers(
        classifiers.filter((c): c is string => typeof c === "string"),
      );
      if (signal !== "unknown") return signal;
    }
  }

  // 2) pyproject requires-python.
  for (const m of manifests) {
    if (m.kind !== "pyproject_toml" || !m.parsed) continue;
    const requiresPython = m.raw?.["requires-python"];
    if (typeof requiresPython === "string" && requiresPython.length > 0) {
      const signal = signalFromConstraint(requiresPython);
      if (signal !== "unknown") return signal;
    }
  }

  // 3) Pipfile python_version.
  for (const m of manifests) {
    if (m.kind !== "pipfile" || !m.parsed) continue;
    const pythonVersion = m.raw?.python_version;
    if (typeof pythonVersion === "string" && pythonVersion.length > 0) {
      const signal = signalFromConstraint(pythonVersion);
      if (signal !== "unknown") return signal;
    }
  }

  return "unknown";
}
