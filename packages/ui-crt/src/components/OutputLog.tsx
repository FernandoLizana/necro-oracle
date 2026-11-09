// src/components/OutputLog.tsx
//
// Feature: 03-crt-terminal, task 17.2.
//
// The live Oracle output region: a single `role="log"` element with
// `aria-live="polite"`, `aria-relevant="additions"` and an `aria-busy` that
// mirrors the in-flight request one tick late (Q12). It is the ONE scroll
// container in the terminal and is `tabindex="0"` so it can be scrolled by
// keyboard (R17.4, R17.5). It renders each `OutputBlock` through
// `OutputBlockView`; nothing here parses repository text.
//
// _Requirements: R10.4, R15.1, R15.3, R15.11, R15.13, R17.4, R17.5_

import { forwardRef } from "react";

import type { OutputBlock } from "../render/blocks.js";
import { OutputBlockView } from "./OutputBlockView.js";
import { SOUND_UNAVAILABLE_MESSAGE } from "../hooks/use-terminal.js";

/** Props for the output log. */
export interface OutputLogProps {
  /** The ordered blocks to render. */
  readonly blocks: readonly OutputBlock[];
  /** Whether the Live_Region reports work in progress (R15.3). */
  readonly ariaBusy: boolean;
  /** Revealed-character count for a block, or `null` when not animating. */
  readonly revealedCountFor: (blockId: number, fullLength: number) => number | null;
  /** Whether to append the in-world "speakers are silent" notice (R19.14). */
  readonly engineFailed: boolean;
  /**
   * Extra content rendered inside the scroll container after the log blocks
   * (e.g. the resurrect/lovers result views). These must live INSIDE the
   * scroll pane, not as siblings after the command bar, or the page overflows.
   */
  readonly children?: React.ReactNode;
}

/** The complete text length of a block (used for the reveal fraction). */
function textLength(block: OutputBlock): number {
  return [...block.lines.map((line) => line.segments.map((s) => s.text).join("")).join("\n")]
    .length;
}

/** The live Oracle output log (`role="log"`). */
export const OutputLog = forwardRef<HTMLDivElement, OutputLogProps>(
  function OutputLog(
    { blocks, ariaBusy, revealedCountFor, engineFailed, children },
    ref,
  ): React.JSX.Element {
    return (
      <div
        ref={ref}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={ariaBusy ? "true" : "false"}
        aria-label="Oracle output"
        tabIndex={0}
        className="crt-log"
      >
        {blocks.map((block) => (
          <OutputBlockView
            key={block.id}
            block={block}
            revealedCount={revealedCountFor(block.id, textLength(block))}
          />
        ))}
        {engineFailed ? (
          <section className="crt-block" data-kind="error" data-reveal="done">
            <div className="crt-live">
              <p className="crt-line">{SOUND_UNAVAILABLE_MESSAGE}</p>
            </div>
          </section>
        ) : null}
        {children}
      </div>
    );
  },
);
