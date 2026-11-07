// @vitest-environment jsdom
//
// Landing visual-audit style / a11y example tests (oracle-landing-polish, task 8.5).
//
// Validates: Requirements R12.1, R12.2, R13.1, R13.2, R14.1, R14.2, R15.1,
// R17.1, R20.3
//
// These are *example* tests complementing the task-8.4 property suites. They
// pin the concrete visual-audit findings (V4–V7, V9) and the listbox/option
// a11y contract (R20.3) the DMG Landing_State must honour.
//
// APPROACH — why two techniques in one file:
//
//   The ui-crt vitest config sets `css: false`, so `import "landing.css"` is a
//   no-op in jsdom and `getComputedStyle` CANNOT resolve the external DMG
//   stylesheet (there is no CSSOM for it, and jsdom does not compute `calc()`
//   tokens or inheritance from an un-applied sheet). That makes the pure-CSS
//   facts — the single bitmap pixel font, the integer `--px` grid, the single
//   spacing-scale token set, and the ellipsis clipping — untestable by rendered
//   computed style here. So for those we SOURCE-SCAN `landing.css` as text
//   (exactly like the committed `crt-tokens.test.ts` scans `crt.css`), reading
//   the authored declarations that govern every DMG surface.
//
//   For the DOM / a11y facts — the eye/moon card-back sigil id (never a
//   pentagram) and the listbox/option roles with the ▶ cursor kept out of the
//   accessible name — we RENDER the real components and assert against the live
//   DOM, which jsdom resolves faithfully without needing computed CSS.
//
// This mirrors the task guidance: render for R12 / R20.3, source-scan for the
// font / spacing / ellipsis facts jsdom cannot compute.
//
// Pure presentational tests: no ports, no data fetching, no clock, no network,
// no LLM, no sandbox.

import { readFileSync } from "node:fs";

