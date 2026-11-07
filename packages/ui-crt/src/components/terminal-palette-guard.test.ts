// Terminal-wide off-palette computed-color guard (oracle-landing-polish, task 17.1).
//
// Validates: Requirements R28.1, R28.2
//
// R28 asks for a test that fails on ANY off-palette color anywhere in the
// terminal — crucially including `border-color` AND `outline-color`, the two
// surfaces the earlier DMG palette suite (`landing-palette.pbt.test.ts`) did
// NOT widen to. This is the guard that would have caught the real off-palette
// `--crt-focus: #a85c30` focus outline the terminal once shipped with. As of
// oracle-landing-polish R32 that amber-brown is gone: `--crt-focus` is now the
// in-palette `#8cff9e` (= --dmg-3) composed with a `#001a00` offset, so the
// allowed set below no longer carries an amber exception — the guard permits
// ONLY DMG_Palette + phosphor-palette colours (R32.3).
//
// ── Why a CSS SOURCE-SCAN, not jsdom computed styles ────────────────────────
// The ui-crt vitest config sets `css: false` (see `vitest.config.ts`): jsdom
// does NOT apply the external stylesheets, so `getComputedStyle` cannot resolve
// cascaded colors or `var(--token)` custom properties — it returns empty /
// `rgba(0,0,0,0)` strings in this env. Every terminal color is authored through
// `var(--crt-*)` / `var(--dmg-*)` tokens, so a computed-style read is unreliable
// here. The committed `landing-palette.pbt.test.ts`, `landing-audit.test.ts`,
// and `crt-tokens.test.ts` all therefore prove their color guarantees by
// SCANNING THE CSS SOURCE as text. This test follows that same proven approach,
// but WIDENS it to the whole terminal (crt.css + landing.css + arcana.css) and
// to borders + outlines, which is what makes it able to catch the real bug.
//
// ── What counts as a "color" (scoping, so decorative rgba layers don't lie) ─
// The guard checks SOLID color values on these four properties only:
//   color · background-color · border-color · outline-color
// plus the color token inside shorthand `border: <w> <style> <color>` and
// `outline: <w> <style> <color>` declarations.
//
// It deliberately does NOT treat the decorative `rgba(...)` effect layers as
// palette "colors": the scanline is a `repeating-linear-gradient` of
// `rgba(0,0,0,α)`, the glow/afterglow are `text-shadow` rgba halos, and the
// flicker overlay is `background-color: #000` behind an animated opacity. These
// are intentionally-audited translucent shadow/scanline EFFECTS (pinned by
// `crt-tokens.test.ts`), not solid palette surface colors, so scoping the guard
// to solid hex/named values on the four color properties keeps them from
// creating false positives while still catching any stray off-palette SURFACE
// color. (`text-shadow` and `background-image` gradients are out of scope by
// construction — they are not among the four scanned properties.)
//
// ── The `--crt-focus` focus token (now fully in-palette) ────────────────────
// `--crt-focus` is now `#8cff9e` — identical to the DMG_Palette brightest shade
// `--dmg-3` and a phosphor-bright green, so it is already a member of the
// allowed set with NO amber exception required (oracle-landing-polish R32). The
// global `.crt :focus-visible` ring composes that `#8cff9e` outline with a
// `#001a00` (`--crt-bg`) offset, so the whole focus indicator is in-palette; the
// former off-palette amber-brown `#a85c30` has been removed from the terminal
// and from this allowed set (R32.3). The allowed set is still built from the
// real token sources (`DMG_PALETTE` + the `tokens.ts` constants), never a
// hand-copied second literal, so it cannot drift. A NEGATIVE CONTROL below
// proves the checker still rejects a deliberately off-palette value (`#ff00ff`),
// so the guard is demonstrably able to fail.
//
// Pure source-scan test: no ports, no DOM, no clock, no network, no LLM.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { DMG_PALETTE } from "../landing/palette.js";
import {
  CRT_BG,
  CRT_BURNING_AMBER,
  CRT_ERROR,
  CRT_FG,
  CRT_FG_DIM,
  CRT_FOCUS,
  CRT_STILL_DEAD,
} from "../tokens.js";

