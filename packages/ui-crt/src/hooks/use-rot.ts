"use client";

// src/hooks/use-rot.ts
//
// Feature: visual-necromancy, task 11.1.
//
// `useRot` is the rot playback hook that drives the "code rot" half of the
// Resurrection_Animation. It reuses the exact `FramePort` self-rescheduling
// pattern of `use-reveal`: it schedules an animation frame ONLY while the
// Decay_Sequence still has frames left to show AND the Motion_Mode is `full`,
// and it cancels its pending frame on unmount or whenever its inputs change.
// In `reduced` motion it schedules no frame and reports the final frame index
// immediately, so an idle or reduced-motion terminal spins no
// `requestAnimationFrame` loop (mirrors R16.9 of spec 03-crt-terminal).
//
// The component reads the reported `frameIndex` and renders
// `rot(preRitualCode, decaySequence[frameIndex], seed)` for that frame, then —
// once the sequence reaches its last amount (decay 1) — reveals the revived
// code, the diff and the Vitality_Delta. The hook therefore owns only the
// *timing*; it never touches the diff content or the vitality delta.
//
// Flash_Limit (R6.11): a decay step is only allowed to advance after at least
// `MIN_ROT_FRAME_MS` (500 ms) of frame-clock time has elapsed since the last
// advance. That caps visible luminance changes at ≤ 2 per second, well under
// the Flash_Limit of three flashes per one-second window. The cap is enforced
// on the frame clock reported by `FramePort`, so it is fully deterministic in
// tests (the fake clock is advanced manually) and carries no wall-clock access.
//
// _Requirements: R6.1, R6.3, R6.9, R6.11_

import { useEffect, useRef, useState } from "react";

import type { FramePort } from "../ports.js";
import type { MotionMode } from "../motion/motion-mode.js";

/**
 * The minimum frame-clock interval, in milliseconds, between two visible decay
 * steps. At ≥ 500 ms per step the rot animation changes luminance at most twice
 * per second, keeping it inside the Flash_Limit (≤ 3 flashes/sec, R6.11).
 */
export const MIN_ROT_FRAME_MS = 500;

/** Inputs to the rot playback driver. */
export interface UseRotOptions {
  /** The animation-frame scheduler and clock. */
  readonly frames: FramePort;
  /** The effective Motion_Mode; only `full` ever animates. */
  readonly motionMode: MotionMode;
  /**
   * The number of decay frames to step through, i.e. `decaySequence(...).length`.
   * The hook steps the index from 0 to `frameCount - 1` inclusive.
   */
  readonly frameCount: number;
}

/** What the rot playback driver reports back to the component. */
export interface UseRotResult {
  /**
   * The index of the Decay_Sequence frame to render right now. In `full` motion
   * it advances from 0 towards `frameCount - 1` over time (capped to
   * `MIN_ROT_FRAME_MS` between steps); in `reduced` motion it is the final index
   * from the first render. For an empty sequence (`frameCount <= 0`) it is `0`.
   */
  readonly frameIndex: number;
  /**
   * Whether the rot animation has reached its final frame (decay 1). The
   * component reveals the revived code, the diff and the Vitality_Delta once
   * this is `true`. It is `true` immediately in `reduced` motion and for an
   * empty sequence.
   */
  readonly done: boolean;
}

/**
 * Clamp a frame count to a non-negative integer. A non-finite or fractional
 * input floors to the nearest whole frame count at or below the value; negatives
 * and `NaN` become `0` (no frames).
 */
function normaliseFrameCount(frameCount: number): number {
  if (Number.isNaN(frameCount)) return 0;
  const floored = Math.floor(frameCount);
  return floored > 0 ? floored : 0;
}

/**
 * Drive a capped, self-rescheduling animation-frame loop that steps the
 * Decay_Sequence index in `full` motion, and report the current frame index to
 * the component. Schedules nothing in `reduced` motion or once the last frame
 * is reached, and cancels any pending frame on unmount or input change.
 */
export function useRot(options: UseRotOptions): UseRotResult {
  const { frames, motionMode, frameCount } = options;

  const count = normaliseFrameCount(frameCount);
  const lastIndex = count > 0 ? count - 1 : 0;

  // In reduced motion (or with no frames) the component shows the final state
  // in a single render, so the index starts — and stays — at the last frame.
  const reduced = motionMode !== "full";
  const [frameIndex, setFrameIndex] = useState<number>(
    reduced ? lastIndex : 0,
  );

  // Frame-clock timestamp (ms) at which the currently-shown decay step became
  // visible. A step may only advance once `MIN_ROT_FRAME_MS` has elapsed since
  // this mark, which enforces the Flash_Limit cadence (R6.11).
  const lastStepAtRef = useRef<number | null>(null);

  useEffect(() => {
    // Reduced motion, or a sequence already at (or past) its last frame: show
    // the final frame and request no animation frame at all. Returning before
    // touching the FramePort keeps the idle request count at 0.
    if (reduced || count <= 1) {
      setFrameIndex(lastIndex);
      return;
    }

    // Full motion with real work to do: start from frame 0 and reset the
    // cadence mark so the first advance is timed from this frame's clock.
    setFrameIndex(0);
    lastStepAtRef.current = null;

    let handle: number | null = null;
    let cancelled = false;

    const schedule = (): void => {
      handle = frames.request((nowMs) => {
        if (cancelled) return;

        if (lastStepAtRef.current === null) {
          // First frame of the loop: anchor the cadence clock without advancing.
          lastStepAtRef.current = nowMs;
        } else if (nowMs - lastStepAtRef.current >= MIN_ROT_FRAME_MS) {
          // Enough time has passed to show the next decay step (Flash_Limit cap).
          lastStepAtRef.current = nowMs;
          setFrameIndex((current) => {
            const next = current + 1;
            return next >= lastIndex ? lastIndex : next;
          });
        }

        // Keep the loop alive until the effect re-runs (the index reaching the
        // last frame flips `done` and the caller can stop driving us by, e.g.,
        // unmounting); the cleanup below cancels the pending frame.
        schedule();
      });
    };

    schedule();

    return () => {
      cancelled = true;
      if (handle !== null) frames.cancel(handle);
    };
  }, [frames, reduced, count, lastIndex]);

  const done = frameIndex >= lastIndex;
  return { frameIndex, done };
}
