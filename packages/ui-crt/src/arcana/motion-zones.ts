// Pure module: Motion_Zone_Table + validator for @necro/ui-crt
// (Arcana_Visions, task 4.1).
//
// Validates: Requirements R4.1, R4.2, R4.3, R4.4, R4.6, R4.8
//
// This module is pure data + pure functions: it reads no clock, DOM, network,
// randomness, or audio, and never throws. It declares the authored
// `MOTION_ZONES` table — one typed rectangle per animated card region — and the
// validator the property test (task 4.2) and the `PixelCard` runtime guard use
// to prove every zone stays inside its card, outside the Text_Bands, and within
// the Flash_Limit of at most 2 luminance changes per second (R4.5, R4.8).
//
// Decision — the `card` field type. The design types `MotionZone.card` as the
// 12-card `CardId` enum from `@necro/oracle/client`, but one authored zone keys
// off the Seer (`"seer"`), which is a landscape asset NOT a diagnosis card and
// is therefore absent from `CardId`. To key the Seer zone by its asset id
// without broadening the deck, the field is `CardId | "seer"` (the single extra
// asset id this table targets). All diagnosis-card zones still use a real
// `CardId`, so the oracle's card-id contract is unchanged for the deck.

import type { CardId } from "@necro/oracle/client";
import type { Size } from "./integer-scale.js";

/**
 * The visual character of an animated region. Each maps to a `steps()` CSS
 * animation bounded to the zone's rectangle (R4.2).
 */
export type MotionEffect = "flicker" | "shimmer" | "pulse" | "rays" | "glow";

/**
 * A rectangle in a card's logical pixels. `x`/`y` are the top-left corner,
 * `w`/`h` the extent; the covered rows span `[y, y + h]` and columns
 * `[x, x + w]`.
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * One authored Motion_Zone: a rectangle on a card (or the Seer) that animates
 * with CSS only. `periodMs` is one full animation cycle; `steps` is the number
 * of discrete `steps()` frames across that cycle. The pair is authored so
 * `luminanceChangesPerSecond` never exceeds the Flash_Limit of 2 (R4.5).
 */
export interface MotionZone {
  readonly card: CardId | "seer";
  readonly rect: Rect;
  readonly effect: MotionEffect;
  readonly periodMs: number;
  readonly steps: number;
}

/**
 * The header/footer row ranges reserved for DOM text on a card. Each is an
 * inclusive `[firstRow, lastRow]` pair; a Motion_Zone must not touch either.
 * The 120x160 diagnosis cards use header `[0, 19]` and footer `[147, 160]`.
 */
export interface Bands {
  readonly header: readonly [number, number];
  readonly footer: readonly [number, number];
}

/**
 * A reason a Motion_Zone fails validation (R4.9). The property test asserts the
 * authored table produces none of these against its card assets.
 */
export type MotionZoneIssue =
  | { readonly kind: "out-of-bounds"; readonly zone: MotionZone }
  | {
      readonly kind: "overlaps-band";
      readonly zone: MotionZone;
      readonly band: "header" | "footer";
    }
  | {
      readonly kind: "flash-limit";
      readonly zone: MotionZone;
      readonly changesPerSecond: number;
    };

// The 120x160 diagnosis-card art area lies strictly between the header band
// (rows [0, 19]) and the footer band (rows [147, 160]). Every card-zone rect
// below sits inside rows [20, 146] and columns [0, 120]. The Seer (256x144) has
// no bands, so its zones only need to stay inside [0, 256] x [0, 144].

/**
 * The authored Motion_Zone table (R4.3): `tower` flame flicker, `star` hair and
 * water shimmer, `moon` glow pulse, `hermit` lantern flicker, `judgement` light
 * rays, and `seer` candle and crystal-ball glow. Every card rect lies fully
 * within its card's logical size and fully outside the Text_Bands (R4.8), and
 * every `periodMs`/`steps` pair holds `luminanceChangesPerSecond <= 2` (R4.5).
 * Authored at `steps = 2` over a `2000 ms` period = 1.0 change/sec — half the
 * Flash_Limit — so the table passes `validateMotionZone` cleanly.
 */
