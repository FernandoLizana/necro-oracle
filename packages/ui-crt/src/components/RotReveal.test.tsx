// @vitest-environment jsdom
//
// RotReveal component behaviour tests (visual-necromancy, task 11.2).
//
// Validates: Requirements R6.1, R6.2, R6.9, R6.10
//
// `RotReveal` is the presentational half of the Resurrection_Animation. These
// tests drive it with the in-memory fake `FramePort` (`makeFakeFrames`) and its
// manual clock, so every assertion is deterministic: time is advanced by hand,
// never by a real `requestAnimationFrame` or wall clock, and the rot corruption
// is seeded, so no real randomness enters a unit test.
//
// Behaviour asserted:
//   - Full motion (R6.1): the first render shows a rot frame (`data-rot=
//     "running"`, a `<pre class="crt-rot-frame">`) and NOT the revived code,
//     diff or vitality delta. Advancing the fake frame clock past
//     `MIN_ROT_FRAME_MS` per step steps the Decay_Sequence to decay 1, at which
//     point the revived code (`data-rot="done"` / `crt-revived-code`), the diff
//     blocks and the Vitality_Delta all render. The rendered diff / vitality
//     text equals exactly what `renderFileResults` / `renderResurrectVitality`
//     produce — the component never alters diff content or the delta (R6.2).
//   - Reduced motion (R6.9): one synchronous render shows revived code + diff +
//     vitality delta with zero rot frames (no `data-rot="running"` element) and
//     no animation frame is ever requested.
//   - The revived code, diff and vitality delta are selectable DOM text inside
//     the `role="log"` region and are rendered exactly once (R6.10).

import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { makeFakeFrames, type FakeFrames } from "../testing/fake-ports.js";
import { lineText } from "../render/blocks.js";
import { renderFileResults } from "../render/resurrect-diff.js";
import { renderResurrectVitality } from "../render/resurrect-vitality.js";
import type {
  ResurrectFileResult,
  VitalityResult,
} from "../protocol.js";
import { MIN_ROT_FRAME_MS } from "../hooks/use-rot.js";
import { ROT_FRAME_COUNT, RotReveal } from "./RotReveal.js";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A multi-line pre-ritual source that visibly decays during the rot phase. */
const PRE_RITUAL_CODE = ["print 'hello'", "x = raw_input()", "print x"].join(
  "\n",
);

/** The revived source revealed after the rot phase completes. */
const REVIVED_CODE = ['print("hello")', "x = input()", "print(x)"].join("\n");

/** A deterministic seed so the rot corruption carries no real randomness. */
const SEED = 0x6e6563;

/** A minimal per-file diff matching `ResurrectFileResult` (one add, one remove). */
const FILES: readonly ResurrectFileResult[] = [
  {
    path: "app/main.py",
    diff: [
      { kind: "remove", text: "print 'hello'" },
      { kind: "add", text: 'print("hello")' },
      { kind: "context", text: "x = input()" },
    ],
    residuals: [
      { path: "app/main.py", line: 2, construct: "raw_input()" },
    ],
    fullyConverted: false,
  },
];

/** A minimal `VitalityResult` with a positive delta and one changed card. */
const VITALITY: VitalityResult = {
  beforeVitality: 40,
  afterVitality: 58,
  vitalityDelta: 18,
  changedCards: [{ card: "tower", change: "severity", improved: true }],
};

/**
 * Every individual line the engine diff renderer produces, in order. The
 * component must render each of these verbatim — it only mirrors the diff it is
 * given, altering nothing (R6.2). A per-line check is exact and robust to how
 * adjacent `<p>` lines are joined in `textContent`.
 */
const EXPECTED_DIFF_LINES: readonly string[] = renderFileResults(FILES).flatMap(
  (block) => block.lines.map(lineText),
);

/** Every individual line the engine vitality-delta renderer produces (unchanged). */
const EXPECTED_VITALITY_LINES: readonly string[] = renderResurrectVitality(
  VITALITY,
).lines.map(lineText);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * Render `<RotReveal>` inside a `role="log"` region (the live log the real
 * Terminal mounts it in), returning the fake frames so the test drives the
 * manual clock. Advancing frames flips React state, so the advances are wrapped
 * in `act(...)`.
 */
function renderRotReveal(motionMode: "full" | "reduced"): {
  readonly frames: FakeFrames;
  readonly log: () => HTMLElement;
} {
  const frames = makeFakeFrames();
  render(
    <div role="log">
      <RotReveal
        preRitualCode={PRE_RITUAL_CODE}
        revivedCode={REVIVED_CODE}
        files={FILES}
        vitality={VITALITY}
        seed={SEED}
        motionMode={motionMode}
        frames={frames}
      />
    </div>,
  );
  return { frames, log: () => screen.getByRole("log") };
}

/** Advance the fake frame clock by `ms`, flushing the React state it triggers. */
function advance(frames: FakeFrames, ms: number): void {
  act(() => {
    frames.advance(ms);
  });
}

/** Collapse runs of whitespace to single spaces and trim (DOM text normalizer). */
function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The whitespace-normalized text of every rendered `.crt-line` paragraph inside
 * the region (the diff and vitality lines render as `<p class="crt-line">`).
 */
function renderedLineTexts(region: HTMLElement): string[] {
  return Array.from(region.querySelectorAll("p.crt-line")).map((node) =>
    squash(node.textContent ?? ""),
  );
}

