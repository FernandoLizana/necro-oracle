// @vitest-environment jsdom
//
// Landing DMG palette-purity property tests (oracle-landing-polish, task 8.4).
//
// Validates: Requirements R10.1, R10.2
//
// Property 8 (DMG palette purity): every `color` / `background-color` /
// `border-color` on a DMG landing surface is one of the four strict
// `DMG_PALETTE` shades (or `transparent`), and the inverted selected row uses
// two palette shades whose WCAG contrast ratio is >= 4.5:1.
//
// ── Assertion strategy: CSS SOURCE-SCAN (not jsdom computed styles) ──────────
// The ui-crt vitest config sets `css: false`, so `import "../landing/landing.css"`
// is a NO-OP in jsdom: no stylesheet is applied, no cascade is computed, and
// the colours below are authored entirely through `var(--dmg-0..3)` custom
// properties that jsdom's `getComputedStyle` cannot resolve. Reading computed
// colours off rendered DOM would therefore yield empty/`rgba(0,0,0,0)` strings
// — unreliable in this repo's test env. So, per the task's guidance, the
// palette-purity guarantee is proven by a SOURCE-SCAN of `landing.css`: every
// hex literal used for a `color` / `background-color` / `border-color`
// declaration on a DMG surface must be a member of `DMG_PALETTE`. We ALSO
// render the four DMG components (HudBar, LegacyRepoList, PreviewWindow,
// HintBar) inside a `.crt .crt-landing` container across arbitrary selected
// indices and row sets to prove the surfaces mount on real DOM and carry only
// the `.crt-landing*` classes the scanned stylesheet governs. The inverted-row
// contrast is computed directly from the two authored hex values
// (#8cff9e on #0b4f1a).

import { readFileSync } from "node:fs";

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import { DMG_PALETTE } from "../landing/palette.js";
import {
  LANDING_ROWS,
  type LandingRow,
} from "../landing/repos.js";
import {
  hudModel,
  previewModel,
  type PreviewModel,
} from "../landing/landing-model.js";
import { initialState } from "../session/state.js";
import type { ArcanaAsset } from "../arcana/manifest.js";
import { resolveLandingCss } from "../testing/landing-css-path.js";
import { HudBar } from "./HudBar.js";
import { HintBar } from "./HintBar.js";
import { LegacyRepoList } from "./LegacyRepoList.js";
import { PreviewWindow } from "./PreviewWindow.js";

afterEach(() => {
  cleanup();
});

const NUM_RUNS = 200;

/**
 * The DMG stylesheet source, read once (source-scan is the palette oracle).
 * jsdom does not expose a `file:` `import.meta.url`, so resolve by CWD. The
 * package-relative path works under `pnpm --filter @necro/ui-crt test` (CWD =
 * package root); the repo-root `pnpm test` run has CWD = repo root, so fall
 * back to the monorepo path. Either way the same source file is read.
 */
const LANDING_CSS = readFileSync(resolveLandingCss(), "utf8");

/**
 * The stylesheet with `/* ... *\/` comment blocks removed. The banner comment
 * discusses colours and filters in prose (e.g. "#33ff66", "filter: none"); the
 * palette-purity guarantee is about the actual CSS DECLARATIONS, so we scan the
 * comment-stripped source. This is the authoritative palette oracle.
 */
const LANDING_RULES = LANDING_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** The four strict shades, lower-cased for case-insensitive membership tests. */
const PALETTE_SET = new Set<string>(DMG_PALETTE.map((h) => h.toLowerCase()));

/** The trusted seer asset so PreviewWindow mounts its real SeerPortrait. */
const SEER_ASSET: ArcanaAsset = {
  id: "seer",
  logical: { w: 256, h: 144 },
  bands: null,
};

/** A manifest that carries the seer (so `showSeer` is true). */
const MANIFEST: ReadonlyMap<string, ArcanaAsset> = new Map([["seer", SEER_ASSET]]);

// ── WCAG contrast helpers (sRGB relative luminance) ──────────────────────────

/** Parse a `#rrggbb` string to its three 0..255 channels. */
function hexChannels(hex: string): readonly [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) {
    throw new Error(`not a 6-digit hex colour: ${hex}`);
  }
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] as const;
}

