// @vitest-environment jsdom
//
// Item 38 (judge-ready-pass): a sentence wrapped across terminal lines must NOT
// drop the word-break space when the rendered log is read as text.
//
// `wrapText` greedily packs words into <= 72-col lines and DROPS the whitespace
// at each break (by design). `OutputBlockView` renders one <p class="crt-line">
// per wrapped line. Two bare block <p> elements concatenate in `textContent`
// with NO separator, so "...will not pay in your" + "stead." reads as
// "...your stead" losing its space -> "yourstead" (the exact baseline byok-flow
// e2e failure). The fix interleaves a newline text node between lines so a
// word boundary survives in `textContent` / the accessibility tree.
//
// This is the DOM-level regression (the e2e asserts the same at the narrow
// terminal width). Validates: judge-ready-pass item 38.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { OutputBlock } from "../render/blocks.js";
import { wrapText, LINE_WIDTH } from "../text/wrap.js";
import { OutputBlockView } from "./OutputBlockView.js";

afterEach(() => {
  cleanup();
});

/** Build an oracle block whose text wraps to >1 line at the 72-col width. */
function wrappedBlock(text: string): OutputBlock {
  const lines = wrapText(text, LINE_WIDTH).map((line) => ({
    segments: [{ text: line }],
  }));
  return { id: 1, kind: "oracle", demo: false, lines };
}

/** Normalise whitespace the way Playwright's toContainText does. */
function normalized(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("item 38: wrapped log text keeps the word-break space in textContent", () => {
  const MSG =
    "OpenRouter rejected your key (401/402); the oracle will not pay in your stead.";

  it("the message wraps to more than one line at 72 cols (precondition)", () => {
    expect(wrapText(MSG, LINE_WIDTH).length).toBeGreaterThan(1);
  });

  it("renders the full sentence with every word boundary intact", () => {
    const { container } = render(
      <OutputBlockView block={wrappedBlock(MSG)} revealedCount={null} />,
    );
    const section = container.querySelector(".crt-block") as HTMLElement;
    const text = normalized(section);
    // The whole sentence survives, including the "in your stead" that straddles
    // the wrap break. Before the fix this read "...pay in yourstead.".
    expect(text).toContain("will not pay in your stead");
    expect(text).not.toContain("yourstead");
  });

  it("holds for an arbitrary word that lands exactly at the wrap boundary", () => {
    // A sentence engineered so a break falls between two short words.
    const msg = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike";
    const { container } = render(
      <OutputBlockView block={wrappedBlock(msg)} revealedCount={null} />,
    );
    const text = normalized(container.querySelector(".crt-block") as HTMLElement);
    // Every adjacent word pair keeps its separating space.
    for (const pair of ["juliet kilo", "kilo lima", "lima mike", "golf hotel"]) {
      expect(text, `lost the space in "${pair}"`).toContain(pair);
    }
  });
});