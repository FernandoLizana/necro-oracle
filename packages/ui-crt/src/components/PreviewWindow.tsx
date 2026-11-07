// src/components/PreviewWindow.tsx
//
// Feature: oracle-landing-polish, task 8.3.
//
// The screen-only DMG PREVIEW window of the Landing_State (design §"Component:
// PreviewWindow"). It renders three fixed pieces:
//
//   1. The pixel Seer — the oracle's face — reusing the Arcana_Visions
//      `SeerPortrait` component VERBATIM. The Seer is shown here WHENEVER the
//      landing is visible (`model.showSeer` is true and the manifest-backed
//      `seerAsset` is defined), INDEPENDENT of the boot phase. This is the
//      Part B bug-1 fix (R8.1): the Spec 05 boot-region Seer only mounted
//      while `boot.phase === "playing"`, so the idle screen never showed it;
//      mounting it in the preview restores the oracle's face on the idle
//      landing where the mockups show it. When the manifest lacks the seer
//      asset (`showSeer` false, or `seerAsset` undefined), the preview degrades
//      to a plain phosphor TEXT fallback — never a broken-image indicator
//      (R6.6).
//
//   2. Three face-down Card_Backs. The sigil motif is an EYE / MOON crescent —
//      explicitly NEVER a pentagram (product + tarot-ux rule, R6.3, R12.1,
//      R12.2). The back reuses the committed `moon` arcana asset (a crescent
//      moon in the strict 4-shade Asset_Palette) as the eye/moon sigil, so no
//      new off-palette art enters the build. Each back is an `<img>` that is
//      integer-scaled and `image-rendering: pixelated` via `landing.css`
//      (R11.1, R11.2, R11.3) — this component adds NO `filter`. If a card-back
//      image fails to load (or the asset is absent), the `<img>` is swapped IN
//      PLACE for the `.crt-landing-cardback-fallback` plain phosphor box, with
//      the same integer footprint and no broken-image indicator (R6.7).
//
//   3. The ORACLE SAYS line — `model.oracleSays` rendered as plain DOM text
//      (`.crt-landing-oracle-says`), a single line clipped with an ellipsis by
//      the CSS, kept within the <= 72-column oracle-voice budget (R6.4, R6.5,
//      R14.1, R14.2).
//
// The Seer and the card backs are scaled by the Arcana_Visions `integerScale`
// pattern: the preview root carries the `--arcana-scale` / `--arcana-logical-*`
// custom properties the shared image rules multiply out, so every landing
// image renders at a whole-number factor of its native pixel size with the
// native aspect ratio preserved.
//
// This is a screen only: no ports, no data fetching, no clock, no network.
//
// _Requirements: R6.1, R6.2, R6.3, R6.4, R6.6, R6.7, R8.1, R8.3, R11.1, R11.2,
//  R11.3, R12.1, R12.2, R14.1, R14.2_

"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { integerScale, type Size } from "../arcana/integer-scale.js";
import type { ArcanaAsset } from "../arcana/manifest.js";
import type { PreviewModel } from "../landing/landing-model.js";
import type { MotionMode } from "../motion/motion-mode.js";
import { SeerPortrait } from "./SeerPortrait.js";

/** Props for the PREVIEW window (design §"Component: PreviewWindow"). */
export interface PreviewWindowProps {
  /** The preview view-model from `previewModel(state, selected, manifest)`. */
  readonly model: PreviewModel;
  /** The trusted `seer` asset, or `undefined` when the manifest lacks it. */
  readonly seerAsset: ArcanaAsset | undefined;
  /** The Seer image URL; defaults to the committed `/arcana/seer.webp`. */
  readonly seerSrc?: string;
  /** The available preview area the Seer / card backs are scaled to fit. */
  readonly available: Size;
  /** The effective motion mode (reserved; motion lives in `landing.css`). */
  readonly motionMode: MotionMode;
}

/** The committed Seer image URL (256×144, bands null). */
const DEFAULT_SEER_SRC = "/arcana/seer.webp";

/**
 * The eye/moon sigil asset id used for the face-down Card_Backs — the committed
 * `moon` arcana asset is a crescent-moon motif in the strict 4-shade palette.
 * This is deliberately an eye/moon sigil and NEVER a pentagram (R6.3, R12.1,
 * R12.2); the asset id is asserted by the style/a11y audit test (task 8.5).
 */
const CARD_BACK_SIGIL_ID = "moon";

/** The committed card-back (eye/moon crescent) image URL. */
const CARD_BACK_SRC = "/arcana/moon.webp";

/** The native logical pixel size of one Card_Back (matches the 120×160 deck). */
const CARD_BACK_LOGICAL: Size = { w: 120, h: 160 };

/**
 * The plain phosphor text shown in place of the Seer when the manifest lacks
 * the `seer` asset or the image fails. Oracle-voice, no broken-image glyph.
 */
const SEER_TEXT_FALLBACK = "THE SEER";

/** The accessible name for a face-down Card_Back (an eye/moon sigil). */
const CARD_BACK_ALT = "A face-down card, sealed with an eye and moon sigil.";