/**
 * Assert every engine-produced line appears verbatim (whitespace-normalized)
 * among the rendered `.crt-line` paragraphs — the component mirrors the diff
 * and vitality delta unchanged (R6.2).
 */
function expectLinesRendered(
  region: HTMLElement,
  expected: readonly string[],
): void {
  const rendered = renderedLineTexts(region);
  for (const line of expected) {
    expect(rendered).toContain(squash(line));
  }
}

/**
 * Step the rot animation to completion: one anchor frame, then one frame per
 * decay step, each `MIN_ROT_FRAME_MS` apart, with a generous margin so every
 * step is allowed to advance. `ROT_FRAME_COUNT` frames need `ROT_FRAME_COUNT`
 * advances past the anchor to reach the last index.
 */
function runRotToCompletion(frames: FakeFrames): void {
  // Anchor the cadence clock (first frame does not advance the index).
  advance(frames, 1);
  for (let i = 0; i < ROT_FRAME_COUNT; i += 1) {
    advance(frames, MIN_ROT_FRAME_MS + 1);
  }
}

// ---------------------------------------------------------------------------
// Full motion (R6.1, R6.2, R6.10)
// ---------------------------------------------------------------------------

describe("RotReveal full motion (R6.1, R6.2)", () => {
  it("shows a rot frame first and hides the revived code, diff and vitality", () => {
    const { log } = renderRotReveal("full");
    const region = log();

    // A rot frame is running: the status section is marked and carries a
    // single `<pre class="crt-rot-frame">` of decayed source (R6.1).
    const running = region.querySelector('[data-rot="running"]');
    expect(running).not.toBeNull();
    expect(region.querySelector("pre.crt-rot-frame")).not.toBeNull();

    // The rebirth content is NOT rendered yet.
    expect(region.querySelector('[data-rot="done"]')).toBeNull();
    expect(region.querySelector(".crt-revived-code")).toBeNull();
    expect(region).not.toHaveTextContent(REVIVED_CODE);
    expect(region).not.toHaveTextContent("VITALITY 40/100");
  });

  it("plays rot frames, then renders the revived code, unchanged diff and vitality delta", () => {
    const { frames, log } = renderRotReveal("full");

    // While rotting, no rebirth content exists.
    expect(log().querySelector('[data-rot="done"]')).toBeNull();

    runRotToCompletion(frames);

    const region = log();

    // Rebirth: the rot frame is gone, the revived code is shown (R6.1).
    expect(region.querySelector('[data-rot="running"]')).toBeNull();
    const revived = region.querySelector("pre.crt-revived-code");
    expect(revived).not.toBeNull();
    expect(revived).toHaveTextContent("print(\"hello\")");

    // The diff and Vitality_Delta render exactly as the engine produced them —
    // every line of `renderFileResults(files)` / `renderResurrectVitality
    // (vitality)` is present verbatim, unchanged (R6.2).
    expectLinesRendered(region, EXPECTED_DIFF_LINES);
    expectLinesRendered(region, EXPECTED_VITALITY_LINES);
    expect(region).toHaveTextContent("VITALITY 40/100 -> 58/100 (+18).");
  });

  it("appends the revived code, diff and vitality to the log exactly once (R6.10)", () => {
    const { frames, log } = renderRotReveal("full");
    runRotToCompletion(frames);
    const region = log();

    // Each is rendered once: one revived-code block, one vitality line.
    expect(region.querySelectorAll("pre.crt-revived-code")).toHaveLength(1);

    const matches = (needle: string): number =>
      (region.textContent ?? "").split(needle).length - 1;
    expect(matches("VITALITY 40/100 -> 58/100 (+18).")).toBe(1);
    expect(matches("FILE app/main.py")).toBe(1);

    // The content is selectable DOM text inside the role="log" region.
    const scoped = within(region);
    expect(scoped.getByText(/VITALITY 40\/100 -> 58\/100/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Reduced motion (R6.9, R6.10)
// ---------------------------------------------------------------------------

describe("RotReveal reduced motion (R6.9)", () => {
  it("renders revived code, diff and vitality in one pass with zero rot frames", () => {
    const { frames, log } = renderRotReveal("reduced");
    const region = log();

    // No rot frame is ever shown in reduced motion (R6.9).
    expect(region.querySelector('[data-rot="running"]')).toBeNull();
    expect(region.querySelector("pre.crt-rot-frame")).toBeNull();

    // No animation frame is requested — the final state shows immediately.
    expect(frames.pending()).toBe(0);
    expect(frames.requestCount()).toBe(0);

    // The revived code, diff and vitality delta all render in this one pass,
    // each line verbatim from the engine renderers — unchanged (R6.2).
    expect(region.querySelector("pre.crt-revived-code")).not.toBeNull();
    expectLinesRendered(region, EXPECTED_DIFF_LINES);
    expectLinesRendered(region, EXPECTED_VITALITY_LINES);
  });

  it("renders the rebirth content exactly once and as selectable log text (R6.10)", () => {
    const { log } = renderRotReveal("reduced");
    const region = log();

    expect(region.querySelectorAll("pre.crt-revived-code")).toHaveLength(1);

    const matches = (needle: string): number =>
      (region.textContent ?? "").split(needle).length - 1;
    expect(matches("VITALITY 40/100 -> 58/100 (+18).")).toBe(1);
    expect(matches("FILE app/main.py")).toBe(1);

    const scoped = within(region);
    expect(scoped.getByText(/THE TOWER|TOWER/)).toBeInTheDocument();
  });
});
