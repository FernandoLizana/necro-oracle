"use client";

// src/components/NecronomiconRitual.tsx
//
// Feature: 06-arcana-visions, task 15.1.
//
// `NecronomiconRitual` is the screen-only Resurrection_Ritual wrapper that
// plays the four-phase Necronomicon animation BEFORE the unchanged Spec 05
// diff/patch view, then renders that view verbatim. It owns only the *timing*
// of the phase sequence and the Escape/image-error short-circuits; it never
// touches, reorders, or re-renders the diff/patch content — `children` is the
// Spec 05 diff/patch view passed straight through (R6.9).
//
// The phase timeline comes entirely from the pure `ritualTimeline` module
// (the `steps` prop). Sequencing is driven through the injected Spec 05
// `FramePort`, reusing the exact self-rescheduling animation-frame pattern of
// `use-reveal`/`use-rot`: on mount we anchor to `frames.now()`, then on every
// frame we compute the elapsed frame-clock time and derive the active phase by
// comparing it against the cumulative step boundaries (`startMs + durationMs`).
// There is NO wall-clock `setTimeout`/`setInterval`; the whole timeline is a
// pure function of the (deterministic) `steps` array and the FramePort clock,
// so a DEMO_SEED replay — whose `steps` are fixed by `ritualTimeline` — is
// byte-for-byte identical (R6.7).
//
// The phases play in order `closed-glitch -> tremble -> crossfade to the open
// book -> rising diff lines` (R6.1). For the active phase the wrapper sets the
// `data-ritual` phase attribute and the per-phase `--ritual-phase-ms` custom
// property (from that step's `durationMs`) so the matching `arcana.css`
// keyframe runs; the closed and open Necronomicon frames are layered so the
// crossfade phase fades the open frame in over the closed one.
//
// Short-circuits to the diff/patch view (`children`):
//   - `steps === []` (or empty): render `children` IMMEDIATELY in a single
//     render — the ritual is skipped (Reduced_Motion, frames not ready, or a
//     Playwright/`?boot=skip` run without the force flag) (R6.4, R6.5).
//   - Escape key while the ritual plays: a synchronous keydown handler calls
//     `onComplete` and flips to the diff view within 100 ms (R6.3).
//   - Either Necronomicon frame failing to decode: `onImageError` fires and the
//     wrapper skips straight to the diff view (R6.10).
//   - The timeline reaching the end of its last step: `onComplete` fires and
//     the diff view renders.
//
// This component is a screen only: no ports beyond the injected `FramePort`, no
// data fetching, no network, no audio.
//
// _Requirements: R6.1, R6.3, R6.4, R6.5, R6.7, R6.9, R6.10_

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { FramePort } from "../ports.js";
import { useCssVars } from "../hooks/use-css-vars.js";
import type { MotionMode } from "../motion/motion-mode.js";
import type { RitualPhase, RitualStep } from "../arcana/ritual-timeline.js";

/** Props for the Resurrection_Ritual wrapper (design §"Component: NecronomiconRitual"). */
export interface NecronomiconRitualProps {
  /**
   * The ordered ritual phases from `ritualTimeline(opts)`. An empty array means
   * "no ritual" — the diff/patch view renders in a single render (R6.4, R6.5).
   */
  readonly steps: readonly RitualStep[];
  /** The animation-frame scheduler and clock (same port `use-reveal`/`use-rot` use). */
  readonly frames: FramePort;
  /** The effective Motion_Mode; `reduced` is already reflected by empty `steps`. */
  readonly motionMode: MotionMode;
  /** The Necronomicon_Closed image URL (`/arcana/necronomicon-closed.webp`). */
  readonly closedSrc: string;
  /** The Necronomicon_Open image URL (`/arcana/necronomicon-open.webp`). */
  readonly openSrc: string;
  /** The resurrected diff lines that rise from the open book during `rising-diff`. */
  readonly diffLines: readonly string[];
  /** Called when either Necronomicon frame fails to decode; skips to `children` (R6.10). */
  readonly onImageError: () => void;
  /** Called when the ritual ends (timeline complete or Escape); the diff view then shows. */
  readonly onComplete: () => void;
  /** The unchanged Spec 05 diff/patch view, rendered verbatim after the ritual (R6.9). */
  readonly children: React.ReactNode;
}

/** The end offset (ms from first frame) of a ritual step. */
function stepEndMs(step: RitualStep): number {
  return step.startMs + step.durationMs;
}

/**
 * The index of the active phase for a given elapsed frame-clock time, or `-1`
 * once elapsed has passed the end of the final step (the ritual is complete).
 * Steps are ordered with non-decreasing `startMs`, so the first step whose end
 * is still ahead of `elapsed` is the active one.
 */
function activeStepIndex(steps: readonly RitualStep[], elapsed: number): number {
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step && elapsed < stepEndMs(step)) return i;
  }
  return -1;
}

/**
 * Play the Resurrection_Ritual, then render the unchanged diff/patch view.
 *
 * With empty `steps` the ritual is skipped and `children` renders immediately.
 * Otherwise a self-rescheduling `FramePort` loop advances the active phase by
 * elapsed frame-clock time; when the timeline completes, Escape is pressed, or
 * a Necronomicon frame fails to decode, the wrapper flips to `children`.
 */
