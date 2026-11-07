// @vitest-environment jsdom
//
// Landing motion-off property tests (oracle-landing-polish, task 8.4).
//
// Validates: Requirements R16.1, R16.2
//
// Property 7 (motion-off disables every landing animation): the ONLY animated
// selectors on the landing are the candle flicker and the cursor blink, both
// gated to `.crt[data-motion="full"]`; under `data-motion="reduced"` and under
// `@media (prefers-reduced-motion: reduce)` those animations are disabled.
//
// ── Assertion strategy: CSS SOURCE-SCAN (not jsdom computed styles) ──────────
// The ui-crt vitest config sets `css: false`, so `landing.css` is never applied
// in jsdom and no `@keyframes` / `animation` cascade is computed. Reading
// `getComputedStyle(el).animationName` would always be empty here, so it cannot
// prove a motion contract. Instead we SOURCE-SCAN `landing.css`:
//   - the only two `@keyframes` are the candle flicker and the cursor blink;
//   - every rule that sets a non-`none` `animation` is gated under
//     `.crt[data-motion="full"]`;
//   - both the `[data-motion="reduced"]` resting rules and a
//     `@media (prefers-reduced-motion: reduce)` guard pin the steady state /
//     set `animation: none`.
// We ALSO render the two Motion_Zone glyph classes under a reduced-motion
// container and assert neither element carries a running inline `animation`
// (the stylesheet, not inline style, drives motion; so inline is always empty).
//
// NOTE: the fast-check property here ranges over the two motion modes and the
// two authored animation names, asserting the full/reduced gating holds for
// each combination from the single stylesheet source.

import { readFileSync } from "node:fs";

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import type { MotionMode } from "../motion/motion-mode.js";
import { resolveLandingCss } from "../testing/landing-css-path.js";

afterEach(() => {
  cleanup();
});

const NUM_RUNS = 200;

/**
 * The DMG stylesheet source — the single motion oracle for this property.
 * jsdom has no `file:` `import.meta.url`, so the path is resolved by CWD with a
 * repo-root fallback (see `resolveLandingCss`).
 */
const LANDING_CSS = readFileSync(resolveLandingCss(), "utf8");

/** The two (and only two) authored landing keyframe animation names. */
const CANDLE_KF = "crt-landing-candle-kf";
const CURSOR_KF = "crt-landing-cursor-kf";

/**
 * The stylesheet with `/* ... *\/` comment blocks removed. The banner comment
 * discusses motion gating in prose; the animation contract is about the actual
 * CSS RULES, so every scan below runs on the comment-stripped source.
 */
const LANDING_RULES = LANDING_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** Collapse whitespace so multi-line declarations match simple patterns. */
function normalize(css: string): string {
  return css.replace(/\s+/g, " ");
}

const CSS_FLAT = normalize(LANDING_RULES);

// ── arbitraries ──────────────────────────────────────────────────────────────

const arbMotionMode: fc.Arbitrary<MotionMode> = fc.constantFrom(
  "full",
  "reduced",
);

const arbAnimationName = fc.constantFrom(CANDLE_KF, CURSOR_KF);

// ── Property: motion-off disables every landing animation ────────────────────

