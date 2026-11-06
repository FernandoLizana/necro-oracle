"use client";

// apps/web/src/components/ResurrectionResult.tsx
//
// Feature: resurrection-engine, tasks 14.5 + 14.7 — the terminal result view
// that renders the per-file before/after diff and the Residual_List of a
// completed Ritual (task 14.5), and offers the unified Patch as a client-side
// download (task 14.7) (design: "Browser/terminal rendering", "Diff and
// Patch").
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
// It also renders a clickable "download patch" control (tarot-ux: every typed
// command is also clickable). The button turns the Ritual's inline unified diff
// (`patch: string`) into a `.patch` download entirely in the browser — no
// server round-trip (R7.3) — via `downloadRitualPatch`. When the patch is empty
// (nothing changed, R7.4) the control is ABSENT, so an empty Ritual offers no
// download rather than a zero-byte file; `buildRitualPatchDownload` makes the
// same absent/present decision so the button's presence matches the artifact.
//
// Client boundary (R16.4): this file imports only `@necro/ui-crt` and the
// sibling browser-safe `patch-download` helper — never `@necro/coven`,
// `@necro/github`, the oracle main entry, or `node:*`. The `ResurrectFileResult`
// shape it consumes is the browser-safe mirror of the coven `FileResult` wire
// form defined in `@necro/ui-crt`'s protocol types.
//
// Blocks carry no `id` from the pure renderer (they are `BlockDraft`s); this
// view assigns a stable, monotonic id by index purely so `OutputBlockView`
// (which expects an `OutputBlock`) has one. The reading log's own reducer owns
// ids for the live log; this standalone result view never shares that space.
//
// _Requirements: R7.1, R7.2, R7.3, R7.4, R8.1, R8.3_

import {
  OutputBlockView,
  renderFileResults,
  type OutputBlock,
  type ResurrectFileResult,
} from "@necro/ui-crt";

import {
  buildRitualPatchDownload,
  downloadRitualPatch,
} from "../terminal/patch-download.js";

/** Props for the resurrection result view. */
export interface ResurrectionResultProps {
  /** The per-file outcomes from a completed Ritual's `RitualResult.files`. */
  readonly files: readonly ResurrectFileResult[];
  /**
   * The Ritual's inline unified diff (`RitualResult.patch`); empty when nothing
   * changed. When non-empty, a clickable download control is shown (R7.3);
   * when empty, the control is absent (R7.4). Optional so callers that only
   * render the diff/residual view need not pass it.
   */
  readonly patch?: string;
  /** The Ritual id, used only to name the downloaded `.patch` file. */
  readonly ritualId?: string;
}

/**
 * Render every file's before/after diff and Residual_List as CRT blocks, plus
 * a client-side patch-download control when there is a non-empty patch. The
 * diff/residual text is produced by the pure `@necro/ui-crt` renderer; this
 * component only lays the resulting blocks out in order. Each block is shown
 * with `revealedCount: null` (full text, no typewriter reveal) — the result is
 * a settled artifact, not a progress animation, and this keeps it readable
 * under reduced motion without extra wiring.
 */
export function ResurrectionResult({
  files,
  patch,
  ritualId,
}: ResurrectionResultProps): React.JSX.Element {
  const blocks: OutputBlock[] = renderFileResults(files).map((draft, index) => ({
    id: index,
    ...draft,
  }));

  // The download affordance is shown only when the Ritual produced a non-empty
  // patch. `buildRitualPatchDownload` returns `null` for an empty patch, so a
  // probe with a no-op URL API tells us whether to render the control at all
  // without materialising a real object URL on every render.
  const hasPatch =
    patch !== undefined &&
    ritualId !== undefined &&
    buildRitualPatchDownload(
      { patch, ritualId },
      { createObjectURL: () => "", revokeObjectURL: () => undefined },
    ) !== null;

  const onDownload = (): void => {
    if (patch === undefined || ritualId === undefined) {
      return;
    }
    // Build + trigger the download from the inline patch with no server
    // round-trip (R7.3); a no-op on an empty patch (R7.4).
    downloadRitualPatch({ patch, ritualId });
  };

  return (
    <div className="crt-resurrection-result">
      {blocks.map((block) => (
        <OutputBlockView key={block.id} block={block} revealedCount={null} />
      ))}
      {hasPatch ? (
        <button
          type="button"
          className="crt-patch-download"
          onClick={onDownload}
        >
          DOWNLOAD PATCH
        </button>
      ) : null}
    </div>
  );
}

export default ResurrectionResult;
