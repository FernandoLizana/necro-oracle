// src/components/SeerPortrait.tsx
//
// Feature: 06-arcana-visions, task 16.1.
//
// Screen-only presentational view for the Seer landing portrait — the oracle's
// face shown in the boot/landing area. It renders the `seer` landscape asset
// (native 256×144 logical px, no text bands) as a single `<img>` with
// `image-rendering: pixelated` and NO colour-altering or blurring filter (the
// shared `arcana.css` `.crt-seer-img` rule guarantees `filter: none` and uses
// only the four Asset_Palette shades). The image is sized to its logical pixel
// size × an Integer_Scale computed from the available landing area through the
// `--arcana-scale` / `--arcana-logical-w` / `--arcana-logical-h` custom
// properties, so both axes scale by the same whole factor and the native 16:9
// aspect ratio is preserved with no distortion or cropping (R7.1, R7.2, R7.3).
//
// The scale comes from `integerScale(available, { w: 256, h: 144 })` — the
// largest whole factor of 1 or greater that fits the landing area; a region
// smaller than the logical size yields 1, so the Seer is always at least
// pixel-exact (R7.1).
//
// If the image fails to load, the `<img>` is swapped IN PLACE for the provided
// text-landing `fallback` with no broken-image indicator and no layout error —
// the landing simply reads as the existing text content with no Seer (R7.4).
//
// This component is a screen only: no ports, no data fetching, no clock.
//
// _Requirements: R7.1, R7.2, R7.3, R7.4_

"use client";

import { useRef, useState } from "react";

import { integerScale, type Size } from "../arcana/integer-scale.js";
import type { ArcanaAsset } from "../arcana/manifest.js";
import { useCssVars } from "../hooks/use-css-vars.js";

/** Props for the Seer landing portrait (design §"Component: SeerPortrait"). */
export interface SeerPortraitProps {
  /** The trusted `seer` asset entry from `loadManifest` (256×144, bands null). */
  readonly asset: ArcanaAsset;
  /** The available landing area the portrait is scaled to fit. */
  readonly available: Size;
  /** The Seer image URL, e.g. `/arcana/seer.webp`. */
  readonly src: string;
  /** The existing text landing content, rendered in place on image error (R7.4). */
  readonly fallback: React.ReactNode;
}

/**
 * The screen-reader name for the Seer portrait. Oracle voice, concise: it names
 * the oracle and what she does, so an assistive-technology user who cannot see
 * the pixels still meets the face of the reading (R10.1 parity).
 */
const SEER_ALT_TEXT = "The Seer, the oracle who reads your repository.";

/**
 * Render the Seer landing portrait.
 *
 * The scale is the largest whole factor by which the native 256×144 Seer fits
 * the `available` landing area, clamped to `>= 1`. The outer `.crt-seer-portrait`
 * carries the `--arcana-scale` and `--arcana-logical-w/h` custom properties the
 * shared `arcana.css` rules multiply out, so the `.crt-seer-img` box is exactly
 * logical × scale on both axes (native 16:9 preserved, no distortion/crop). On
 * image error the `<img>` is replaced in place by the text `fallback`, with no
 * broken-image indicator.
 */
export function SeerPortrait({
  asset,
  available,
  src,
  fallback,
}: SeerPortraitProps): React.JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);

  const scale = integerScale(available, asset.logical);

  const ref = useRef<HTMLDivElement | null>(null);
  // SEC-08: apply the scale/logical custom properties via the CSSOM (useCssVars)
  // instead of a CSP-blocked inline style attribute.
  useCssVars(ref, {
    "--arcana-scale": String(scale),
    "--arcana-logical-w": String(asset.logical.w),
    "--arcana-logical-h": String(asset.logical.h),
  });

  return (
    <div ref={ref} className="crt-seer-portrait" data-asset={asset.id}>
      {imageFailed ? (
        // Image unavailable: show the existing text landing, no broken-image
        // indicator, no layout error (R7.4).
        fallback
      ) : (
        <img
          className="crt-seer-img"
          src={src}
          alt={SEER_ALT_TEXT}
          onError={() => setImageFailed(true)}
        />
      )}
    </div>
  );
}
