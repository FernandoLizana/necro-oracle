// @vitest-environment jsdom
//
// PixelCard property tests (Arcana_Visions, task 12.2).
//
// Validates: Requirements R1.6, R1.7, R2.9, R5.1, R5.2
//
// These drive the screen-only `PixelCard` built in task 12.1 across the whole
// input space with fast-check (200 runs). The component is pure/presentational:
// its display model comes from the pure `pixelCardModel(VisualCard)` and its
// glitch from the pure `glitchProfile(severity)` — no network, clock, DOM-timer
// or real randomness. jsdom gives a real DOM to read the band text, the caption
// position, `data-orientation`, and the glitch `data-*`/class contract.
//
// Every property names its requirement in the describe title, per repo PBT
// conventions, and prints the fast-check seed on failure.

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import { CardIdSchema, type CardDraw, type CardId } from "@necro/oracle/client";

import type { ArcanaAsset } from "../arcana/manifest.js";
import { pixelCardModel } from "../arcana/pixel-card-model.js";
import { glitchProfile } from "../motion/glitch.js";
import { asciiCard } from "../render/ascii-card.js";
import type { VisualCard } from "../session/visual-reading.js";
import { GLITCH_CLASS } from "./AsciiCardView.js";
import { PixelCard, type PixelCardProps } from "./PixelCard.js";

afterEach(() => {
  cleanup();
});

const NUM_RUNS = 200;

/** The 12 diagnosis card ids, in deck order (120×160 assets with bands). */
const CARD_IDS: readonly CardId[] = CardIdSchema.options;

/** The trusted 120×160 diagnosis asset every Pixel_Card is rendered against. */
const DIAGNOSIS_ASSET: ArcanaAsset = {
  id: "diagnosis",
  logical: { w: 120, h: 160 },
  bands: { header: [0, 19], footer: [147, 160] },
};

// ── arbitraries ──────────────────────────────────────────────────────────────

const arbCardId: fc.Arbitrary<CardId> = fc.constantFrom(...CARD_IDS);
const arbOrientation = fc.constantFrom("upright" as const, "reversed" as const);
const arbSeverity = fc.constantFrom(0 as const, 1 as const, 2 as const, 3 as const);
const arbLabel = fc.constantFrom(
  "I · THE CORPSE",
  "III · THE SHADOW",
  "V · THE PAST",
  "X · THE OUTCOME",
);

/** A `VisualCard` — the Spec 05 shape `pixelCardModel` maps into the model. */
const arbVisualCard: fc.Arbitrary<VisualCard> = fc
  .record({
    card: arbCardId,
    orientation: arbOrientation,
    severity: arbSeverity,
    label: arbLabel,
    position: fc.integer({ min: 1, max: 10 }),
  })
  .map(({ card, orientation, severity, label, position }) => {
    const draw: CardDraw = {
      card,
      severity,
      orientation,
      evidence: [],
      summary: "deterministic summary",
      grimoires: [],
    };
    return { position, label, draw } satisfies VisualCard;
  });

// ── harness ──────────────────────────────────────────────────────────────────