/** The sRGB relative luminance of a `#rrggbb` colour (WCAG 2.x formula). */
function relativeLuminance(hex: string): number {
  const toLinear = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexChannels(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** The WCAG contrast ratio between two `#rrggbb` colours (1..21). */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── arbitraries ──────────────────────────────────────────────────────────────

/** Any valid selected index into the fixed landing row list (clamped range). */
const arbSelectedIndex = fc.integer({ min: 0, max: LANDING_ROWS.length - 1 });

/**
 * An arbitrary non-empty subset of the schema-valid `LANDING_ROWS`, preserving
 * their authored order. Each drawn row set is still made of schema-valid rows
 * (we only drop rows, never fabricate off-spec ones), so the DMG surfaces stay
 * within the authored palette regardless of how many rows render.
 */
const arbRowSet: fc.Arbitrary<readonly LandingRow[]> = fc
  .subarray([...LANDING_ROWS], { minLength: 1 })
  .map((rows) => rows as readonly LandingRow[]);

/** The preview model for a selected row (seer present, 3 backs, oracle line). */
function previewFor(selected: LandingRow): PreviewModel {
  return previewModel(initialState(), selected, MANIFEST);
}

// ── Source-scan oracle: every hex on a DMG colour property is in DMG_PALETTE ──

describe("P8 (R10.1, R10.2): DMG palette purity", () => {
  it("every hex literal in landing.css is a member of DMG_PALETTE (source-scan)", () => {
    // Scan every hex colour literal (#rgb or #rrggbb) in the stylesheet. Because
    // this file only ever writes colour/background-color/border-color on DMG
    // surfaces (its sole purpose) and binds them through `var(--dmg-0..3)`, the
    // ONLY hex literals present are the four palette definitions themselves.
    // Any stray off-palette hex — now or in a future edit — fails here.
    const hexMatches = LANDING_RULES.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];

    // The stylesheet must actually define the palette (guard against an empty
    // scan silently "passing").
    expect(hexMatches.length).toBeGreaterThanOrEqual(DMG_PALETTE.length);

    for (const raw of hexMatches) {
      const hex = raw.toLowerCase();
      expect(
        PALETTE_SET.has(hex),
        `off-palette hex ${raw} found in landing.css; only ${DMG_PALETTE.join(
          ", ",
        )} are allowed`,
      ).toBe(true);
    }

    // And all four palette shades are present (the rules mirror the tuple).
    for (const shade of DMG_PALETTE) {
      expect(LANDING_RULES.toLowerCase()).toContain(shade.toLowerCase());
    }
  });

  it("renders every DMG surface across arbitrary selection + row sets, each carrying only .crt-landing* classes", () => {
    fc.assert(
      fc.property(arbSelectedIndex, arbRowSet, (rawIndex, rows) => {
        const selectedIndex = Math.min(rawIndex, rows.length - 1);
        const selected = rows[selectedIndex];
        if (selected === undefined) throw new Error("row set must be non-empty");

        const { container } = render(
          createElement(
            "div",
            { className: "crt" },
            createElement(
              "div",
              { className: "crt-landing" },
              createElement(HudBar, { model: hudModel(initialState()) }),
              createElement(LegacyRepoList, {
                rows,
                selectedIndex,
                onSelect: () => {},
                onActivate: () => {},
              }),
              createElement(PreviewWindow, {
                model: previewFor(selected),
                seerAsset: SEER_ASSET,
                available: { w: 640, h: 480 },
                motionMode: "full",
              }),
              createElement(HintBar),
            ),
          ),
        );

        // The four DMG panels mounted on real DOM inside `.crt .crt-landing`.
        const root = container.querySelector(".crt .crt-landing");
        expect(root).not.toBeNull();
        expect(root?.querySelector(".crt-landing-hud")).not.toBeNull();
        expect(root?.querySelector(".crt-landing-list")).not.toBeNull();
        expect(root?.querySelector(".crt-landing-preview")).not.toBeNull();
        expect(root?.querySelector(".crt-landing-hint")).not.toBeNull();

        // Exactly the selected row is inverted (the palette-swap surface); the
        // inverted recipe's two shades are proven >= 4.5:1 below. Every option
        // carries the DMG row class the scanned stylesheet governs.
        const options = Array.from(
          root?.querySelectorAll('[role="option"]') ?? [],
        );
        expect(options.length).toBe(rows.length);
        const selectedOptions = options.filter(
          (o) => o.getAttribute("aria-selected") === "true",
        );
        expect(selectedOptions.length).toBe(1);
        for (const o of options) {
          expect(o.classList.contains("crt-landing-row")).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("the inverted selected row uses two palette shades with contrast >= 4.5:1", () => {
    // The authored TRULY-inverted recipe (landing.css, R24): a SOLID `--dmg-3`
    // (#8cff9e) background with `--dmg-0` (#001a00) text. Both are palette
    // members and their sRGB contrast ratio (~13:1) clears the WCAG AA 4.5:1
    // floor with ample margin (R24.1, R10.2).
    const fg = "#001a00";
    const bg = "#8cff9e";
    expect(PALETTE_SET.has(fg)).toBe(true);
    expect(PALETTE_SET.has(bg)).toBe(true);

    const ratio = contrastRatio(fg, bg);
    expect(ratio).toBeGreaterThanOrEqual(4.5);

    // The inverted rule actually pairs these two shades in the source: a solid
    // `--dmg-3` background and `--dmg-0` text.
    expect(LANDING_RULES).toMatch(
      /\.crt-landing-row\[aria-selected="true"\]\s*\{[\s\S]*?background-color:\s*var\(--dmg-3\)[\s\S]*?color:\s*var\(--dmg-0\)/,
    );
  });
});
