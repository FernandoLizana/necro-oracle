"use client";

// src/hooks/use-reveal.ts
//
// Feature: 03-crt-terminal, task 17.2.
//
// `useReveal` drives the typewriter reveal entirely through the injected
// `FramePort`. It schedules an animation frame ONLY while there is reveal work
// pending AND the Motion_Mode is `full`; on each frame it reports the current
// clock through `onTick`, which the Terminal turns into a `reveal.tick` action
// so the pure reducer advances the revealed-character count. The loop
// re-schedules itself while work remains and cancels its pending frame on
// unmount.
//
// Crucially, in `reduced` mode — or whenever nothing is pending — NO frame is
// ever requested, so an idle terminal spins no `requestAnimationFrame` loop
// (R16.9). The fake `FramePort` has a manual clock, so the schedule is fully
// deterministic in tests.
//
// _Requirements: R10.1, R10.2, R10.3, R10.8, R10.11, R16.9_

import { useEffect } from "react";

import type { FramePort } from "../ports.js";
import type { MotionMode } from "../motion/motion-mode.js";

/** Inputs to the reveal driver. */
export interface UseRevealOptions {
  /** The animation-frame scheduler and clock. */
  readonly frames: FramePort;
  /** The effective Motion_Mode; only `full` ever animates. */
  readonly motionMode: MotionMode;
  /** Whether any block is still revealing (the reducer's reveal queue is non-empty). */
  readonly pending: boolean;
  /** Called on every frame with the current clock, in milliseconds. */
  readonly onTick: (nowMs: number) => void;
}

/**
 * Schedule a self-rescheduling animation-frame loop while a reveal is pending
 * in full motion; schedule nothing otherwise. Cancels the pending frame on
 * unmount or whenever the inputs change.
 */
export function useReveal(options: UseRevealOptions): void {
  const { frames, motionMode, pending, onTick } = options;

  useEffect(() => {
    // No animation loop in reduced motion or when there is nothing to reveal
    // (R16.9): return before touching the FramePort so `requestCount()` is 0.
    if (motionMode !== "full" || !pending) {
      return;
    }

    let handle: number | null = null;
    let cancelled = false;

    const schedule = (): void => {
      handle = frames.request((nowMs) => {
        if (cancelled) return;
        onTick(nowMs);
        // Keep the loop alive while work may remain; the parent stops it by
        // flipping `pending` to false, which re-runs this effect's cleanup.
        schedule();
      });
    };

    schedule();

    return () => {
      cancelled = true;
      if (handle !== null) frames.cancel(handle);
    };
  }, [frames, motionMode, pending, onTick]);
}
