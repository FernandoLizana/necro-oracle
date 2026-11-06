// src/components/SpreadPixelView.tsx
//
// Feature: 06-arcana-visions, task 13.1.
//
// Screen-only presentational view for a pixel-art tarot spread. It lays a
// left-to-right `.crt-spread-pixel` row of `PixelCard`s in the reading's EXACT
// spread order — one slot per drawn `VisualCard`, none reordered, duplicated or
// omitted — so a fates reading renders exactly three slots (R3.1, R3.5). The
// card order is authoritative: `cards` is already produced in spread order by
// the Spec 05 `visualCards` selector (void positions stripped, order preserved),
// and this view maps it straight through without sorting or de-duplicating.
//
// Each slot sizes itself independently: the available region is divided evenly
// across the slots and that per-slot width drives `integerScale(perSlot,
// logical)`, so every card scales by its own whole factor that fits its slot on
// both axes while preserving the native aspect ratio (R3.2). An empty spread or
// a missing manifest entry for a slot yields no card for that slot rather than a
// broken render.
//
// Per-slot image failure falls back to the ASCII card in that same slot: each
// `PixelCard` is handed its `asciiFallback` (built here with the Spec 05
// `asciiCard` renderer, exactly as `CardReveal` does — the same VisualCard →
// AsciiCard path), and `PixelCard`'s own `onError` swaps the `<img>` for
// `AsciiCardView` in place, with no broken-image indicator (R3.3).
//
// No-JS / progressive enhancement (R3.4): `PixelCard` is a client component, so
// without JavaScript it never hydrates and paints nothing. To guarantee a no-JS
// reader still sees the ASCII spread in order, this view also emits the ASCII
// card for every position inside a `<noscript>` block, in the same spread order
// — mirroring the established Spec 05 `<noscript>` fallback pattern in
// `Terminal.tsx`. A JS reader sees the pixel cards; a no-JS reader sees the
// ASCII spread. Either way the order is the reading's order.
//
// Image loading (R11.1): the cards of a rendered spread are the Spread_View's
// currently visible cards (a fates reading is exactly three, all on screen at
// once), so every `PixelCard` here is handed `loading="eager"` — its bitmap
// loads on the first render rather than being deferred. Every OTHER pixel
// surface (the Fullscreen view's card while it is closed, any off-screen
// imagery) keeps `PixelCard`'s `"lazy"` default, so only the visible spread
// images load eagerly.
//
// This component is a screen only: no ports, no data fetching, no clock, no
// unseeded randomness. The ASCII fallback renderer (`asciiCard`) is pure.
//
// _Requirements: R3.1, R3.2, R3.3, R3.4, R3.5, R11.1_

"use client";

import { useMemo } from "react";

import type { ArcanaAsset } from "../arcana/manifest.js";
import { integerScale, type Size } from "../arcana/integer-scale.js";
import { pixelCardModel } from "../arcana/pixel-card-model.js";
import { glitchProfile } from "../motion/glitch.js";
import type { MotionMode } from "../motion/motion-mode.js";
import { asciiCard, type CardArtTable } from "../render/ascii-card.js";
import type { VisualCard } from "../session/visual-reading.js";
import { AsciiCardView } from "./AsciiCardView.js";
import { PixelCard } from "./PixelCard.js";

/** The URL of a card's committed WebP bitmap, keyed by asset/card id. */
function cardImageSrc(id: string): string {
  return `/arcana/${id}.webp`;
}

