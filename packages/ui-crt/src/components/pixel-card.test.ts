// @vitest-environment jsdom
//
// PixelCard example unit tests (Arcana_Visions, task 12.2).
//
// Validates: Requirements R1.8, R1.9, R4.2, R4.6, R4.9, R5.3, R5.4, R5.5, R5.6,
// R11.1
//
// These pin the specific edge cases of the screen-only `PixelCard` (task 12.1)
// that the property suite (`pixel-spread.pbt.test.ts`) leaves to examples: the
// image-error ASCII fallback, the scale-1 ellipsis-clipping classes, the glitch
// one-shot resting state in reduced/steady motion, the invalid Motion_Zone
// runtime guard (dev `console.warn`, no terminal message), and the `steps()`
// rect-clipping custom properties on the rendered zone overlays.
//
// The component is pure/presentational: cards come from the pure
// `pixelCardModel`/`asciiCard` and glitch from the pure `glitchProfile` — no
// network, clock, DOM-timer or real randomness. jsdom gives a real DOM, and
// `fireEvent.error` drives the `<img>` `onError` path deterministically.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CardDraw } from "@necro/oracle/client";

import type { ArcanaAsset } from "../arcana/manifest.js";
import { MOTION_ZONES } from "../arcana/motion-zones.js";
import { pixelCardModel } from "../arcana/pixel-card-model.js";
import { asciiCard } from "../render/ascii-card.js";
import type { VisualCard } from "../session/visual-reading.js";
import { GLITCH_CLASS } from "./AsciiCardView.js";
import { PixelCard, type PixelCardProps } from "./PixelCard.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The trusted 120×160 diagnosis asset with the standard header/footer bands. */
const DIAGNOSIS_ASSET: ArcanaAsset = {
  id: "diagnosis",
  logical: { w: 120, h: 160 },
  bands: { header: [0, 19], footer: [147, 160] },
};

/** Build a `VisualCard` for one card/orientation/severity. */
function visualCard(args: {
  card: VisualCard["draw"]["card"];
  orientation: "upright" | "reversed";
  severity: 0 | 1 | 2 | 3;
  label?: string;
}): VisualCard {
  const draw: CardDraw = {
    card: args.card,
    severity: args.severity,
    orientation: args.orientation,
    evidence: [],
    summary: "deterministic summary",
    grimoires: [],
  };
  return { position: 1, label: args.label ?? "I · THE CORPSE", draw };
}

/** Render a `PixelCard`, returning the root element and the container. */
function renderCard(
  visual: VisualCard,
  overrides: Partial<PixelCardProps> = {},
): { root: HTMLElement; container: HTMLElement } {
  const model = pixelCardModel(visual);
  const props: PixelCardProps = {
    model,
    asset: DIAGNOSIS_ASSET,
    scale: 2,
    motionMode: "full",
    src: `/arcana/${model.card}.webp`,
    asciiFallback: asciiCard(model.card, model.orientation),
    ...overrides,
  };
  const { container } = render(createElement(PixelCard, props));
  const root = container.querySelector(".crt-pixel-card");
  expect(root).not.toBeNull();
  return { root: root as HTMLElement, container };
}

// ---------------------------------------------------------------------------
// R1.9: image error → ASCII fallback in place, no broken-image indicator
// ---------------------------------------------------------------------------

