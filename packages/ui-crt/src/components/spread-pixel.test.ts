// @vitest-environment jsdom
//
// SpreadPixelView behaviour tests (Arcana_Visions, task 13.2).
//
// Validates: Requirements 3.1, 3.3, 3.4, 3.5
//
// This file is intentionally SEPARATE from `pixel-spread.pbt.test.ts` (which is
// owned by task 12.2). Task 13.2 and task 12.2 both touch the pixel-spread test
// surface; keeping this task's property + unit tests in their own file avoids
// clobbering the concurrently-authored 12.2 file.
//
// SpreadPixelView is a screen-only presentational view: the slot order is the
// reading's spread order, authoritative and untouched (no reorder, duplicate or
// omission — R3.1, R3.5). It renders a per-slot ASCII fallback when a card image
// is unavailable (R3.3) and a `<noscript>` ASCII spread, in order, for no-JS
// readers (R3.4). Every assertion here is deterministic: VisualCards are built
// from the pure oracle `CardId` enum, the manifest is a hand-built trusted map,
// and no network/clock/DOM-timer/real randomness is involved. The small inline
// fast-check property drives the order invariant across arbitrary readings; the
// example tests pin the fates-3 slot count, the missing-image fallback and the
// SSR no-JS fallback.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { CardIdSchema, type CardDraw, type CardId } from "@necro/oracle/client";
import fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import type { ArcanaAsset } from "../arcana/manifest.js";
import type { Size } from "../arcana/integer-scale.js";
import type { VisualCard } from "../session/visual-reading.js";
import { SpreadPixelView } from "./SpreadPixelView.js";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Fixtures: a trusted manifest map and a VisualCard builder
// ---------------------------------------------------------------------------

/** The 12 diagnosis card ids, in deck order (the manifest's diagnosis assets). */
const CARD_IDS: readonly CardId[] = CardIdSchema.options;

/** A region generous enough that each slot scales at a whole factor >= 1. */
const AVAILABLE: Size = { w: 1200, h: 400 };

/** A trusted 120x160 diagnosis asset with the standard text bands. */
function diagnosisAsset(id: CardId): ArcanaAsset {
  return {
    id,
    logical: { w: 120, h: 160 },
    bands: { header: [0, 19], footer: [147, 160] },
  };
}

/** A trusted `id -> ArcanaAsset` map covering all 12 diagnosis cards. */
function fullManifest(): ReadonlyMap<string, ArcanaAsset> {
  return new Map(CARD_IDS.map((id) => [id, diagnosisAsset(id)] as const));
}

/** Build a minimal non-void `CardDraw` for a card id and severity. */
function draw(card: CardId, severity: 0 | 1 | 2 | 3): CardDraw {
  return {
    card,
    severity,
    orientation: "upright",
    evidence: [],
    summary: "",
    grimoires: [],
  };
}

/** Build a `VisualCard` for a 1-based spread position. */
function visualCard(position: number, card: CardId): VisualCard {
  return {
    position,
    label: `${position} · ${card.toUpperCase()}`,
    draw: draw(card, (position % 4) as 0 | 1 | 2 | 3),
  };
}

/**
 * Read the rendered slot `data-card` order out of the live (non-noscript)
 * spread row, in document order. Every slot — a `PixelCard` root or a
 * missing-asset ASCII fallback — is a direct `.crt-pixel-card` child of the
 * row and carries `data-card`, so this reads the exact rendered slot sequence.
 */
function renderedCardOrder(container: HTMLElement): string[] {
  const row = container.querySelector(
    ".crt-spread-pixel:not(.crt-spread-pixel-fallback)",
  );
  expect(row).not.toBeNull();
  const slots = (row as HTMLElement).querySelectorAll(
    ":scope > .crt-pixel-card",
  );
  return Array.from(slots).map((el) => el.getAttribute("data-card") ?? "");
}

// ---------------------------------------------------------------------------
// P3: slot order equals the reading's spread order (R3.1, R3.5)
// ---------------------------------------------------------------------------

