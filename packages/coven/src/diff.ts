// @necro/coven — per-file line diff and unified-patch generation (design:
// "Diff and Patch"). PURE module: no adapters, no side effects. It may import
// @necro/oracle only; here it needs no imports at all beyond the local models.
//
// Two responsibilities:
//   1. `lineDiff(before, after)` — a line-oriented LCS diff into `DiffLine[]`
//      (R7.1). Identical content yields a context-only diff with no add/remove
//      lines (R7.2).
//   2. `buildPatch(files)` — a single unified-diff `Patch` string over the
//      validated, changed `File_Result`s only (R7.3, R7.7). Files with
//      `validated: false` are excluded; zero changed files yields an empty
//      patch (R7.4). The unified diff is emitted so that applying it to a
//      file's `Before_Content` reproduces its `After_Content` byte-for-byte
//      (R7.5) — this is property-tested in task 9.2.
//
// Byte-for-byte round-trip is the load-bearing invariant. To preserve it the
// module models each file's content as a list of physical lines plus a flag
// for whether the content ends in a trailing newline, and emits the standard
// unified-diff "\ No newline at end of file" marker whenever a side lacks one.

import type { DiffLine, FileResult } from "./models.js";

// ---------------------------------------------------------------------------
// Line splitting that preserves byte-for-byte reconstructability.
//
// `splitLines("")`            -> { lines: [],            trailingNewline: false }
// `splitLines("a")`           -> { lines: ["a"],         trailingNewline: false }
// `splitLines("a\n")`         -> { lines: ["a"],         trailingNewline: true }
// `splitLines("a\nb")`        -> { lines: ["a","b"],     trailingNewline: false }
// `splitLines("a\nb\n")`      -> { lines: ["a","b"],     trailingNewline: true }
// `splitLines("\n")`          -> { lines: [""],          trailingNewline: true }
//
// Only "\n" is treated as a line terminator; a preceding "\r" is kept as part
// of the line's text so CRLF content round-trips unchanged.
// ---------------------------------------------------------------------------

interface SplitContent {
  readonly lines: readonly string[];
  readonly trailingNewline: boolean;
}

function splitLines(content: string): SplitContent {
  if (content === "") {
    return { lines: [], trailingNewline: false };
  }
  const trailingNewline = content.endsWith("\n");
  const body = trailingNewline ? content.slice(0, -1) : content;
  // After stripping at most one trailing "\n", every remaining "\n" separates
  // two physical lines. An empty `body` (content was exactly "\n") splits to
  // a single empty line, which is correct.
  return { lines: body.split("\n"), trailingNewline };
}

// ---------------------------------------------------------------------------
// Line-oriented LCS.
//
// Classic dynamic-programming longest-common-subsequence over the two line
// arrays, then a backtrack that yields, in order, the operations needed to
// turn `before` into `after`: shared lines become `context`, lines only in
// `before` become `remove`, lines only in `after` become `add`.
// ---------------------------------------------------------------------------

type Op = { readonly kind: "context" | "remove" | "add"; readonly text: string };

