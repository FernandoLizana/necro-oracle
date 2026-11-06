// src/components/AsciiCardView.tsx
//
// Feature: visual-necromancy, task 10.1.
//
// Presentational view for one framed ASCII tarot card (`AsciiCard`). The
// card's glyph rows are rendered as ordinary, selectable DOM text inside a
// `<pre aria-hidden="true">` — never a canvas — with a sibling
// `<span class="crt-sr-only">` carrying the `accessibleText` (numeral + name +
// orientation) so the screen reader hears the card exactly once while the
// decorative glyph art stays out of the a11y tree. This mirrors the
// `crt-sr-only` + `aria-hidden` decorative pattern used by `OutputBlockView`
// (R3.4, R10.2).
//
// Orientation is emitted as `data-orientation`; the 180° rotation of reversed
// cards and the counter-rotated upright text overlay are handled entirely in
// CSS (task 14.1), so this component only emits the attribute (R3.6, R3.7).
//
// The Glitch_Profile drives the severity glitch, but only in `full` motion AND
// only when the severity actually glitches (`intensity > 0`): the glitch class
// and its CSS custom properties are applied solely when `motionMode === "full"`
// and `glitch.intensity > 0`, and omitted entirely in reduced motion or for a
// calm severity-0 card (R5.1, R5.3, R5.7, R5.12). A severity-0 card therefore
// renders in its steady single-image resting state — no chromatic doubling.
// `data-burning` is set only for the amber-burning cards `tower` and
// `devil` (R5.8). The Tower's shake class is added only for `tower` at
// Glitch_Intensity ≥ 2 in full motion (R5.9, R5.10). The glitch animation never
// alters the selectable text — the corrupted glyphs are a transient CSS layer,
// so the card text and its screen-reader equivalent are stable.
//
// _Requirements: R3.4, R3.6, R3.7, R5.1, R5.7, R5.8, R5.9, R5.10, R5.12, R10.2_

"use client";

import type { CSSProperties } from "react";

import type { GlitchParams } from "../motion/glitch.js";
import type { MotionMode } from "../motion/motion-mode.js";
import type { AsciiCard } from "../render/ascii-card.js";

/** The CSS class that drives the severity glitch animation (full motion only). */
export const GLITCH_CLASS = "crt-glitch";

/** The CSS class that drives the Tower's shake (full motion, intensity ≥ 2). */
export const SHAKE_CLASS = "crt-shake";

/** The CardIds that burn amber (`data-burning`). */
const BURNING_CARDS = new Set(["tower", "devil"]);

/** The minimum Glitch_Intensity at which the Tower shakes. */
const SHAKE_MIN_INTENSITY = 2;

/** Props for a single rendered ASCII card. */
export interface AsciiCardViewProps {
  /** The framed ASCII card to render (rows, cardId, orientation, a11y text). */
  readonly card: AsciiCard;
  /** The severity-derived glitch parameters; applied only in full motion. */
  readonly glitch: GlitchParams;
  /** The effective motion mode; `reduced` suppresses all glitch effects. */
  readonly motionMode: MotionMode;
}

/**
 * The CSS custom properties the glitch animation reads, derived from
 * `GlitchParams`. These are only attached in full motion; the stylesheet
 * (task 14.1) consumes them to size the chromatic offset, scanline tears,
 * transient corruption, and duration.
 */
function glitchStyle(glitch: GlitchParams): CSSProperties {
  return {
    "--glitch-offset": `${glitch.offsetPx}px`,
    "--glitch-tears": String(glitch.tearCount),
    "--glitch-corrupt": String(glitch.corruptChars),
    "--glitch-duration": `${glitch.durationMs}ms`,
  } as CSSProperties;
}

/**
 * Render one framed ASCII tarot card.
 *
 * The glyph rows (joined with newlines) live in an `aria-hidden` `<pre>` as
 * selectable text; the `crt-sr-only` sibling carries the accessible equivalent.
 * In full motion the glitch class and custom properties are applied; in reduced
 * motion no glitch is emitted at all. `data-orientation` lets CSS flip reversed
 * cards, `data-burning` marks the amber Tower/Devil, and the shake class is
 * added only for a severe Tower in full motion.
 */
export function AsciiCardView({
  card,
  glitch,
  motionMode,
}: AsciiCardViewProps): React.JSX.Element {
  // The glitch is applied only in full motion AND only when the severity
  // actually produces a glitch (`intensity > 0`). A calm severity-0 card is
  // perfectly steady: it gets no glitch class, no `data-glitch-intensity`, no
  // glitch custom properties and no shake — identical to reduced motion for
  // that card (R5.3: severity 0 ⇒ all-zero / steady).
  const glitching = motionMode === "full" && glitch.intensity > 0;
  const burning = BURNING_CARDS.has(card.cardId);
  const shaking =
    glitching && card.cardId === "tower" && glitch.intensity >= SHAKE_MIN_INTENSITY;

  // The glitch class/attributes/custom-properties are gated on `glitching`.
  const classes = ["crt-ascii-card"];
  if (glitching) classes.push(GLITCH_CLASS);
  if (shaking) classes.push(SHAKE_CLASS);

  return (
    <div
      className={classes.join(" ")}
      data-card={card.cardId}
      data-orientation={card.orientation}
      {...(burning ? { "data-burning": "true" } : {})}
      {...(glitching
        ? { "data-glitch-intensity": String(glitch.intensity), style: glitchStyle(glitch) }
        : {})}
    >
      <pre className="crt-ascii-card-art" aria-hidden="true">
        {card.rows.join("\n")}
      </pre>
      <span className="crt-sr-only">{card.accessibleText}</span>
    </div>
  );
}
