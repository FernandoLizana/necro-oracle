// @necro/grimoires-py2to3 — structured chunk edit schema + deterministic gate
// (task 5.3, design B.2).
//
// Part B of Lovers_Binding sends ONLY a chunk's residual diagnostics to the
// model and accepts a STRUCTURED edit behind a deterministic gate, falling back
// to the deterministic chunk whenever the edit cannot be proven safe. This file
// adds, ADDITIVELY to the existing py2to3 grimoire, two pure values:
//
//   1. `ChunkEditSchema` — the strict zod shape of one chunk edit
//      (purpose `py2to3.chunk`), and
//   2. `acceptChunk(before, edit, diagnose, parse)` — the pure gate that
//      decides whether an edit is accepted, declined, or rejected.
//
// The gate is PURE and TESTABLE: the Python diagnosis rule (`diagnose`) and the
// tree-sitter parser (`parse`) are INJECTED (mirroring `FixerContext.parse`),
// so this module performs no network, clock, or DOM work and never executes
// repository code — it only parses and inspects syntax trees (security rule 1).
//
// It stays adapter-free: it imports `@necro/oracle` (for `maskSecret`, reused to
// derive the real mask fingerprint, and the `Tree` type) and `zod` only — the
// SAME dependencies the grimoire already uses. No `@necro/llm`, no
// `@necro/sandbox`, no network/process sink, so the import-ban guard
// (`fixers/import-ban.test.ts`) stays green.

import { maskSecret, type Tree } from "@necro/oracle";
import { z } from "zod";

import type { Node } from "web-tree-sitter";

// ---------------------------------------------------------------------------
// ChunkEditSchema (R12.1, design B.2)
// ---------------------------------------------------------------------------

/**
 * The structured edit a model returns for one residual chunk (purpose
 * `py2to3.chunk`). `.strict()` rejects any extra field so a drifting model
 * response fails zod and the runner applies the single retry rule (A.8).
 *
 *   - `chunkId`          stable id of the chunk the edit targets (path#a-b).
 *   - `replacementCode`  the rewritten chunk source (may be empty).
 *   - `requiredImports`  STDLIB-ONLY import lines the runner hoists
 *                        DETERMINISTICALLY outside the chunk; any non-stdlib
 *                        entry is rejected by the gate (R12.5).
 *   - `reason`           one bounded, oracle-voice-friendly sentence (<=280).
 *   - `confidence`       0..1; `confidence === 0` means DECLINE (R12.6).
 */
export const ChunkEditSchema = z
  .object({
    chunkId: z.string().min(1),
    replacementCode: z.string(),
    requiredImports: z.array(z.string()),
    reason: z.string().min(1).max(280),
    confidence: z.number().min(0).max(1),
  })
  .strict();

/** The validated structured edit for one residual chunk. */
export type ChunkEdit = z.infer<typeof ChunkEditSchema>;

// ---------------------------------------------------------------------------
// Gate result (discriminated union, design B.2)
// ---------------------------------------------------------------------------

/**
 * Why a chunk edit was rejected. `reject(...)` outcomes follow the single retry
 * rule (A.8): the runner (task 5.4) issues ONE repair retry carrying the exact
 * reason, then keeps the deterministic chunk.
 *
 *   - `mask_placeholder`  `replacementCode` contained a masked span (R12.7).
 *   - `bad_import`        a `requiredImports` entry was not a stdlib import.
 *   - `output_unparseable` the spliced result did not parse as Python 3.
 *   - `no_transform`      Python 2 constructs remained, a public signature was
 *                         dropped, or the diff escaped the chunk.
 */
export type ChunkRejectReason =
  | "mask_placeholder"
  | "bad_import"
  | "output_unparseable"
  | "no_transform";

/**
 * The gate's typed outcome, a discriminated union on `status`:
 *
 *   - `accept`   the spliced + hoisted Python 3 passed every check; `after` is
 *                the full module source to use for this chunk.
 *   - `decline`  the model abstained (`confidence === 0`): keep the
 *                deterministic chunk with NO retry (a distinct outcome the
 *                runner reads — R12.6).
 *   - `reject`   the edit failed a safety check; `reason` names which. The
 *                runner does the single retry then keeps deterministic.
 */
export type ChunkGateResult =
  | { readonly status: "accept"; readonly after: string }
  | { readonly status: "decline" }
  | { readonly status: "reject"; readonly reason: ChunkRejectReason };

/** The injected Python diagnosis rule: true when any Python 2 node remains. */
export type DiagnoseFn = (tree: Tree) => boolean;

