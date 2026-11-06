// Per-file before/after diff and Residual_List renderer for @necro/ui-crt
// (resurrection-engine, task 14.5).
//
// Validates: Requirements R7.1, R7.2, R8.1, R8.3
//
// `renderFileResult` turns one `ResurrectFileResult` into a single oracle
// `BlockDraft`: a header naming the file, then the per-line diff, then the
// Residual_List (or a fully-converted line when `residuals.length === 0`).
//
// Diff lines (R7.1, R7.2): each `DiffLine` becomes one or more CRT lines marked
// `+` (add), `-` (remove) or ` ` (context). A file whose before/after are
// identical carries only context lines (the coven diff emits context-only for
// unchanged content), so it renders as unchanged with no `+`/`-` line — the
// renderer adds nothing of its own, it only mirrors the diff it is given.
//
// Residuals (R8.1, R8.3): each `ResidualEntry` renders as `path:line` followed
// by its unconverted construct; an empty `residuals` list renders the single
// fully-converted indication instead.
//
// Every emitted line is ASCII-only and fits the phosphor column budget: the
// diff marker (`+`/`-`/` `) plus a space takes two columns, so diff content is
// wrapped/truncated to `LINE_WIDTH - 2` and each wrapped piece is re-prefixed
// with the same marker, keeping the whole line within `LINE_WIDTH` (72). The
// text is first routed through `sanitizeText` (ANSI/control/bidi stripping),
// then any remaining non-ASCII code point is replaced so repository-derived
// source can never smuggle wide or deceptive glyphs onto the CRT.

import type {
  ResurrectDiffLine,
  ResurrectFileResult,
  ResurrectResidual,
} from "../protocol.js";
import { sanitizeText } from "../text/sanitize.js";
import { LINE_WIDTH, wrapText } from "../text/wrap.js";
import type { BlockDraft, OutputLine } from "./blocks.js";

/** The replacement for any non-ASCII code point kept after sanitising. */
const NON_ASCII_REPLACEMENT = "?";

/** The width left for diff content once the 1-char marker and a space are taken. */
const DIFF_CONTENT_WIDTH = LINE_WIDTH - 2;

/** The marker printed before each diff line's content, keyed by diff-line kind. */
const DIFF_MARKER: Readonly<Record<ResurrectDiffLine["kind"], string>> = {
  add: "+",
  remove: "-",
  context: " ",
};

/**
 * Reduce `text` to printable ASCII: strip ANSI/control/bidi sequences via the
 * shared sanitiser, then replace every remaining code point outside the
 * printable-ASCII range (U+0020–U+007E) with `?`. Line feeds are already gone
 * by the time diff content reaches here (a `DiffLine.text` is a single line),
 * so none need be preserved.
 */
function toAscii(text: string): string {
  const sanitised = sanitizeText(text);
  let out = "";
  for (const ch of sanitised) {
    const code = ch.codePointAt(0)!;
    out += code >= 0x20 && code <= 0x7e ? ch : NON_ASCII_REPLACEMENT;
  }
  return out;
}

/** Build wrapped, ASCII-only plain `OutputLine`s (used for headers/residuals). */
function textLines(text: string): OutputLine[] {
  return wrapText(toAscii(text)).map((line) => ({
    segments: [{ text: line }],
  }));
}

/**
 * Render one `DiffLine` as one or more CRT lines. The content is made
 * ASCII-only and wrapped to `DIFF_CONTENT_WIDTH`; every wrapped piece is
 * prefixed with the line's marker and a space, so each emitted line stays
 * within `LINE_WIDTH`. A diff line with empty text still emits one marked line
 * (the bare marker) so an added/removed blank line is visible.
 */
function diffLines(line: ResurrectDiffLine): OutputLine[] {
  const marker = DIFF_MARKER[line.kind];
  const pieces = wrapText(toAscii(line.text), DIFF_CONTENT_WIDTH);
  return pieces.map((piece) => ({
    segments: [{ text: `${marker} ${piece}` }],
  }));
}

/** Render one residual as `path:line  <construct>` (ASCII-only, wrapped). */
function residualLines(residual: ResurrectResidual): OutputLine[] {
  const location = `${residual.path}:${residual.line}`;
  return textLines(`${location}  ${residual.construct}`);
}

/**
 * Render one file's resurrection outcome as a single oracle block: a header
 * naming the file, the per-line diff (R7.1, R7.2), then either the fully
 * converted indication (R8.3) or the Residual_List (R8.1). Pure and
 * deterministic — a function of the `ResurrectFileResult` alone.
 */
export function renderFileResult(file: ResurrectFileResult): BlockDraft {
  const lines: OutputLine[] = [];

  lines.push(...textLines(`FILE ${file.path}`));

  for (const line of file.diff) {
    lines.push(...diffLines(line));
  }

  if (file.residuals.length === 0) {
    lines.push(
      ...textLines("Fully resurrected; every construct crossed over."),
    );
  } else {
    const count = file.residuals.length;
    lines.push(
      ...textLines(
        `${count} construct(s) could not be raised (RESIDUAL):`,
      ),
    );
    for (const residual of file.residuals) {
      lines.push(...residualLines(residual));
    }
  }

  return { kind: "oracle", demo: false, lines };
}

/**
 * Render a sequence of file results, one block per file, preserving order. A
 * convenience over mapping `renderFileResult`; returns an empty array for an
 * empty input (the caller decides how to narrate a zero-file ritual).
 */
export function renderFileResults(
  files: readonly ResurrectFileResult[],
): BlockDraft[] {
  return files.map((file) => renderFileResult(file));
}