/** Props for a rendered pixel spread (design §"Component: SpreadPixelView"). */
export interface SpreadPixelViewProps {
  /** The drawn cards in the reading's spread order — authoritative (R3.1, R3.5). */
  readonly cards: readonly VisualCard[];
  /** The trusted `id -> ArcanaAsset` map from `loadManifest`. */
  readonly manifest: ReadonlyMap<string, ArcanaAsset>;
  /** The measured viewport region the whole row is laid out within. */
  readonly available: Size;
  /** The effective motion mode; `reduced` suppresses glitch and zone animation. */
  readonly motionMode: MotionMode;
  /**
   * The lazily-loaded per-CardId ASCII illustration table used to build each
   * slot's `asciiFallback`. Defaults to an empty table so the first render
   * (before the art chunk resolves) draws the generic motif and this view never
   * blocks on the lazy chunk — identical to `CardReveal`'s contract (R11.4).
   */
  readonly art?: CardArtTable;
  /**
   * Activate the drawn card at `index` (its position in this spread order) —
   * the parent opens the Fullscreen_Card_View for it (R2.1, R2.2). Wired onto
   * each `PixelCard`'s `onActivate` so a mouse click OR an Enter press on the
   * focused card opens it. Omitted leaves the cards non-interactive (the Spec 05
   * decorative spread behaviour).
   */
  readonly onActivateCard?: (index: number) => void;
}

/**
 * Render a pixel-art spread: one `PixelCard` per drawn position, in the
 * reading's exact order, each at its own integer scale, with a per-slot ASCII
 * fallback, plus a `<noscript>` ASCII spread for no-JS readers.
 */
export function SpreadPixelView({
  cards,
  manifest,
  available,
  motionMode,
  art = {},
  onActivateCard,
}: SpreadPixelViewProps): React.JSX.Element {
  const slotCount = Math.max(cards.length, 1);

  // Divide the available region evenly across the slots; each slot's own
  // `integerScale` is computed against that per-slot width and the full height
  // (R3.2). This is pure arithmetic over the measured region.
  const perSlot: Size = {
    w: available.w / slotCount,
    h: available.h,
  };

  // Build one ASCII card per position, in spread order, via the same Spec 05
  // VisualCard -> AsciiCard path `CardReveal` uses. `asciiCard` is pure and
  // falls back to the generic motif for any CardId the (possibly not-yet-loaded)
  // art table lacks, so the fallback is always a complete framed card.
  const asciiCards = useMemo(
    () =>
      cards.map((card) =>
        asciiCard(card.draw.card, card.draw.orientation, art, card.label),
      ),
    [cards, art],
  );

  return (
    <div className="crt-spread-pixel">
      {cards.map((card, index) => {
        const asset = manifest.get(card.draw.card);
        const ascii = asciiCards[index]!;
        // A slot whose asset is missing from the manifest cannot be scaled or
        // framed as a pixel card; render its ASCII card in place so the slot is
        // still present and in order (R3.3, R3.4) rather than a broken image.
        if (asset === undefined) {
          return (
            <div
              key={card.position}
              className="crt-pixel-card"
              data-card={card.draw.card}
              data-position={card.position}
            >
              <AsciiCardView
                card={ascii}
                glitch={glitchProfile(card.draw.severity)}
                motionMode={motionMode}
              />
            </div>
          );
        }

        const model = pixelCardModel(card);
        const scale = integerScale(perSlot, asset.logical);

        return (
          <PixelCard
            key={card.position}
            model={model}
            asset={asset}
            scale={scale}
            motionMode={motionMode}
            src={cardImageSrc(asset.id)}
            loading="eager"
            asciiFallback={ascii}
            {...(onActivateCard
              ? { onActivate: () => onActivateCard(index) }
              : {})}
          />
        );
      })}

      {/*
        No-JS fallback (R3.4): the client-only PixelCards never hydrate without
        JavaScript, so emit the ASCII spread in the reading's order inside a
        <noscript> block — the same pattern Spec 05 uses in Terminal.tsx. A
        no-JS reader sees the ASCII spread in order; a JS reader sees the pixel
        cards above (this block renders nothing once scripts run).
      */}
      <noscript>
        <div className="crt-spread-pixel crt-spread-pixel-fallback">
          {cards.map((card, index) => (
            <div
              key={card.position}
              className="crt-pixel-card"
              data-card={card.draw.card}
              data-position={card.position}
            >
              <AsciiCardView
                card={asciiCards[index]!}
                glitch={glitchProfile(card.draw.severity)}
                motionMode={motionMode}
              />
            </div>
          ))}
        </div>
      </noscript>
    </div>
  );
}
