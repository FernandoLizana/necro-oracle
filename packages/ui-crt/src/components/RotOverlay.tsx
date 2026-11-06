"use client";

// src/components/RotOverlay.tsx
//
// Feature: visual-necromancy, task 16.1.
//
// `RotOverlay` is the decorative rot-then-rebirth layer of a resurrection. It
// plays the code-rot animation over the terminal: the pre-ritual source visibly
// decays frame by frame (`rot(source, decaySequence[i], seed)`), then the
// revived source is revealed. The authoritative diff (`renderFileResult`) and
// the Vitality_Delta (`renderResurrectVitality`) are NOT drawn here — the pure
// reducer already appended them to the `role="log"` region when the ritual
// resolved, so the Live_Region announces them exactly once (design D1, R6.10).
// This layer is therefore `aria-hidden`: a visual flourish over the log, never
// a second copy of the diff for assistive technology.
//
// Timing is owned entirely by `useRot`, which reuses the `FramePort` tick
// pattern of `use-reveal` and caps the decay cadence at `MIN_ROT_FRAME_MS` so
// luminance changes stay inside the Flash_Limit (R6.11). In reduced motion
// `useRot` reports the final frame on its first render, so the overlay shows
// the revived code immediately with zero rot frames (R6.9).
//
// The pre-ritual and revived source are reconstructed from the ritual's own
// per-file diff lines (`remove`/`context` form the before, `add`/`context` form
// the after), so no extra server data is needed and the decay plays over the
// code the resurrection actually changed (R6.1, R6.3).
//
// _Requirements: R6.1, R6.3, R6.9, R6.10, R6.11_

import { useEffect, useMemo } from "react";

import type { MotionMode } from "../motion/motion-mode.js";
import type { FramePort } from "../ports.js";
import type { ResurrectFileResult } from "../protocol.js";
import { decaySequence } from "../motion/decay.js";
import { rot } from "../render/rot.js";
import { ROT_FRAME_COUNT } from "./RotReveal.js";
import { useRot } from "../hooks/use-rot.js";

/** Props for the decorative rot-and-rebirth overlay. */
export interface RotOverlayProps {
  /** The per-file diff the resurrection produced (source of the before/after). */
  readonly files: readonly ResurrectFileResult[];
  /** The only randomness source for the rot corruption; `DEMO_SEED` in demo. */
  readonly seed: number;
  /** The effective Motion_Mode; only `full` plays the rot/rebirth frames. */
  readonly motionMode: MotionMode;
  /** The animation-frame scheduler and clock (same port `use-reveal` uses). */
  readonly frames: FramePort;
  /** How many rot frames to play before rebirth. Defaults to `ROT_FRAME_COUNT`. */
  readonly frameCount?: number;
  /**
   * Called whenever the rot-then-rebirth animation's active-playing state
   * changes (visual-necromancy task 21.1, OPTIONAL polish). `true` while the
   * decay is still running (the drone may hum), `false` once rebirth is reached
   * or there is nothing to animate. The Terminal forwards this to the ambient
   * hum gate so the single `useRot` here stays the one source of truth for rot
   * timing — no second frame loop. Optional; omitting it adds no behaviour.
   */
  readonly onPlayingChange?: (playing: boolean) => void;
}

/** The pre-ritual source reconstructed from the diff (remove + context lines). */
function beforeCode(files: readonly ResurrectFileResult[]): string {
  return files
    .flatMap((file) =>
      file.diff
        .filter((line) => line.kind !== "add")
        .map((line) => line.text),
    )
    .join("\n");
}

/** The revived source reconstructed from the diff (add + context lines). */
function afterCode(files: readonly ResurrectFileResult[]): string {
  return files
    .flatMap((file) =>
      file.diff
        .filter((line) => line.kind !== "remove")
        .map((line) => line.text),
    )
    .join("\n");
}

/**
 * Play the decorative rot-then-rebirth animation over the terminal. Draws the
 * decaying pre-ritual source during the rot phase, then the revived source;
 * never draws the diff or Vitality_Delta (those live in the log, R6.10).
 * Renders nothing once there is no source to decay.
 */
export function RotOverlay({
  files,
  seed,
  motionMode,
  frames,
  frameCount = ROT_FRAME_COUNT,
  onPlayingChange,
}: RotOverlayProps): React.JSX.Element | null {
  const sequence = useMemo(() => decaySequence(frameCount), [frameCount]);
  const preRitualCode = useMemo(() => beforeCode(files), [files]);
  const revivedCode = useMemo(() => afterCode(files), [files]);

  const { frameIndex, done } = useRot({
    frames,
    motionMode,
    frameCount: sequence.length,
  });

  // Nothing to decay: the overlay renders nothing and the animation is not
  // playing. The two early-return branches below mirror the render path.
  const hasSource = preRitualCode !== "" || revivedCode !== "";

  // The rot-then-rebirth animation is actively playing only while there is
  // source to decay and the rot phase has not yet reached rebirth. In reduced
  // motion `useRot` reports `done` on the first render, so playing stays false
  // (no frames animate), which keeps the ambient drone silent there (R13.1).
  const playing = hasSource && !done;
  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  // When the overlay unmounts (the ritual is cleared), report that the
  // animation is no longer playing so the ambient hum fades out for good.
  useEffect(() => {
    return () => {
      onPlayingChange?.(false);
    };
  }, [onPlayingChange]);

  if (!hasSource) return null;

  if (!done) {
    const amount = sequence[frameIndex] ?? sequence.at(-1) ?? 0;
    const decayed = rot(preRitualCode, amount, seed);
    return (
      <div className="crt-rot-overlay" data-rot="running" aria-hidden="true">
        <pre className="crt-line crt-rot-frame">{decayed}</pre>
      </div>
    );
  }

  return (
    <div className="crt-rot-overlay" data-rot="done" aria-hidden="true">
      <pre className="crt-line crt-revived-code">{revivedCode}</pre>
    </div>
  );
}