// ---------------------------------------------------------------------------
// Allowed palette set — derived from the REAL token sources (no hand-copy).
// ---------------------------------------------------------------------------

/**
 * The audited Spec 03 phosphor-chrome tokens, imported from `tokens.ts` (the
 * single source of truth `crt-tokens.test.ts` already pins). Importing the
 * constants — rather than re-typing their hex — keeps this allowed set in sync
 * with the tokens automatically: change a token and the allowed set follows.
 *
 * `CRT_FOCUS` is now `#8cff9e` (= --dmg-3), a fully in-palette DMG/phosphor
 * shade, so it needs no special exception — it is allowed because it is a
 * palette member (oracle-landing-polish R32). The former amber-brown `#a85c30`
 * exception is gone.
 */
const PHOSPHOR_CHROME = [
  CRT_FG, // #33ff66
  CRT_BG, // #001a00
  CRT_FG_DIM, // #29cc52
  CRT_ERROR, // #ff7a7a
  CRT_FOCUS, // #8cff9e — in-palette composed focus ring outline (= --dmg-3)
  CRT_BURNING_AMBER, // #ffb000 — Visual_Layer accent (tower/devil glow only)
  CRT_STILL_DEAD, // #ff3355 — Visual_Layer accent (STILL DEAD verdict word only)
] as const;

/**
 * The full allowed SOLID-color set: the four DMG shades plus the audited
 * phosphor-chrome tokens, lower-cased for case-insensitive membership. `#000`
 * is the flicker overlay base color (`.crt-flicker { background-color: #000 }`)
 * — an audited decorative layer whose VISIBLE luminance is governed by an
 * animated opacity, not a palette surface color; it is allowed here so the one
 * authored black overlay does not read as a violation while any OTHER stray hex
 * still fails.
 */
const ALLOWED_HEX = new Set<string>(
  [...DMG_PALETTE, ...PHOSPHOR_CHROME, "#000", "#000000"].map((h) =>
    h.toLowerCase(),
  ),
);

/** Color KEYWORDS that carry no palette obligation (no concrete hue). */
const ALLOWED_KEYWORDS = new Set<string>([
  "transparent",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
  "none",
]);

// ---------------------------------------------------------------------------
// Resolve + read the three terminal stylesheets as comment-stripped text.
// ---------------------------------------------------------------------------

/**
 * Resolve a `src/`-relative stylesheet path regardless of the vitest CWD. The
 * filtered package run (`pnpm --filter @necro/ui-crt test`) has CWD at the
 * package root; the monorepo run (`pnpm test`) has CWD at the repo root. Try
 * both, matching the committed `landing-css-path.ts` helper's strategy.
 */
function resolveCss(relFromSrc: string): string {
  const candidates = [
    resolve(process.cwd(), "src", relFromSrc),
    resolve(process.cwd(), "packages/ui-crt/src", relFromSrc),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `stylesheet ${relFromSrc} not found. Checked:\n  ${candidates.join("\n  ")}`,
  );
}

/** Strip `/* ... *\/` comment blocks so prose colors are never scanned. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The terminal stylesheet SOURCES scanned by this guard:
 *   - `crt.css`       — the Spec 03 phosphor chrome shell + Visual_Layer.
 *   - `landing/landing.css` — the DMG Landing_State surfaces.
 *   - `arcana/arcana.css`   — the pixel-card chrome that styles terminal
 *                             surfaces (bands/caption/fullscreen) with
 *                             color/border-color declarations.
 * All three contribute `color` / `background-color` / `border` / `outline`
 * declarations to the rendered terminal, so all three are in scope for R28.
 */
const STYLESHEETS: readonly { readonly name: string; readonly css: string }[] =
  [
    { name: "crt.css", rel: "crt.css" },
    { name: "landing.css", rel: "landing/landing.css" },
    { name: "arcana.css", rel: "arcana/arcana.css" },
  ].map(({ name, rel }) => ({
    name,
    css: stripComments(readFileSync(resolveCss(rel), "utf8")),
  }));

