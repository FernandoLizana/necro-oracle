// @vitest-environment jsdom
//
// `use-boot` hook + `BootOverlay` component tests (visual-necromancy task 9.3).
//
// Validates: Requirements R1.1, R1.2, R1.3, R1.5, R1.6, R1.9
//
// These exercise the client half of the one-time CRT Boot_Sequence:
//   - `useBoot` requests `FramePort` frames ONLY while motion is `full` and the
//     boot is `playing`; in reduced motion, under `bootSignal` (modelled by the
//     caller passing `bootPhase: "done"`), or once done, it schedules no frame
//     (R1.5, R1.6).
//   - a non-modifier keydown dispatches `onSkip` (the Terminal turns this into a
//     `boot.skip` action and focuses the Command_Line); a lone Shift/Control/
//     Alt/Meta keydown does not (R1.3).
//   - when no `FramePort` is available while playing in full motion, the hook
//     calls `onUnavailable` once so the consumer forces `bootPhase: "done"`
//     (R1.9).
//   - `BootOverlay` renders nothing once done and shows the skip hint, an
//     aria-hidden frame, and the `crt-sr-only` logo equivalent while playing
//     (R1.1).
//
// The fake `FramePort` has a manual clock, so every schedule is asserted
// deterministically — no real `requestAnimationFrame`, no wall-clock time, no
// network, no real randomness. The reducer already owns the boot-phrase-first
// Output_Block rule (task 7.3, `boot-reveal.test.ts`); here one reducer assertion
// pins that invariant end-to-end for the playing and done paths (R1.2) and the
// rest of the file stays on the hook + overlay.

import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { makeFakeFrames } from "../testing/fake-ports.js";
import { bootFrame, bootFrameKind, BOOT_STEP_COUNT } from "../render/boot.js";
import { BOOT_LOGO_TEXT_EQUIVALENT } from "../render/boot.js";
import { blockText } from "../render/blocks.js";
import { BOOT_PHRASE } from "../voice/phrases.js";
import { initialState, type Action } from "../session/state.js";
import { step } from "../session/reducer.js";

import { useBoot, type UseBootOptions } from "./use-boot.js";
import { BootOverlay, BOOT_SKIP_HINT } from "../components/BootOverlay.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Build `useBoot` options with full-motion/playing defaults; override per case. */
function bootOptions(overrides: Partial<UseBootOptions> = {}): UseBootOptions {
  return {
    frames: makeFakeFrames(),
    motionMode: "full",
    bootPhase: "playing",
    onTick: vi.fn(),
    onSkip: vi.fn(),
    ...overrides,
  };
}