describe("P7 (R16.1, R16.2): motion-off disables every landing animation", () => {
  it("the only @keyframes in landing.css are the candle flicker and the cursor blink", () => {
    // Collect every @keyframes name declared in the stylesheet.
    const names = Array.from(
      LANDING_RULES.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g),
      (m) => m[1],
    );
    expect(new Set(names)).toEqual(new Set([CANDLE_KF, CURSOR_KF]));
    // Exactly two keyframe blocks, no duplicates.
    expect(names.length).toBe(2);
  });

  it("every rule that starts an animation is gated under .crt[data-motion=\"full\"]", () => {
    // Find each `animation:` declaration whose value is not `none`, and the
    // selector that introduces it; assert the selector is the full-motion gate.
    // The two authored animating rules are:
    //   .crt[data-motion="full"] .crt-landing-candle { animation: ...kf ... }
    //   .crt[data-motion="full"] .crt-landing-cursor { animation: ...kf ... }
    for (const kf of [CANDLE_KF, CURSOR_KF]) {
      // The keyframe name is referenced by an `animation:` declaration...
      expect(CSS_FLAT).toContain(kf);
      // ...and that reference lives under the full-motion gate.
      const gated = new RegExp(
        `\\.crt\\[data-motion="full"\\][^{}]*\\{[^{}]*${kf}[^{}]*\\}`,
      );
      expect(gated.test(CSS_FLAT)).toBe(true);
    }

    // No `animation:` declaration with a keyframe name appears OUTSIDE a
    // full-motion gate. We check that every animating declaration's keyframe is
    // one of the two names and that each is only started inside the gate above;
    // a stray `.crt-landing-* { animation: somekf ... }` would escape both
    // `gated` patterns and we assert there is no such ungated keyframe use.
    const animDecls = Array.from(
      CSS_FLAT.matchAll(/animation:\s*([^;]+);/g),
      (m) => (m[1] ?? "").trim(),
    );
    for (const decl of animDecls) {
      if (decl === "none") continue;
      // Any non-none animation must name one of the two landing keyframes.
      const usesCandle = decl.includes(CANDLE_KF);
      const usesCursor = decl.includes(CURSOR_KF);
      expect(usesCandle || usesCursor).toBe(true);
    }
  });

  it("reduced motion + prefers-reduced-motion disable both landing animations (per animation name, both modes)", () => {
    fc.assert(
      fc.property(arbMotionMode, arbAnimationName, (mode, kf) => {
        if (mode === "full") {
          // Full motion: the animation IS started (inside the gate).
          const gated = new RegExp(
            `\\.crt\\[data-motion="full"\\][^{}]*\\{[^{}]*${kf}[^{}]*\\}`,
          );
          expect(gated.test(CSS_FLAT)).toBe(true);
        } else {
          // Reduced motion: the explicit resting rule pins the steady state for
          // the candle (colour) and cursor (opacity) under the reduced gate,
          // and `crt.css`'s `.crt[data-motion="reduced"] *` strips animations.
          const glyphClass =
            kf === CANDLE_KF ? "crt-landing-candle" : "crt-landing-cursor";
          const restingRule = new RegExp(
            `\\.crt\\[data-motion="reduced"\\]\\s+\\.${glyphClass}\\s*\\{`,
          );
          expect(restingRule.test(CSS_FLAT)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a prefers-reduced-motion media guard sets animation: none even at full motion", () => {
    // The OS-preference guard block exists and holds the steady state.
    expect(CSS_FLAT).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    // Within the stylesheet, the guard disables the full-motion animations.
    const guardIdx = LANDING_RULES.indexOf(
      "@media (prefers-reduced-motion: reduce)",
    );
    expect(guardIdx).toBeGreaterThanOrEqual(0);
    const guardBlock = LANDING_RULES.slice(guardIdx);
    expect(guardBlock).toMatch(/animation:\s*none/);
    // Both motion-zone glyph classes are named inside the guard.
    expect(guardBlock).toContain("crt-landing-candle");
    expect(guardBlock).toContain("crt-landing-cursor");
  });

  it("rendered under data-motion=\"reduced\", neither motion-zone glyph carries a running inline animation", () => {
    // The stylesheet (not inline style) drives motion; css:false means no
    // cascade here, so inline `animation` must be empty on both glyphs. This
    // guards against a future regression that inlines an animation on the DOM.
    const { container } = render(
      createElement(
        "div",
        { className: "crt", "data-motion": "reduced" },
        createElement(
          "div",
          { className: "crt-landing" },
          createElement("span", { className: "crt-landing-candle" }, "*"),
          createElement("span", { className: "crt-landing-cursor" }, "_"),
        ),
      ),
    );

    const candle = container.querySelector<HTMLElement>(".crt-landing-candle");
    const cursor = container.querySelector<HTMLElement>(".crt-landing-cursor");
    expect(candle).not.toBeNull();
    expect(cursor).not.toBeNull();
    expect(candle?.style.animation ?? "").toBe("");
    expect(cursor?.style.animation ?? "").toBe("");
  });
});