describe("P3 (R3.1, R3.5): spread slot order equals the reading's spread order", () => {
  it("renders every slot in the reading's exact order, none reordered/duplicated/omitted", () => {
    const manifest = fullManifest();

    fc.assert(
      fc.property(
        // An arbitrary reading: 1..10 drawn positions, each a (card id,
        // 1-based position) pair. Positions are assigned sequentially so each
        // slot carries a distinct, meaningful position label and index.
        fc.array(fc.constantFrom(...CARD_IDS), { minLength: 1, maxLength: 10 }),
        (cardOrder) => {
          const cards: VisualCard[] = cardOrder.map((card, i) =>
            visualCard(i + 1, card),
          );

          const { container, unmount } = render(
            createElement(SpreadPixelView, {
              cards,
              manifest,
              available: AVAILABLE,
              motionMode: "reduced",
            }),
          );

          try {
            const rendered = renderedCardOrder(container);
            const expected = cards.map((c) => c.draw.card);

            // Same count: nothing omitted or duplicated.
            expect(rendered).toHaveLength(cards.length);
            // Same sequence, element by element: nothing reordered.
            expect(rendered).toEqual(expected);
          } finally {
            unmount();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("renders exactly 3 slots, in order, for a fates reading (example)", () => {
    const cards: VisualCard[] = [
      visualCard(1, "tower"),
      visualCard(2, "death"),
      visualCard(3, "star"),
    ];

    const { container } = render(
      createElement(SpreadPixelView, {
        cards,
        manifest: fullManifest(),
        available: AVAILABLE,
        motionMode: "reduced",
      }),
    );

    const rendered = renderedCardOrder(container);
    expect(rendered).toHaveLength(3);
    expect(rendered).toEqual(["tower", "death", "star"]);

    // The `<noscript>` fallback carries `data-position`, pinning the position
    // order too (1, 2, 3) alongside the card order above.
    const fallback = container.querySelector(
      ".crt-spread-pixel-fallback",
    ) as HTMLElement | null;
    if (fallback) {
      const positions = Array.from(
        fallback.querySelectorAll(":scope > [data-position]"),
      ).map((el) => el.getAttribute("data-position"));
      expect(positions).toEqual(["1", "2", "3"]);
    }
  });
});

// ---------------------------------------------------------------------------
// R3.3: an image-unavailable slot renders the ASCII card in that slot
// ---------------------------------------------------------------------------

describe("R3.3 (image unavailable): the slot renders the ASCII card in place", () => {
  it("renders the ASCII card for a slot whose asset is missing from the manifest, in its own slot", () => {
    // A manifest that omits `death` entirely: its slot cannot be scaled as a
    // pixel card, so the view renders the ASCII card for that position in the
    // same slot while the other two render as pixel cards (R3.3). The slot
    // order and count are unchanged.
    const partialManifest = new Map<string, ArcanaAsset>([
      ["tower", diagnosisAsset("tower")],
      ["star", diagnosisAsset("star")],
    ]);
    const cards: VisualCard[] = [
      visualCard(1, "tower"),
      visualCard(2, "death"),
      visualCard(3, "star"),
    ];

    const { container } = render(
      createElement(SpreadPixelView, {
        cards,
        manifest: partialManifest,
        available: AVAILABLE,
        motionMode: "reduced",
      }),
    );

    const row = container.querySelector(
      ".crt-spread-pixel:not(.crt-spread-pixel-fallback)",
    ) as HTMLElement;
    const slots = row.querySelectorAll(":scope > .crt-pixel-card");

    // Still three slots, still in order.
    expect(
      Array.from(slots).map((el) => el.getAttribute("data-card")),
    ).toEqual(["tower", "death", "star"]);

    // The `death` slot (index 1) holds the ASCII card, not an <img>.
    const deathSlot = slots[1] as HTMLElement;
    expect(deathSlot.getAttribute("data-card")).toBe("death");
    expect(deathSlot.querySelector(".crt-ascii-card")).not.toBeNull();
    expect(deathSlot.querySelector("img")).toBeNull();

    // The pixel-card slots still render an <img> (an available asset).
    expect(
      (slots[0] as HTMLElement).querySelector("img"),
    ).not.toBeNull();
    expect(
      (slots[2] as HTMLElement).querySelector("img"),
    ).not.toBeNull();
  });

  it("swaps a pixel card's <img> for the ASCII card in place on image load failure", () => {
    // When the asset IS in the manifest but the bitmap fails to load,
    // PixelCard's onError swaps the <img> for the ASCII card in the same slot,
    // with no broken-image indicator (R3.3 / R1.9).
    const cards: VisualCard[] = [visualCard(1, "tower")];

    const { container } = render(
      createElement(SpreadPixelView, {
        cards,
        manifest: fullManifest(),
        available: AVAILABLE,
        motionMode: "reduced",
      }),
    );

    const img = container.querySelector("img.crt-pixel-card-img");
    expect(img).not.toBeNull();

    // Fire the image error to trigger PixelCard's in-place ASCII fallback.
    fireEvent.error(img as HTMLImageElement);

    // The <img> is gone and the ASCII card is now rendered in its place.
    expect(container.querySelector("img.crt-pixel-card-img")).toBeNull();
    expect(container.querySelector(".crt-ascii-card")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R3.4: a no-JS SSR render presents the ASCII spread in order
// ---------------------------------------------------------------------------

describe("R3.4 (no JS): the server-rendered <noscript> block holds the ASCII spread in order", () => {
  it("renders the ASCII cards inside <noscript>, one per position, in the reading's spread order", () => {
    const cards: VisualCard[] = [
      visualCard(1, "tower"),
      visualCard(2, "death"),
      visualCard(3, "star"),
    ];

    // Render to static markup the way a no-JS server response would: the
    // client-only PixelCards never hydrate, so the <noscript> ASCII spread is
    // what a no-JS reader sees.
    const html = renderToStaticMarkup(
      createElement(SpreadPixelView, {
        cards,
        manifest: fullManifest(),
        available: AVAILABLE,
        motionMode: "reduced",
      }),
    );

    // The <noscript> fallback row is present.
    expect(html).toContain("crt-spread-pixel-fallback");

    // Isolate the <noscript> block and assert the three positions appear
    // inside it, in spread order.
    const noscriptMatch = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
    expect(noscriptMatch).not.toBeNull();
    const noscript = noscriptMatch![1]!;

    const pos1 = noscript.indexOf('data-position="1"');
    const pos2 = noscript.indexOf('data-position="2"');
    const pos3 = noscript.indexOf('data-position="3"');
    expect(pos1).toBeGreaterThanOrEqual(0);
    expect(pos2).toBeGreaterThan(pos1);
    expect(pos3).toBeGreaterThan(pos2);

    // Card ids appear in the same spread order inside the fallback.
    const card1 = noscript.indexOf('data-card="tower"');
    const card2 = noscript.indexOf('data-card="death"');
    const card3 = noscript.indexOf('data-card="star"');
    expect(card1).toBeGreaterThanOrEqual(0);
    expect(card2).toBeGreaterThan(card1);
    expect(card3).toBeGreaterThan(card2);

    // The fallback uses the ASCII card view, not <img> bitmaps.
    expect(noscript).toContain("crt-ascii-card");
  });
});