describe("R1.9 (image error): a failed image swaps to the ASCII card in place", () => {
  it("renders the <img> initially, then the AsciiCardView after onError, with no broken-image indicator", () => {
    const visual = visualCard({ card: "tower", orientation: "upright", severity: 2 });
    const { root } = renderCard(visual);

    const img = root.querySelector("img.crt-pixel-card-img");
    expect(img).not.toBeNull();
    // No ASCII card yet.
    expect(root.querySelector(".crt-ascii-card")).toBeNull();

    // Simulate the decode/load failure.
    fireEvent.error(img as HTMLImageElement);

    // The <img> is gone and the ASCII card view is rendered in its place.
    expect(root.querySelector("img.crt-pixel-card-img")).toBeNull();
    const ascii = root.querySelector(".crt-ascii-card");
    expect(ascii).not.toBeNull();
    // The ASCII fallback carries the card's accessible text — the fallback is a
    // real card, not a broken-image placeholder.
    const fallback = asciiCard("tower", "upright");
    expect(ascii?.querySelector(".crt-sr-only")?.textContent).toBe(
      fallback.accessibleText,
    );

    // No broken-image indicator: the only <img> that could 404 is gone, and no
    // alt-text-exposing error node is rendered.
    expect(root.querySelector("img")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R11.1: image loading strategy — eager for the visible spread, lazy by default
// ---------------------------------------------------------------------------

describe("R11.1 (lazy loading): the card image carries the caller's loading strategy", () => {
  it("defaults the <img> to loading=lazy so an unmarked card defers its bitmap", () => {
    const visual = visualCard({ card: "moon", orientation: "upright", severity: 0 });
    const { root } = renderCard(visual);

    const img = root.querySelector<HTMLImageElement>("img.crt-pixel-card-img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("marks a visible spread card loading=eager when the parent passes it", () => {
    const visual = visualCard({ card: "moon", orientation: "upright", severity: 0 });
    const { root } = renderCard(visual, { loading: "eager" });

    const img = root.querySelector<HTMLImageElement>("img.crt-pixel-card-img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("loading")).toBe("eager");
  });
});

// ---------------------------------------------------------------------------
// R1.8: scale-1 ellipsis clipping — band/caption classes carry the clip rules
// ---------------------------------------------------------------------------

describe("R1.8 (scale-1 legibility): header/footer/caption carry the arcana.css clipping classes", () => {
  it("renders the band and caption elements with the classes the stylesheet clips to an ellipsis", () => {
    const visual = visualCard({ card: "hermit", orientation: "upright", severity: 1 });
    const { root } = renderCard(visual, { scale: 1 });

    // The clipping is a CSS concern of `arcana.css`; the component's obligation
    // is to carry the class hooks the stylesheet targets. Assert they exist.
    const header = root.querySelector('.crt-pixel-band[data-band="header"]');
    const footer = root.querySelector('.crt-pixel-band[data-band="footer"]');
    const caption = root.querySelector(".crt-pixel-caption");

    expect(header).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(caption).not.toBeNull();

    // The band children carry the dedicated text classes the clip rules target.
    expect(header?.querySelector(".crt-pixel-numeral")).not.toBeNull();
    expect(header?.querySelector(".crt-pixel-title")).not.toBeNull();
    expect(footer?.querySelector(".crt-pixel-position")).not.toBeNull();

    // At scale 1 the card still carries the --arcana-scale custom property = 1.
    expect(root.style.getPropertyValue("--arcana-scale")).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// R5.3, R5.4, R5.6: glitch one-shot resting state at severity 0 (steady)
// R5.5: reduced motion yields no glitch attributes
// ---------------------------------------------------------------------------

describe("R5.3 / R5.4 / R5.6 (steady at rest): a severity-0 card carries no glitch hook", () => {
  it("emits no crt-glitch class, no data-glitch-intensity, and no glitch custom properties for severity 0 in full motion", () => {
    const visual = visualCard({ card: "star", orientation: "upright", severity: 0 });
    const { root } = renderCard(visual);

    expect(root.classList.contains(GLITCH_CLASS)).toBe(false);
    expect(root.hasAttribute("data-glitch-intensity")).toBe(false);
    expect(root.style.getPropertyValue("--glitch-offset")).toBe("");
    expect(root.style.getPropertyValue("--glitch-tears")).toBe("");
    expect(root.style.getPropertyValue("--glitch-corrupt")).toBe("");
    expect(root.style.getPropertyValue("--glitch-duration")).toBe("");
  });
});

describe("R5.5 (reduced motion): a glitchy card carries no glitch hook under reduced motion", () => {
  it("omits the crt-glitch class and all glitch custom properties for a severe card in reduced motion", () => {
    const visual = visualCard({ card: "tower", orientation: "upright", severity: 3 });
    const { root } = renderCard(visual, { motionMode: "reduced" });

    expect(root.classList.contains(GLITCH_CLASS)).toBe(false);
    expect(root.hasAttribute("data-glitch-intensity")).toBe(false);
    expect(root.style.getPropertyValue("--glitch-offset")).toBe("");
    expect(root.style.getPropertyValue("--glitch-duration")).toBe("");
    // Orientation still records (it is not a glitch effect).
    expect(root.getAttribute("data-orientation")).toBe("upright");
  });
});

// ---------------------------------------------------------------------------
// R4.9: invalid Motion_Zone runtime guard — omit + dev console.warn, no message
// ---------------------------------------------------------------------------

describe("R4.9 (invalid-zone guard): an invalid zone is omitted with a dev console.warn and no terminal message", () => {
  it("omits the overlay and warns (dev) when an authored zone overlaps a Text_Band, with no user-visible text", () => {
    // The authored `tower` flame-flicker zone sits at rows [28,62]. Forcing an
    // asset whose header band spans [0,100] makes that zone overlap the band,
    // driving `validateMotionZone` to return an `overlaps-band` issue — so the
    // runtime guard must omit the overlay and emit a dev-time console.warn.
    const bandOverlapAsset: ArcanaAsset = {
      id: "diagnosis",
      logical: { w: 120, h: 160 },
      bands: { header: [0, 100], footer: [147, 160] },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const visual = visualCard({ card: "tower", orientation: "upright", severity: 1 });
    const { root } = renderCard(visual, { asset: bandOverlapAsset });

    // No animated overlay is rendered for the invalidated zone.
    expect(root.querySelectorAll(".crt-motion-zone").length).toBe(0);

    // A dev-time console.warn named the omitted zone (R4.9).
    expect(warn).toHaveBeenCalled();
    const warnText = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warnText).toContain("tower");

    // No user-visible terminal message: the warning is console-only and nothing
    // was rendered into the card's DOM about the omission.
    expect(root.textContent).not.toContain("motion zone");
    expect(root.textContent).not.toContain("console.warn");
  });

  it("renders every authored valid zone as a .crt-motion-zone overlay in full motion and none in reduced motion", () => {
    // Complementary property: with a valid asset, all authored zones for the
    // card render as overlays in full motion and none in reduced motion. The
    // invalid-rect path (rect out of a card's logical bounds) is covered by the
    // motion-zones.pbt.test.ts validator property; here the authored table is
    // valid against the real 120×160 bands, so we assert the full/reduced split.
    const towerZones = MOTION_ZONES.filter((z) => z.card === "tower");
    expect(towerZones.length).toBeGreaterThan(0);

    const visual = visualCard({ card: "tower", orientation: "upright", severity: 1 });

    const full = renderCard(visual, { motionMode: "full" });
    expect(full.root.querySelectorAll(".crt-motion-zone").length).toBe(
      towerZones.length,
    );

    cleanup();

    const reduced = renderCard(visual, { motionMode: "reduced" });
    expect(reduced.root.querySelectorAll(".crt-motion-zone").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R4.2, R4.6: steps()/rect-clipping — zone overlays carry --zone-* and data-effect
// ---------------------------------------------------------------------------

describe("R4.2 / R4.6 (rect clipping): each motion zone carries its rect custom props and effect", () => {
  it("places each .crt-motion-zone with --zone-x/y/w/h matching the authored rect and data-effect naming the effect", () => {
    const towerZones = MOTION_ZONES.filter((z) => z.card === "tower");
    const visual = visualCard({ card: "tower", orientation: "upright", severity: 1 });
    const { root } = renderCard(visual, { motionMode: "full" });

    const overlays = root.querySelectorAll<HTMLElement>(".crt-motion-zone");
    expect(overlays.length).toBe(towerZones.length);

    overlays.forEach((overlay, index) => {
      const zone = towerZones[index];
      expect(zone).toBeDefined();
      if (zone === undefined) return;
      expect(overlay.getAttribute("data-effect")).toBe(zone.effect);
      expect(overlay.style.getPropertyValue("--zone-x")).toBe(String(zone.rect.x));
      expect(overlay.style.getPropertyValue("--zone-y")).toBe(String(zone.rect.y));
      expect(overlay.style.getPropertyValue("--zone-w")).toBe(String(zone.rect.w));
      expect(overlay.style.getPropertyValue("--zone-h")).toBe(String(zone.rect.h));
      // The overlay is decorative — hidden from the a11y tree.
      expect(overlay.getAttribute("aria-hidden")).toBe("true");
    });
  });
});
