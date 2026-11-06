// @vitest-environment jsdom
//
// NecronomiconRitual component behaviour tests (task 15.2).
//
// Validates: Requirements R6.3, R6.4, R6.5, R6.7, R6.9, R6.10
//
// These drive the screen-only Resurrection_Ritual wrapper built in task 15.1.
// The wrapper owns only the *timing* of the four-phase Necronomicon animation
// and the Escape / image-error short-circuits; it renders the unchanged Spec 05
// diff/patch view (`children`) verbatim once the ritual ends (R6.9). Timing is
// driven entirely through an injected `FramePort` — there is NO wall-clock
// `setTimeout`/`setInterval` — so every assertion here is deterministic: the
// test pumps a manual-clock fake `FramePort` (`makeFakeFrames`) and reads the
// resulting `data-ritual` phase attribute off the DOM. No real
// `requestAnimationFrame`, timer, network, or audio is touched.
//
// The file is authored as `.ts` (per the task) and so avoids JSX: trees are
// built with `React.createElement`, which needs no JSX transform.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ritualTimeline } from "../arcana/ritual-timeline.js";
import type { RitualStep } from "../arcana/ritual-timeline.js";
import { makeFakeFrames } from "../testing/fake-ports.js";
import type { FakeFrames } from "../testing/fake-ports.js";

import { NecronomiconRitual } from "./NecronomiconRitual.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// A sentinel marker on the Spec 05 diff/patch view so the test can assert, by a
// stable id and verbatim text, that `children` is rendered unchanged (R6.9).
const DIFF_TEST_ID = "spec05-diff";
const DIFF_TEXT = "diff --git a/foo.py b/foo.py\n@@\n-print x\n+print(x)";

/** The unchanged Spec 05 diff/patch view passed as `children`. */
function diffView(): React.ReactElement {
  return h(
    "div",
    { "data-testid": DIFF_TEST_ID, className: "spec05-diff-view" },
    DIFF_TEXT,
  );
}

/** Build the component props, letting each test override the parts it drives. */
function makeProps(
  overrides: Partial<Parameters<typeof NecronomiconRitual>[0]> = {},
): Parameters<typeof NecronomiconRitual>[0] {
  return {
    steps: playingSteps(),
    frames: makeFakeFrames(),
    motionMode: "full",
    closedSrc: "/arcana/necronomicon-closed.webp",
    openSrc: "/arcana/necronomicon-open.webp",
    diffLines: ["-print x", "+print(x)"],
    onImageError: vi.fn(),
    onComplete: vi.fn(),
    children: diffView(),
    ...overrides,
  };
}

/** The four-phase timeline a real playing ritual produces (fixed `seed`). */
function playingSteps(seed = 7): readonly RitualStep[] {
  return ritualTimeline({
    motionMode: "full",
    playwright: false,
    bootSkip: false,
    ritualForce: false,
    seed,
    imagesReady: true,
  });
}

/** Render `NecronomiconRitual` with the given props; return the test utilities. */
function renderRitual(props: Parameters<typeof NecronomiconRitual>[0]) {
  return render(h(NecronomiconRitual, props));
}

/** The ritual root element (present only while the ritual is still playing). */
function ritualRoot(container: HTMLElement): HTMLElement | null {
  return container.querySelector(".crt-ritual");
}

// ---------------------------------------------------------------------------
// R6.4 / R6.5: empty steps render children immediately in a single render
// ---------------------------------------------------------------------------

