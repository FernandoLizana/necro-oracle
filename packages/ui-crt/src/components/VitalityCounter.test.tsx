// @vitest-environment jsdom
//
// VitalityCounter component behaviour tests (visual-necromancy, task 21.3).
//
// Validates: Requirements R13.3, R13.4
//
// `VitalityCounter` is the OPTIONAL decorative Vitality_Delta count-up. These
// tests drive it with the in-memory fake `FramePort` (`makeFakeFrames`) and its
// manual clock, so every assertion is deterministic: time is advanced by hand,
// never by a real `requestAnimationFrame` or wall clock.
//
// Behaviour asserted:
//   - Full motion (R13.4): the counter starts at `beforeVitality`, steps paced
//     to `MIN_COUNT_FRAME_MS` towards `afterVitality`, and settles exactly on
//     the final value without overshooting (both up and down directions).
//   - Reduced motion (R13.3): a single synchronous render shows the final value
//     and requests NO animation frame.
//   - The counter is `aria-hidden` (the announced delta lives in the log, D1).
//   - When re-diagnosis failed (`afterVitality === null`) it renders nothing.

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { makeFakeFrames, type FakeFrames } from "../testing/fake-ports.js";
import { MIN_COUNT_FRAME_MS } from "../hooks/use-count-up.js";
import { VitalityCounter } from "./VitalityCounter.js";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function renderCounter(args: {
  readonly before: number;
  readonly after: number | null;
  readonly motionMode: "full" | "reduced";
}): {
  readonly frames: FakeFrames;
  readonly counter: () => HTMLElement | null;
} {
  const frames = makeFakeFrames();
  const { container } = render(
    <VitalityCounter
      beforeVitality={args.before}
      afterVitality={args.after}
      motionMode={args.motionMode}
      frames={frames}
    />,
  );
  return {
    frames,
    counter: () =>
      container.querySelector<HTMLElement>(".crt-vitality-counter"),
  };
}

/** The current integer the counter displays, or `null` if not rendered. */
function shownValue(counter: HTMLElement | null): number | null {
  if (counter === null) return null;
  const node = counter.querySelector(".crt-vitality-counter-value");
  return node === null ? null : Number(node.textContent);
}

/** Advance the fake frame clock by `ms`, flushing the React state it triggers. */
function advance(frames: FakeFrames, ms: number): void {
  act(() => {
    frames.advance(ms);
  });
}

// ---------------------------------------------------------------------------
// Full motion (R13.4)
// ---------------------------------------------------------------------------

describe("VitalityCounter full motion (R13.4)", () => {
  it("counts up from before to after, paced, and settles on the final value", () => {
    const { frames, counter } = renderCounter({
      before: 40,
      after: 44,
      motionMode: "full",
    });

    // The count departs from the before value, and an animation frame is
    // scheduled (the count is animating).
    expect(shownValue(counter())).toBe(40);
    expect(frames.requestCount()).toBeGreaterThan(0);

    // Anchor the cadence clock (first frame does not advance the value).
    advance(frames, 1);
    expect(shownValue(counter())).toBe(40);

    // Each paced tick advances the visible value by exactly one.
    advance(frames, MIN_COUNT_FRAME_MS + 1);
    expect(shownValue(counter())).toBe(41);
    advance(frames, MIN_COUNT_FRAME_MS + 1);
    expect(shownValue(counter())).toBe(42);

    // Run to completion: it settles exactly on the final value, never past it.
    advance(frames, MIN_COUNT_FRAME_MS + 1);
    advance(frames, MIN_COUNT_FRAME_MS + 1);
    advance(frames, MIN_COUNT_FRAME_MS + 1);
    expect(shownValue(counter())).toBe(44);
    expect(counter()?.dataset.counting).toBe("done");
  });

  it("counts down when vitality decreased and settles on the final value", () => {
    const { frames, counter } = renderCounter({
      before: 60,
      after: 57,
      motionMode: "full",
    });

    expect(shownValue(counter())).toBe(60);

    advance(frames, 1); // anchor
    advance(frames, MIN_COUNT_FRAME_MS + 1);
    expect(shownValue(counter())).toBe(59);

    // Overshoot the ticks: the value clamps exactly to the target, never below.
    for (let i = 0; i < 10; i += 1) advance(frames, MIN_COUNT_FRAME_MS + 1);
    expect(shownValue(counter())).toBe(57);
  });

  it("marks the element aria-hidden so the screen reader is not spammed (D1)", () => {
    const { counter } = renderCounter({
      before: 40,
      after: 58,
      motionMode: "full",
    });
    expect(counter()?.getAttribute("aria-hidden")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// Reduced motion (R13.3)
// ---------------------------------------------------------------------------

describe("VitalityCounter reduced motion (R13.3)", () => {
  it("shows the final value in one render and requests no animation frame", () => {
    const { frames, counter } = renderCounter({
      before: 40,
      after: 58,
      motionMode: "reduced",
    });

    // The final value is shown immediately, with no intermediate count.
    expect(shownValue(counter())).toBe(58);
    expect(counter()?.dataset.counting).toBe("done");

    // No animation frame is ever requested in reduced motion.
    expect(frames.requestCount()).toBe(0);
    expect(frames.pending()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Re-diagnosis failed (R6.5): nothing to count to
// ---------------------------------------------------------------------------

describe("VitalityCounter with no final vitality", () => {
  it("renders nothing and requests no frame when afterVitality is null", () => {
    const { frames, counter } = renderCounter({
      before: 40,
      after: null,
      motionMode: "full",
    });
    expect(counter()).toBeNull();
    expect(frames.requestCount()).toBe(0);
    expect(frames.pending()).toBe(0);
  });
});