/** The injected Python parser (mirrors `FixerContext.parse`). */
export type ParseFn = (source: string) => Tree;

// ---------------------------------------------------------------------------
// Mask-placeholder guard (R12.7)
// ---------------------------------------------------------------------------

// The real mask token is the `maskSecret` fingerprint `<first 4 chars>****`
// (see `@necro/oracle` util/mask): every masked secret ends in the literal
// `****` sentinel. We derive that sentinel FROM `maskSecret` so the gate and
// the masker can never drift apart. We also reject the literal `***MASKED***`
// documented in the prompt's rule 6 as a belt-and-braces placeholder form.
const MASK_FINGERPRINT_SUFFIX = maskSecret("").slice(-4); // "****"
const LITERAL_MASK_PLACEHOLDER = "***MASKED***";

/**
 * True when `replacementCode` carries a masked span — either the `maskSecret`
 * fingerprint sentinel (`****`) or the literal `***MASKED***` placeholder. A
 * masked span must never be written back into the source (R12.7).
 */
function containsMaskPlaceholder(replacementCode: string): boolean {
  return (
    replacementCode.includes(MASK_FINGERPRINT_SUFFIX) ||
    replacementCode.includes(LITERAL_MASK_PLACEHOLDER)
  );
}

// ---------------------------------------------------------------------------
// Stdlib import allow-list (R12.5)
// ---------------------------------------------------------------------------

/**
 * A reasonable allow-list of common Python 3 standard-library TOP-LEVEL module
 * names. A `requiredImports` line is a "stdlib import line" only when its
 * imported top-level module is in this set; any other module (a third-party
 * package, a dotted local path, or an unknown name) is rejected (R12.5).
 *
 * The list intentionally covers the modules the py2->3 migration rules in the
 * `py2to3.chunk` system prompt may legitimately pull in (`functools` for
 * `cmp_to_key`/`reduce`, `io`, `sys`, `os`, `string`, etc.) plus the common
 * stdlib surface. It is a DENY-BY-DEFAULT allow-list: unknown => rejected.
 */
export const PYTHON3_STDLIB_MODULES: ReadonlySet<string> = new Set([
  "abc",
  "argparse",
  "array",
  "ast",
  "asyncio",
  "base64",
  "binascii",
  "bisect",
  "builtins",
  "calendar",
  "cmath",
  "codecs",
  "collections",
  "configparser",
  "contextlib",
  "copy",
  "csv",
  "dataclasses",
  "datetime",
  "decimal",
  "difflib",
  "enum",
  "errno",
  "fnmatch",
  "fractions",
  "functools",
  "gc",
  "getpass",
  "glob",
  "gzip",
  "hashlib",
  "heapq",
  "hmac",
  "html",
  "http",
  "importlib",
  "inspect",
  "io",
  "ipaddress",
  "itertools",
  "json",
  "keyword",
  "locale",
  "logging",
  "math",
  "numbers",
  "operator",
  "os",
  "pathlib",
  "pickle",
  "pprint",
  "queue",
  "random",
  "re",
  "secrets",
  "shutil",
  "signal",
  "socket",
  "sqlite3",
  "stat",
  "statistics",
  "string",
  "struct",
  "subprocess",
  "sys",
  "tempfile",
  "textwrap",
  "threading",
  "time",
  "traceback",
  "types",
  "typing",
  "unicodedata",
  "unittest",
  "urllib",
  "uuid",
  "warnings",
  "weakref",
  "xml",
  "zipfile",
  "zlib",
]);

/**
 * Parse one `requiredImports` line and decide whether it is a stdlib import
 * line. A stdlib import line matches either
 *
 *   `import <mod>[ as alias]`   (optionally comma-separated: `import os, sys`)
 *   `from <mod>[.<sub>...] import ...`
 *
 * where every top-level `<mod>` is in {@link PYTHON3_STDLIB_MODULES}. Anything
 * else — a non-import line, a relative import (`from . import x`), or a module
 * outside the allow-list — is NOT a stdlib import line (R12.5).
 */
function isStdlibImportLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;

  // Item 27 (R12.5): an import line must be PURELY a single import statement.
  // Reject anything that could smuggle executable code onto the module top when
  // the line is hoisted verbatim: an embedded newline (a second line), a `;`
  // statement separator, or a trailing comment (`#`). This runs BEFORE the
  // form checks so no structurally-suspicious line can reach the module-name
  // allow-list and be accepted on the strength of its first token alone.
  if (/[\n\r;#]/.test(trimmed)) return false;

  // `from <mod>[.<sub>...] import <names>` - the import list is a comma-list of
  // `name [as alias]` identifiers, OPTIONALLY wrapped in a single pair of
  // parens. The pattern is ANCHORED at both ends (`$`), so NOTHING may follow
  // the import list (no trailing statement). A relative import (`from . import`)
  // has no leading identifier, so it fails the `[A-Za-z_]` module start.
  const IMPORT_NAME = "[A-Za-z_]\\w*(?:\\s+as\\s+[A-Za-z_]\\w*)?";
  const NAME_LIST = `${IMPORT_NAME}(?:\\s*,\\s*${IMPORT_NAME})*`;
  const fromRe = new RegExp(
    `^from\\s+([A-Za-z_][\\w.]*)\\s+import\\s+(?:\\*|\\(\\s*${NAME_LIST}\\s*,?\\s*\\)|${NAME_LIST})$`,
  );
  const fromMatch = fromRe.exec(trimmed);
  if (fromMatch) {
    const top = (fromMatch[1] ?? "").split(".")[0] ?? "";
    return PYTHON3_STDLIB_MODULES.has(top);
  }

  // `import <mod>[.<sub>][ as alias][, <mod2>...]` - anchored at both ends so a
  // trailing statement cannot ride along; every top-level module must be stdlib.
  const importRe = new RegExp(
    `^import\\s+[A-Za-z_][\\w.]*(?:\\s+as\\s+[A-Za-z_]\\w*)?(?:\\s*,\\s*[A-Za-z_][\\w.]*(?:\\s+as\\s+[A-Za-z_]\\w*)?)*$`,
  );
  if (importRe.test(trimmed)) {
    const modules = trimmed.replace(/^import\s+/, "").split(",");
    for (const spec of modules) {
      const name = spec.trim().split(/\s+as\s+/)[0] ?? "";
      const top = name.split(".")[0] ?? "";
      if (top.length === 0 || !PYTHON3_STDLIB_MODULES.has(top)) return false;
    }
    return true;
  }

  return false;
}

/** True when ANY entry is not a stdlib import line (R12.5). */
function anyNonStdlibImport(requiredImports: readonly string[]): boolean {
  return requiredImports.some((line) => !isStdlibImportLine(line));
}

// ---------------------------------------------------------------------------
// Chunk id + splice mechanics
// ---------------------------------------------------------------------------

/**
 * A chunk id is `path#startLine-endLine` (1-based, inclusive), matching
 * `ResidualChunk.chunkId` from `groupResiduals`. Parse out the line span; a
 * malformed id yields `null` so the gate treats the splice as a `no_transform`
 * reject rather than throwing.
 */
function parseChunkSpan(chunkId: string): { start: number; end: number } | null {
  const hash = chunkId.lastIndexOf("#");
  if (hash < 0) return null;
  const range = chunkId.slice(hash + 1);
  const dash = range.indexOf("-");
  if (dash < 0) return null;
  const start = Number.parseInt(range.slice(0, dash), 10);
  const end = Number.parseInt(range.slice(dash + 1), 10);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 1 || end < start) return null;
  return { start, end };
}

/**
 * Replace the chunk's line span `[start, end]` (1-based inclusive) in `before`
 * with `replacementCode`. Splitting on `\n` preserves the surrounding lines
 * exactly; the replacement is spliced in as whole lines. Returns `null` when
 * the span is out of range so the caller rejects rather than corrupting source.
 */
function spliceChunk(before: string, chunkId: string, replacementCode: string): string | null {
  const span = parseChunkSpan(chunkId);
  if (span === null) return null;

  const lines = before.split("\n");
  if (span.end > lines.length) return null;

  const head = lines.slice(0, span.start - 1);
  const tail = lines.slice(span.end);
  const replacementLines = replacementCode.split("\n");
  return [...head, ...replacementLines, ...tail].join("\n");
}

/**
 * Hoist the stdlib `requiredImports` DETERMINISTICALLY outside the chunk: each
 * import line is prepended at the MODULE TOP, after any existing leading
 * shebang (`#!`) / coding-cookie / `from __future__` lines and in the order the
 * model supplied them. An import already present verbatim at the module top is
 * not duplicated. The hoisted lines are excluded from the diff-within-chunk
 * check by the caller (R12.5).
 */