export function NecronomiconRitual({
  steps,
  frames,
  motionMode,
  closedSrc,
  openSrc,
  diffLines,
  onImageError,
  onComplete,
  children,
}: NecronomiconRitualProps): React.JSX.Element {
  // An empty timeline means "no ritual": render the diff/patch view straight
  // away. This is a single render — no frame is ever scheduled (R6.4, R6.5).
  const hasRitual = steps.length > 0;

  // `finished` flips to true when the timeline completes, Escape is pressed, or
  // an image fails to decode. Once finished, `children` renders verbatim (R6.9).
  const [finished, setFinished] = useState(false);

  // The index of the phase currently playing, or -1 before the first frame
  // anchors / after the timeline completes. Drives the `data-ritual` attribute.
  const [phaseIndex, setPhaseIndex] = useState(-1);

  // Keep the latest `onComplete` in a ref so the keydown handler and the frame
  // loop always call the current callback without re-subscribing every render.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Complete the ritual exactly once: flip to the diff view and notify the
  // caller. Guarded by a ref so a late frame plus an Escape can't double-fire.
  const completedRef = useRef(false);
  const complete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    setFinished(true);
    onCompleteRef.current();
  }, []);

  // Escape skip (R6.3): a synchronous keydown handler, active only while the
  // ritual is playing, calls `onComplete` the moment Escape is pressed — well
  // within 100 ms since there is no timer between the keypress and the call.
  useEffect(() => {
    if (!hasRitual || finished) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        complete();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasRitual, finished, complete]);

  // The phase timeline, driven through the FramePort (no wall-clock timers).
  // Mirrors the `use-reveal`/`use-rot` pattern: anchor to `frames.now()` on the
  // first frame, then each frame derive the active phase from elapsed time and
  // self-reschedule until the timeline completes. Cancels the pending frame on
  // unmount or input change.
  useEffect(() => {
    if (!hasRitual || finished) return;

    const totalMs = steps.reduce(
      (max, step) => Math.max(max, stepEndMs(step)),
      0,
    );

    let handle: number | null = null;
    let cancelled = false;
    let startAt: number | null = null;

    const schedule = (): void => {
      handle = frames.request((nowMs) => {
        if (cancelled) return;

        // Anchor the timeline to the first frame's clock, then measure elapsed
        // frame-clock time against the cumulative step boundaries.
        if (startAt === null) startAt = nowMs;
        const elapsed = nowMs - startAt;

        if (elapsed >= totalMs) {
          // The last step has ended: the ritual completes and the diff shows.
          complete();
          return;
        }

        const index = activeStepIndex(steps, elapsed);
        setPhaseIndex((current) => (current === index ? current : index));

        // Keep the loop alive until the timeline completes or the effect's
        // cleanup cancels the pending frame.
        schedule();
      });
    };

    schedule();

    return () => {
      cancelled = true;
      if (handle !== null) frames.cancel(handle);
    };
  }, [hasRitual, finished, steps, frames, complete]);

  // Image decode failure on either frame (R6.10): notify the caller and skip to
  // the diff view. `onImageError` is reported before completing so the caller
  // learns the frames are unusable.
  const handleImageError = useCallback(() => {
    onImageError();
    complete();
  }, [onImageError, complete]);

  // The active phase for the current frame (or the first phase before the frame
  // loop has anchored), used to drive the `data-ritual` attribute and the
  // per-phase `--ritual-phase-ms` duration the `arcana.css` keyframes read.
  const activeIndex = phaseIndex >= 0 ? phaseIndex : 0;
  const activeStep = steps[activeIndex] ?? steps[0];
  const activePhase: RitualPhase = activeStep ? activeStep.phase : "closed-glitch";
  const phaseMs = activeStep ? activeStep.durationMs : 0;

  // SEC-08: apply the ritual phase-duration custom property through the CSSOM
  // (useCssVars) instead of a CSP-blocked inline style attribute. Declared
  // BEFORE the early return below so every render runs the same hooks.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useCssVars(rootRef, { "--ritual-phase-ms": `${phaseMs}ms` });

  // Skipped ritual or finished playback: render the Spec 05 diff/patch view
  // verbatim. `children` is never altered by the ritual (R6.9).
  if (!hasRitual || finished) {
    return <>{children}</>;
  }

  return (
    <div
      ref={rootRef}
      className="crt-ritual crt-necronomicon"
      data-ritual={activePhase}
      data-motion={motionMode}
      aria-hidden="true"
    >
      {/*
        Both Necronomicon frames are layered: the closed book sits beneath and
        the open book (`.crt-ritual-open`) fades in over it during the crossfade
        phase. A decode failure on either frame skips to the diff view (R6.10).
      */}
      <img
        className="crt-necronomicon-img crt-ritual-closed"
        src={closedSrc}
        alt=""
        onError={handleImageError}
      />
      <img
        className="crt-necronomicon-img crt-ritual-open"
        src={openSrc}
        alt=""
        onError={handleImageError}
      />

      {/*
        The resurrected diff lines rise from the open book during the
        `rising-diff` phase. These are a decorative preview of the diff that is
        about to render; the authoritative, unaltered diff/patch view is the
        `children` rendered once the ritual completes (R6.9).
      */}
      <div className="crt-ritual-lines" data-phase={activePhase}>
        {diffLines.map((line, index) => (
          <pre key={index} className="crt-line crt-ritual-line">
            {line}
          </pre>
        ))}
      </div>
    </div>
  );
}