describe("R6.4 / R6.5 (skip): empty steps render the diff view immediately", () => {
  it("renders children in a single render and schedules no frame", () => {
    const frames = makeFakeFrames();
    const { container, getByTestId } = renderRitual(
      makeProps({ steps: [], frames }),
    );

    // The diff/patch view is present at once; the ritual overlay never renders.
    expect(getByTestId(DIFF_TEST_ID)).toBeInTheDocument();
    expect(getByTestId(DIFF_TEST_ID)).toHaveTextContent("print(x)");
    expect(ritualRoot(container)).toBeNull();

    // A single render means no animation frame was ever requested.
    expect(frames.requestCount()).toBe(0);
    expect(frames.pending()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R6.3: Escape ends the ritual and shows the diff synchronously (<= 100 ms)
// ---------------------------------------------------------------------------

describe("R6.3 (escape): Escape ends the ritual and shows the diff within 100 ms", () => {
  it("calls onComplete synchronously on the keydown and renders children", () => {
    const frames = makeFakeFrames();
    const onComplete = vi.fn();
    const { container, getByTestId, queryByTestId } = renderRitual(
      makeProps({ frames, onComplete }),
    );

    // While playing, the ritual overlay is shown and the diff is not yet mounted.
    expect(ritualRoot(container)).not.toBeNull();
    expect(queryByTestId(DIFF_TEST_ID)).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();

    // Pressing Escape completes the ritual on the keydown itself — no timer,
    // and no frame advance — so the diff is shown well within 100 ms.
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(getByTestId(DIFF_TEST_ID)).toBeInTheDocument();
    expect(getByTestId(DIFF_TEST_ID)).toHaveTextContent("print(x)");
    expect(ritualRoot(container)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R6.10: an image decode failure on either frame skips to the diff view
// ---------------------------------------------------------------------------

describe("R6.10 (image error): a Necronomicon decode failure skips to the diff", () => {
  it("skips to the diff when the closed frame fails to decode", () => {
    const onImageError = vi.fn();
    const { container, getByTestId } = renderRitual(
      makeProps({ onImageError }),
    );

    const closed = container.querySelector(".crt-ritual-closed");
    expect(closed).not.toBeNull();

    act(() => {
      fireEvent.error(closed as Element);
    });

    expect(onImageError).toHaveBeenCalledTimes(1);
    expect(getByTestId(DIFF_TEST_ID)).toBeInTheDocument();
    expect(ritualRoot(container)).toBeNull();
  });

  it("skips to the diff when the open frame fails to decode", () => {
    const onImageError = vi.fn();
    const { container, getByTestId } = renderRitual(
      makeProps({ onImageError }),
    );

    const open = container.querySelector(".crt-ritual-open");
    expect(open).not.toBeNull();

    act(() => {
      fireEvent.error(open as Element);
    });

    expect(onImageError).toHaveBeenCalledTimes(1);
    expect(getByTestId(DIFF_TEST_ID)).toBeInTheDocument();
    expect(ritualRoot(container)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R6.9: the diff/patch content is rendered verbatim, unchanged by the ritual
// ---------------------------------------------------------------------------

describe("R6.9 (unchanged content): children render verbatim after the ritual", () => {
  it("renders the exact same diff text after completion as was passed in", () => {
    const frames = makeFakeFrames();
    const { container, getByTestId } = renderRitual(makeProps({ frames }));

    // Complete the ritual by escaping; the content below must be byte-identical
    // to the `children` passed in (the ritual only controls timing, not text).
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    const diff = getByTestId(DIFF_TEST_ID);
    expect(diff).toBeInTheDocument();
    expect(diff).toHaveClass("spec05-diff-view");
    expect(diff.textContent).toBe(DIFF_TEXT);
    // Nothing from the ritual overlay remains wrapped around the content.
    expect(ritualRoot(container)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R6.7 / R6.8: demo determinism — identical phase progression across two runs
// ---------------------------------------------------------------------------

/**
 * Drive the fake `FramePort` so the component anchors its timeline at `t = 0`
 * (via `flush()`, which runs the first frame without advancing the clock), then
 * step the clock to each sample time and record the `data-ritual` phase the
 * component shows at that elapsed time. Returns the ordered phase samples.
 */
function samplePhases(
  steps: readonly RitualStep[],
  sampleTimes: readonly number[],
): string[] {
  const frames: FakeFrames = makeFakeFrames();
  const { container, unmount } = renderRitual(makeProps({ steps, frames }));

  // Anchor the timeline to t = 0: the first frame runs at the current clock
  // (0) without advancing it, so subsequent `advance` deltas are true elapsed.
  act(() => {
    frames.flush();
  });

  const phases: string[] = [];
  let previous = 0;
  for (const time of sampleTimes) {
    act(() => {
      frames.advance(time - previous);
    });
    previous = time;
    const root = ritualRoot(container);
    phases.push(root ? (root.getAttribute("data-ritual") ?? "none") : "done");
  }

  unmount();
  return phases;
}

describe("R6.7 / R6.8 (determinism): a fixed seed yields identical phase progression", () => {
  it("drives the same data-ritual phases across two runs with the same steps", () => {
    const seed = 42;
    const steps = playingSteps(seed);
    expect(steps.length).toBe(4);

    // Sample one time strictly inside each phase window and one past the end,
    // derived from the pure timeline boundaries so the expectations track the
    // real steps rather than hardcoded magic numbers.
    const midpoints = steps.map(
      (step) => step.startMs + Math.floor(step.durationMs / 2),
    );
    const total = steps.reduce(
      (max, step) => Math.max(max, step.startMs + step.durationMs),
      0,
    );
    const sampleTimes = [...midpoints, total + 1];

    const expectedPhases = [
      ...steps.map((step) => step.phase),
      "done", // past the final step the ritual completes and the diff shows
    ];

    const runA = samplePhases(steps, sampleTimes);
    const runB = samplePhases(steps, sampleTimes);

    // The progression matches the steps' phase boundaries and is identical
    // across the two runs (byte-for-byte deterministic replay) (R6.7, R6.8).
    expect(runA).toEqual(expectedPhases);
    expect(runB).toEqual(expectedPhases);
    expect(runA).toEqual(runB);
  });

  it("produces the identical steps array for a fixed seed (pure timeline)", () => {
    // The timeline the ritual consumes is a pure function of the seed, so the
    // frame content it drives is fixed for a Demo_Seed replay (R6.8).
    expect(playingSteps(99)).toEqual(playingSteps(99));
  });
});
