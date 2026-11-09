// @vitest-environment jsdom
//
// Item 4 (P1, guided buttons): every typed command should also be clickable
// (tarot-ux). `resurrect` previously had NO chip - a user could only type it.
// A one-shot RESURRECT chip is now offered WHEN a resurrectable candidate is in
// scope (JUDGEMENT drawn), gated by the pure `resurrectEligible` selector, and
// clicking it submits the bare `resurrect` line (no required arg, like READ).
//
// Offline, jsdom. No network / LLM / sandbox.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ButtonRow, type ButtonRowProps } from "./ButtonRow.js";
import { resurrectEligible } from "../session/visual-reading.js";
import { initialState } from "../session/state.js";
import type { SessionState } from "../session/state.js";
import type { ReadingResponse } from "../protocol.js";

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// resurrectEligible selector
// ---------------------------------------------------------------------------

/** A minimal ReadingResponse carrying one drawn card of the given id. The
 *  overlay selectors read `response.reading.spread`, so the drawn card must
 *  live on the nested `reading.spread`. */
function readingWithCard(card: string): ReadingResponse {
  return {
    summary: {
      ref: { owner: "o", name: "n", sha: "a".repeat(40), defaultBranch: "main" },
      stars: 0,
      hasWorkflowsDir: false,
      degradedFields: [],
      cache: "miss",
      fileCount: 1,
      truncated: false,
    },
    reading: {
      id: "123e4567-e89b-42d3-a456-426614174000",
      repo: { owner: "o", name: "n", sha: "a".repeat(40), defaultBranch: "main" },
      draws: [
        { card, orientation: "upright", severity: 2, position: 1, evidence: [] },
      ],
      spread: [
        { position: 1, label: "I", draw: { card, orientation: "upright", severity: 2 } },
      ],
      vitality: 42,
      createdAt: "2024-01-01T00:00:00.000Z",
    },
  } as unknown as ReadingResponse;
}

/** A live session holding `reading` for the `necropsy` spread. */
function liveStateWith(reading: ReadingResponse): SessionState {
  const base = initialState();
  return {
    ...base,
    lastSpread: "necropsy",
    readings: { ...base.readings, necropsy: reading },
  } as unknown as SessionState;
}

describe("Item 4 (R1.2 tarot-ux): resurrectEligible is true exactly when JUDGEMENT is drawn", () => {
  it("is true when the in-scope reading drew judgement", () => {
    expect(resurrectEligible(liveStateWith(readingWithCard("judgement")))).toBe(true);
  });

  it("is false when no reading is in scope", () => {
    expect(resurrectEligible(initialState())).toBe(false);
  });

  it("is false when the reading has no judgement draw", () => {
    expect(resurrectEligible(liveStateWith(readingWithCard("tower")))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RESURRECT chip
// ---------------------------------------------------------------------------

function renderRow(resurrect: boolean | undefined): { submit: ReturnType<typeof vi.fn> } {
  const submit = vi.fn();
  const props: ButtonRowProps = {
    submit,
    prefillSummon: vi.fn(),
    toggleSound: vi.fn(),
    soundOn: false,
    ...(resurrect === undefined ? {} : { resurrectEligible: resurrect }),
  };
  render(<ButtonRow {...props} />);
  return { submit };
}

describe("Item 4: the RESURRECT chip is clickable and offered only when eligible", () => {
  it("renders a RESURRECT chip that one-shot submits the bare `resurrect` line when eligible", () => {
    const { submit } = renderRow(true);
    const chip = screen.getByRole("button", { name: "RESURRECT" });
    fireEvent.click(chip);
    expect(submit).toHaveBeenCalledExactlyOnceWith("resurrect", "button");
  });

  it("omits the RESURRECT chip when not eligible", () => {
    renderRow(false);
    expect(screen.queryByRole("button", { name: "RESURRECT" })).toBeNull();
  });

  it("omits the RESURRECT chip when the prop is absent (default)", () => {
    renderRow(undefined);
    expect(screen.queryByRole("button", { name: "RESURRECT" })).toBeNull();
  });
});