function hoistImports(source: string, requiredImports: readonly string[]): string {
  if (requiredImports.length === 0) return source;

  const lines = source.split("\n");
  // Find the insertion point: skip a leading shebang, coding cookies, and any
  // `from __future__` imports, which must stay at the very top of the module.
  let insertAt = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const l = (lines[i] ?? "").trim();
    const isPreamble =
      (i === 0 && l.startsWith("#!")) ||
      l.startsWith("# -*-") ||
      l.startsWith("# coding") ||
      l.startsWith("from __future__") ||
      l.length === 0;
    if (isPreamble) {
      insertAt = i + 1;
      continue;
    }
    break;
  }

  const existing = new Set(lines.map((l) => l.trim()));
  const toAdd = requiredImports.map((l) => l.trim()).filter((l) => !existing.has(l));
  if (toAdd.length === 0) return source;

  return [...lines.slice(0, insertAt), ...toAdd, ...lines.slice(insertAt)].join("\n");
}

// ---------------------------------------------------------------------------
// Public-signature preservation
// ---------------------------------------------------------------------------

/**
 * Collect the PUBLIC `def`/`class` names declared anywhere in `source`, in
 * sorted order, by a line-wise scan: a line whose first token is `def` or
 * `class` and whose name does not start with `_` (a public name). This is a
 * deterministic, parse-free structural read used to assert the edit preserves
 * the public surface before vs after (R12.2).
 */
function publicDefClassNames(source: string): string[] {
  const names = new Set<string>();
  const re = /^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/;
  for (const line of source.split("\n")) {
    const m = re.exec(line);
    if (m === null) continue;
    const name = m[2] ?? "";
    if (name.length === 0 || name.startsWith("_")) continue;
    names.add(name);
  }
  return [...names].sort();
}

/** True when the public def/class names are identical before vs after (R12.2). */
function publicSignaturesPreserved(before: string, after: string): boolean {
  const a = publicDefClassNames(before);
  const b = publicDefClassNames(after);
  if (a.length !== b.length) return false;
  return a.every((name, i) => name === b[i]);
}

// ---------------------------------------------------------------------------
// Diff-within-chunk check (excluding hoisted imports)
// ---------------------------------------------------------------------------

/**
 * True when the only lines that changed between `before` and `after` lie within
 * the chunk's line span OR are the deterministically-hoisted `requiredImports`
 * (which are EXCLUDED from the check per R12.5). Lines outside the chunk span
 * must be byte-identical once the hoisted imports are accounted for.
 *
 * The check compares the lines OUTSIDE the chunk span on both sides after
 * removing the hoisted import lines from `after`'s outside region; if those
 * sequences are equal, the diff stayed within the chunk.
 */
function diffStaysWithinChunk(
  before: string,
  after: string,
  chunkId: string,
  hoisted: readonly string[],
): boolean {
  const span = parseChunkSpan(chunkId);
  if (span === null) return false;

  const beforeLines = before.split("\n");
  // The chunk occupied `[start, end]` in `before`. Everything before `start`
  // and everything after `end` must survive unchanged (modulo hoisted imports).
  const beforeHead = beforeLines.slice(0, span.start - 1);
  const beforeTail = beforeLines.slice(span.end);

  const hoistedSet = new Set(hoisted.map((l) => l.trim()));
  const afterLines = after.split("\n");

  // Peel the head off `after`: the hoisted imports were inserted into the head
  // region, so compare the head sequences after dropping hoisted lines.
  const afterHeadLen = beforeHead.length + countHoistedInHead(afterLines, beforeHead, hoistedSet);
  const afterHead = afterLines.slice(0, afterHeadLen).filter((l) => !hoistedSet.has(l.trim()));
  const afterTail = afterLines.slice(afterLines.length - beforeTail.length);

  return (
    sequencesEqual(beforeHead, afterHead) && sequencesEqual(beforeTail, afterTail)
  );
}

/** Count how many leading `after` lines (up to the head region) are hoisted imports. */
function countHoistedInHead(
  afterLines: readonly string[],
  beforeHead: readonly string[],
  hoistedSet: ReadonlySet<string>,
): number {
  let count = 0;
  for (let i = 0; i < afterLines.length && i < beforeHead.length + hoistedSet.size; i += 1) {
    if (hoistedSet.has((afterLines[i] ?? "").trim())) count += 1;
  }
  return count;
}

/** True when two line sequences are element-wise equal. */
function sequencesEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((line, i) => line === b[i]);
}

// ---------------------------------------------------------------------------
// Parse + diagnose helpers (injected `parse` / `diagnose`)
// ---------------------------------------------------------------------------