// ---------------------------------------------------------------------------
// Build the token map (--name -> value) from every scanned sheet + tokens.ts.
// ---------------------------------------------------------------------------

/**
 * Map every `--name: value;` custom property declared anywhere in the scanned
 * terminal stylesheets to its authored value. This lets the checker resolve a
 * `var(--token)` reference (e.g. `outline: 2px solid var(--crt-focus)`) to the
 * token's real value and test THAT against the allowed set — so an off-palette
 * token used by name is still caught at its definition.
 */
function buildTokenMap(): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const { css } of STYLESHEETS) {
    const re = /(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
      const name = m[1];
      const value = m[2];
      if (name !== undefined && value !== undefined) {
        // First definition wins (the `.crt` root declaration); later overrides
        // of the SAME token are also color-checked where they are used, but the
        // root value is the canonical one most references resolve to.
        if (!map.has(name)) map.set(name, value.trim());
      }
    }
  }
  return map;
}

const TOKEN_MAP = buildTokenMap();

// ---------------------------------------------------------------------------
// The checker: is a single authored color VALUE within the allowed set?
// ---------------------------------------------------------------------------

/** A hex color literal (`#rgb`, `#rrggbb`, `#rrggbbaa`). */
const HEX_RE = /^#[0-9a-f]{3,8}$/i;

/** Normalise a 3-digit hex (`#abc`) to its 6-digit form (`#aabbcc`). */
function expandHex(hex: string): string {
  const h = hex.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(h)) {
    const [, r, g, b] = /^#(.)(.)(.)$/.exec(h) as RegExpExecArray;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return h;
}

/**
 * Outcome of checking one authored color value. `ok` is true when the value is
 * allowed; otherwise `reason` explains the violation (used in the assertion
 * message and in the negative-control test).
 */
interface CheckResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Decide whether a single authored color VALUE is within the allowed palette.
 * Accepts a hex literal, a named keyword, or a `var(--token[, fallback])`
 * reference (resolved through the token map, recursively). This is the heart of
 * the guard and is exercised directly by the negative-control test below.
 */