import { cleanup, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { loadManifest, type ArcanaAsset } from "../arcana/manifest.js";
import { previewModel } from "../landing/landing-model.js";
import { LANDING_ROWS } from "../landing/repos.js";
import { resolveLandingCss } from "../testing/landing-css-path.js";
import { LegacyRepoList } from "./LegacyRepoList.js";
import { PreviewWindow } from "./PreviewWindow.js";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// landing.css source text (source-scan for the pure-CSS facts)
// ---------------------------------------------------------------------------

// NOTE: this file runs under jsdom (for the render assertions below), where
// `import.meta.url` is an `http://` URL and `fileURLToPath` would reject it. We
// resolve the stylesheet by CWD instead, with a repo-root fallback so both the
// filtered package run (`pnpm --filter @necro/ui-crt test`, CWD = package root)
// and the monorepo run (`pnpm test`, CWD = repo root) read the same source.
const LANDING_CSS_PATH = resolveLandingCss();
const css = readFileSync(LANDING_CSS_PATH, "utf8");

/**
 * Pull the body `{ ... }` of the first rule whose selector list contains
 * `selector` out of the stylesheet. A small, dependency-free CSS slice good
 * enough to assert the authored declarations on a known rule.
 */
function ruleBody(selector: string): string {
  // Escape the selector for use inside a RegExp, then match up to the next `}`.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}[^{}]*\\{([^}]*)\\}`);
  const match = re.exec(css);
  expect(match, `missing rule for selector ${selector} in landing.css`).not.toBeNull();
  const body = (match as RegExpExecArray)[1];
  expect(body, `empty rule body for selector ${selector}`).toBeDefined();
  return body as string;
}

/** The stylesheet with `/* ... *\/` comments stripped, for declaration scans. */
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Pull a `--name: value;` custom-property value declared anywhere in the sheet. */
function cssVar(name: string): string {
  const match = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(css);
  expect(match, `missing --${name} in landing.css`).not.toBeNull();
  const value = (match as RegExpExecArray)[1];
  expect(value, `empty --${name} in landing.css`).toBeDefined();
  return (value as string).trim();
}

// ---------------------------------------------------------------------------
// R15.1 (V7) — a single bitmap pixel font on every DMG surface
// ---------------------------------------------------------------------------
//
// jsdom cannot compute the inherited `font-family` with `css:false`, so we scan
// the source: there is exactly ONE `--dmg-font` family token, it is VT323-based
// (the project bitmap pixel display font), and it is applied to BOTH the
// landing root `.crt-landing` AND the universal `.crt-landing *` so every DMG
// descendant draws the one family. No second family token is declared on a DMG
// surface.

describe("R15.1 (V7): single bitmap pixel font on DMG surfaces", () => {
  it("declares exactly one --dmg-font family token resolving to the bundled VT323 face", () => {
    // Exactly one declaration of the family token.
    const decls = css.match(/--dmg-font\s*:/g) ?? [];
    expect(decls).toHaveLength(1);

    // The one family resolves to the BUNDLED VT323 face first (oracle-landing-
    // polish R25): the host loads VT323 via `next/font` and exposes it as the
    // `--font-vt323` variable, which the token references ahead of the literal
    // "VT323" name and the monospace fallback stack. Both the self-hosted
    // variable and the literal family name must be present so the bundled
    // bitmap font — never a system monospace — paints every DMG surface.
    const family = cssVar("dmg-font");
    expect(family).toMatch(/^var\(--font-vt323\)/);
    expect(family).toMatch(/"VT323"/);
  });

  it("applies var(--dmg-font) to .crt-landing and every DMG descendant", () => {
    // The landing root sets the family.
    expect(ruleBody(".crt .crt-landing")).toMatch(
      /font-family:\s*var\(--dmg-font\)/,
    );

    // The universal DMG-surface rule applies the SAME token to all descendants,
    // so no proportional/smoothed family can sneak onto a DMG surface.
    const universal = ruleBody(".crt .crt-landing,\n.crt .crt-landing *");
    expect(universal).toMatch(/font-family:\s*var\(--dmg-font\)/);
  });

  it("declares no second font-family token on any DMG surface", () => {
    // Every authored `font-family` on a .crt-landing* rule must be the single
    // var(--dmg-font) token — no raw family stack, no second variable. Scan the
    // comment-stripped source so the prose in the file header (which mentions
    // `font-family: var(--dmg-font)`) is not mistaken for a real declaration.
    const fontFamilyDecls = [
      ...cssNoComments.matchAll(/font-family\s*:\s*([^;]+);/g),
    ].map((m) => (m[1] ?? "").trim());

    // Exactly the token-setter (`--dmg-font: "VT323", ...`) is NOT a
    // `font-family:` declaration, so every `font-family:` we find must be the
    // single var token reference.
    expect(fontFamilyDecls.length).toBeGreaterThan(0);
    for (const value of fontFamilyDecls) {
      expect(value).toBe("var(--dmg-font)");
    }
  });
});

// ---------------------------------------------------------------------------
// R13.1 / R13.2 (V5) — integer pixel-grid spacing tokens
// ---------------------------------------------------------------------------
//
// Every spacing / border token is a whole-pixel value: `--px` is `1px`, and the
// gap / border tokens are each `calc(<integer> * var(--px))`. We scan the
// source and assert each token is an integer multiple of the `--px` grid unit,
// and that no fractional px literal appears on a panel box rule.

describe("R13.1 / R13.2 (V5): integer pixel-grid spacing tokens", () => {
  it("defines --px as a single whole pixel", () => {
    expect(cssVar("px")).toBe("1px");
  });

  it("defines every --dmg-gap*/--dmg-border token as an integer multiple of --px", () => {
    const tokens = ["dmg-gap", "dmg-gap-sm", "dmg-gap-lg", "dmg-border"];
    for (const token of tokens) {
      const value = cssVar(token);
      // Each must be `calc(<integer> * var(--px))` — a whole-number grid step.
      const m = /^calc\(\s*(\d+)\s*\*\s*var\(--px\)\s*\)$/.exec(value);
      expect(m, `--${token} is not an integer * var(--px): ${value}`).not.toBeNull();
      expect(Number.isInteger(Number((m as RegExpExecArray)[1]))).toBe(true);
    }
  });

  it("uses no fractional px literal anywhere in the stylesheet", () => {
    // A fractional px literal (e.g. `1.5px`, `0.5px`) would blur a panel box.
    // The integer `--px` grid forbids them; assert none are authored.
    expect(css).not.toMatch(/\d*\.\d+px/);
  });
});

// ---------------------------------------------------------------------------
// R17.1 (V9) — a single spacing-scale token set on the panels
// ---------------------------------------------------------------------------
//
// Panel padding and gaps must reference only the `--dmg-gap*` token set; no
// ad-hoc px value lives on a `.crt-landing*` panel box. We scan the padding /
// gap declarations on the panel-bearing rules and assert each resolves to a
// `var(--dmg-gap*)` token (the one spacing scale), never a bare px literal.

describe("R17.1 (V9): panels draw spacing only from the --dmg-gap* token set", () => {
  const SPACING_SCALE = new Set([
    "var(--dmg-gap)",
    "var(--dmg-gap-sm)",
    "var(--dmg-gap-lg)",
  ]);

  it("sets .crt-landing padding and gap from the token set", () => {
    const root = ruleBody(".crt .crt-landing");
    const padding = /(?:^|[^-])padding\s*:\s*([^;]+);/.exec(root)?.[1]?.trim();
    const gap = /(?:^|[^-])gap\s*:\s*([^;]+);/.exec(root)?.[1]?.trim();
    expect(padding).toBeDefined();
    expect(gap).toBeDefined();
    expect(SPACING_SCALE.has(padding as string)).toBe(true);
    expect(SPACING_SCALE.has(gap as string)).toBe(true);
  });

  it("sets the shared panel-box padding from the token set", () => {
    const panel = ruleBody(".crt .crt-landing-panel");
    const padding = /(?:^|[^-])padding\s*:\s*([^;]+);/.exec(panel)?.[1]?.trim();
    expect(padding).toBeDefined();
    expect(SPACING_SCALE.has(padding as string)).toBe(true);
  });

  it("draws every panel gap/padding value from the token set, with no ad-hoc px", () => {
    // Scan every `.crt-landing*` rule body for `gap`/`padding`/`margin`
    // declarations and assert each value is either a token-set reference, `0`,
    // or a two-value token pair (e.g. `var(--dmg-gap-sm) var(--dmg-gap)`), but
    // NEVER a bare px literal like `3px`.
    const ruleRe = /\.crt\s+\.crt-landing[^{}]*\{([^}]*)\}/g;
    let rule: RegExpExecArray | null;
    let checked = 0;
    while ((rule = ruleRe.exec(css)) !== null) {
      const body = rule[1] ?? "";
      const spacingDecls = [
        ...body.matchAll(/(?:^|[^-])(gap|padding|margin)\s*:\s*([^;]+);/g),
      ];
      for (const [, prop, rawValue] of spacingDecls) {
        checked += 1;
        const value = (rawValue ?? "").trim();
        // Every token in the (possibly multi-value) declaration must be a
        // spacing-scale var, a plain `0`, `100%`, or `auto` — never a px
        // literal that bypasses the single spacing scale.
        for (const part of value.split(/\s+/)) {
          const ok =
            SPACING_SCALE.has(part) ||
            part === "0" ||
            part === "100%" ||
            part === "auto";
          expect(
            ok,
            `${prop} value "${value}" uses off-scale token "${part}"`,
          ).toBe(true);
        }
      }
    }
    // Guard: we actually scanned some spacing declarations.
    expect(checked).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// R14.1 / R14.2 (V6) — single-line text fit with ellipsis
// ---------------------------------------------------------------------------
//
// The repo-label and ORACLE SAYS rules clip to a single line with an ellipsis
// so long text never overflows its panel box. jsdom cannot compute the external
// rule, so we source-scan the two rule bodies for the three clipping
// declarations.

describe("R14.1 / R14.2 (V6): repo label + ORACLE SAYS clip to one line with ellipsis", () => {
  const CLIP_DECLS = [
    /overflow\s*:\s*hidden/,
    /white-space\s*:\s*nowrap/,
    /text-overflow\s*:\s*ellipsis/,
  ];

  it("clips the repo label row to a single ellipsised line", () => {
    const body = ruleBody(".crt .crt-landing-row-label");
    for (const decl of CLIP_DECLS) {
      expect(body).toMatch(decl);
    }
  });

  it("clips the ORACLE SAYS line to a single ellipsised line", () => {
    const body = ruleBody(".crt .crt-landing-oracle-says");
    for (const decl of CLIP_DECLS) {
      expect(body).toMatch(decl);
    }
  });
});

// ---------------------------------------------------------------------------
// R12.1 / R12.2 (V4) — eye/moon card-back sigil, NEVER a pentagram
// ---------------------------------------------------------------------------
//
// Render the real PreviewWindow and assert each of the three face-down card
// backs carries the eye/moon sigil id (`data-sigil="moon"`) and that neither
// the DOM nor the card-back asset source contains a pentagram/pentacle-star
// motif token.

describe("R12.1 / R12.2 (V4): card backs use the eye/moon sigil, never a pentagram", () => {
  // The seer manifest fixture mirrors the committed manifest's trusted fields
  // (id/logical/bands) through the real boundary loader, like seer-portrait.test.
  const MANIFEST_FIXTURE = {
    images: [{ id: "seer", logical: [256, 144], bands: null }],
  } as const;

  const SEER_ASSET: ArcanaAsset = (() => {
    const asset = loadManifest(MANIFEST_FIXTURE).get("seer");
    if (asset === undefined) {
      throw new Error("fixture must contain the seer asset");
    }
    return asset;
  })();

  function renderPreview(): HTMLElement {
    // The ENTER row is a safe selected row (no repo-specific coupling); the
    // preview model always renders three card backs regardless of selection.
    const manifest = loadManifest(MANIFEST_FIXTURE);
    const enterRow = LANDING_ROWS[LANDING_ROWS.length - 1];
    if (enterRow === undefined) {
      throw new Error("LANDING_ROWS must be non-empty");
    }
    const model = previewModel({} as never, enterRow, manifest);
    // Render PreviewWindow as a real React element (not a plain function call):
    // it now uses hooks to measure its own panel box so the Seer and card backs
    // fill the preview (oracle-landing-polish R26), and hooks require a render
    // context.
    const { container } = render(
      createElement(PreviewWindow, {
        model,
        seerAsset: SEER_ASSET,
        available: { w: 1024, h: 768 },
        motionMode: "full",
      }),
    );
    return container;
  }

  it("renders exactly three card backs, each carrying the eye/moon sigil id", () => {
    const container = renderPreview();
    const backs = container.querySelectorAll(".crt-landing-cardback");
    expect(backs).toHaveLength(3);
    for (const back of Array.from(backs)) {
      // The component tags each back with the eye/moon motif id.
      expect(back.getAttribute("data-sigil")).toBe("moon");
    }
  });

  it("names the eye/moon motif in the card-back accessible text, never a pentagram", () => {
    const container = renderPreview();
    const backs = container.querySelectorAll<HTMLImageElement>(".crt-landing-cardback");
    expect(backs.length).toBeGreaterThan(0);
    for (const back of Array.from(backs)) {
      const alt = (back.getAttribute("alt") ?? "").toLowerCase();
      // The accessible name describes the eye and moon sigil...
      expect(alt).toMatch(/eye/);
      expect(alt).toMatch(/moon/);
      // ...and never a pentagram / pentacle-star motif.
      expect(alt).not.toMatch(/pentagram/);
      expect(alt).not.toMatch(/pentacle/);
    }
  });

  it("uses a card-back asset source that is the moon motif, never a pentagram", () => {
    const container = renderPreview();
    const backs = container.querySelectorAll<HTMLImageElement>(".crt-landing-cardback");
    for (const back of Array.from(backs)) {
      const src = (back.getAttribute("src") ?? "").toLowerCase();
      // The committed eye/moon asset id, never a pentagram-named asset.
      expect(src).toContain("moon");
      expect(src).not.toMatch(/pentagram/);
      expect(src).not.toMatch(/pentacle/);
    }

    // Belt-and-braces: the whole rendered subtree carries no pentagram token
    // in any data-sigil / src / class attribute.
    expect(container.innerHTML.toLowerCase()).not.toMatch(/pentagram/);
    expect(container.innerHTML.toLowerCase()).not.toMatch(/pentacle-star/);
  });
});

// ---------------------------------------------------------------------------
// R20.3 — listbox semantics with the ▶ cursor excluded from the a11y name
// ---------------------------------------------------------------------------
//
// Render the real LegacyRepoList and assert the listbox/option roles, the
// single selected option with `aria-selected="true"`, and that the selected
// option's visible / accessible text contains the repo label, tag, and file
// count but NOT the ▶ (U+25B6) cursor glyph (which is `aria-hidden`).

describe("R20.3: listbox/option roles with the ▶ cursor out of the accessible name", () => {
  /** The ▶ cursor glyph the component marks decorative (aria-hidden). */
  const CURSOR_GLYPH = "\u25B6"; // ▶

  function renderList(selectedIndex: number): HTMLElement {
    const { container } = render(
      LegacyRepoList({
        rows: LANDING_ROWS,
        selectedIndex,
        onSelect: () => {},
        onActivate: () => {},
      }),
    );
    return container;
  }

  it("exposes a listbox with one option per row", () => {
    renderList(0);
    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(LANDING_ROWS.length);
  });

  it("marks exactly one option aria-selected=true for the selected row", () => {
    renderList(0);
    const options = screen.getAllByRole("option");
    const selected = options.filter(
      (o) => o.getAttribute("aria-selected") === "true",
    );
    expect(selected).toHaveLength(1);
    // The selected one is the row at the selected index.
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(options[1]?.getAttribute("aria-selected")).toBe("false");
  });

  it("includes the label, tag, and files in the selected option's name, excluding the ▶ cursor", () => {
    // Select the first concrete repo row so it carries the ▶ cursor.
    renderList(0);
    const firstRow = LANDING_ROWS[0];
    if (firstRow === undefined || firstRow.kind !== "repo") {
      throw new Error("expected the first landing row to be a concrete repo");
    }
    const { label, tag, files } = firstRow.repo;

    const selectedOption = screen.getAllByRole("option")[0];
    if (selectedOption === undefined) {
      throw new Error("expected a selected option to render");
    }

    // The option's accessible/visible text contains the label, tag and files.
    expect(selectedOption).toHaveTextContent(label);
    expect(selectedOption).toHaveTextContent(tag);
    expect(selectedOption).toHaveTextContent(files);

    // The ▶ cursor glyph lives in an aria-hidden span, so it must NOT appear
    // in the option's accessible name (what a screen reader announces). Assert
    // the aria-hidden cursor span carries the glyph and the NON-hidden text
    // excludes it.
    const cursor = selectedOption.querySelector('[aria-hidden="true"]');
    expect(cursor).not.toBeNull();
    expect(cursor?.textContent).toBe(CURSOR_GLYPH);

    // Build the accessible name = concatenation of the non-aria-hidden text.
    const visibleText = Array.from(selectedOption.children)
      .filter((child) => child.getAttribute("aria-hidden") !== "true")
      .map((child) => child.textContent ?? "")
      .join(" ");
    expect(visibleText).toContain(label);
    expect(visibleText).toContain(tag);
    expect(visibleText).toContain(files);
    // The decorative ▶ cursor is excluded from the accessible name.
    expect(visibleText.includes(CURSOR_GLYPH)).toBe(false);
  });

  it("keeps the ▶ cursor off non-selected options", () => {
    renderList(0);
    const options = screen.getAllByRole("option");
    // The second (non-selected) option's decorative cursor span is empty.
    const cursor = options[1]?.querySelector('[aria-hidden="true"]');
    expect(cursor).not.toBeNull();
    expect(cursor?.textContent).toBe("");
  });
});