/** True when `after` parses as Python 3 with ZERO error nodes (R12.2). */
function parsesAsPython3(after: string, parse: ParseFn): boolean {
  let tree: Tree;
  try {
    tree = parse(after);
  } catch {
    return false;
  }
  try {
    return !treeHasError(tree);
  } finally {
    tree.delete();
  }
}

/** True when any ERROR or MISSING node appears in the tree. */
function treeHasError(tree: Tree): boolean {
  let bad = false;
  const cursor = tree.walk();
  try {
    for (;;) {
      const node: Node = cursor.currentNode;
      if (node.type === "ERROR" || node.isError || node.isMissing) {
        bad = true;
        break;
      }
      if (cursor.gotoFirstChild()) continue;
      for (;;) {
        if (cursor.gotoNextSibling()) break;
        if (!cursor.gotoParent()) return bad;
      }
    }
  } finally {
    cursor.delete();
  }
  return bad;
}

/**
 * True when `after` still contains Python 2 constructs under the REUSED oracle
 * diagnosis rule (`hasLegacyPythonNodes`, injected as `diagnose`). Parses
 * `after` once and asks the rule; a parse failure is a conservative "constructs
 * remain" so an unparseable result never slips through as transformed.
 */
function py2ConstructsRemain(after: string, diagnose: DiagnoseFn, parse: ParseFn): boolean {
  let tree: Tree;
  try {
    tree = parse(after);
  } catch {
    return true;
  }
  try {
    return diagnose(tree);
  } finally {
    tree.delete();
  }
}

// ---------------------------------------------------------------------------
// acceptChunk — the deterministic gate (design B.2)
// ---------------------------------------------------------------------------

/**
 * Decide whether a chunk edit is accepted, declined, or rejected (design B.2).
 *
 * The Python diagnosis rule (`diagnose`, e.g. the oracle `hasLegacyPythonNodes`)
 * and the Python parser (`parse`, e.g. the oracle `parsePython`) are INJECTED so
 * the gate is pure and testable (mirroring `FixerContext.parse`). It performs no
 * network, clock, or DOM work and never executes repository code.
 *
 * Order (short-circuiting):
 *   1. `confidence === 0`                 => `decline` (keep deterministic, NO retry).
 *   2. mask placeholder in replacement    => `reject("mask_placeholder")`.
 *   3. any non-stdlib `requiredImports`   => `reject("bad_import")`.
 *   4. splice the replacement into the chunk span, hoist the stdlib imports to
 *      the module top, then accept ONLY if the result parses as Python 3 (zero
 *      error nodes), retains no Python 2 constructs under `diagnose`, preserves
 *      public `def`/`class` names, and the diff stays within the chunk span
 *      EXCLUDING the hoisted imports; otherwise `reject(...)`.
 *
 * `reject(...)` outcomes follow the single retry rule (A.8): the runner (task
 * 5.4) does ONE repair retry then keeps the deterministic chunk. `decline` is a
 * DISTINCT outcome with no retry.
 */
export function acceptChunk(
  before: string,
  edit: ChunkEdit,
  diagnose: DiagnoseFn,
  parse: ParseFn,
): ChunkGateResult {
  // 1. The model explicitly abstained: keep the deterministic chunk, no retry.
  if (edit.confidence === 0) {
    return { status: "decline" };
  }

  // 2. Never write a masked span back into the source.
  if (containsMaskPlaceholder(edit.replacementCode)) {
    return { status: "reject", reason: "mask_placeholder" };
  }

  // 3. Only stdlib import lines may be hoisted.
  if (anyNonStdlibImport(edit.requiredImports)) {
    return { status: "reject", reason: "bad_import" };
  }

  // 4. Splice the replacement into the chunk span, then hoist the imports.
  const spliced = spliceChunk(before, edit.chunkId, edit.replacementCode);
  if (spliced === null) {
    return { status: "reject", reason: "no_transform" };
  }
  const after = hoistImports(spliced, edit.requiredImports);

  if (!parsesAsPython3(after, parse)) {
    return { status: "reject", reason: "output_unparseable" };
  }
  if (py2ConstructsRemain(after, diagnose, parse)) {
    return { status: "reject", reason: "no_transform" };
  }
  if (!publicSignaturesPreserved(before, after)) {
    return { status: "reject", reason: "no_transform" };
  }
  if (!diffStaysWithinChunk(before, after, edit.chunkId, edit.requiredImports)) {
    return { status: "reject", reason: "no_transform" };
  }

  return { status: "accept", after };
}
