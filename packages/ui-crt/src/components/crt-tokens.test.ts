// CRT design-token / CSS parity and WCAG-constraint test (task 17.1, RED).
//
// Validates: Requirements R9.1, R9.2, R9.3, R9.4, R9.5, R9.6, R9.7, R9.8,
// R15.6, R15.7
//
// Runs in the default `node` environment: it imports the token constants from
// `src/tokens.ts` and reads `src/crt.css` as text, then asserts:
//
//   1. Every custom property declared on `.crt` in `crt.css` equals the
//      matching exported token (the single source of truth, design
//      §"CRT design tokens and motion CSS").
//   2. The phosphor palette is exactly the steering colours (R9.1).
//   3. `fg`, `fg-dim` and `error` reach >= 4.5:1 contrast on `bg`, both on the
//      flat background and under the scanline composite (R15.6).
//   4. `focus` is the in-palette `#8cff9e` and reaches >= 3:1 against the
//      `#001a00` offset/background of the composed focus indicator (R15.7,
//      R32.4). The indicator is a COMPOSED two-colour ring — a `#8cff9e`
//      outline separated from the bright `#33ff66` foreground by a `#001a00`
//      offset — so the dark offset (not the outline colour vs the fg) provides
//      the separation on the bright-text side; the former "focus vs fg >= 3:1"
//      check is dropped accordingly.
//   5. The flicker animation changes luminance at most 3 times per second and
//      by at most 5 % (R9.4).
//   6. The scanline and glow effects are CSS-only: no `url(` anywhere in the
//      stylesheet, so no image file is loaded by any layer (R9.8).
//
// NONE of `tokens.ts` / `crt.css` exist yet, so the import and the file read
// fail first (expected red). Implementing task 17.2 turns this green; if any
// candidate colour fails a ratio here, task 17.2 adjusts the token until it
// passes (the test is the arbiter, design §"CRT design tokens").

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as tokens from "../tokens.js";

