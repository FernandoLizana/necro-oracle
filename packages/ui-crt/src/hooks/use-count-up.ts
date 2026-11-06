"use client";

// src/hooks/use-count-up.ts
//
// Feature: visual-necromancy, task 21.3 (OPTIONAL flourish).
//
// `useCountUp` drives a one-shot numeric count from a `from` value to a `to`
// value entirely through the injected `FramePort`, reusing the exact
// self-rescheduling tick pattern of `use-rot` / `use-reveal`. It is the timing
// engine behind the decorative Vitality_Delta counter: in full motion the
// visible number advances one step at a time from `from` towards `to`, capped
// to `MIN_COUNT_FRAME_MS` between steps so the text change is a smooth, paced
// count and never a rapid luminance flash (Flash_Limit, R13.4). In reduced
// motion it reports `to` on its first render and schedules no frame at all, so
// the final value shows instantly (R13.3) and an idle terminal spins no
// `requestAnimationFrame` loop.
//
// The hook owns only the *timing* and the *visible* intermediate value; it
// never announces anything. The authoritative Vitality_Delta lives in the
// `role="log"` block (`renderResurrectVitality`), announced exactly once (D1),
// so the count-up is purely a visual embellishment over/alongside that log.
//
// Direction is inferred from `from`/`to`: it counts up when `to > from` and
// down when `to < from`, always settling exactly on `to` (never overshooting).
//
// _Requirements: R13.3, R13.4_

import { useEffect, useRef, useState } from "react";

import type { FramePort } from "../ports.js";
import type { MotionMode } from "../motion/motion-mode.js";

/**
 * The minimum frame-clock interval, in milliseconds, between two visible count
 * steps. At >= 250 ms per step the number changes at most four times per
 * second; because a digit changing is a text change (not a full-screen
 * luminance inversion) this stays comfortably inside the Flash_Limit, and the
 * pacing keeps the count readable rather than a blur (R13.4).
 */
export const MIN_COUNT_FRAME_MS = 250;

/** Inputs to the count-up driver. */
export interface UseCountUpOptions {
  /** The animation-frame scheduler and clock (same port `use-rot` uses). */
  readonly frames: FramePort;
  /** The effective Motion_Mode; only `full` ever animates. */
  readonly motionMode: MotionMode;
  /** The starting value the count departs from (e.g. `beforeVitality`). */
  readonly from: number;
  /** The final value the count settles on (e.g. `afterVitality`). */
  readonly to: number;
}

/** What the count-up driver reports back to the component. */
export interface UseCountUpResult {
  /**
   * The integer value to display right now. In `full` motion it steps from
   * `from` towards `to` over time (capped to `MIN_COUNT_FRAME_MS` between
   * steps); in `reduced` motion it is `to` from the first render. It never
   * passes `to`.
   */
  readonly value: number;
  /** Whether the count has settled on its final value (`value === to`). */
  readonly done: boolean;
}

/** Floor to a safe integer; non-finite inputs collapse to `0`. */
function toInt(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/**
 * Drive a capped, self-rescheduling animation-frame loop that steps a visible
 * number from `from` to `to` in `full` motion, and report the current value.
 * Schedules nothing in `reduced` motion or once the target is reached, and
 * cancels any pending frame on unmount or input change.
 */
export function useCountUp(options: UseCountUpOptions): UseCountUpResult {
  const { frames, motionMode, from, to } = options;

  const start = toInt(from);
  const target = toInt(to);
  const reduced = motionMode !== "full";

  // Reduced motion (or no distance to cover) shows the final value at once.
  const [value, setValue] = useState<number>(
    reduced || start === target ? target : start,
  );

  // Frame-clock timestamp (ms) at which the currently-shown value became
  // visible. A step may only advance once `MIN_COUNT_FRAME_MS` has elapsed
  // since this mark, which paces the count (R13.4).
  const lastStepAtRef = useRef<number | null>(null);

  useEffect(() => {
    // Reduced motion, or already at the target: show the final value and
    // request no animation frame. Returning before touching the FramePort
    // keeps the idle request count at 0 (R13.3).
    if (reduced || start === target) {
      setValue(target);
      return;
    }

    // Full motion with real distance to cover: start from `start` and reset
    // the cadence mark so the first advance is timed from this frame's clock.
    setValue(start);
    lastStepAtRef.current = null;

    const step = target > start ? 1 : -1;

    let handle: number | null = null;
    let cancelled = false;

    const schedule = (): void => {
      handle = frames.request((nowMs) => {
        if (cancelled) return;

        if (lastStepAtRef.current === null) {
          // First frame of the loop: anchor the cadence clock, do not advance.
          lastStepAtRef.current = nowMs;
        } else if (nowMs - lastStepAtRef.current >= MIN_COUNT_FRAME_MS) {
          lastStepAtRef.current = nowMs;
          setValue((current) => {
            const next = current + step;
            // Never overshoot the target in either direction.
            return step > 0
              ? Math.min(next, target)
              : Math.max(next, target);
          });
        }

        // Keep the loop alive; the cleanup below cancels the pending frame once
        // the effect re-runs (e.g. on unmount or when `done` stops the caller).
        schedule();
      });
    };

    schedule();

    return () => {
      cancelled = true;
      if (handle !== null) frames.cancel(handle);
    };
  }, [frames, reduced, start, target]);

  return { value, done: value === target };
}
