"use client";

// src/components/RotReveal.tsx
//
// Feature: visual-necromancy, task 11.1.
//
// `RotReveal` is the presentational half of the Resurrection_Animation: it
// plays the "code rot then rebirth" sequence and then renders the unchanged
// diff and Vitality_Delta. All timing comes from the `useRot` playback hook,
// which reuses the same `FramePort` tick pattern as `use-reveal`; this
// component only decides what to draw for the frame index the hook reports.
//
// Full motion (R6.1, R6.3):
//   1. For each Decay_Sequence frame `i`, render
//      `rot(preRitualCode, decaySequence[i], seed)` as selectable DOM text in a
//      single `<pre>` (decay rises from 0 to 1 — "rot").
//   2. Once the sequence reaches decay 1 (`useRot` reports `done`), reveal the
//      revived code ("rebirth"), then the diff (`renderFileResult`) and then the
//      Vitality_Delta (`renderResurrectVitality`).
//
// Reduced motion (R6.9): a single synchronous render of revived code + diff +
// vitality delta, with zero rot/rebirth frames — `useRot` reports the final
// frame on its first render.
//
// The diff content and the Vitality_Delta are rendered exactly as the
// resurrection engine produced them; this component never alters a diff line or
// the delta (R6.2, R6.3). The revived code, diff and vitality delta are
// selectable DOM text appended inside the existing `role="log"` region, so the
// Live_Region semantics of spec 03-crt-terminal are preserved (R6.10). The
// Flash_Limit cap (R6.11) lives in `useRot` (`MIN_ROT_FRAME_MS`).
//
// _Requirements: R6.1, R6.2, R6.3, R6.9, R6.10, R6.11_

import type { MotionMode } from "../motion/motion-mode.js";
import type { FramePort } from "../ports.js";
import type {
  ResurrectFileResult,
  VitalityResult,
} from "../protocol.js";
import { decaySequence } from "../motion/decay.js";
import { rot } from "../render/rot.js";
import { renderFileResults } from "../render/resurrect-diff.js";
import { renderResurrectVitality } from "../render/resurrect-vitality.js";
import type { BlockDraft, OutputBlock } from "../render/blocks.js";
import { useRot } from "../hooks/use-rot.js";
import { OutputBlockView } from "./OutputBlockView.js";

/** The number of rot frames the Resurrection_Animation plays before rebirth. */
export const ROT_FRAME_COUNT = 5;

/** Props for the rot-and-rebirth playback view. */
export interface RotRevealProps {
  /** The pre-ritual source text that visibly decays during the rot phase. */
  readonly preRitualCode: string;
  /** The revived source text revealed after the rot phase completes. */
  readonly revivedCode: string;
  /** The per-file diff the resurrection engine produced (rendered unchanged). */
  readonly files: readonly ResurrectFileResult[];
  /** The Vitality_Delta / changed-card result (rendered unchanged). */
  readonly vitality: VitalityResult;
  /** The only randomness source for the rot corruption; deterministic in Demo. */
  readonly seed: number;
  /** The effective Motion_Mode; only `full` plays the rot/rebirth frames. */
  readonly motionMode: MotionMode;
  /** The animation-frame scheduler and clock (same port `use-reveal` uses). */
  readonly frames: FramePort;
  /**
   * How many rot frames to play before rebirth. Defaults to `ROT_FRAME_COUNT`.
   * The Decay_Sequence of this length drives the frame content; the diff is
   * never touched (R6.3).
   */
  readonly frameCount?: number;
}

/**
 * Attach stable ids to a sequence of drafts so each renders through the
 * existing `OutputBlockView`. The ids are negative and offset per block so they
 * never collide with the positive, reducer-assigned ids of the surrounding log.
 */
function toBlocks(drafts: readonly BlockDraft[], base: number): OutputBlock[] {
  return drafts.map((draft, index) => ({ ...draft, id: base - index }));
}

/**
 * Play the rot-and-rebirth animation, then render the unchanged diff and
 * Vitality_Delta. In reduced motion the rot phase is skipped entirely and the
 * final state renders in one pass.
 */
export function RotReveal({
  preRitualCode,
  revivedCode,
  files,
  vitality,
  seed,
  motionMode,
  frames,
  frameCount = ROT_FRAME_COUNT,
}: RotRevealProps): React.JSX.Element {
  // The decay amounts for the rot phase. `decaySequence` guarantees the first
  // amount is 0 and the last is 1 (R6.3); the playback hook steps its index.
  const sequence = decaySequence(frameCount);

  const { frameIndex, done } = useRot({
    frames,
    motionMode,
    frameCount: sequence.length,
  });

  // During the rot phase (full motion, not yet done), show the decayed source
  // for the current frame as selectable DOM text. `rot` preserves the line
  // count and total length for every decay, including 1 (R6.5).
  if (!done) {
    const amount = sequence[frameIndex] ?? sequence.at(-1) ?? 0;
    const decayed = rot(preRitualCode, amount, seed);
    return (
      <section className="crt-block" data-kind="status" data-rot="running">
        <pre className="crt-line crt-rot-frame">{decayed}</pre>
      </section>
    );
  }

  // Rebirth: the revived code, then the unchanged diff, then the Vitality_Delta.
  // Each is selectable DOM text; the diff and delta blocks come straight from
  // the engine renderers and are rendered in their final, complete state
  // (`revealedCount={null}`), so this view never alters them (R6.2, R6.3).
  const diffBlocks = toBlocks(renderFileResults(files), -1000);
  const vitalityBlock = toBlocks([renderResurrectVitality(vitality)], -2000)[0]!;

  return (
    <>
      <section className="crt-block" data-kind="status" data-rot="done">
        <pre className="crt-line crt-revived-code">{revivedCode}</pre>
      </section>
      {diffBlocks.map((block) => (
        <OutputBlockView key={block.id} block={block} revealedCount={null} />
      ))}
      <OutputBlockView block={vitalityBlock} revealedCount={null} />
    </>
  );
}
