// src/arcana/pixel-card-model.pbt.test.ts
//
// Feature: arcana-visions, task 6.2.
//
// Property-based tests for the pixel-card model (`pixel-card-model.ts`, task
// 6.1). The module derives a Pixel_Card's screen-reader alt text and display
// model from a Spec 05 `VisualCard`. Two pure functions are exercised:
//
//   - `cardAltText(card, orientation)` builds the accessibility string
//     `"<Name>, <upright|reversed> — <one-line meaning ≤ 120 chars>"` (R10.1),
//     reusing `CARD_REGISTRY` for the name and `VOICE_TABLE` for the meaning.
//   - `pixelCardModel(card)` maps a `VisualCard` into the display model
//     `PixelCard` renders: numeral/title (non-empty for the real deck),
//     severity preserved unchanged (0..3), and an `altText` consistent with
//     `cardAltText`.
//
// Testing steering: fast-check with explicit numRuns (200 for model/alt-text
// derivation); the seed prints on failure. No network / LLM / sandbox — pure
// computation over the real `CardId` deck and both orientations.
//
// **Validates: Requirements R10.1**
import {
  CARD_REGISTRY,
  CardIdSchema,
  type CardDraw,
  type CardId,
} from "@necro/oracle/client";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { VOICE_TABLE, type Orientation } from "../voice/voice-table.js";
import type { VisualCard } from "../session/visual-reading.js";
import { cardAltText, pixelCardModel } from "./pixel-card-model.js";

/** Model/alt-text derivation is in the 200-run default tier. */
const NUM_RUNS = 200;

/** The longest alt-text meaning clause allowed by R10.1, in code points. */
const ALT_MEANING_MAX = 120;

/** The real diagnosis deck: every `CardId` accepted by the oracle schema. */
const CARD_IDS = CardIdSchema.options as readonly CardId[];

/** Any card in the real deck. */
const arbCard: fc.Arbitrary<CardId> = fc.constantFrom(...CARD_IDS);

/** Either orientation word. */
const arbOrientation: fc.Arbitrary<Orientation> = fc.constantFrom(
  "upright",
  "reversed",
);

/** The 0..3 diagnosis severity flowing unchanged into the glitch contract. */
const arbSeverity = fc.constantFrom<0 | 1 | 2 | 3>(0, 1, 2, 3);

/**
 * A minimal-but-valid `VisualCard`. The model only reads `draw.card`,
 * `draw.orientation`, `draw.severity`, and `label`; the remaining `CardDraw`
 * fields are filled with valid empty/short values so the generated value is a
 * faithful `VisualCard` the selectors could have produced.
 */
const arbVisualCard: fc.Arbitrary<VisualCard> = fc
  .record({
    card: arbCard,
    orientation: arbOrientation,
    severity: arbSeverity,
    position: fc.integer({ min: 1, max: 10 }),
    label: fc.string({ minLength: 1, maxLength: 40 }),
  })
  .map(({ card, orientation, severity, position, label }) => {
    const draw: CardDraw = {
      card,
      severity,
      orientation,
      evidence: [],
      summary: "",
      grimoires: [],
    };
    return { position, label, draw } satisfies VisualCard;
  });

/** The display name `cardAltText` uses for a card (registry name, id fallback). */
function displayName(card: CardId): string {
  return CARD_REGISTRY.get(card)?.name ?? card;
}

describe("P12 (R10.1): alt text contains the name, orientation word, and a meaning <= 120 chars", () => {
  it("contains the card's display name (R10.1)", () => {
    fc.assert(
      fc.property(arbCard, arbOrientation, (card, orientation) => {
        const alt = cardAltText(card, orientation);
        expect(alt).toContain(displayName(card));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("contains the orientation word 'upright' or 'reversed' (R10.1)", () => {
    fc.assert(
      fc.property(arbCard, arbOrientation, (card, orientation) => {
        const alt = cardAltText(card, orientation);
        expect(alt).toContain(orientation);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("carries a one-line meaning clause of at most 120 code points (R10.1)", () => {
    fc.assert(
      fc.property(arbCard, arbOrientation, (card, orientation) => {
        const alt = cardAltText(card, orientation);
        // The format is "<Name>, <orientation> — <meaning>"; the meaning clause
        // follows the em-dash separator. It must be non-empty and within the
        // 120-code-point ceiling.
        const marker = " — ";
        const at = alt.indexOf(marker);
        expect(at).toBeGreaterThanOrEqual(0);
        const meaning = alt.slice(at + marker.length);
        const length = [...meaning].length;
        expect(length).toBeGreaterThan(0);
        expect(length).toBeLessThanOrEqual(ALT_MEANING_MAX);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("matches the exact 'Name, orientation — meaning' composition (R10.1)", () => {
    fc.assert(
      fc.property(arbCard, arbOrientation, (card, orientation) => {
        const alt = cardAltText(card, orientation);
        const name = displayName(card);
        const meaning = VOICE_TABLE[card][orientation];
        // The VOICE_TABLE lines are already <= 72 columns, so no clamp applies
        // and the alt text is the verbatim three-part join.
        expect(alt).toBe(`${name}, ${orientation} — ${meaning}`);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("P12 (R10.1): pixelCardModel produces a well-formed, alt-consistent model", () => {
  it("yields a non-empty numeral and title for every real card (R1.6)", () => {
    fc.assert(
      fc.property(arbVisualCard, (visual) => {
        const model = pixelCardModel(visual);
        // Real deck entries always resolve in CARD_REGISTRY, so neither the
        // header numeral nor the title falls back to the empty string.
        expect(model.numeral.length).toBeGreaterThan(0);
        expect(model.title.length).toBeGreaterThan(0);
        expect(model.title).toBe(model.title.toUpperCase());
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("preserves card, orientation, severity, and label unchanged (R2.9, R5.1, R5.2)", () => {
    fc.assert(
      fc.property(arbVisualCard, (visual) => {
        const model = pixelCardModel(visual);
        expect(model.card).toBe(visual.draw.card);
        expect(model.orientation).toBe(visual.draw.orientation);
        expect(model.severity).toBe(visual.draw.severity);
        expect(model.severity).toBeGreaterThanOrEqual(0);
        expect(model.severity).toBeLessThanOrEqual(3);
        expect(model.positionLabel).toBe(visual.label);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("derives altText consistent with cardAltText for the same card and orientation (R10.1)", () => {
    fc.assert(
      fc.property(arbVisualCard, (visual) => {
        const model = pixelCardModel(visual);
        expect(model.altText).toBe(
          cardAltText(visual.draw.card, visual.draw.orientation),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