/** Render a `PixelCard` from a `VisualCard` and return its root element. */
function renderPixelCard(
  visual: VisualCard,
  motionMode: PixelCardProps["motionMode"],
): HTMLElement {
  const model = pixelCardModel(visual);
  const { container } = render(
    createElement(PixelCard, {
      model,
      asset: DIAGNOSIS_ASSET,
      scale: 2,
      motionMode,
      src: `/arcana/${model.card}.webp`,
      asciiFallback: asciiCard(model.card, model.orientation),
    } satisfies PixelCardProps),
  );
  const el = container.querySelector(".crt-pixel-card");
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

// ── P9 (R1.6, R1.7) ────────────────────────────────────────────────────────

describe("P9 (R1.6, R1.7): pixel card renders band text and caption below the image", () => {
  it("shows numeral+title in the header band, position·orientation in the footer band, and the caption below the image", () => {
    fc.assert(
      fc.property(arbVisualCard, (visual) => {
        const model = pixelCardModel(visual);
        const el = renderPixelCard(visual, "full");

        // Header band [0,19]: numeral + title as DOM text (R1.6).
        const header = el.querySelector('.crt-pixel-band[data-band="header"]');
        expect(header).not.toBeNull();
        expect(header?.querySelector(".crt-pixel-numeral")?.textContent).toBe(
          model.numeral,
        );
        expect(header?.querySelector(".crt-pixel-title")?.textContent).toBe(
          model.title,
        );

        // Footer band [147,160]: POSITION · ORIENTATION as DOM text (R1.6).
        const footer = el.querySelector('.crt-pixel-band[data-band="footer"]');
        expect(footer).not.toBeNull();
        const footerText = footer?.querySelector(".crt-pixel-position")?.textContent;
        expect(footerText).toBe(
          `${model.positionLabel} · ${model.orientation.toUpperCase()}`,
        );

        // Diagnosis_Caption: present, carrying the caption text (R1.7).
        const caption = el.querySelector(".crt-pixel-caption");
        expect(caption).not.toBeNull();
        expect(caption?.textContent).toBe(model.caption);

        // The caption renders BELOW the image in DOM order (outside the bands):
        // in document order the image (or its fallback) precedes the caption.
        const children = Array.from(el.children);
        const captionIndex = children.indexOf(caption as Element);
        const img = el.querySelector("img.crt-pixel-card-img");
        expect(img).not.toBeNull();
        const imgIndex = children.indexOf(img as Element);
        expect(imgIndex).toBeGreaterThanOrEqual(0);
        expect(captionIndex).toBeGreaterThan(imgIndex);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ── P10 (R2.9) ───────────────────────────────────────────────────────────────

describe("P10 (R2.9): reversed card rotates the image while text stays upright", () => {
  it("sets data-orientation and keeps the band/caption text in the unrotated DOM flow (never inside the img)", () => {
    fc.assert(
      fc.property(
        arbVisualCard,
        arbOrientation,
        (base, orientation) => {
          const visual: VisualCard = {
            ...base,
            draw: { ...base.draw, orientation },
          };
          const model = pixelCardModel(visual);
          const el = renderPixelCard(visual, "full");

          // The orientation is emitted as an attribute; the 180° image rotation
          // is CSS keyed off it (R2.9).
          expect(el.getAttribute("data-orientation")).toBe(orientation);

          // The image carries no text — the numeral/title/position/caption text
          // lives in sibling DOM nodes, never inside the rotated <img>, so it
          // stays upright regardless of the image flip.
          const img = el.querySelector("img.crt-pixel-card-img") as HTMLElement;
          expect(img).not.toBeNull();
          expect(img.textContent).toBe("");

          // Every text node is present and upright (outside the image subtree).
          const numeral = el.querySelector(".crt-pixel-numeral");
          const title = el.querySelector(".crt-pixel-title");
          const position = el.querySelector(".crt-pixel-position");
          const caption = el.querySelector(".crt-pixel-caption");
          for (const node of [numeral, title, position, caption]) {
            expect(node).not.toBeNull();
            expect(img.contains(node as Node)).toBe(false);
          }
          expect(numeral?.textContent).toBe(model.numeral);
          expect(title?.textContent).toBe(model.title);
          expect(caption?.textContent).toBe(model.caption);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ── P11 (R5.1, R5.2) ─────────────────────────────────────────────────────────

describe("P11 (R5.1, R5.2): glitch contract follows glitchProfile, steady at severity 0", () => {
  it("in full motion, severity>0 carries the crt-glitch class and data-glitch-intensity = glitchProfile(severity).intensity; severity 0 carries neither", () => {
    fc.assert(
      fc.property(arbVisualCard, (visual) => {
        const model = pixelCardModel(visual);
        const el = renderPixelCard(visual, "full");
        const glitch = glitchProfile(model.severity);

        if (model.severity > 0) {
          // R5.1: a card with severity 1..3 glitches in full motion, with the
          // intensity derived straight from the Glitch_Profile.
          expect(el.classList.contains(GLITCH_CLASS)).toBe(true);
          expect(el.getAttribute("data-glitch-intensity")).toBe(
            String(glitch.intensity),
          );
          // The glitch custom properties mirror the profile exactly.
          expect(el.style.getPropertyValue("--glitch-offset")).toBe(
            `${glitch.offsetPx}px`,
          );
          expect(el.style.getPropertyValue("--glitch-tears")).toBe(
            String(glitch.tearCount),
          );
          expect(el.style.getPropertyValue("--glitch-corrupt")).toBe(
            String(glitch.corruptChars),
          );
          expect(el.style.getPropertyValue("--glitch-duration")).toBe(
            `${glitch.durationMs}ms`,
          );
        } else {
          // R5.2: a severity-0 card is steady — no glitch class, no intensity
          // attribute, no chromatic offset / tear / corruption custom props.
          expect(el.classList.contains(GLITCH_CLASS)).toBe(false);
          expect(el.hasAttribute("data-glitch-intensity")).toBe(false);
          expect(el.style.getPropertyValue("--glitch-offset")).toBe("");
          expect(el.style.getPropertyValue("--glitch-tears")).toBe("");
          expect(el.style.getPropertyValue("--glitch-corrupt")).toBe("");
          expect(el.style.getPropertyValue("--glitch-duration")).toBe("");
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
