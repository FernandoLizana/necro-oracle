// src/components/PixelCard.tsx
//
// Feature: 06-arcana-visions, task 12.1.
//
// Screen-only presentational view for one pixel-art diagnosis card. It renders
// the strict 4-shade WebP bitmap as a single `<img>` with
// `image-rendering: pixelated` and NO colour-altering or blurring filter (the
// `arcana.css` `.crt-pixel-card-img` rule guarantees `filter: none`), sized to
// its logical pixel size × an Integer_Scale passed through the `--arcana-scale`
// custom property so both axes scale by the same whole factor and the native
// aspect ratio is preserved (R1.1, R1.2, R1.5, R7.3). The screen-reader name is
// the model's alt text (R10.1).
//
// The surrounding chrome is phosphor DOM text, drawn in the CRT tokens by the
// `arcana.css` band/caption classes: the header band (logical rows [0,19])
// carries `numeral + title`, the footer band (logical rows [147,160]) carries
// `POSITION · ORIENTATION`, and the Diagnosis_Caption renders directly BELOW the
// image, outside the bands (R1.6, R1.7). At scale 1 the band text clips to an
// ellipsis via the stylesheet (R1.8) — this component only applies the classes.
//
// The severity glitch REUSES the Spec 05 contract exactly as `AsciiCardView`
// does: in `full` motion AND only when the severity actually glitches
// (`glitchProfile(severity).intensity > 0`) a `.crt-glitch` wrapper carries
// `data-glitch-intensity` and the same `--glitch-offset/tears/corrupt/duration`
// custom properties, so the existing `.crt[data-motion="full"]
// .crt-glitch[data-glitch-intensity="N"]` one-shot (≤ 300 ms,
// `animation-iteration-count: 1`) applies and settles to a clean resting state.
// A severity-0 card or reduced motion carries NO glitch attributes, so it is
// steady from first paint (R5.1–R5.6). `data-burning="true"` marks the amber
// tower/devil exactly as `AsciiCardView` does. `data-motion` is NOT set here —
// it comes from the `.crt` root already set by `Screen`.
//
// Reversed cards set `data-orientation="reversed"` so `arcana.css` rotates the
// IMAGE 180° while the band/caption text, living in the unrotated DOM flow,
// stays upright (R2.9).
//
// The `<img>` carries the caller's `loading` strategy (R11.1): the three
// visible Spread_View cards load `"eager"` on the first render, while every
// other pixel card — off-screen imagery and the Fullscreen view's card when it
// is not open — defaults to `"lazy"` so its bitmap is deferred until it scrolls
// into view. The prop defaults to `"lazy"` so a card is deferred unless a parent
// explicitly marks it visible.
//
// On image load failure the `<img>` is swapped IN PLACE for the Spec 05
// `AsciiCardView` fallback, with no broken-image indicator (R1.9, R3.3).
//
// Motion zones: for each `MOTION_ZONES` entry matching `model.card`, the zone is
// validated against the asset's logical size and bands. A valid zone in full
// motion renders an absolutely-positioned `.crt-motion-zone` overlay whose
// `--zone-x/y/w/h` custom properties place it within the rect; an invalid zone
// is OMITTED (rendered static) and a dev-time `console.warn` names it — never a
// user-visible terminal message (R4.1, R4.2, R4.6, R4.7, R4.9). In reduced
// motion all zones render static (no overlay animation).
//
// This component is a screen only: no ports, no data fetching, no clock.
//
// _Requirements: R1.1, R1.5, R1.6, R1.7, R1.8, R1.9, R2.9, R4.1, R4.2, R4.6,
//  R4.7, R4.9, R5.1, R5.2, R5.3, R5.4, R5.5, R5.6, R10.1, R10.2, R11.1_

"use client";

