"use client";

// src/hooks/use-boot.ts
//
// Feature: visual-necromancy, task 9.1.
//
// `useBoot` drives the one-time CRT Boot_Sequence overlay. It mirrors
// `use-reveal`: a self-rescheduling animation-frame loop that runs ONLY while
// the Motion_Mode is `full` AND the boot is still `playing`. Each frame reports
// the current clock through `onTick`, which the Terminal turns into a
// `boot.tick` action so the pure reducer advances the displayed step and, at the
// last step, transitions the boot phase to `"done"` (R1.1). In reduced motion,
// under the `bootSignal` test flag, or once boot is done, the `bootPhase` the
// caller passes is already `"done"`, so NO frame is ever requested and an idle
// terminal spins no `requestAnimationFrame` loop (R1.5, R1.6, R16.9).
//
// The hook also owns the skip listener. While the boot is playing, any key that
// is NOT a lone modifier (Shift / Control / Alt / Meta) — or any control
// activation routed through the same handler — dispatches a skip through
// `onSkip`, which the Terminal turns into a `boot.skip` action and a focus of the
// Command_Line (R1.3).
//
// FramePort availability (R1.9): the `FramePort` is injected as possibly
// `undefined`. If the boot is `playing` in full motion but no `FramePort` is
// available to animate it, the hook calls `onUnavailable` once so the consumer
// can force `bootPhase: "done"` immediately — the Terminal always reaches the
// ready state even when the animation cannot run.
//
// This stays a pure client hook: it touches only the injected `FramePort` and a
// keydown listener on the injected root (or `document` by default), and it
// cleans up both the listener and any pending frame on unmount or input change.
//
// _Requirements: R1.3, R1.5, R1.6, R1.9_

import { useEffect, useRef, type RefObject } from "react";

import type { FramePort } from "../ports.js";
import type { MotionMode } from "../motion/motion-mode.js";

/** The boot phase this hook observes; mirrors `BootState["phase"]`. */
export type BootPhase = "playing" | "done";

/** Inputs to the boot driver. */
export interface UseBootOptions {
  /**
   * The animation-frame scheduler and clock. Possibly `undefined` when no
   * `FramePort` is available (R1.9): the hook then forces the boot done rather
   * than animating.
   */
  readonly frames: FramePort | undefined;
  /** The effective Motion_Mode; only `full` ever animates the boot. */
  readonly motionMode: MotionMode;
  /** The current boot phase; the loop only runs while `"playing"`. */
  readonly bootPhase: BootPhase;
  /** Called on every frame with the current clock, in milliseconds. */
  readonly onTick: (nowMs: number) => void;
  /**
   * Called when a non-modifier key or control activation ends the boot. The
   * Terminal turns this into a `boot.skip` action and focuses the Command_Line.
   */
  readonly onSkip: () => void;
  /**
   * Called at most once when the boot is `playing` in full motion but no
   * `FramePort` is available to animate it. The consumer forces
   * `bootPhase: "done"` so the Terminal still reaches the ready state (R1.9).
   */
  readonly onUnavailable?: (() => void) | undefined;
  /**
   * The element whose `keydown` ends the boot. Defaults to `document` when the
   * ref is absent or null, so the skip listener always has a target while the
   * boot is playing.
   */
  readonly rootRef?: RefObject<HTMLElement | null> | undefined;
}

/**
 * True for a keydown that should skip the boot: any key that is not a lone
 * modifier. A press that only produces Shift, Control, Alt, or Meta does not
 * skip (R1.3).
 */
function isSkipKey(event: KeyboardEvent): boolean {
  switch (event.key) {
    case "Shift":
    case "Control":
    case "Alt":
    case "Meta":
      return false;
    default:
      return true;
  }
}

/**
 * Drive the Boot_Sequence overlay. Schedules a self-rescheduling animation-frame
 * loop while the boot is playing in full motion, forces the boot done when no
 * `FramePort` is available, and installs a skip listener that ends the boot on
 * any non-modifier key. Returns nothing; every effect flows through the injected
 * port, the injected root, and the supplied callbacks. Safe to call every render.
 */
export function useBoot(options: UseBootOptions): void {
  const { frames, motionMode, bootPhase, onTick, onSkip, onUnavailable, rootRef } =
    options;

  // Keep the newest callbacks reachable from the long-lived listener without
  // re-subscribing on every render.
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const onSkipRef = useRef(onSkip);
  onSkipRef.current = onSkip;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  // ----- Frame loop: only while playing in full motion. ---------------------
  useEffect(() => {
    // No animation loop in reduced motion or once boot is done (R1.5, R1.6,
    // R16.9): return before touching the FramePort so no frame is requested.
    if (motionMode !== "full" || bootPhase !== "playing") {
      return;
    }

    // Playing in full motion but no FramePort to drive it (R1.9): force the
    // boot done exactly once; the consumer transitions bootPhase to "done".
    if (frames === undefined) {
      onUnavailableRef.current?.();
      return;
    }

    let handle: number | null = null;
    let cancelled = false;

    const schedule = (): void => {
      handle = frames.request((nowMs) => {
        if (cancelled) return;
        onTickRef.current(nowMs);
        // Keep the loop alive while the boot is playing; the reducer stops it by
        // flipping bootPhase to "done", which re-runs this effect's cleanup.
        schedule();
      });
    };

    schedule();

    return () => {
      cancelled = true;
      if (handle !== null) frames.cancel(handle);
    };
  }, [frames, motionMode, bootPhase]);

  // ----- Skip listener: any non-modifier key ends the boot while playing. ---
  useEffect(() => {
    if (bootPhase !== "playing") {
      return;
    }

    const target: EventTarget = rootRef?.current ?? document;

    const onKeyDown = (event: Event): void => {
      if (!isSkipKey(event as KeyboardEvent)) return;
      onSkipRef.current();
    };

    target.addEventListener("keydown", onKeyDown);
    return () => {
      target.removeEventListener("keydown", onKeyDown);
    };
  }, [bootPhase, rootRef]);
}
