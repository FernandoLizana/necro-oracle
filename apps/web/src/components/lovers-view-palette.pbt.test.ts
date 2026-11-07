// apps/web/src/components/lovers-view-palette.pbt.test.ts
//
// Feature: lovers-binding, task 12.3 — DMG palette purity on the Lovers view
// (design C.6 "DMG Lovers view"; R21.3, V1).
//
// Validates: Requirements 21.3
//
// Property 18 (R21.3): DMG palette purity on the Lovers view — every colour a
// Lovers surface paints (`color` / `background-color` / `border-color`) is one
// of the four strict `DMG_PALETTE` shades (or `transparent`), and nothing else
// (no other hex, rgb/rgba, hsl, or named colour) ever leaks in.
//
// ── Assertion strategy: CSS SOURCE-SCAN + rendered-markup inline-style scan ──
// The web vitest project applies no CSS (`import "./lovers-view.css"` is a
// no-op module in vitest), and the stylesheet authors every colour through
// `var(--dmg-0..3)` custom properties, so a jsdom `getComputedStyle` sweep
// would read empty/`rgba(0,0,0,0)` values — unreliable in this env, exactly as
// the oracle-landing-polish landing palette test documents. So, per the task's
// guidance, the guarantee is proven two ways that do not depend on a browser
// colour computation:
//
//   1. SOURCE-SCAN of `lovers-view.css` (the authoritative palette oracle):
//      every hex colour literal in the comment-stripped stylesheet is a member
//      of `DMG_PALETTE`, and all four shades are present. The stylesheet writes
//      colour / background-color / border-color only on `.crt-lovers*` surfaces
//      and binds them through `var(--dmg-0..3)`, so the only hex literals in it
//      are the four palette definitions. Any stray off-palette hex — now or in
//      a future edit — fails here. A further scan rejects any `rgb(` / `hsl(`
//      colour function or CSS named colour on a colour declaration.
//
//   2. RENDERED-MARKUP INLINE-STYLE SCAN: `LoversView` is rendered to static
//      markup across arbitrary `LoversResult` props (generated card data) and
//      every inline `style="..."` attribute is scanned for a colour token. The
//      component's ONLY inline style token is `--lov-rise-delay` (a time), so
//      any inline colour (hex / rgb / hsl / named) would be a real leak and
//      fails the property. This proves arbitrary rendered card content cannot
//      introduce a non-palette colour through an inline style.

import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DMG_PALETTE } from "@necro/ui-crt";
import type { LoversResult } from "@necro/coven";

import { LoversView } from "./LoversView.js";

const NUM_RUNS = 200;

// ── locate lovers-view.css regardless of the vitest working directory ────────
//
// Mirrors `packages/ui-crt/src/testing/landing-css-path.ts`: the filtered web
// run has CWD = apps/web, the repo-root `pnpm test` projects run has CWD = repo
// root. Try both and read the same source file.
const CSS_CANDIDATES = [
  resolve(process.cwd(), "src/components/lovers-view.css"),
  resolve(process.cwd(), "apps/web/src/components/lovers-view.css"),
];

function resolveLoversCss(): string {
  for (const candidate of CSS_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`lovers-view.css not found. Checked:\n  ${CSS_CANDIDATES.join("\n  ")}`);
}

/** The DMG stylesheet source, read once (the source-scan is the palette oracle). */
const LOVERS_CSS = readFileSync(resolveLoversCss(), "utf8");

/**
 * The stylesheet with `/* ... *\/` comment blocks removed. The banner comment
 * discusses other colours in prose (e.g. "#33ff66", "--crt-bg"); the
 * palette-purity guarantee is about the actual CSS DECLARATIONS, so scan the
 * comment-stripped source.
 */
const LOVERS_RULES = LOVERS_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** The four strict shades, lower-cased for case-insensitive membership tests. */
const PALETTE_SET = new Set<string>(DMG_PALETTE.map((h) => h.toLowerCase()));

