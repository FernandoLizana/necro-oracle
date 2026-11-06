"use client";

// src/components/VitalityCounter.tsx
//
// Feature: visual-necromancy, task 21.3 (OPTIONAL flourish).
//
// `VitalityCounter` is a purely decorative visual embellishment that counts the
// Vitality_Delta from `beforeVitality` up or down to `afterVitality` as the
// rebirth settles. All timing comes from `useCountUp`, which reuses the
// `FramePort` tick pattern of `use-rot`:
//   - Full motion (R13.4): the visible number steps one at a time from before
//     to after, paced to `MIN_COUNT_FRAME_MS` so the digits read as a smooth
//     count and the text change never becomes a rapid luminance flash. It then
//     settles exactly on the final value.
//   - Reduced motion (R13.3): the final value shows immediately, with no
//     animation frame requested at all.
//
// The element is `aria-hidden` on purpose. The authoritative Vitality_Delta —
// `VITALITY 40/100 -> 58/100 (+18)` — already lives in the `role="log"` block
// produced by `renderResurrectVitality`, where the Live_Region announces it
// exactly once (design D1, R6.10). This counter must therefore never be
// announced, or the screen reader would hear every intermediate count. It is a
// visual flourish over/alongside the log, never a second source of truth.
//
// When re-diagnosis failed (`afterVitality` is `null`, R6.5) there is no final
// delta to count to, so the counter renders nothing.
//
// _Requirements: R13.3, R13.4_

import type { MotionMode } from "../motion/motion-mode.js";
import type { FramePort } from "../ports.js";
import { useCountUp } from "../hooks/use-count-up.js";

/** Props for the decorative Vitality_Delta count-up flourish. */
export interface VitalityCounterProps {
  /** The pre-ritual vitality the count departs from (0-100). */
  readonly beforeVitality: number;
  /**
   * The post-ritual vitality the count settles on (0-100), or `null` when
   * re-diagnosis never completed (R6.5) — in which case nothing is rendered.
   */
  readonly afterVitality: number | null;
  /** The effective Motion_Mode; only `full` animates the count. */
  readonly motionMode: MotionMode;
  /** The animation-frame scheduler and clock (same port `use-rot` uses). */
  readonly frames: FramePort;
}

/**
 * Render the decorative, `aria-hidden` Vitality_Delta count-up. Shows the
 * counting value (full motion) or the final value (reduced motion); renders
 * nothing when there is no final vitality to count to.
 */
export function VitalityCounter({
  beforeVitality,
  afterVitality,
  motionMode,
  frames,
}: VitalityCounterProps): React.JSX.Element | null {
  // No second reading => no delta to count to: render nothing (R6.5). The hook
  // is still called unconditionally (rules of hooks) with a no-op `to`.
  const { value, done } = useCountUp({
    frames,
    motionMode,
    from: beforeVitality,
    to: afterVitality ?? beforeVitality,
  });

  if (afterVitality === null) return null;

  return (
    <div
      className="crt-vitality-counter"
      data-counting={done ? "done" : "running"}
      aria-hidden="true"
    >
      <span className="crt-vitality-counter-value">{value}</span>
      <span className="crt-vitality-counter-max">/100</span>
    </div>
  );
}
