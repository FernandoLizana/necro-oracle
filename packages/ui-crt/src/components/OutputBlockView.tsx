// src/components/OutputBlockView.tsx
//
// Feature: 03-crt-terminal, task 17.2.
//
// Renders one `OutputBlock` as a `<section class="crt-block">`. The block's
// COMPLETE text is always present in the `.crt-live` copy as ordinary DOM text
// nodes, so the screen reader hears it exactly once, at append time (R10.4,
// R15.1). While the block's typewriter reveal is running (full motion only),
// the live copy is visually hidden with `crt-sr-only` and a second,
// `aria-hidden` `.crt-reveal` copy shows the revealed prefix; once the reveal
// completes (or in reduced motion) there is no reveal copy and the live copy is
// shown directly.
//
// Repository-derived text is rendered strictly as text nodes. The ONLY anchor
// is a built Evidence_Link segment (its `href` comes solely from
// `buildEvidenceLink`), and it carries `rel="noopener noreferrer"` and
// `target="_blank"` (R14.1, R14.5). There is no `dangerouslySetInnerHTML`.
//
// _Requirements: R10.4, R14.1, R14.5, R15.1, R15.11_

import { Fragment } from "react";

import type { OutputBlock, OutputLine } from "../render/blocks.js";
import { blockText } from "../render/blocks.js";
import type { Segment } from "../text/wrap.js";

/** Props for a single rendered block. */
export interface OutputBlockViewProps {
  /** The block to render. */
  readonly block: OutputBlock;
  /**
   * How many characters of the block are revealed right now, or `null` when the
   * block is not animating (show the full text with no reveal copy).
   */
  readonly revealedCount: number | null;
}

/** Render one segment: a text node, or the single safe Evidence_Link anchor. */
function SegmentView({ segment }: { readonly segment: Segment }): React.JSX.Element {
  if (segment.href === undefined) {
    // Repository-derived text is always an inert text node.
    return <>{segment.text}</>;
  }
  return (
    <a href={segment.href} rel="noopener noreferrer" target="_blank">
      {segment.text}
    </a>
  );
}

/** Render one `.crt-line` paragraph of segments. */
function LineView({ line }: { readonly line: OutputLine }): React.JSX.Element {
  return (
    <p className="crt-line">
      {line.segments.map((segment, index) => (
        <SegmentView key={index} segment={segment} />
      ))}
    </p>
  );
}

/** Render a single output block, with its optional typewriter reveal copy. */
export function OutputBlockView({
  block,
  revealedCount,
}: OutputBlockViewProps): React.JSX.Element {
  const revealing = revealedCount !== null;

  // When a block is NOT animating (reveal finished, or reduced motion), its
  // lines are rendered directly ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â there is no separate live/reveal pairing.
  // While it animates, the full text lives in a `.crt-live` copy (clipped with
  // `crt-sr-only`, still in the a11y tree so it was announced once at append),
  // and an aria-hidden `.crt-reveal` copy shows the typed prefix.
  // Item 38: render each wrapped line as its own <p>, but interleave a newline
  // TEXT NODE between adjacent lines. Two bare block <p> elements concatenate in
  // `textContent` with NO separator ("...in your" + "stead." -> "yourstead"),
  // dropping the word-break space `wrapText` removed at the wrap. The "\n" text
  // node restores a word boundary in `textContent` (and the accessibility tree)
  // so a sentence wrapped across lines still reads correctly; it is collapsed to
  // nothing visually between block elements, so the layout is unchanged.
  const lines = (
    <>
      {block.lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 ? "\n" : null}
          <LineView line={line} />
        </Fragment>
      ))}
    </>
  );

  return (
    <section
      className="crt-block"
      data-kind={block.kind}
      data-reveal={revealing ? "running" : "done"}
    >
      {revealing ? (
        <>
          <div className="crt-live crt-sr-only">{lines}</div>
          <div className="crt-reveal" aria-hidden="true">
            <pre className="crt-line">
              {[...blockText(block)].slice(0, revealedCount).join("")}
            </pre>
          </div>
        </>
      ) : (
        lines
      )}
    </section>
  );
}