// ---------------------------------------------------------------------------
// WCAG sRGB relative-luminance + contrast helpers (implemented locally so the
// test owns its arithmetic and depends on no colour library).
// ---------------------------------------------------------------------------

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Parse `#rrggbb` (or `#rgb`) to 0..255 channels. */
function parseHex(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  expect(full).toMatch(/^[0-9a-fA-F]{6}$/);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** Linearise one 0..255 sRGB channel per the WCAG definition. */
function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an sRGB colour. */
function relativeLuminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/** WCAG contrast ratio between two colours, from their luminances. */
function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Alpha-composite `over` (with alpha `alpha`) on top of `under`, returning the
 * resulting opaque colour. Used to model the scanline overlay: dark scanlines
 * at `--crt-scanline-alpha` darken both the foreground text and the background
 * at the trough of the gradient, which is the worst case for contrast.
 */
function composite(over: Rgb, alpha: number, under: Rgb): Rgb {
  return {
    r: over.r * alpha + under.r * (1 - alpha),
    g: over.g * alpha + under.g * (1 - alpha),
    b: over.b * alpha + under.b * (1 - alpha),
  };
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };

// ---------------------------------------------------------------------------
// Read the stylesheet and extract the `.crt` custom properties.
// ---------------------------------------------------------------------------

const CSS_PATH = fileURLToPath(new URL("../crt.css", import.meta.url));
const css = readFileSync(CSS_PATH, "utf8");

/** Pull one `--name: value;` declaration out of the stylesheet. */
function cssVar(name: string): string {
  const match = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(css);
  expect(match, `missing --${name} in crt.css`).not.toBeNull();
  const value = (match as RegExpExecArray)[1];
  expect(value, `empty --${name} in crt.css`).toBeDefined();
  return (value as string).trim();
}

/** The number out of a `<n>px` / `<n>ms` / bare-number CSS value. */
function cssNumber(name: string): number {
  const raw = cssVar(name);
  const match = /^(-?\d+(?:\.\d+)?)(px|ms|s)?$/.exec(raw);
  expect(match, `--${name} is not a plain number: ${raw}`).not.toBeNull();
  return Number((match as RegExpMatchArray)[1]);
}

// ---------------------------------------------------------------------------
// 1. Token / CSS parity
// ---------------------------------------------------------------------------

describe("R9.1 (tokens / CSS parity): crt.css mirrors tokens.ts", () => {
  it("declares the phosphor palette equal to the exported tokens", () => {
    expect(cssVar("crt-fg")).toBe(tokens.CRT_FG);
    expect(cssVar("crt-bg")).toBe(tokens.CRT_BG);
    expect(cssVar("crt-fg-dim")).toBe(tokens.CRT_FG_DIM);
    expect(cssVar("crt-error")).toBe(tokens.CRT_ERROR);
    expect(cssVar("crt-focus")).toBe(tokens.CRT_FOCUS);
  });

  it("declares the effect tokens equal to the exported numbers", () => {
    expect(cssNumber("crt-glow-radius")).toBe(tokens.CRT_GLOW_RADIUS_PX);
    expect(cssNumber("crt-glow-alpha")).toBe(tokens.CRT_GLOW_ALPHA);
    expect(cssNumber("crt-scanline-period")).toBe(
      tokens.CRT_SCANLINE_PERIOD_PX,
    );
    expect(cssNumber("crt-scanline-alpha")).toBe(tokens.CRT_SCANLINE_ALPHA);
    expect(cssNumber("crt-flicker-cycles-per-s")).toBe(
      tokens.CRT_FLICKER_CYCLES_PER_S,
    );
    expect(cssNumber("crt-flicker-depth")).toBe(tokens.CRT_FLICKER_DEPTH);
    expect(cssNumber("crt-afterglow-ms")).toBe(tokens.CRT_AFTERGLOW_MS);
  });

  it("declares the Visual_Layer motion tokens equal to the exported numbers", () => {
    expect(cssNumber("crt-glitch-max-ms")).toBe(tokens.CRT_GLITCH_MAX_MS);
    expect(cssNumber("crt-shake-ms")).toBe(tokens.CRT_SHAKE_MS);
    expect(cssNumber("crt-flip-ms")).toBe(tokens.CRT_FLIP_MS);
    expect(cssNumber("crt-rot-frame-min-ms")).toBe(tokens.CRT_ROT_FRAME_MIN_MS);
    // OPTIONAL severity-3 phosphor bloom window (task 21.2, R13.2).
    expect(cssNumber("crt-bloom-ms")).toBe(tokens.CRT_BLOOM_MS);
  });

  it("keeps the phosphor bloom one-shot and inside the Flash_Limit window (R13.2)", () => {
    // The bloom duration is <= the glitch ceiling (<= 300 ms), and the CSS
    // fires it with iteration-count 1 (never `infinite`), so a single
    // rise-then-settle cannot exceed the Flash_Limit in any one-second window.
    expect(tokens.CRT_BLOOM_MS).toBeGreaterThan(0);
    expect(tokens.CRT_BLOOM_MS).toBeLessThanOrEqual(tokens.CRT_GLITCH_MAX_MS);
    const bloomRule =
      /\.crt\[data-motion="full"\] \.crt-glitch\[data-glitch-intensity="3"\][^}]*crt-bloom-kf[^}]*}/s.exec(
        css,
      );
    expect(bloomRule, "missing full-motion severity-3 bloom rule").not.toBeNull();
    // One-shot: the bloom animation ends with iteration-count 1, never infinite.
    expect((bloomRule as RegExpExecArray)[0]).toMatch(/crt-bloom-kf[^,}]*\b1\b/);
    expect((bloomRule as RegExpExecArray)[0]).not.toContain("infinite");
  });
});

// ---------------------------------------------------------------------------
// 2. Palette (R9.1)
// ---------------------------------------------------------------------------

describe("R9.1 (palette): the phosphor colours are the steering palette", () => {
  it("fixes the foreground and background", () => {
    expect(tokens.CRT_FG.toLowerCase()).toBe("#33ff66");
    expect(tokens.CRT_BG.toLowerCase()).toBe("#001a00");
  });
});

// ---------------------------------------------------------------------------
// 3 & 4. Contrast constraints (R15.6, R15.7)
// ---------------------------------------------------------------------------

