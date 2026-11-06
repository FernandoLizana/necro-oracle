"use client";

// apps/web/src/components/ResurrectionResult.tsx
//
// Feature: resurrection-engine, task 14.5 — the terminal result view that
// renders the per-file before/after diff and the Residual_List of a completed
// Ritual (design: "Browser/terminal rendering", "Diff and Patch").
//
// This is the apps/web wiring point for the `@necro/ui-crt` resurrection diff
// renderer. It takes the redaction-safe `files` of a `RitualResult` wire form
// (`ResurrectFileResult[]`), turns each into a CRT `OutputBlock` via
// `renderFileResult` (which marks added `+`, removed `-` and context ` ` lines,
// keeps everything ASCII-only within the 72-column phosphor budget, and renders
// each file's Residual_List as `path:line` + construct or a fully-converted
// line when there are no residuals), and shows them with the same
// `OutputBlockView` the live reading log uses — so a resurrection result reads
// in the one phosphor palette as the rest of the terminal.
//
// Client boundary (R16.4): this file imports only `@necro/ui-crt` — never
// `@necro/coven`, `@necro/github`, the oracle main entry, or `node:*`. The
// `ResurrectFileResult` shape it consumes is the browser-safe mirror of the
// coven `FileResult` wire form defined in `@necro/ui-crt`'s protocol types.
//
// Blocks carry no `id` from the pure renderer (they are `BlockDraft`s); this
// view assigns a stable, monotonic id by index purely so `OutputBlockView`
// (which expects an `OutputBlock`) has one. The reading log's own reducer owns
// ids for the live log; this standalone result view never shares that space.
//
// _Requirements: R7.1, R7.2, R8.1, R8.3_

import {
  OutputBlockView,
  renderFileResults,
  type OutputBlock,
  type ResurrectFileResult,
} from "@necro/ui-crt";

/** Props for the resurrection result view. */
export interface ResurrectionResultProps {
  /** The per-file outcomes from a completed Ritual's `RitualResult.files`. */
  readonly files: readonly ResurrectFileResult[];
}

/**
 * Render every file's before/after diff and Residual_List as CRT blocks. The
 * diff/residual text is produced by the pure `@necro/ui-crt` renderer; this
 * component only lays the resulting blocks out in order. Each block is shown
 * with `revealedCount: null` (full text, no typewriter reveal) — the result is
 * a settled artifact, not a progress animation, and this keeps it readable
 * under reduced motion without extra wiring.
 */
export function ResurrectionResult({
  files,
}: ResurrectionResultProps): React.JSX.Element {
  const blocks: OutputBlock[] = renderFileResults(files).map((draft, index) => ({
    id: index,
    ...draft,
  }));

  return (
    <div className="crt-resurrection-result">
      {blocks.map((block) => (
        <OutputBlockView key={block.id} block={block} revealedCount={null} />
      ))}
    </div>
  );
}

export default ResurrectionResult;