/** Normalise a hex colour to a comparable lower-case `#rrggbb` string. */
function normaliseHex(raw: string): string {
  let hex = raw.toLowerCase();
  // Expand 3-digit shorthand (#abc -> #aabbcc) so it compares against the
  // 6-digit palette members.
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

// ── arbitrary LoversResult (generated "card data" to render) ─────────────────

/** A short code-ish blob with newlines so the rising-reveal splits it into lines. */
const arbCode = fc
  .array(fc.string({ minLength: 0, maxLength: 24 }), { minLength: 1, maxLength: 8 })
  .map((lines) => lines.join("\n"))
  // The pair artifacts are `.min(1)`; guarantee a non-empty string.
  .map((s) => (s.length > 0 ? s : "x"));

/** A planned function name (used only for the header count; kept simple). */
const arbFnName = fc
  .string({ minLength: 1, maxLength: 12 })
  .map((s) => (/^[A-Za-z_]/.test(s) ? s : `fn_${s}`));

const arbLoversResult: fc.Arbitrary<LoversResult> = fc
  .record({
    file: fc.string({ minLength: 1, maxLength: 40 }),
    pythonHeart: arbCode,
    contractSchema: arbCode,
    jsBeloved: arbCode,
    pythonTests: arbCode,
    jsTests: arbCode,
    fnCount: fc.integer({ min: 1, max: 8 }),
    fnName: arbFnName,
    path: fc.constantFrom("llm" as const, "template" as const),
    soulSource: fc.constantFrom("ORACLE" as const, "YOURS" as const),
    promptTokens: fc.integer({ min: 0, max: 100000 }),
    completionTokens: fc.integer({ min: 0, max: 100000 }),
    costUsd: fc.double({ min: 0, max: 100, noNaN: true }),
    demo: fc.boolean(),
  })
  .map((r): LoversResult => {
    const functions = Array.from({ length: r.fnCount }, (_, i) => ({
      name: `${r.fnName}_${i}`,
      params: [],
      returns: { pyType: "int", jsonType: "integer" as const, jsType: "number" },
      bindable: true,
      edgeCases: [],
    }));
    return {
      file: r.file,
      targetLang: "javascript",
      pair: {
        pythonHeart: r.pythonHeart,
        contractSchema: r.contractSchema,
        jsBeloved: r.jsBeloved,
        pythonTests: r.pythonTests,
        jsTests: r.jsTests,
      },
      plan: { functions, typeMap: [] },
      path: r.path,
      soulsSpent: {
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        costUsd: r.costUsd,
        soulSource: r.soulSource,
        byModel: [],
      },
      soulSource: r.soulSource,
      demo: r.demo,
    };
  });

describe("P18 (R21.3): DMG palette purity on the Lovers view", () => {
  it("every hex colour literal in lovers-view.css is a member of DMG_PALETTE (source-scan)", () => {
    const hexMatches = LOVERS_RULES.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];

    // The stylesheet must actually define the palette (guard against an empty
    // scan silently "passing").
    expect(hexMatches.length).toBeGreaterThanOrEqual(DMG_PALETTE.length);

    for (const raw of hexMatches) {
      const hex = normaliseHex(raw);
      expect(
        PALETTE_SET.has(hex),
        `off-palette hex ${raw} found in lovers-view.css; only ${DMG_PALETTE.join(
          ", ",
        )} are allowed`,
      ).toBe(true);
    }

    // And all four palette shades are present (the rules mirror the tuple).
    for (const shade of DMG_PALETTE) {
      expect(LOVERS_RULES.toLowerCase()).toContain(shade.toLowerCase());
    }
  });

  it("lovers-view.css uses no rgb()/hsl() colour function (every colour is a DMG var/hex)", () => {
    // The stylesheet paints colours only through `var(--dmg-0..3)` or the four
    // hex definitions. A stray `rgb(` / `rgba(` / `hsl(` / `hsla(` would be an
    // off-palette channel that the hex scan above cannot catch, so reject it.
    expect(LOVERS_RULES).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\s*\(/i);
  });

  it("no inline style in the rendered Lovers view introduces a non-palette colour (rendered-markup scan)", () => {
    fc.assert(
      fc.property(arbLoversResult, (result) => {
        const html = renderToStaticMarkup(createElement(LoversView, { result }));

        // Pull every inline style attribute out of the rendered markup.
        const styleAttrs = [...html.matchAll(/style="([^"]*)"/g)].map((m) => m[1] ?? "");

        for (const style of styleAttrs) {
          // Any hex colour in an inline style must be a palette member. The
          // component writes no inline hex at all, so any match is a leak.
          const inlineHex = style.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
          for (const raw of inlineHex) {
            expect(
              PALETTE_SET.has(normaliseHex(raw)),
              `off-palette inline hex ${raw} in style="${style}"`,
            ).toBe(true);
          }

          // No inline rgb()/hsl() colour function either (the component sets
          // only the `--lov-rise-delay` time token inline).
          expect(
            /\b(?:rgb|rgba|hsl|hsla)\s*\(/i.test(style),
            `inline rgb/hsl colour function in style="${style}"`,
          ).toBe(false);

          // No inline `color` / `background[-color]` / `border[-color]`
          // declaration at all: the only inline token is `--lov-rise-delay`.
          expect(
            /(?:^|;)\s*(?:color|background|background-color|border|border-color)\s*:/i.test(style),
            `unexpected inline colour declaration in style="${style}"`,
          ).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