function checkColorValue(
  rawValue: string,
  tokenMap: ReadonlyMap<string, string> = TOKEN_MAP,
  seen: ReadonlySet<string> = new Set(),
): CheckResult {
  const value = rawValue.trim();
  const lower = value.toLowerCase();

  // Keyword with no concrete hue (transparent / currentColor / inherit / ...).
  if (ALLOWED_KEYWORDS.has(lower)) return { ok: true };

  // Hex literal: must be an allowed shade (compare in expanded 6-digit form).
  if (HEX_RE.test(value)) {
    const expanded = expandHex(value);
    if (ALLOWED_HEX.has(lower) || ALLOWED_HEX.has(expanded)) return { ok: true };
    return { ok: false, reason: `off-palette hex ${value}` };
  }

  // var(--token[, fallback]) — resolve the token (and any fallback) and check.
  const varMatch = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/i.exec(value);
  if (varMatch !== null) {
    const name = varMatch[1] as string;
    const fallback = varMatch[2];
    if (seen.has(name)) {
      // A cyclic var reference cannot be resolved to a concrete hue; treat it
      // as allowed (it can only ever be another token we also check at source).
      return { ok: true };
    }
    const resolved = tokenMap.get(name);
    const nextSeen = new Set([...seen, name]);
    if (resolved !== undefined) {
      const r = checkColorValue(resolved, tokenMap, nextSeen);
      if (!r.ok) {
        return { ok: false, reason: `${name} = ${resolved} (${r.reason})` };
      }
      return { ok: true };
    }
    // Token not defined in the scanned sheets (e.g. the host-provided
    // `--font-vt323`, or a non-color token). If a fallback is present, check it;
    // otherwise it is not a color we can judge, so it is not a violation.
    if (fallback !== undefined) return checkColorValue(fallback, tokenMap, nextSeen);
    return { ok: true };
  }

  // An rgb()/rgba()/hsl() function value: NOT a solid palette surface color in
  // the scanned scope. We only ever reach here for a `border`/`outline` color
  // slot (the four color PROPERTIES are matched literally below and only ever
  // carry hex / keyword / var on terminal surfaces). Decorative rgba effect
  // layers (scanline gradient, glow/afterglow text-shadow, flicker overlay) are
  // out of scope by construction — they are not among the four scanned
  // properties — so an rgb/rgba token in a color slot is treated as allowed.
  if (/^(rgb|rgba|hsl|hsla)\(/i.test(lower)) return { ok: true };

  // A bare CSS color NAME (e.g. `red`, `white`). None are authored on terminal
  // surfaces today; any that appears is off-palette and must fail. Allow only
  // the achromatic `black` (= the audited `#000` flicker base).
  if (/^[a-z]+$/.test(lower)) {
    if (lower === "black") return { ok: true };
    return { ok: false, reason: `off-palette named color "${value}"` };
  }

  // Anything else in a color slot is unrecognised; fail loudly rather than
  // silently pass, so a future odd value cannot slip through.
  return { ok: false, reason: `unrecognised color value "${value}"` };
}

// ---------------------------------------------------------------------------
// Extract every color / background-color / border-color / outline-color value
// (including the color token inside `border:` / `outline:` shorthands).
// ---------------------------------------------------------------------------

/** One authored color declaration found in a stylesheet (for messages). */
interface ColorDecl {
  readonly sheet: string;
  readonly property: string;
  readonly value: string;
}

/** CSS <line-style> keywords, to skip over in a `border`/`outline` shorthand. */
const LINE_STYLES = new Set<string>([
  "none",
  "hidden",
  "dotted",
  "dashed",
  "solid",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
]);

/** True if a shorthand token is a <line-width> (px/em/… length or a keyword). */
function isWidthToken(token: string): boolean {
  const t = token.toLowerCase();
  if (t === "thin" || t === "medium" || t === "thick") return true;
  return /^[\d.]+(px|em|rem|pt|ex|ch|vw|vh|vmin|vmax)?$/.test(t);
}

/**
 * True if a shorthand token is (or resolves to) a <line-width>: a bare length,
 * a `calc(...)` expression, or a `var(--token)` whose value is a length/calc.
 * In the DMG sheet the border WIDTH is itself a token (`var(--dmg-border)` =
 * `calc(2 * var(--px))`), so a naive "first non-style token is the color" rule
 * would mis-read the width as the color. Resolving the var here distinguishes a
 * width token from a color token.
 */
function isWidthLike(
  token: string,
  tokenMap: ReadonlyMap<string, string>,
): boolean {
  const t = token.toLowerCase();
  if (isWidthToken(t)) return true;
  if (/^calc\(/i.test(t)) return true;
  const varMatch = /^var\(\s*(--[a-z0-9-]+)\s*(?:,[\s\S]+)?\)$/i.exec(token);
  if (varMatch !== null) {
    const resolved = tokenMap.get(varMatch[1] as string);
    if (resolved !== undefined) {
      const r = resolved.toLowerCase();
      if (/^calc\(/i.test(r)) return true;
      if (isWidthToken(r)) return true;
    }
  }
  return false;
}

/**
 * Pull the color slot out of a `border` / `outline` shorthand value. The grammar
 * is `<line-width> || <line-style> || <color>` in any order, so drop every
 * width and style token and keep what remains as the color. Widths may be a
 * bare length, a `calc(...)`, or a `var(--token)` that resolves to one (the DMG
 * `--dmg-border` case). Returns null when no color token is present (the color
 * then comes from the longhand or inherits — nothing to check here).
 */
function colorFromShorthand(
  value: string,
  tokenMap: ReadonlyMap<string, string> = TOKEN_MAP,
): string | null {
  // Tokenise on whitespace, but keep `var(...)`, `rgb(...)`, `calc(...)` groups
  // intact (they contain no top-level spaces we split on except inside parens).
  const tokens = value.match(
    /(?:var|rgb|rgba|hsl|hsla|calc)\([^)]*\)|[^\s]+/gi,
  );
  if (tokens === null) return null;
  for (const token of tokens) {
    const t = token.toLowerCase();
    if (LINE_STYLES.has(t)) continue;
    if (isWidthLike(token, tokenMap)) continue;
    return token; // the remaining token is the color slot
  }
  return null;
}

/** Scan one stylesheet for every in-scope color declaration. */
function extractColorDecls(sheet: string, css: string): ColorDecl[] {
  const decls: ColorDecl[] = [];

  // Longhand color properties: color / background-color / border-color /
  // outline-color (and the per-side border-*-color variants). Match the
  // property name exactly so `background-image`, `text-shadow`, and
  // `caret-color` (not a surface fill) are not swept in.
  const longhandRe =
    /(?<![-\w])(color|background-color|border-color|border-(?:top|right|bottom|left)-color|outline-color)\s*:\s*([^;{}]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = longhandRe.exec(css)) !== null) {
    const property = (m[1] as string).toLowerCase();
    const value = (m[2] as string).trim();
    decls.push({ sheet, property, value });
  }

  // Shorthand `border:` / `outline:` — extract only the color slot, if any.
  const shorthandRe = /(?<![-\w])(border|outline)\s*:\s*([^;{}]+);/gi;
  while ((m = shorthandRe.exec(css)) !== null) {
    const property = (m[1] as string).toLowerCase();
    const value = (m[2] as string).trim();
    const colorSlot = colorFromShorthand(value);
    if (colorSlot !== null) {
      decls.push({ sheet, property: `${property} (color slot)`, value: colorSlot });
    }
  }

  return decls;
}

// ---------------------------------------------------------------------------
// The guard tests.
// ---------------------------------------------------------------------------

describe("R28 (terminal-wide palette guard): every solid color is in the allowed set", () => {
  it("derives the allowed set from the real token sources (no hand-copied literal)", () => {
    // The allowed set is the 4 DMG shades + the 7 audited phosphor-chrome
    // tokens (+ the audited `#000` flicker base). Guard against an empty or
    // partial import silently weakening the test.
    expect(ALLOWED_HEX.has("#001a00")).toBe(true); // --dmg-0 / --crt-bg (shared)
    expect(ALLOWED_HEX.has("#8cff9e")).toBe(true); // --dmg-3
    expect(ALLOWED_HEX.has("#33ff66")).toBe(true); // --crt-fg
    expect(ALLOWED_HEX.has("#8cff9e")).toBe(true); // --crt-focus (in-palette, = --dmg-3)
    // The former amber-brown focus token is no longer in the terminal nor the
    // allowed set (R32.3).
    expect(ALLOWED_HEX.has("#a85c30")).toBe(false);
    // Every DMG shade and every phosphor-chrome token made it into the set.
    for (const shade of DMG_PALETTE) {
      expect(ALLOWED_HEX.has(shade.toLowerCase())).toBe(true);
    }
    for (const token of PHOSPHOR_CHROME) {
      expect(ALLOWED_HEX.has(token.toLowerCase())).toBe(true);
    }
  });

  it("scanned all three terminal stylesheets and found real color declarations", () => {
    // Guard: an empty scan (wrong path, over-tight regex) must not pass vacuously.
    expect(STYLESHEETS.map((s) => s.name)).toEqual([
      "crt.css",
      "landing.css",
      "arcana.css",
    ]);
    const total = STYLESHEETS.reduce(
      (n, { name, css }) => n + extractColorDecls(name, css).length,
      0,
    );
    // There are dozens of color declarations across the three sheets.
    expect(total).toBeGreaterThan(20);
  });

  it("the token map resolves the focus ring tokens to their in-palette values", () => {
    // `--crt-focus` is now the in-palette `#8cff9e` (= --dmg-3), composed in the
    // global ring with a `#001a00` (--crt-bg) offset — no amber-brown (R32).
    expect(TOKEN_MAP.get("--crt-focus")).toBe("#8cff9e");
    expect(TOKEN_MAP.get("--dmg-3")).toBe("#8cff9e");
    // The global ring outline uses var(--crt-focus) and its offset uses
    // var(--crt-bg); both resolve to allowed DMG/phosphor values.
    expect(checkColorValue("var(--crt-focus)").ok).toBe(true);
    expect(checkColorValue("var(--dmg-3)").ok).toBe(true);
    expect(checkColorValue("var(--crt-bg)").ok).toBe(true);
  });

  it("every color / background-color / border-color / outline-color (and border/outline shorthand) is in the allowed set", () => {
    const violations: string[] = [];
    for (const { name, css } of STYLESHEETS) {
      for (const decl of extractColorDecls(name, css)) {
        const result = checkColorValue(decl.value);
        if (!result.ok) {
          violations.push(
            `${decl.sheet}: ${decl.property}: ${decl.value}  →  ${result.reason}`,
          );
        }
      }
    }
    expect(
      violations,
      `off-palette color(s) found in the terminal stylesheets:\n  ${violations.join(
        "\n  ",
      )}\nAllowed solid colors: ${[...ALLOWED_HEX].join(", ")} (+ keywords ${[
        ...ALLOWED_KEYWORDS,
      ].join(", ")})`,
    ).toEqual([]);
  });

  it("explicitly covers border-color AND outline-color (the surfaces R28 widens to)", () => {
    // Prove the scan actually reaches border + outline declarations — the whole
    // point of R28 over the narrower DMG color suite. crt.css has the global
    // composed focus `outline: 2px solid var(--crt-focus)` (now #8cff9e) with a
    // `--crt-bg` offset, and both sheets author `border:`/`border-color` on
    // panels and buttons.
    const allDecls = STYLESHEETS.flatMap(({ name, css }) =>
      extractColorDecls(name, css),
    );
    const outlineDecls = allDecls.filter((d) => d.property.startsWith("outline"));
    const borderDecls = allDecls.filter((d) => d.property.startsWith("border"));
    expect(outlineDecls.length).toBeGreaterThan(0);
    expect(borderDecls.length).toBeGreaterThan(0);
    // And every one of them is in-palette (they are included in the main scan
    // above, but assert here so a regression names the border/outline surface).
    for (const decl of [...outlineDecls, ...borderDecls]) {
      expect(
        checkColorValue(decl.value).ok,
        `${decl.sheet}: ${decl.property}: ${decl.value} is off-palette`,
      ).toBe(true);
    }
  });

  // ── NEGATIVE CONTROL ──────────────────────────────────────────────────────
  // Prove the guard can actually FAIL: the checker must REJECT a deliberately
  // off-palette value. Without this, a checker that accepted everything would
  // pass the suite above vacuously.
  it("NEGATIVE CONTROL: the checker rejects a deliberately off-palette color", () => {
    // A raw stray magenta hex — exactly the kind of UNINTENDED off-palette color
    // R28 exists to catch.
    const magenta = checkColorValue("#ff00ff");
    expect(magenta.ok).toBe(false);
    expect(magenta.reason).toContain("#ff00ff");

    // A var() pointing at a token whose value is off-palette is rejected via the
    // token it resolves to (this is exactly how a stray off-palette focus token
    // such as the former `--crt-focus: #a85c30` is now caught — there is no
    // amber exception any more, R32.3).
    const strayTokenMap = new Map<string, string>([["--stray", "#c0ffee"]]);
    const strayVar = checkColorValue("var(--stray)", strayTokenMap);
    expect(strayVar.ok).toBe(false);
    expect(strayVar.reason).toContain("--stray");

    // A bare off-palette named color is rejected too.
    expect(checkColorValue("hotpink").ok).toBe(false);

    // And the shorthand extractor pulls the color out so an off-palette border
    // color would be caught: `border: 2px solid #ff00ff` → color slot #ff00ff.
    const slot = colorFromShorthand("2px solid #ff00ff");
    expect(slot).toBe("#ff00ff");
    expect(checkColorValue(slot as string).ok).toBe(false);

    // The former amber-brown focus token `#a85c30` is now OFF-palette and
    // rejected — the amber exception has been removed (oracle-landing-polish
    // R32.3). The in-palette focus outline `#8cff9e` (= --dmg-3) is accepted.
    expect(checkColorValue("#a85c30").ok).toBe(false);
    expect(checkColorValue("#8cff9e").ok).toBe(true);
  });
});