describe("R15.6 (contrast): text reaches >= 4.5:1 on the background", () => {
  const bg = () => parseHex(tokens.CRT_BG);

  it("fg on bg >= 4.5:1, flat and under the scanline composite", () => {
    const fg = parseHex(tokens.CRT_FG);
    expect(contrastRatio(fg, bg())).toBeGreaterThanOrEqual(4.5);

    // Worst case: a scanline trough darkens both text and background.
    const alpha = tokens.CRT_SCANLINE_ALPHA;
    const fgScan = composite(BLACK, alpha, fg);
    const bgScan = composite(BLACK, alpha, bg());
    expect(contrastRatio(fgScan, bgScan)).toBeGreaterThanOrEqual(4.5);
  });

  it("fg-dim on bg >= 4.5:1, flat and under the scanline composite", () => {
    const dim = parseHex(tokens.CRT_FG_DIM);
    expect(contrastRatio(dim, bg())).toBeGreaterThanOrEqual(4.5);
    const alpha = tokens.CRT_SCANLINE_ALPHA;
    expect(
      contrastRatio(composite(BLACK, alpha, dim), composite(BLACK, alpha, bg())),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("error on bg >= 4.5:1, flat and under the scanline composite", () => {
    const err = parseHex(tokens.CRT_ERROR);
    expect(contrastRatio(err, bg())).toBeGreaterThanOrEqual(4.5);
    const alpha = tokens.CRT_SCANLINE_ALPHA;
    expect(
      contrastRatio(composite(BLACK, alpha, err), composite(BLACK, alpha, bg())),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("R15.7 / R32.4 (focus): the composed in-palette focus ring reaches >= 3:1 against its dark offset", () => {
  // The global `.crt :focus-visible` indicator is now a COMPOSED two-colour
  // ring (oracle-landing-polish R32): a bright `#8cff9e` (`--crt-focus`, =
  // --dmg-3) outline separated from the bright `#33ff66` foreground by a
  // `#001a00` (`--crt-bg`) offset/gap. The VISIBLE contrast obligation is the
  // bright ring against the dark offset/background it sits on — NOT the ring
  // against the bright fg, because the dark offset provides that separation. So
  // we assert `#8cff9e` is a palette member and clears >= 3:1 against `#001a00`
  // (it reaches ~11:1), and we no longer require >= 3:1 vs the `#33ff66` fg.
  it("focus is the in-palette #8cff9e and reaches >= 3:1 against the #001a00 offset/background", () => {
    const focus = parseHex(tokens.CRT_FOCUS);
    const bg = parseHex(tokens.CRT_BG);

    // The focus outline is the DMG/phosphor brightest shade (= --dmg-3), a
    // palette member — no off-palette amber-brown (R32.1).
    expect(tokens.CRT_FOCUS.toLowerCase()).toBe("#8cff9e");

    // The bright ring clears the 3:1 visible-focus floor against the dark
    // `#001a00` offset/background it visibly sits against (~11:1, R32.4).
    expect(contrastRatio(focus, bg)).toBeGreaterThanOrEqual(3);

    // The composed CSS actually pairs the `--crt-focus` outline with a
    // `--crt-bg` (#001a00) separating offset ring (box-shadow), so the bright
    // ring never sits directly on the bright fg; that dark gap — not the
    // outline-vs-fg ratio — provides the bright-text-side separation (R32.2).
    const focusRule = /\.crt\s*:focus-visible\s*\{[^}]*\}/s.exec(css);
    expect(focusRule, "missing .crt :focus-visible rule").not.toBeNull();
    const rule = (focusRule as RegExpExecArray)[0];
    expect(rule).toMatch(/outline:\s*2px\s+solid\s+var\(--crt-focus\)/);
    expect(rule).toMatch(/var\(--crt-bg\)/);
  });
});

// ---------------------------------------------------------------------------
// 5. Flicker constraints (R9.4)
// ---------------------------------------------------------------------------

describe("R9.4 (flicker): at most 3 changes/s and at most 5 % depth", () => {
  it("drives at most 3 luminance changes per second", () => {
    // One cycle = a rise and a fall = two luminance changes. The budget of 3
    // changes/s caps the cycle frequency at 1.5 Hz.
    const cyclesPerSecond = tokens.CRT_FLICKER_CYCLES_PER_S;
    expect(cyclesPerSecond * 2).toBeLessThanOrEqual(3);
  });

  it("changes luminance by at most 5 %", () => {
    expect(tokens.CRT_FLICKER_DEPTH).toBeGreaterThan(0);
    expect(tokens.CRT_FLICKER_DEPTH).toBeLessThanOrEqual(0.05);
  });
});

// ---------------------------------------------------------------------------
// 6. CSS-only effects (R9.8)
// ---------------------------------------------------------------------------

describe("R9.8 (no images): scanline and glow are CSS-only", () => {
  it("loads no external asset anywhere in the stylesheet", () => {
    expect(css).not.toContain("url(");
  });

  it("builds the scanline from a repeating gradient, not an image", () => {
    expect(css).toMatch(/repeating-linear-gradient/);
  });

  it("builds the glow from text-shadow, not a filter image", () => {
    expect(css).toMatch(/text-shadow/);
  });
});