import {
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import type { ArcanaAsset } from "../arcana/manifest.js";
import {
  MOTION_ZONES,
  validateMotionZone,
  type Bands,
  type MotionZone,
} from "../arcana/motion-zones.js";
import type { PixelCardModel } from "../arcana/pixel-card-model.js";
import { glitchProfile, type GlitchParams } from "../motion/glitch.js";
import type { MotionMode } from "../motion/motion-mode.js";
import type { AsciiCard } from "../render/ascii-card.js";
import { AsciiCardView, GLITCH_CLASS } from "./AsciiCardView.js";

/** The CardIds that burn amber (`data-burning`) — identical to `AsciiCardView`. */
const BURNING_CARDS = new Set(["tower", "devil"]);

/** Props for one rendered pixel diagnosis card (design §"Component: PixelCard"). */
export interface PixelCardProps {
  /** The display model: numeral/title, position label, orientation, severity, caption, alt. */
  readonly model: PixelCardModel;
  /** The trusted asset entry from `loadManifest` (logical size + text bands). */
  readonly asset: ArcanaAsset;
  /** The Integer_Scale for this slot, from `integerScale(available, logical)`. */
  readonly scale: number;
  /** The effective motion mode; `reduced` suppresses glitch and zone animation. */
  readonly motionMode: MotionMode;
  /** The card image URL, e.g. `/arcana/<id>.webp`. */
  readonly src: string;
  /**
   * The browser image-loading strategy for this card's `<img>` (R11.1). The
   * three visible Spread_View cards pass `"eager"` so they load on the first
   * render; every other pixel card (off-screen imagery, the Fullscreen view
   * when closed) defaults to `"lazy"` so its bitmap is deferred until it enters
   * the viewport. Defaults to `"lazy"`.
   */
  readonly loading?: "eager" | "lazy";
  /** Optional activation handler (open fullscreen on click / Enter). */
  readonly onActivate?: () => void;
  /** The Spec 05 ASCII card rendered in place on image error / no image (R1.9, R3.3). */
  readonly asciiFallback: AsciiCard;
}

/**
 * The CSS custom properties the Spec 05 glitch animation reads, derived from
 * `GlitchParams`. Attached only in full motion — identical to the set
 * `AsciiCardView` applies so both ride the same `crt-glitch-kf` contract.
 */
function glitchStyle(glitch: GlitchParams): CSSProperties {
  return {
    "--glitch-offset": `${glitch.offsetPx}px`,
    "--glitch-tears": String(glitch.tearCount),
    "--glitch-corrupt": String(glitch.corruptChars),
    "--glitch-duration": `${glitch.durationMs}ms`,
  } as CSSProperties;
}

/**
 * The inline custom properties that size one Motion_Zone overlay from its rect.
 * `arcana.css` multiplies each by `--arcana-scale` to place the overlay exactly
 * over the animated region of the scaled image (R4.2, R4.6).
 */
function zoneStyle(zone: MotionZone): CSSProperties {
  return {
    "--zone-x": String(zone.rect.x),
    "--zone-y": String(zone.rect.y),
    "--zone-w": String(zone.rect.w),
    "--zone-h": String(zone.rect.h),
  } as CSSProperties;
}

/** A card with no text bands cannot host zones against bands; treat as empty. */
const NO_BANDS: Bands = { header: [0, 0], footer: [0, 0] };

/**
 * Resolve the Motion_Zone overlays to render for this card. Each `MOTION_ZONES`
 * entry matching `model.card` is validated against the asset's logical size and
 * bands; a zone with no issues renders an animated overlay, a zone with any
 * issue is omitted (rendered static) and named in a dev-time `console.warn`
 * (R4.9). In reduced motion no overlay animates, so no zones are collected here
 * at all — the stylesheet's reduced-motion block keeps everything static (R4.7).
 */
function resolveZones(
  model: PixelCardModel,
  asset: ArcanaAsset,
  motionMode: MotionMode,
): readonly MotionZone[] {
  if (motionMode !== "full") return [];
  const bands: Bands = asset.bands ?? NO_BANDS;
  const valid: MotionZone[] = [];
  for (const zone of MOTION_ZONES) {
    if (zone.card !== model.card) continue;
    const issues = validateMotionZone(zone, asset.logical, bands);
    if (issues.length === 0) {
      valid.push(zone);
      continue;
    }
    // Dev-time only, never a user-visible terminal message (R4.9).
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[arcana] motion zone omitted for card "${zone.card}" (${zone.effect}): ` +
          issues.map((i) => i.kind).join(", "),
      );
    }
  }
  return valid;
}

/**
 * Render one pixel diagnosis card.
 *
 * The outer `.crt-pixel-card` carries `data-orientation` (so CSS flips a
 * reversed image while the text stays upright), `data-burning` for tower/devil,
 * `--arcana-scale`, and, when glitching, the `.crt-glitch` class plus
 * `data-glitch-intensity` and the glitch custom properties. On image error the
 * `<img>` is replaced in place by `AsciiCardView` with no broken-image marker.
 */
export function PixelCard({
  model,
  asset,
  scale,
  motionMode,
  src,
  loading = "lazy",
  onActivate,
  asciiFallback,
}: PixelCardProps): React.JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);

  const glitch = glitchProfile(model.severity);
  // Same gate `AsciiCardView` uses: full motion AND a severity that glitches.
  const glitching = motionMode === "full" && glitch.intensity > 0;
  const burning = BURNING_CARDS.has(model.card);

  const classes = ["crt-pixel-card"];
  if (glitching) classes.push(GLITCH_CLASS);

  const cardStyle = {
    "--arcana-scale": String(scale),
    "--arcana-logical-w": String(asset.logical.w),
    "--arcana-logical-h": String(asset.logical.h),
    ...(glitching ? glitchStyle(glitch) : {}),
  } as CSSProperties;

  const zones = resolveZones(model, asset, motionMode);

  // When activatable (the Spread_View wires `onActivate` to open the
  // Fullscreen_Card_View), the card root becomes a keyboard-reachable button:
  // `role="button"` + `tabIndex=0` put it in the tab order with the Spec 05
  // `:focus-visible` ring, and Enter / Space activate it just like a click
  // (R2.1, R2.2, R10.3, R10.5). Its accessible name is the model's alt text.
  // Without `onActivate` the card is the inert decorative view (no role/tab).
  const onKeyDown = onActivate
    ? (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate();
        }
      }
    : undefined;

  return (
    <div
      className={classes.join(" ")}
      data-card={model.card}
      data-orientation={model.orientation}
      style={cardStyle}
      {...(burning ? { "data-burning": "true" } : {})}
      {...(glitching ? { "data-glitch-intensity": String(glitch.intensity) } : {})}
      {...(onActivate
        ? {
            onClick: onActivate,
            onKeyDown,
            role: "button",
            tabIndex: 0,
            "aria-label": model.altText,
          }
        : {})}
    >
      {/* Header band [0,19]: numeral + title as phosphor DOM text (R1.6). */}
      <div className="crt-pixel-band" data-band="header">
        <span className="crt-pixel-numeral">{model.numeral}</span>
        <span className="crt-pixel-title">{model.title}</span>
      </div>

      {imageFailed ? (
        // Image error: swap the <img> in place for the ASCII card, no broken
        // image indicator (R1.9, R3.3). The fallback rides the same glitch
        // profile and motion mode so the card's severity feel is preserved.
        <AsciiCardView
          card={asciiFallback}
          glitch={glitch}
          motionMode={motionMode}
        />
      ) : (
        <img
          className="crt-pixel-card-img"
          src={src}
          alt={model.altText}
          loading={loading}
          style={{ imageRendering: "pixelated" }}
          onError={() => setImageFailed(true)}
        />
      )}

      {/* Motion zones: valid zones (full motion) only; invalid ones omitted. */}
      {zones.map((zone, index) => (
        <span
          key={`${zone.card}-${zone.effect}-${index}`}
          className="crt-motion-zone"
          data-effect={zone.effect}
          aria-hidden="true"
          style={zoneStyle(zone)}
        />
      ))}

      {/* Footer band [147,160]: POSITION · ORIENTATION as phosphor DOM text (R1.6). */}
      <div className="crt-pixel-band" data-band="footer">
        <span className="crt-pixel-position">
          {`${model.positionLabel} · ${model.orientation.toUpperCase()}`}
        </span>
      </div>

      {/* Diagnosis_Caption: directly below the image, outside the bands (R1.7). */}
      <p className="crt-pixel-caption">{model.caption}</p>
    </div>
  );
}
