// Pure module: arcana manifest loader for @necro/ui-crt (Arcana_Visions, task 3.1).
//
// Validates: Requirements 1.6, 3.1
//
// The committed asset manifest (`apps/web/public/arcana/manifest.json`) carries
// generator bookkeeping — absolute workspace png/webp/preview paths, byte
// counts, dither flags, per-band fractions and authoring notes — that the app
// must never trust or read. This module validates the manifest at the boundary
// with zod and distils it down to the only fields Arcana_Visions relies on: the
// asset `id`, its `logical` pixel size, and the optional header/footer text
// `bands`. Everything else is tolerated (`.passthrough()`) but discarded.
//
// The loader is a total, pure function over already-imported static data: it
// reads no clock, DOM, network or audio. On an invalid manifest shape it throws
// a typed `NecroError` carrying an oracle-voice `userMessage`, as every boundary
// in the codebase does.

import { CardIdSchema, NecroError, type CardId } from "@necro/oracle/client";
import { z } from "zod";

import type { Size } from "./integer-scale.js";

// ── zod schemas (boundary validation) ───────────────────────────────────────

/**
 * The header/footer text bands of a card, as declared by the manifest. Each is
 * an inclusive-start/exclusive-end pair of pixel rows (e.g. header `[0, 19]`,
 * footer `[147, 160]`). Landscape assets (seer, open Necronomicon) declare
 * `null` — they carry no text bands. Extra keys the generator writes
 * (`width`, `height`, `header_frac`, `footer_frac`, `note`, …) are tolerated
 * but ignored.
 */
export const ManifestBandsSchema = z
  .object({
    header_rows: z.tuple([z.number().int(), z.number().int()]),
    footer_rows: z.tuple([z.number().int(), z.number().int()]),
  })
  .passthrough()
  .nullable();

/**
 * One manifest image entry. Only `id`, `logical` and `bands` are read; the
 * `.passthrough()` tolerates but IGNORES the generator's `png`/`webp`/`preview`
 * paths, byte counts, `box`, `dither` and any other workspace fields.
 */
export const ManifestImageSchema = z
  .object({
    id: z.string().min(1),
    logical: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    bands: ManifestBandsSchema,
  })
  .passthrough();

/** The manifest root: a non-empty `images` array plus ignored top-level fields. */
export const ManifestSchema = z
  .object({
    images: z.array(ManifestImageSchema).min(1),
  })
  .passthrough();

/** A single validated image entry (the trusted subset plus tolerated extras). */
export type ManifestImage = z.infer<typeof ManifestImageSchema>;

// ── Trusted view the app consumes ────────────────────────────────────────────

/**
 * The resolved, trusted view of one arcana asset. `id` is the asset id (the 12
 * diagnosis `CardId`s, or the `seer`/`necronomicon-*` extras); `logical` is the
 * native pixel size an integer scale is applied to; `bands` is the header/footer
 * text-band row ranges, or `null` for landscape assets with no bands.
 */
export interface ArcanaAsset {
  readonly id: string;
  readonly logical: Size;
  readonly bands: {
    readonly header: readonly [number, number];
    readonly footer: readonly [number, number];
  } | null;
}

/**
 * The 12 major-arcana diagnosis card ids, in deck order. Every one of these
 * must be present in the manifest as a 120×160 asset with header/footer bands.
 * Derived from the oracle `CardIdSchema` enum so the order and membership stay
 * pinned to the deck registry, never drifting from it.
 */
export const DIAGNOSIS_CARD_IDS: readonly CardId[] = CardIdSchema.options;

// ── Loader (boundary) ────────────────────────────────────────────────────────

/**
 * The oracle-voice message surfaced when the manifest cannot be trusted. It
 * names the ritual failure without leaking the raw zod issue to the user.
 */
const INVALID_MANIFEST_MESSAGE =
  "The grimoire's index is corrupted; the arcana cannot be summoned.";

/**
 * Parse already-imported manifest JSON into a trusted `id -> ArcanaAsset` map.
 *
 * Validates `raw` with zod at the boundary and keeps only the id, logical size
 * and bands of each image; all generator bookkeeping is discarded. Throws a
 * typed `NecroError` (`VALIDATION_FAILED`) with an oracle-voice `userMessage`
 * when the shape is invalid. Pure: no clock, DOM, network or audio.
 */
export function loadManifest(raw: unknown): ReadonlyMap<string, ArcanaAsset> {
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new NecroError("VALIDATION_FAILED", INVALID_MANIFEST_MESSAGE, parsed.error);
  }

  const assets = new Map<string, ArcanaAsset>();
  for (const image of parsed.data.images) {
    const [w, h] = image.logical;
    const bands = image.bands
      ? {
          header: [image.bands.header_rows[0], image.bands.header_rows[1]] as const,
          footer: [image.bands.footer_rows[0], image.bands.footer_rows[1]] as const,
        }
      : null;
    assets.set(image.id, { id: image.id, logical: { w, h }, bands });
  }

  return assets;
}