export const MOTION_ZONES: readonly MotionZone[] = [
  // The Tower — flame flicker at the crown, inside the art area.
  {
    card: "tower",
    rect: { x: 40, y: 28, w: 40, h: 34 },
    effect: "flicker",
    periodMs: 2000,
    steps: 2,
  },
  // The Star — hair and poured-water shimmer across the lower-centre pool.
  {
    card: "star",
    rect: { x: 26, y: 96, w: 68, h: 44 },
    effect: "shimmer",
    periodMs: 2000,
    steps: 2,
  },
  // The Moon — glow pulse around the disc, high in the art area.
  {
    card: "moon",
    rect: { x: 36, y: 30, w: 48, h: 48 },
    effect: "pulse",
    periodMs: 2000,
    steps: 2,
  },
  // The Hermit — lantern flicker, held centre-right.
  {
    card: "hermit",
    rect: { x: 62, y: 60, w: 30, h: 40 },
    effect: "flicker",
    periodMs: 2000,
    steps: 2,
  },
  // Judgement — light rays descending through the upper art area.
  {
    card: "judgement",
    rect: { x: 24, y: 24, w: 72, h: 60 },
    effect: "rays",
    periodMs: 2000,
    steps: 2,
  },
  // The Seer (landscape 256x144) — candle and crystal-ball glow, lower centre.
  {
    card: "seer",
    rect: { x: 88, y: 64, w: 80, h: 64 },
    effect: "glow",
    periodMs: 2000,
    steps: 2,
  },
] as const;

/** The Flash_Limit: at most 2 luminance changes per second per zone (R4.5). */
const FLASH_LIMIT_CHANGES_PER_SECOND = 2;

/**
 * Luminance changes per second for a zone's animation. One `steps()` cycle moves
 * through `steps` discrete frames per `periodMs`; a conservative upper bound on
 * visible luminance changes is `steps / (periodMs / 1000)`. The Flash_Limit is
 * 2 (R4.5, R13.3).
 */
export function luminanceChangesPerSecond(z: MotionZone): number {
  return z.steps / (z.periodMs / 1000);
}

/**
 * Validate one Motion_Zone against a card's logical size and its Text_Bands
 * (R4.8, R4.9, R13.2, R13.3). Returns every issue found (possibly empty):
 *
 * - `out-of-bounds` when the rect leaves `[0, logical.w] x [0, logical.h]`;
 * - `overlaps-band` when the rect's rows intersect the header or footer band;
 * - `flash-limit` when `luminanceChangesPerSecond(z)` exceeds 2.
 *
 * Pure: no clock, DOM, or randomness.
 */
export function validateMotionZone(
  z: MotionZone,
  logical: Size,
  bands: Bands,
): MotionZoneIssue[] {
  const issues: MotionZoneIssue[] = [];
  const { x, y, w, h } = z.rect;

  // Bounds: the whole rect must lie within [0, logical.w] x [0, logical.h].
  const withinBounds =
    x >= 0 &&
    y >= 0 &&
    w >= 0 &&
    h >= 0 &&
    x + w <= logical.w &&
    y + h <= logical.h;
  if (!withinBounds) {
    issues.push({ kind: "out-of-bounds", zone: z });
  }

  // Bands: the rect's row span [y, y + h] must not touch either band's rows.
  const top = y;
  const bottom = y + h;
  const [headerFirst, headerLast] = bands.header;
  const [footerFirst, footerLast] = bands.footer;
  if (top <= headerLast && bottom >= headerFirst) {
    issues.push({ kind: "overlaps-band", zone: z, band: "header" });
  }
  if (top <= footerLast && bottom >= footerFirst) {
    issues.push({ kind: "overlaps-band", zone: z, band: "footer" });
  }

  // Flash_Limit: luminance changes per second must stay within 2.
  const changesPerSecond = luminanceChangesPerSecond(z);
  if (changesPerSecond > FLASH_LIMIT_CHANGES_PER_SECOND) {
    issues.push({ kind: "flash-limit", zone: z, changesPerSecond });
  }

  return issues;
}