/** Dispatch a keydown of the given key on an EventTarget (document by default). */
function pressKey(key: string, target: EventTarget = document): void {
  act(() => {
    target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

// ---------------------------------------------------------------------------
// R1.1 / R1.6: full motion + playing requests frames; onTick fires on the clock
// ---------------------------------------------------------------------------

describe("R1.1 / R1.6 (boot animates): full motion + playing requests frames", () => {
  it("schedules a frame and reports the clock through onTick as time advances", () => {
    const frames = makeFakeFrames();
    const onTick = vi.fn();
    renderHook(() => useBoot(bootOptions({ frames, onTick })));

    // Playing in full motion requests at least one animation frame.
    expect(frames.requestCount()).toBeGreaterThan(0);
    expect(frames.pending()).toBeGreaterThanOrEqual(1);

    // Advancing the manual clock runs the frame callback, which reports the time.
    act(() => {
      frames.advance(100);
    });
    expect(onTick).toHaveBeenCalled();
    const nowArg = onTick.mock.calls.at(-1)?.[0];
    expect(nowArg).toBe(100);
  });

  it("keeps the loop alive across frames while still playing", () => {
    const frames = makeFakeFrames();
    const onTick = vi.fn();
    renderHook(() => useBoot(bootOptions({ frames, onTick })));

    act(() => {
      frames.advance(16);
    });
    act(() => {
      frames.advance(16);
    });
    expect(onTick).toHaveBeenCalledTimes(2);
    // A self-rescheduling loop always leaves one frame queued while playing.
    expect(frames.pending()).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// R1.5 / R1.6: no frame in reduced motion, under bootSignal (done), or once done
// ---------------------------------------------------------------------------

describe("R1.5 / R1.6 (idle boot): no frame scheduled when it must not animate", () => {
  it("requests no frame in reduced motion", () => {
    const frames = makeFakeFrames();
    const onTick = vi.fn();
    renderHook(() =>
      useBoot(bootOptions({ frames, motionMode: "reduced", onTick })),
    );
    expect(frames.requestCount()).toBe(0);
    expect(frames.pending()).toBe(0);
    act(() => {
      frames.advance(500);
    });
    expect(onTick).not.toHaveBeenCalled();
  });

  it("requests no frame once the boot phase is done (the bootSignal path lands here)", () => {
    // Under `bootSignal` (or a replay) the reducer starts the boot already
    // `done`, so the consumer passes `bootPhase: "done"`: no frame is scheduled
    // even in full motion.
    const frames = makeFakeFrames();
    const onTick = vi.fn();
    renderHook(() =>
      useBoot(bootOptions({ frames, bootPhase: "done", onTick })),
    );
    expect(frames.requestCount()).toBe(0);
    expect(frames.pending()).toBe(0);
    act(() => {
      frames.advance(500);
    });
    expect(onTick).not.toHaveBeenCalled();
  });

  it("stops scheduling frames once bootPhase flips from playing to done", () => {
    const frames = makeFakeFrames();
    const onTick = vi.fn();
    const { rerender } = renderHook(
      (props: UseBootOptions) => useBoot(props),
      { initialProps: bootOptions({ frames, onTick }) },
    );
    expect(frames.pending()).toBeGreaterThanOrEqual(1);

    // Boot completes: the reducer flips the phase, the loop's cleanup runs, and
    // no new frame is queued.
    act(() => {
      rerender(bootOptions({ frames, bootPhase: "done", onTick }));
    });
    expect(frames.pending()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R1.3: skip on any non-modifier key; lone modifiers do not skip
// ---------------------------------------------------------------------------

describe("R1.3 (skip): a non-modifier key ends the boot, lone modifiers do not", () => {
  it("calls onSkip for a non-modifier key while playing (document default target)", () => {
    const onSkip = vi.fn();
    renderHook(() => useBoot(bootOptions({ onSkip })));

    pressKey("a");
    expect(onSkip).toHaveBeenCalledTimes(1);

    pressKey("Enter");
    expect(onSkip).toHaveBeenCalledTimes(2);

    pressKey("Escape");
    expect(onSkip).toHaveBeenCalledTimes(3);
  });

  it("does NOT call onSkip for lone Shift/Control/Alt/Meta keydowns", () => {
    const onSkip = vi.fn();
    renderHook(() => useBoot(bootOptions({ onSkip })));

    for (const key of ["Shift", "Control", "Alt", "Meta"]) {
      pressKey(key);
    }
    expect(onSkip).not.toHaveBeenCalled();

    // A real key after the modifiers still skips.
    pressKey("x");
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("listens on the supplied rootRef element rather than document", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const rootRef = { current: root };
    const onSkip = vi.fn();
    renderHook(() => useBoot(bootOptions({ onSkip, rootRef })));

    // A key on the root element skips.
    pressKey("a", root);
    expect(onSkip).toHaveBeenCalledTimes(1);

    root.remove();
  });

  it("does NOT skip once the boot is done (no skip listener while done)", () => {
    const onSkip = vi.fn();
    renderHook(() => useBoot(bootOptions({ bootPhase: "done", onSkip })));
    pressKey("a");
    expect(onSkip).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R1.9: FramePort unavailable while playing in full motion → onUnavailable once
// ---------------------------------------------------------------------------

describe("R1.9 (unavailable FramePort): force the boot done exactly once", () => {
  it("calls onUnavailable once when frames is undefined while playing in full motion", () => {
    const onUnavailable = vi.fn();
    const onTick = vi.fn();
    renderHook(() =>
      useBoot(bootOptions({ frames: undefined, onTick, onUnavailable })),
    );
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    // With no FramePort there is no frame loop, so onTick never fires.
    expect(onTick).not.toHaveBeenCalled();
  });

  it("does NOT call onUnavailable when the boot is already done (nothing to animate)", () => {
    const onUnavailable = vi.fn();
    renderHook(() =>
      useBoot(
        bootOptions({ frames: undefined, bootPhase: "done", onUnavailable }),
      ),
    );
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("does NOT call onUnavailable in reduced motion even without a FramePort", () => {
    const onUnavailable = vi.fn();
    renderHook(() =>
      useBoot(
        bootOptions({
          frames: undefined,
          motionMode: "reduced",
          onUnavailable,
        }),
      ),
    );
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R1.8 (cleanup): the hook cancels its pending frame on unmount
// ---------------------------------------------------------------------------

describe("cleanup: the hook cancels its pending frame on unmount", () => {
  it("leaves no scheduled frame after unmount", () => {
    const frames = makeFakeFrames();
    const { unmount } = renderHook(() => useBoot(bootOptions({ frames })));
    expect(frames.pending()).toBeGreaterThanOrEqual(1);
    act(() => {
      unmount();
    });
    expect(frames.pending()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R1.1 / R1.7: BootOverlay renders nothing when done, the frame + hint while playing
// ---------------------------------------------------------------------------

describe("R1.1 (overlay): BootOverlay renders nothing once done", () => {
  it("renders nothing when bootPhase is done", () => {
    const { container } = render(
      <BootOverlay
        frame={bootFrame(0)}
        bootPhase="done"
        frameKind={bootFrameKind(0)}
      />,
    );
    expect(container.querySelector(".crt-boot-overlay")).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("renders the skip hint, an aria-hidden frame, and the sr-only logo equivalent while playing", () => {
    const frame = bootFrame(0);
    const { container } = render(
      <BootOverlay
        frame={frame}
        bootPhase="playing"
        frameKind={bootFrameKind(0)}
      />,
    );

    const overlay = container.querySelector(".crt-boot-overlay");
    expect(overlay).not.toBeNull();

    // The persistent skip hint is present in the oracle's dry voice.
    const hint = container.querySelector(".crt-boot-hint");
    expect(hint?.textContent).toBe(BOOT_SKIP_HINT);
    expect(BOOT_SKIP_HINT).toBe("Press any key to skip the awakening.");

    // The decorative glyph region is out of the accessibility tree.
    const frameEl = container.querySelector(".crt-boot-frame");
    expect(frameEl).not.toBeNull();
    expect(frameEl).toHaveAttribute("aria-hidden", "true");

    // A single sr-only sibling carries the accessible wordmark.
    const sr = container.querySelector("span.crt-sr-only");
    expect(sr?.textContent).toBe(BOOT_LOGO_TEXT_EQUIVALENT);
    expect(BOOT_LOGO_TEXT_EQUIVALENT).toBe("NECROMANTIC SYSTEMS 1986");

    // The frame's text is rendered as selectable DOM text (one <pre> per line).
    const expectedText = frame.lines
      .map((line) => line.segments.map((s) => s.text).join(""))
      .join("");
    const renderedText = [...frameEl!.querySelectorAll("pre")]
      .map((pre) => pre.textContent ?? "")
      .join("");
    expect(renderedText).toBe(expectedText);
  });

  it("marks each playing frame with its frame kind via data-boot-frame (R2.1)", () => {
    // The memory-check steps are "memory", the ASCII logo step is "logo", the
    // warm-up step is "warmup", and the final (saturating) step is "ready".
    // A screenshot/test waits for `[data-boot-frame="logo"]` rather than the
    // constant `crt-sr-only` wordmark, which is present in every playing frame.
    const kinds = Array.from({ length: BOOT_STEP_COUNT }, (_, step) =>
      bootFrameKind(step),
    );
    expect(kinds).toContain("logo");

    for (let step = 0; step < BOOT_STEP_COUNT; step++) {
      const { container, unmount } = render(
        <BootOverlay
          frame={bootFrame(step)}
          bootPhase="playing"
          frameKind={bootFrameKind(step)}
        />,
      );
      const overlay = container.querySelector(".crt-boot-overlay");
      expect(overlay).toHaveAttribute("data-boot-frame", bootFrameKind(step));
      unmount();
    }

    // The logo step specifically carries the logo marker the screenshot waits
    // for, and the overlay's visible glyph rows include the big ASCII wordmark.
    const logoStep = kinds.indexOf("logo");
    const { container } = render(
      <BootOverlay
        frame={bootFrame(logoStep)}
        bootPhase="playing"
        frameKind="logo"
      />,
    );
    const overlay = container.querySelector(".crt-boot-overlay");
    expect(overlay).toHaveAttribute("data-boot-frame", "logo");
    const glyphText = [
      ...container.querySelectorAll(".crt-boot-frame pre"),
    ]
      .map((pre) => pre.textContent ?? "")
      .join("\n");
    expect(glyphText).toContain("NECROMANTIC SYSTEMS 1986");
  });
});

// ---------------------------------------------------------------------------
// R1.2: the boot phrase is the first Output_Block in both playing and done paths
// ---------------------------------------------------------------------------

describe("R1.2 (boot phrase first): BOOT_PHRASE is the first Output_Block in all cases", () => {
  function bootAction(overrides: Partial<Extract<Action, { type: "boot" }>> = {}): Action {
    return {
      type: "boot",
      motionPreference: "on",
      soundPreference: "off",
      prefersReduced: false,
      visible: true,
      bootSignal: false,
      ...overrides,
    };
  }

  it("prepends BOOT_PHRASE when the boot plays (full motion, no signal)", () => {
    const { state } = step(initialState(), bootAction());
    expect(state.boot.phase).toBe("playing");
    expect(blockText(state.log[0]!)).toContain(BOOT_PHRASE);
  });

  it("prepends BOOT_PHRASE when the boot is skipped by bootSignal (phase done)", () => {
    const { state } = step(initialState(), bootAction({ bootSignal: true }));
    expect(state.boot.phase).toBe("done");
    expect(blockText(state.log[0]!)).toContain(BOOT_PHRASE);
  });
});
