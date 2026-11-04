// Block/line/segment output model for @necro/ui-crt (task 8.2).
//
// Validates: Requirements R14.4, R14.5, R14.6
//
// Terminal output is modelled as data (design decision D4): an `OutputBlock`
// is an ordered list of `OutputLine`s, and a line is an ordered list of
// `Segment`s (`{ text, href? }`, defined in `../text/wrap.ts`). A `BlockDraft`
// is an `OutputBlock` without its `id`; the session reducer assigns the `id`
// when it appends the draft to the log. `lineText` and `blockText` are the two
// pure helpers that flatten this model back to plain strings (used by tests,
// the aria-live region, and the CLI).

import type { Segment } from "../text/wrap.js";

/** The visual category of a block, which drives its phosphor styling. */
export type BlockKind = "boot" | "echo" | "oracle" | "error" | "status";

/** A single output line: an ordered list of (optionally linked) text runs. */
export interface OutputLine {
  readonly segments: readonly Segment[];
}

/** A rendered block in the log, identified by the id the reducer assigned. */
export interface OutputBlock {
  readonly id: number;
  readonly kind: BlockKind;
  readonly demo: boolean;
  readonly lines: readonly OutputLine[];
}

/** An `OutputBlock` before the reducer assigns it an `id`. */
export type BlockDraft = Omit<OutputBlock, "id">;

/** The plain text of a line: every segment's text joined in order. */
export function lineText(line: OutputLine): string {
  return line.segments.map((segment) => segment.text).join("");
}

/** The plain text of a block: each line's text joined by a single newline. */
export function blockText(block: BlockDraft | OutputBlock): string {
  return block.lines.map(lineText).join("\n");
}
