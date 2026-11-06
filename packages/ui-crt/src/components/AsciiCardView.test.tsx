// @vitest-environment jsdom
//
// AsciiCardView component behaviour tests (task 10.2).
//
// Validates: Requirements R3.4, R3.7, R5.7, R5.8, R5.9, R5.10, R5.12
//
// These drive the presentational card view built in task 10.1. The component
// is pure/presentational, so every assertion is deterministic: cards come from
// the pure `asciiCard(cardId, orientation)` renderer and glitch params from the
// pure `glitchProfile(severity)` — no network, clock, DOM-timer, or real
// randomness. jsdom gives us a real DOM to read `data-*` attributes, the
// aria-hidden glyph `<pre>`, the `crt-sr-only` equivalent, and the glitch CSS
// custom properties off the element's inline style.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { glitchProfile } from "../motion/glitch.js";
import { asciiCard } from "../render/ascii-card.js";

import {
  AsciiCardView,
  GLITCH_CLASS,
  SHAKE_CLASS,
} from "./AsciiCardView.js";

afterEach(() => {
  cleanup();
});

/**
 * Render an `AsciiCardView` and return the single card element (the root
 * `.crt-ascii-card` div) for attribute/class assertions.
 */
function renderCard(
  props: Parameters<typeof AsciiCardView>[0],
): HTMLElement {
  const { container } = render(<AsciiCardView {...props} />);
  const el = container.querySelector(".crt-ascii-card");
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

// ---------------------------------------------------------------------------
// Orientation: reversed sets data-orientation; text is not mangled (R3.7)
// ---------------------------------------------------------------------------

describe("R3.7 (orientation): reversed records data-orientation, text stays upright-handled in CSS", () => {
  it("sets data-orientation=\"reversed\" on the card element for a reversed card", () => {
    const card = asciiCard("hermit", "reversed");
    const el = renderCard({ card, glitch: glitchProfile(0), motionMode: "full" });
    expect(el).toHaveAttribute("data-orientation", "reversed");
  });

  it("sets data-orientation=\"upright\" on the card element for an upright card", () => {
    const card = asciiCard("hermit", "upright");
    const el = renderCard({ card, glitch: glitchProfile(0), motionMode: "full" });
    expect(el).toHaveAttribute("data-orientation", "upright");
  });

  it("emits the orientation as a DOM attribute only — the glyph text is the same frame regardless (CSS handles the 180° flip and upright text overlay)", () => {
    // The component does not rotate or re-order the glyph rows itself; the
    // reversed flip is CSS. So the rendered glyph text equals the renderer's
    // rows joined by newlines for both orientations.
    const card = asciiCard("hermit", "reversed");
    const el = renderCard({ card, glitch: glitchProfile(0), motionMode: "full" });
    const pre = el.querySelector("pre.crt-ascii-card-art");
    expect(pre?.textContent).toBe(card.rows.join("\n"));
  });
});

// ---------------------------------------------------------------------------
// A11y: aria-hidden glyph art + crt-sr-only equivalent (R3.4)
// ---------------------------------------------------------------------------

describe("R3.4 (accessible text): decorative glyphs are aria-hidden with a crt-sr-only equivalent", () => {
  it("renders the glyph <pre> as aria-hidden and a sibling crt-sr-only span with accessibleText", () => {
    const card = asciiCard("tower", "upright");
    const el = renderCard({ card, glitch: glitchProfile(2), motionMode: "full" });

    const pre = el.querySelector("pre.crt-ascii-card-art");
    expect(pre).not.toBeNull();
    expect(pre).toHaveAttribute("aria-hidden", "true");

    const sr = el.querySelector("span.crt-sr-only");
    expect(sr).not.toBeNull();
    expect(sr?.textContent).toBe(card.accessibleText);
    // The accessible text names numeral + name + orientation.
    expect(card.accessibleText).toContain("THE TOWER");
    expect(card.accessibleText).toContain("upright");
  });
});

// ---------------------------------------------------------------------------
// Glitch in full motion reflects glitchProfile(severity) (R5.7, R5.12)
// ---------------------------------------------------------------------------

describe("R5.3 (calm card is steady): severity 0 in full motion carries no glitch", () => {
  it("emits NO crt-glitch class, NO data-glitch-intensity, NO glitch custom-props, NO shake for a severity-0 card in full motion", () => {
    // THE STAR is severity 0 in the demo necropsy reading. A calm card must be
    // perfectly steady: no glitch hook at all, identical to reduced motion for
    // that card, so it renders as a clean single-image card (no chromatic
    // double-image). The glitch belongs only to severity > 0.
    const el = renderCard({
      card: asciiCard("star", "upright"),
      glitch: glitchProfile(0),
      motionMode: "full",
    });

    expect(el.classList.contains(GLITCH_CLASS)).toBe(false);
    expect(el.classList.contains(SHAKE_CLASS)).toBe(false);
    expect(el).not.toHaveAttribute("data-glitch-intensity");
    expect(el.style.getPropertyValue("--glitch-offset")).toBe("");
    expect(el.style.getPropertyValue("--glitch-tears")).toBe("");
    expect(el.style.getPropertyValue("--glitch-corrupt")).toBe("");
    expect(el.style.getPropertyValue("--glitch-duration")).toBe("");
  });

  it("does NOT add crt-shake for a severity-0 tower in full motion (a calm card is steady)", () => {
    const el = renderCard({
      card: asciiCard("tower", "upright"),
      glitch: glitchProfile(0),
      motionMode: "full",
    });
    expect(el.classList.contains(GLITCH_CLASS)).toBe(false);
    expect(el.classList.contains(SHAKE_CLASS)).toBe(false);
    expect(el).not.toHaveAttribute("data-glitch-intensity");
  });
});

describe("R5.7 (glitch in full motion): glitch class and attributes reflect glitchProfile", () => {
  it("applies the crt-glitch class and glitch attributes/custom-properties for a severe card in full motion", () => {
    const glitch = glitchProfile(3);
    const card = asciiCard("tower", "upright");
    const el = renderCard({ card, glitch, motionMode: "full" });

    expect(el.classList.contains(GLITCH_CLASS)).toBe(true);
    expect(el).toHaveAttribute("data-glitch-intensity", "3");

    // Severity 3 → offsetPx 6, tearCount 3, corruptChars 9, durationMs 270.
    expect(glitch.offsetPx).toBe(6);
    expect(el.style.getPropertyValue("--glitch-offset")).toBe("6px");
    expect(el.style.getPropertyValue("--glitch-tears")).toBe("3");
    expect(el.style.getPropertyValue("--glitch-corrupt")).toBe("9");
    expect(el.style.getPropertyValue("--glitch-duration")).toBe("270ms");
  });

  it("maps a milder severity to its own glitch intensity and bounded offset", () => {
    const glitch = glitchProfile(1);
    const card = asciiCard("hermit", "upright");
    const el = renderCard({ card, glitch, motionMode: "full" });

    expect(el.classList.contains(GLITCH_CLASS)).toBe(true);
    expect(el).toHaveAttribute("data-glitch-intensity", "1");
    expect(el.style.getPropertyValue("--glitch-offset")).toBe("2px");
    expect(el.style.getPropertyValue("--glitch-tears")).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// OPTIONAL severity-3 phosphor bloom hook (R13.2, task 21.2)
// ---------------------------------------------------------------------------
//
// The bloom is CSS-only, keyed off the existing `data-glitch-intensity="3"`
// attribute under `.crt[data-motion="full"] .crt-glitch`. So the view's only
// obligation is to carry that hook — the crt-glitch class plus
// data-glitch-intensity="3" — for a severity-3 card in full motion, and to
// carry neither the severe intensity hook for a milder card nor any glitch hook
// at all in reduced motion.

describe("R13.2 (phosphor bloom hook): severity-3 card in full motion carries the bloom hook", () => {
  it("carries crt-glitch + data-glitch-intensity=\"3\" for a severity-3 card in full motion", () => {
    const el = renderCard({
      card: asciiCard("death", "upright"),
      glitch: glitchProfile(3),
      motionMode: "full",
    });
    // Both parts of the CSS selector `.crt-glitch[data-glitch-intensity="3"]`.
    expect(el.classList.contains(GLITCH_CLASS)).toBe(true);
    expect(el).toHaveAttribute("data-glitch-intensity", "3");
  });

  it("does NOT carry the severity-3 bloom hook for a non-severe card in full motion", () => {
    const el = renderCard({
      card: asciiCard("hermit", "upright"),
      glitch: glitchProfile(2),
      motionMode: "full",
    });
    // Still glitches, but the bloom selector needs intensity="3" specifically.
    expect(el).toHaveAttribute("data-glitch-intensity", "2");
    expect(el.getAttribute("data-glitch-intensity")).not.toBe("3");
  });

  it("does NOT carry any bloom hook for a severity-3 card in reduced motion", () => {
    const el = renderCard({
      card: asciiCard("death", "upright"),
      glitch: glitchProfile(3),
      motionMode: "reduced",
    });
    // Reduced motion emits no glitch class and no intensity attribute, so the
    // full-motion bloom selector can never match.
    expect(el.classList.contains(GLITCH_CLASS)).toBe(false);
    expect(el).not.toHaveAttribute("data-glitch-intensity");
  });
});

// ---------------------------------------------------------------------------
// Amber burning only for tower/devil (R5.8)
// ---------------------------------------------------------------------------

describe("R5.8 (amber): data-burning is set only for tower and devil", () => {
  it("sets data-burning=\"true\" for the tower", () => {
    const el = renderCard({
      card: asciiCard("tower", "upright"),
      glitch: glitchProfile(2),
      motionMode: "full",
    });
    expect(el).toHaveAttribute("data-burning", "true");
  });

  it("sets data-burning=\"true\" for the devil", () => {
    const el = renderCard({
      card: asciiCard("devil", "upright"),
      glitch: glitchProfile(2),
      motionMode: "full",
    });
    expect(el).toHaveAttribute("data-burning", "true");
  });

  it("does NOT set data-burning for a non-burning card (hermit)", () => {
    const el = renderCard({
      card: asciiCard("hermit", "upright"),
      glitch: glitchProfile(2),
      motionMode: "full",
    });
    expect(el).not.toHaveAttribute("data-burning");
  });
});

// ---------------------------------------------------------------------------
// Tower shake: full motion + tower + intensity ≥ 2 (R5.9, R5.10)
// ---------------------------------------------------------------------------

describe("R5.9 / R5.10 (tower shake): crt-shake only for a severe Tower in full motion", () => {
  it("adds crt-shake for the tower at severity 2 in full motion", () => {
    const el = renderCard({
      card: asciiCard("tower", "upright"),
      glitch: glitchProfile(2),
      motionMode: "full",
    });
    expect(el.classList.contains(SHAKE_CLASS)).toBe(true);
  });

  it("adds crt-shake for the tower at severity 3 in full motion", () => {
    const el = renderCard({
      card: asciiCard("tower", "upright"),
      glitch: glitchProfile(3),
      motionMode: "full",
    });
    expect(el.classList.contains(SHAKE_CLASS)).toBe(true);
  });

  it("does NOT add crt-shake for the tower below severity 2 in full motion", () => {
    const el = renderCard({
      card: asciiCard("tower", "upright"),
      glitch: glitchProfile(1),
      motionMode: "full",
    });
    expect(el.classList.contains(SHAKE_CLASS)).toBe(false);
  });

  it("does NOT add crt-shake for a non-tower card even at severity 3 in full motion", () => {
    const el = renderCard({
      card: asciiCard("death", "upright"),
      glitch: glitchProfile(3),
      motionMode: "full",
    });
    expect(el.classList.contains(SHAKE_CLASS)).toBe(false);
  });

  it("does NOT add crt-shake for a severe tower in reduced motion", () => {
    const el = renderCard({
      card: asciiCard("tower", "upright"),
      glitch: glitchProfile(3),
      motionMode: "reduced",
    });
    expect(el.classList.contains(SHAKE_CLASS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reduced motion: no glitch class, no glitch attributes (R5.12)
// ---------------------------------------------------------------------------

describe("R5.12 (reduced motion): no glitch class and no glitch attributes", () => {
  it("omits the crt-glitch class and all glitch attributes/custom-properties in reduced motion", () => {
    const el = renderCard({
      card: asciiCard("tower", "upright"),
      glitch: glitchProfile(3),
      motionMode: "reduced",
    });

    expect(el.classList.contains(GLITCH_CLASS)).toBe(false);
    expect(el).not.toHaveAttribute("data-glitch-intensity");
    expect(el.style.getPropertyValue("--glitch-offset")).toBe("");
    expect(el.style.getPropertyValue("--glitch-tears")).toBe("");
    expect(el.style.getPropertyValue("--glitch-corrupt")).toBe("");
    expect(el.style.getPropertyValue("--glitch-duration")).toBe("");
  });

  it("still records data-orientation and data-burning in reduced motion (those are not glitch effects)", () => {
    const el = renderCard({
      card: asciiCard("tower", "reversed"),
      glitch: glitchProfile(3),
      motionMode: "reduced",
    });
    expect(el).toHaveAttribute("data-orientation", "reversed");
    expect(el).toHaveAttribute("data-burning", "true");
  });
});

// ---------------------------------------------------------------------------
// Severity integer is not stripped: the view keeps all card content (R5.12)
// ---------------------------------------------------------------------------

describe("R5.12 (content stability): the view never strips card content", () => {
  it("renders every glyph row of the card regardless of motion mode", () => {
    const card = asciiCard("tower", "upright");

    const full = renderCard({ card, glitch: glitchProfile(3), motionMode: "full" });
    const reduced = renderCard({ card, glitch: glitchProfile(3), motionMode: "reduced" });

    // The selectable glyph text is identical in both motion modes: the glitch
    // is a transient CSS layer, not a mutation of the card content. The SEVERITY
    // header integer is produced by the reducer/renderReading elsewhere; the
    // view simply never removes card rows.
    const fullPre = full.querySelector("pre.crt-ascii-card-art");
    const reducedPre = reduced.querySelector("pre.crt-ascii-card-art");
    expect(fullPre?.textContent).toBe(card.rows.join("\n"));
    expect(reducedPre?.textContent).toBe(card.rows.join("\n"));
    // All of the card's rows are present in the rendered glyph text.
    for (const row of card.rows) {
      expect(fullPre?.textContent).toContain(row);
    }
  });
});