/**
 * One face-down Card_Back. Renders the eye/moon `moon` asset as a pixelated,
 * integer-scaled `<img>` (the scale + no-filter rules live in `landing.css`);
 * on image error it swaps IN PLACE for the `.crt-landing-cardback-fallback`
 * plain phosphor box of the same footprint, with no broken-image indicator
 * (R6.7).
 */
function CardBack(): React.JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);

  if (imageFailed) {
    return (
      <div
        className="crt-landing-cardback-fallback"
        data-sigil={CARD_BACK_SIGIL_ID}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      className="crt-landing-cardback"
      data-sigil={CARD_BACK_SIGIL_ID}
      src={CARD_BACK_SRC}
      alt={CARD_BACK_ALT}
      // Pixelated + no filter are enforced by `landing.css`; the inline hint
      // keeps the crisp rendering even before the stylesheet applies.
      style={{ imageRendering: "pixelated" }}
      onError={() => setImageFailed(true)}
    />
  );
}

/**
 * Render the DMG PREVIEW window: the pixel Seer (whenever the landing is
 * visible — the Part B bug fix), three face-down eye/moon Card_Backs, and the
 * ORACLE SAYS line.
 */
export function PreviewWindow({
  model,
  seerAsset,
  seerSrc,
  available,
}: PreviewWindowProps): React.JSX.Element {
  // Measure the preview PANEL's own box so the Seer and card backs fill it
  // (R26) WITHIN the panel's height budget (R29). The `available` prop is a
  // coarse hint; observing the panel's real rect and scaling to IT fills the
  // panel like the mockup. Crucially, `landing.css` height-bounds this panel
  // (`max-height: 42vh`, a shrinkable flex child), so the measured rect height
  // is already a bounded SHARE of the viewport — feeding that height to
  // `integerScale` is what stops the Seer from growing to fill the whole
  // viewport and pushing the rest of the landing off-screen (the R29 overshoot
  // fix). Until the first measurement (and in jsdom, where layout is
  // zero-sized) we fall back to the `available` hint so the scale is still a
  // valid integer >= 1 and the pinned test math is unchanged.
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The ORACLE SAYS line's own box (R29). The height-bounded preview stacks the
  // Seer row, the card-back row and this oracle line vertically under
  // `overflow: hidden`. If the two image rows consume the FULL panel height,
  // this line — `white-space: nowrap; overflow: hidden` — is squeezed to height
  // 0 and clipped out of the viewport, violating R29 ("the ORACLE SAYS line is
  // within the viewport"). We measure its real rendered height (and the panel's
  // inter-row `gap`) and RESERVE that space before splitting the remaining
  // height between the image rows, so the oracle line always keeps its row.
  const oracleRef = useRef<HTMLParagraphElement | null>(null);
  const [panelArea, setPanelArea] = useState<Size | null>(null);
  // The vertical space to withhold from the image budget: the ORACLE SAYS
  // line's height plus the panel's inter-row gaps. Measured in the real browser
  // alongside the panel; stays 0 in the zero-sized jsdom layout so the pinned
  // fallback math is untouched (R29).
  const [reservedHeight, setReservedHeight] = useState(0);
  useLayoutEffect(() => {
    const node = panelRef.current;
    if (node === null) return;
    const measure = (): void => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setPanelArea({ w: rect.width, h: rect.height });
      }
      // Reserve the oracle line's rendered height + the column `gap`s between
      // the stacked rows (Seer / card backs / oracle line). The preview is a
      // flex column with a uniform `gap`; with the three stacked rows there are
      // two inter-row gaps. Read the `gap` straight off the computed style so
      // the reservation tracks the `--dmg-gap` token exactly.
      const oracleRect = oracleRef.current?.getBoundingClientRect();
      const oracleH = oracleRect !== undefined ? oracleRect.height : 0;
      const gapPx = Number.parseFloat(
        getComputedStyle(node).rowGap || "0",
      );
      const gap = Number.isFinite(gapPx) ? gapPx : 0;
      const GAP_COUNT = 2; // Seer↔cardbacks and cardbacks↔oracle line.
      const reserved = oracleH + gap * GAP_COUNT;
      setReservedHeight(Number.isFinite(reserved) && reserved > 0 ? reserved : 0);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The area the images scale against. In a real browser this is the MEASURED
  // panel rect, which `landing.css` height-bounds to `max-height: 42vh` so it
  // never grows to the full Seer image and push the rest of the landing
  // off-screen (R29). Before the first measurement — and in the zero-sized
  // jsdom layout used by the unit/property tests — we fall back to the coarse
  // `available` hint so the integer scale is still a valid whole number >= 1.
  const measuredPanel = panelArea;
  const fillArea: Size = measuredPanel ?? available;

  const CARD_BACK_COUNT = 3;

  // The Seer renders whenever the landing is visible AND the manifest carries
  // the asset (R8.1). `model.showSeer` already encodes `manifest.has("seer")`;
  // `seerAsset` is the trusted entry the reused SeerPortrait scales against.
  const showSeer = model.showSeer && seerAsset !== undefined;

  // The height budget the Seer and the card-back row each get. In the browser
  // the preview panel is height-bounded (42vh), and the Seer, the card-back row
  // and the ORACLE SAYS line STACK vertically inside it — so each image group
  // must fit its OWN SHARE of the bounded panel height, not the whole panel
  // height, or the stack would overflow (and be clipped) and push card backs
  // out of view (R29.1). We split the measured panel height between the Seer
  // row and the card-back row (reserving a small slice for the oracle line and
  // the inter-row gaps), and scale each image group against its own height
  // share and the full panel width. This makes the largest integer factor that
  // fits BOTH the bounded height budget AND the width budget (minimum 1) —
  // exactly the R29.2 rule — while the images still fill the bounded panel
  // (R26 preserved). When we have NO measured panel (tests / pre-measure), we
  // fall back to the SAME formula the committed `landing-image.pbt.test.ts`
  // mirrors — `integerScale({ w: available.w / 3, h: available.h }, …)` for the
  // card backs and `integerScale(available, …)` for the Seer — so the pinned
  // scale math is unchanged on that path.
  const ROW_COUNT_FOR_SPLIT = showSeer ? 2 : 1; // Seer row + card-back row
  // The height the IMAGE rows (Seer + card backs) may share. In the browser we
  // start from the height-bounded panel (42vh) and RESERVE the ORACLE SAYS
  // line's height plus the inter-row gaps so the oracle line keeps its row and
  // stays within the viewport (R29). `imageBudget` is clamped to >= 0 so a
  // pathologically small panel never yields a negative budget; `integerScale`
  // then clamps the derived factor to its >= 1 floor (R11.1). On the
  // NO-measurement / jsdom fallback path `reservedHeight` is 0 and we use the
  // coarse `available` hint verbatim, so the pinned `landing-image.pbt.test.ts`
  // scale math is byte-identical.
  const imageBudget =
    measuredPanel !== null
      ? Math.max(0, measuredPanel.h - reservedHeight)
      : fillArea.h;
  const cardBackHeightBudget =
    measuredPanel !== null ? imageBudget / ROW_COUNT_FOR_SPLIT : fillArea.h;
  const seerHeightBudget =
    measuredPanel !== null ? imageBudget / 2 : fillArea.h;

  // The three face-down card backs sit side by side, so the panel width must
  // hold `3 × 120 × scale`. Scaling each back against a THIRD of the panel
  // width (and its height share) makes the row of three substantially fill the
  // panel width (R26.1) while the stack still fits the bounded panel height
  // (R29). The factor stays a single integer >= 1 identical on both axes, so
  // `image-rendering: pixelated` art keeps its native aspect (R26.2) — the CSS
  // applies no filter.
  const cardBackScale = integerScale(
    { w: fillArea.w / CARD_BACK_COUNT, h: cardBackHeightBudget },
    CARD_BACK_LOGICAL,
  );
  const previewStyle = {
    "--arcana-scale": String(cardBackScale),
    "--arcana-logical-w": String(CARD_BACK_LOGICAL.w),
    "--arcana-logical-h": String(CARD_BACK_LOGICAL.h),
  } as CSSProperties;

  // The area the Seer's reused `SeerPortrait` scales itself against: the full
  // panel width and the Seer's height share, so the Seer fills the preview
  // width while the whole stack stays inside the bounded panel height (R29).
  const seerArea: Size = { w: fillArea.w, h: seerHeightBudget };

  return (
    <div
      ref={panelRef}
      className="crt-landing-panel crt-landing-preview"
      style={previewStyle}
      role="group"
      aria-label="Reading preview"
    >
      {showSeer ? (
        // The REUSED Arcana_Visions SeerPortrait — same component, same
        // integer-scale pattern, same in-place text fallback. Mounting it here
        // is what makes the oracle's face visible on the idle landing (R8.1).
        <SeerPortrait
          asset={seerAsset}
          available={seerArea}
          src={seerSrc ?? DEFAULT_SEER_SRC}
          fallback={<span className="crt-landing-seer-fallback">{SEER_TEXT_FALLBACK}</span>}
        />
      ) : (
        // Manifest lacks the seer asset: plain phosphor text, NOT a broken
        // image (R6.6).
        <span className="crt-landing-seer-fallback">{SEER_TEXT_FALLBACK}</span>
      )}

      {/* Three face-down eye/moon Card_Backs (NEVER a pentagram, R6.3). */}
      <div className="crt-landing-cardbacks" aria-hidden="true">
        {Array.from({ length: model.cardBacks }, (_, i) => (
          <CardBack key={i} />
        ))}
      </div>

      {/* The ORACLE SAYS line: plain DOM text, single line, ellipsis-clipped by
          the CSS, <= 72 cols (R6.4, R14.1, R14.2). */}
      <p ref={oracleRef} className="crt-landing-oracle-says">
        {model.oracleSays}
      </p>
    </div>
  );
}
