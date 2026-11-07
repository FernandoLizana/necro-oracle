// @vitest-environment jsdom
//
// Landing image integer-scaling + no-smoothing property tests
// (oracle-landing-polish, task 8.4).
//
// Validates: Requirements R11.1, R11.2
//
// Property 9 (integer scaling and no smoothing on every landing image): for any
// available preview size, every landing `<img>` renders pixelated with no
// colour/blur filter, and the integer scale factor applied to it
// (`integerScale(available, logical)`) is a whole number >= 1 on both axes.
//
// ── Assertion strategy: INLINE STYLE + CSS SOURCE-SCAN ───────────────────────
// The ui-crt vitest config sets `css: false`, so `landing.css` is not applied
// in jsdom and `getComputedStyle(img).imageRendering` / `filter` cannot be read
// off the cascade. We therefore prove the no-smoothing guarantee two ways, both
// reliable in this env:
//   1. INLINE STYLE on the rendered DOM — every landing `<img>` carries
//      `style.imageRendering === "pixelated"` and sets NO inline `filter`
//      (the components add none). This is read straight off the element, with
//      no stylesheet needed.
//   2. CSS SOURCE-SCAN — `landing.css` declares `image-rendering: pixelated`
//      and `filter: none` on the image classes (`.crt-landing-cardback`, and
//      the Seer `<img>` is governed by the Arcana `.crt-seer-img` rule), so no
//      colour-shifting/blur filter is ever applied at runtime.
// The integer scale factor is computed directly with the real `integerScale`
// (the same function the component calls) and asserted to be an integer >= 1
// — one factor applied to both axes, preserving aspect (R11.1).

import { readFileSync } from "node:fs";

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import { integerScale, type Size } from "../arcana/integer-scale.js";
import { previewModel } from "../landing/landing-model.js";
import { LANDING_ROWS } from "../landing/repos.js";
import { initialState } from "../session/state.js";
import type { ArcanaAsset } from "../arcana/manifest.js";
import { resolveLandingCss } from "../testing/landing-css-path.js";
import { PreviewWindow } from "./PreviewWindow.js";

afterEach(() => {
  cleanup();
});

const NUM_RUNS = 200;

/**
 * The DMG stylesheet source (the no-filter / pixelated oracle for CSS rules).
 * jsdom has no `file:` `import.meta.url`, so the path is resolved by CWD with a
 * repo-root fallback (see `resolveLandingCss`).
 */
const LANDING_CSS = readFileSync(resolveLandingCss(), "utf8");

/**
 * The stylesheet with `/* ... *\/` comment blocks removed. The banner comment
 * mentions "filter: none" in prose; the no-smoothing guarantee is about the
 * actual CSS DECLARATIONS, so we scan the comment-stripped source.
 */
const LANDING_RULES = LANDING_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** The native logical size of one Card_Back (matches the 120x160 deck art). */
const CARD_BACK_LOGICAL: Size = { w: 120, h: 160 };

/** The trusted seer asset so PreviewWindow mounts its real SeerPortrait img. */
const SEER_ASSET: ArcanaAsset = {
  id: "seer",
  logical: { w: 256, h: 144 },
  bands: null,
};

/** A manifest carrying the seer (so the preview renders the Seer <img>). */
const MANIFEST: ReadonlyMap<string, ArcanaAsset> = new Map([["seer", SEER_ASSET]]);

/**
 * Arbitrary available preview region. The range spans below the logical size
 * (where the factor clamps to 1) up through many multiples (larger factors),
 * so the "integer >= 1 on both axes" invariant is exercised across the space.
 */
const arbAvailable: fc.Arbitrary<Size> = fc.record({
  w: fc.integer({ min: 1, max: 4096 }),
  h: fc.integer({ min: 1, max: 4096 }),
});

/** Render the PreviewWindow for the first landing row at a given area. */
function renderPreview(available: Size): HTMLElement {
  const selected = LANDING_ROWS[0];
  if (selected === undefined) throw new Error("LANDING_ROWS must be non-empty");
  const { container } = render(
    createElement(PreviewWindow, {
      model: previewModel(initialState(), selected, MANIFEST),
      seerAsset: SEER_ASSET,
      available,
      motionMode: "full",
    }),
  );
  const root = container.querySelector(".crt-landing-preview");
  expect(root).not.toBeNull();
  return root as HTMLElement;
}

// ── CSS source-scan: pixelated + filter:none on the image classes ────────────

describe("P9 (R11.1, R11.2): integer scaling and no smoothing on every landing image", () => {
  it("landing.css declares image-rendering: pixelated and filter: none on the image surfaces (source-scan)", () => {
    // The card-back image rule carries both guarantees.
    expect(LANDING_RULES).toMatch(
      /\.crt-landing-cardback\b[\s\S]*?image-rendering:\s*pixelated/,
    );
    expect(LANDING_RULES).toMatch(
      /\.crt-landing-cardback\b[\s\S]*?filter:\s*none/,
    );

    // No colour-shifting/blur filter is ever authored on a landing image: the
    // only `filter:` declaration in the stylesheet is the `none` reset above.
    const filterDecls = LANDING_RULES.match(/filter:\s*[^;]+;/g) ?? [];
    for (const decl of filterDecls) {
      expect(decl.replace(/\s+/g, " ").trim()).toBe("filter: none;");
    }
  });

  it("every landing <img> is pixelated with no inline filter, and integerScale is an integer >= 1 on both axes", () => {
    fc.assert(
      fc.property(arbAvailable, (available) => {
        const root = renderPreview(available);

        const imgs = Array.from(root.querySelectorAll("img"));
        // The preview always mounts the Seer img + three card-back imgs.
        expect(imgs.length).toBeGreaterThanOrEqual(1);

        for (const img of imgs) {
          // (1) Inline pixelated hint (survives even without the stylesheet).
          expect(img.style.imageRendering).toBe("pixelated");
          // (2) No colour/blur filter is set inline by the component.
          expect(img.style.filter === "" || img.style.filter === "none").toBe(
            true,
          );
        }

        // The integer display factor the component applies to the 120x160 card
        // backs: one whole-number factor used on BOTH axes (aspect preserved,
        // R11.1). The three backs sit side by side, so to FILL the preview panel
        // (R26) each scales against a THIRD of the available width (and the full
        // height) — larger than scaling against the whole width — keeping the
        // row of three substantially filling the panel. In jsdom the panel's
        // measured rect is zero-sized, so the component falls back to this same
        // `available` hint, which the test mirrors exactly. `integerScale` is
        // total and clamps to 1 for tiny regions.
        const CARD_BACK_COUNT = 3;
        const cardScale = integerScale(
          { w: available.w / CARD_BACK_COUNT, h: available.h },
          CARD_BACK_LOGICAL,
        );
        expect(Number.isInteger(cardScale)).toBe(true);
        expect(cardScale).toBeGreaterThanOrEqual(1);

        // The same whole factor applied to each axis yields integer pixel box
        // dimensions on both width and height (no sub-pixel smoothing).
        expect(Number.isInteger(CARD_BACK_LOGICAL.w * cardScale)).toBe(true);
        expect(Number.isInteger(CARD_BACK_LOGICAL.h * cardScale)).toBe(true);

        // The preview root exposes the integer `--arcana-scale` the card-back
        // box rules multiply out (mirrors the computed factor).
        const exposed = Number(
          root.style.getPropertyValue("--arcana-scale"),
        );
        expect(exposed).toBe(cardScale);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
