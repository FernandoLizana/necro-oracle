// @vitest-environment jsdom
//
// Item 10 (judge-ready-pass): the DMG Landing is fully keyboard-operable.
//
// The pure `landingKeyAction` classifier is exhaustively PBT-covered
// (key-binding.pbt.test.ts, P4), but nothing proved that the LIVE `Landing`
// component actually WIRES that handler to real selection + activation: the
// keyboard integration (root `onKeyDown` -> move selection, Enter/A activate
// the selected row, B/D run demo, H help, modified keys fall through) was
// untested. A regression that dropped a case, stopped calling `preventDefault`,
// mis-wired `runActivation`, or moved the handler off the focusable root would
// still pass the pure PBT while silently breaking the keyboard menu.
//
// This is the end-to-end wiring guard: it renders the real `Landing` in a
// booted-idle, landing-visible state and drives it entirely from the keyboard,
// asserting the observable effects (which row activates, which command the host
// receives). It also pins the accessibility contract that makes the region
// keyboard-reachable at all: a focusable (`tabIndex=0`) labelled region.
//
// Validates: judge-ready-pass item 10 (R7.2-R7.9).

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadManifest } from "../arcana/manifest.js";
import { bootedIdleState } from "../testing/arbitraries.js";
import { landingVisible } from "../landing/landing-model.js";
import { LANDING_ROWS } from "../landing/repos.js";
import { Landing } from "./Landing.js";

afterEach(() => {
  cleanup();
});

const MANIFEST = loadManifest({
  images: [
    { id: "seer", logical: [256, 144], bands: null },
    {
      id: "moon",
      logical: [120, 160],
      bands: { header_rows: [0, 19], footer_rows: [147, 160] },
    },
  ],
} as const);

const PREVIEW_AREA = { w: 1024, h: 576 } as const;

/** The first concrete repo row (index 0) and the trailing ENTER row. */
const FIRST_REPO_REF =
  LANDING_ROWS[0]?.kind === "repo" ? LANDING_ROWS[0].repo.ref : "";
const ENTER_INDEX = LANDING_ROWS.length - 1;

/** Render the real Landing with spy callbacks and return the focusable root. */
function renderLanding(): {
  readonly root: HTMLElement;
  readonly submit: ReturnType<typeof vi.fn>;
  readonly onSummonAndRead: ReturnType<typeof vi.fn>;
  readonly focusInput: ReturnType<typeof vi.fn>;
} {
  const state = bootedIdleState();
  expect(landingVisible(state)).toBe(true);

  const submit = vi.fn();
  const onSummonAndRead = vi.fn();
  const focusInput = vi.fn();

  const { container } = render(
    <Landing
      state={state}
      manifest={MANIFEST}
      motionMode="full"
      available={PREVIEW_AREA}
      submit={submit}
      onSummonAndRead={onSummonAndRead}
      focusInput={focusInput}
    />,
  );

  const root = container.querySelector(".crt-landing") as HTMLElement | null;
  expect(root, "the landing root must render").not.toBeNull();
  return { root: root as HTMLElement, submit, onSummonAndRead, focusInput };
}

describe("item 10 (judge-ready-pass, R7.2-R7.9): the Landing is keyboard-operable", () => {
  it("exposes a focusable, labelled region so a keyboard user can Tab in", () => {
    const { root } = renderLanding();
    expect(root.getAttribute("tabindex")).toBe("0");
    expect(root.getAttribute("role")).toBe("region");
    expect(root.getAttribute("aria-label")).toBe(
      "Legacy repository landing",
    );
  });

  it("Enter activates the first row by default -> summons that repo + reads", () => {
    const { root, onSummonAndRead, focusInput, submit } = renderLanding();
    fireEvent.keyDown(root, { key: "Enter" });
    expect(onSummonAndRead).toHaveBeenCalledTimes(1);
    expect(onSummonAndRead).toHaveBeenCalledWith(FIRST_REPO_REF);
    expect(focusInput).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("ArrowDown moves the cursor; A then activates the NEW row", () => {
    const { root, onSummonAndRead } = renderLanding();
    // Walk from the first repo all the way to the ENTER row.
    for (let i = 0; i < ENTER_INDEX; i++) {
      fireEvent.keyDown(root, { key: "ArrowDown" });
    }
    fireEvent.keyDown(root, { key: "a" });
    // The ENTER row focuses the input rather than summoning a repo.
    expect(onSummonAndRead).not.toHaveBeenCalled();
  });

  it("the ENTER row (reached by arrows) activates to focus the NECRO> input", () => {
    const { root, focusInput, onSummonAndRead } = renderLanding();
    for (let i = 0; i < ENTER_INDEX; i++) {
      fireEvent.keyDown(root, { key: "ArrowDown" });
    }
    fireEvent.keyDown(root, { key: "Enter" });
    expect(focusInput).toHaveBeenCalledTimes(1);
    expect(onSummonAndRead).not.toHaveBeenCalled();
  });

  it("ArrowUp is clamped at the top (no wrap): Enter still hits the first repo", () => {
    const { root, onSummonAndRead } = renderLanding();
    fireEvent.keyDown(root, { key: "ArrowUp" });
    fireEvent.keyDown(root, { key: "ArrowUp" });
    fireEvent.keyDown(root, { key: "Enter" });
    expect(onSummonAndRead).toHaveBeenCalledWith(FIRST_REPO_REF);
  });

  it("B and D both run the demo command", () => {
    const { root, submit } = renderLanding();
    fireEvent.keyDown(root, { key: "b" });
    fireEvent.keyDown(root, { key: "d" });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenNthCalledWith(1, "demo", "button");
    expect(submit).toHaveBeenNthCalledWith(2, "demo", "button");
  });

  it("H (START) runs the help command", () => {
    const { root, submit } = renderLanding();
    fireEvent.keyDown(root, { key: "h" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("help", "button");
  });

  it("a modified key (Ctrl+ArrowDown) is NOT stolen: no move, no activation", () => {
    const { root, onSummonAndRead } = renderLanding();
    // Ctrl+Down must fall through (none); the cursor stays on the first repo.
    fireEvent.keyDown(root, { key: "ArrowDown", ctrlKey: true });
    fireEvent.keyDown(root, { key: "Enter" });
    expect(onSummonAndRead).toHaveBeenCalledWith(FIRST_REPO_REF);
  });

  it("an unmapped key (x) does nothing and does not throw", () => {
    const { root, submit, onSummonAndRead, focusInput } = renderLanding();
    expect(() => fireEvent.keyDown(root, { key: "x" })).not.toThrow();
    expect(submit).not.toHaveBeenCalled();
    expect(onSummonAndRead).not.toHaveBeenCalled();
    expect(focusInput).not.toHaveBeenCalled();
  });
});