function lcsOps(before: readonly string[], after: readonly string[]): Op[] {
  const n = before.length;
  const m = after.length;
  const width = m + 1;

  // dp is a flat (n+1) x (m+1) grid; dp[i*width + j] is the LCS length of
  // before[i..] and after[j..]. A flat Int32Array avoids the possibly-sparse
  // nested-array access the strict index-access checker rejects, and `at` is a
  // total lookup over the typed array.
  const dp = new Int32Array((n + 1) * width);
  const at = (i: number, j: number): number => dp[i * width + j] ?? 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] =
        before[i] === after[j]
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const bi = before[i] ?? "";
    const aj = after[j] ?? "";
    if (bi === aj) {
      ops.push({ kind: "context", text: bi });
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      ops.push({ kind: "remove", text: bi });
      i += 1;
    } else {
      ops.push({ kind: "add", text: aj });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ kind: "remove", text: before[i] ?? "" });
    i += 1;
  }
  while (j < m) {
    ops.push({ kind: "add", text: after[j] ?? "" });
    j += 1;
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Public: per-file DiffLine[] (R7.1, R7.2).
// ---------------------------------------------------------------------------

/**
 * Compute a line-oriented LCS diff of `before` vs `after` as `DiffLine[]`
 * (R7.1). Identical content yields context-only lines with no add/remove
 * entries (R7.2). The trailing-newline distinction is not represented in the
 * line array itself (it carries no text); it is preserved by the unified-patch
 * generator, which is where byte-for-byte reconstruction matters.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const ops = lcsOps(splitLines(before).lines, splitLines(after).lines);
  return ops.map((op) => ({ kind: op.kind, text: op.text }));
}

// ---------------------------------------------------------------------------
// Unified-diff hunk assembly.
//
// With no context-collapsing (the files here are small, bounded at 1 MB by
// selection) the whole file is emitted as a single hunk. Hunk header line
// counts follow the unified-diff convention: a side with zero lines reports a
// start line of 0.
// ---------------------------------------------------------------------------

const NO_NEWLINE_MARKER = "\\ No newline at end of file";

// A non-printable sentinel appended to the last line of a side that lacks a
// trailing newline. It makes the final line's newline status part of its
// identity for the LCS, so toggling the trailing newline on an otherwise
// unchanged last line is diffed as a real remove+add (which unified diff
// requires: an all-context hunk cannot carry a one-sided no-newline marker).
// It is stripped before the line text is written. U+0000 can never appear in
// the split line text because `splitLines` only ever splits on "\n".
const NO_NL_SENTINEL = "\u0000";

/**
 * Split like `splitLines`, but tag the final line with `NO_NL_SENTINEL` when
 * that side has no trailing newline. The tag is purely internal to the diff.
 */
function taggedLines(content: string): string[] {
  const { lines, trailingNewline } = splitLines(content);
  if (lines.length === 0 || trailingNewline) return [...lines];
  const tagged = [...lines];
  tagged[tagged.length - 1] = `${tagged[tagged.length - 1] ?? ""}${NO_NL_SENTINEL}`;
  return tagged;
}

/**
 * Build the unified-diff body (hunk header + line rows) for one file whose
 * content actually changed. A line whose tag marks it as newline-less is
 * written without the tag and followed by the "\ No newline at end of file"
 * marker, so a consumer that strips the marker reconstructs the exact bytes.
 */
function fileHunk(before: string, after: string): string[] {
  const beforeTagged = taggedLines(before);
  const afterTagged = taggedLines(after);
  const ops = lcsOps(beforeTagged, afterTagged);

  const beforeCount = beforeTagged.length;
  const afterCount = afterTagged.length;
  const beforeStart = beforeCount === 0 ? 0 : 1;
  const afterStart = afterCount === 0 ? 0 : 1;

  const out: string[] = [
    `@@ -${beforeStart},${beforeCount} +${afterStart},${afterCount} @@`,
  ];

  for (const op of ops) {
    const prefix = op.kind === "add" ? "+" : op.kind === "remove" ? "-" : " ";
    const noNewline = op.text.endsWith(NO_NL_SENTINEL);
    const text = noNewline ? op.text.slice(0, -NO_NL_SENTINEL.length) : op.text;
    out.push(`${prefix}${text}`);
    if (noNewline) out.push(NO_NEWLINE_MARKER);
  }

  return out;
}

/**
 * Generate a single unified-diff `Patch` over the validated, changed
 * `File_Result`s (R7.3). Files with `validated === false` are excluded (R7.7);
 * files whose `before === after` are not changed and contribute nothing. When
 * no file is both validated and changed the result is the empty string (R7.4).
 *
 * The emitted patch round-trips: applying it to each file's `before` yields its
 * `after` byte-for-byte (R7.5), including the trailing-newline edge cases via
 * the standard no-newline marker.
 */
export function buildPatch(files: readonly FileResult[]): string {
  const sections: string[] = [];

  for (const file of files) {
    if (!file.validated) continue; // R7.7: exclude not-validated files
    if (file.before === file.after) continue; // unchanged: not in the patch

    const header = [
      `--- a/${file.path}`,
      `+++ b/${file.path}`,
      ...fileHunk(file.before, file.after),
    ];
    sections.push(header.join("\n"));
  }

  if (sections.length === 0) return ""; // R7.4: empty patch

  // Each file section is newline-joined; a trailing newline terminates the
  // final hunk line so the patch is a well-formed text file.
  return `${sections.join("\n")}\n`;
}
