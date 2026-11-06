// src/components/BootOverlay.tsx
//
// Feature: visual-necromancy, task 9.2.
//
// `BootOverlay` is the presentational half of the one-time CRT Boot_Sequence.
// It renders the current `BootFrame` as ordinary, selectable DOM text — never a
// canvas — positioned over the screen, together with a persistent skip hint.
// All timing lives in `use-boot`; this component only decides what to draw for
// the `bootPhase` and `frame` the Terminal reports.
//
// The overlay exists ONLY while the boot is playing: when `bootPhase !== "playing"`
// it renders nothing, so the ready terminal has no leftover overlay in the DOM
// (R1.1, R1.7). While playing it shows the frame lines as `<pre class="crt-line">`
// text nodes and the fixed Oracle_Voice skip hint
// `Press any key to skip the awakening.` (R1.4).
//
// The frame is decorative wordmark/boot art, so the whole glyph region is
// `aria-hidden="true"` and a single sibling `crt-sr-only` span carries
// `BOOT_LOGO_TEXT_EQUIVALENT` — assistive technology announces the wordmark
// `NECROMANTIC SYSTEMS 1986`, not the raw ASCII glyphs. This mirrors the
// `crt-sr-only` + `aria-hidden` decorative pattern used by `OutputBlockView`
// and `AsciiCardView` (R1.8, R10.2).
//
// The overlay carries a `data-boot-frame` attribute (`memory` | `logo` |
// `warmup` | `ready`) derived purely from the current boot step. It is a
// presentational marker only — no behaviour depends on it — that lets a
// screenshot or test wait for the logo frame specifically, since the
// `crt-sr-only` wordmark is a constant sibling present in every playing frame.
//
// The overlay NEVER renders, references, moves, re-parents, or hides
// `#no-js-note`; that element belongs to `layout.tsx` (which this feature never
// modifies) and stays entirely outside this component (R10.4).
//
// _Requirements: R1.1, R1.4, R1.7, R1.8, R10.2, R10.4_

"use client";

import type { BootFrame, BootFrameKind } from "../render/boot.js";
import { BOOT_LOGO_TEXT_EQUIVALENT } from "../render/boot.js";
import type { OutputLine } from "../render/blocks.js";
import type { BootPhase } from "../hooks/use-boot.js";

/** The fixed Oracle_Voice skip hint shown for the full boot (R1.4). */
export const BOOT_SKIP_HINT = "Press any key to skip the awakening.";

/** Props for the Boot_Sequence overlay. */
export interface BootOverlayProps {
  /** The current frame to display; rendered only while the boot is playing. */
  readonly frame: BootFrame;
  /** The boot phase; the overlay renders nothing unless this is `"playing"`. */
  readonly bootPhase: BootPhase;
  /**
   * Which kind of frame is on screen (`memory` | `logo` | `warmup` | `ready`),
   * derived purely from the boot step. Exposed as `data-boot-frame` so a
   * screenshot or test can wait for the logo frame specifically — the
   * `crt-sr-only` wordmark alone is present in every playing frame and so does
   * not identify the logo step. Purely presentational; no behaviour depends on
   * it.
   */
  readonly frameKind: BootFrameKind;
}

/** The plain text of one boot line (boot frames carry a single text segment). */
function lineText(line: OutputLine): string {
  return line.segments.map((segment) => segment.text).join("");
}

/**
 * Render the Boot_Sequence overlay over the screen while the boot is playing.
 *
 * Returns `null` when `bootPhase !== "playing"` so there is no overlay in the
 * DOM once the boot is done (R1.1, R1.7). While playing, the frame's glyph rows
 * are selectable DOM text inside an `aria-hidden` region, a single
 * `crt-sr-only` sibling carries the accessible wordmark (R1.8, R10.2), and the
 * fixed skip hint is always present (R1.4). This component never touches
 * `#no-js-note` (R10.4).
 */
export function BootOverlay({
  frame,
  bootPhase,
  frameKind,
}: BootOverlayProps): React.JSX.Element | null {
  if (bootPhase !== "playing") {
    return null;
  }

  return (
    <div
      className="crt-boot-overlay"
      data-boot="playing"
      data-boot-frame={frameKind}
    >
      {/* Decorative boot/wordmark glyphs: selectable text, out of the a11y tree. */}
      <div className="crt-boot-frame" aria-hidden="true">
        {frame.lines.map((line, index) => (
          <pre key={index} className="crt-line">
            {lineText(line)}
          </pre>
        ))}
      </div>
      {/* The single accessible equivalent the screen reader announces. */}
      <span className="crt-sr-only">{BOOT_LOGO_TEXT_EQUIVALENT}</span>
      {/* The persistent skip hint, in the oracle's dry voice. */}
      <p className="crt-boot-hint">{BOOT_SKIP_HINT}</p>
    </div>
  );
}
