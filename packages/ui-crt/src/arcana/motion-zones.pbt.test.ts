// Feature: arcana-visions, task 4.2 — Motion_Zone table + validator properties.
//
// Validates: Requirements R4.5, R4.8, R13.2, R13.3
//
// Two authored properties pin the Motion_Zone_Table against its card assets:
//
//   P4 (R4.8, R13.2): every entry in `MOTION_ZONES` lies fully within its card's
//     logical size and fully outside the Text_Bands — `validateMotionZone`
//     returns neither an `out-of-bounds` nor an `overlaps-band` issue for any
//     authored zone against its own card asset.
//
//   P5 (R4.5, R13.3): every entry stays within the Flash_Limit —
//     `luminanceChangesPerSecond(zone) <= 2` for all zones, and
//     `validateMotionZone` returns no `flash-limit` issue.
//
// Honest sizing. Each zone's card logical size and Text_Bands are NOT hard-coded
// here; they are resolved through the real `loadManifest` boundary loader from a
// fixture that mirrors the trusted fields (`id`, `logical`, `bands`) of the
// committed manifest (`apps/web/public/arcana/manifest.json`): the 12 diagnosis
// cards are 120×160 with header `[0, 19]` / footer `[147, 160]`, and the Seer is
// a 256×144 landscape asset with `bands: null`. The `@necro/ui-crt` package may
// not import across to `apps/web`, so the fixture reproduces exactly those
// values and flows them through `loadManifest`, keeping the test honest about
// how sizes and bands are derived at runtime.
//
// Bandless assets (the Seer). The manifest declares `bands: null` for the Seer,
// but `validateMotionZone` takes a non-null `Bands`. For a bandless asset we
// pass a zero-overlap sentinel: a header band entirely above row 0 and a footer
// band entirely below the card, so no in-bounds rect can ever intersect either.
// This matches how `PixelCard` validates a bandless asset at runtime — a Seer
// zone is only ever constrained by its bounds and the Flash_Limit, never by
// bands. For the diagnosis cards the real header/footer ranges are used.
//
// The property generators both enumerate the authored `MOTION_ZONES` and fuzz
// additional in-bounds and out-of-bounds rectangles, so `validateMotionZone` is
// exercised in both directions (clean and issue-raising) rather than only on the
// authored, passing table.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { loadManifest, type ArcanaAsset } from "./manifest.js";
import {
  MOTION_ZONES,
  luminanceChangesPerSecond,
  validateMotionZone,
  type Bands,
  type MotionZone,
  type Rect,
} from "./motion-zones.js";

// ── Manifest fixture (mirrors the trusted fields of the committed manifest) ──
//
// Only `id`, `logical` and `bands` are read by `loadManifest`; everything else
// is tolerated-and-ignored generator bookkeeping, so the fixture carries just
// the trusted subset. Diagnosis cards: 120×160, header [0,19], footer [147,160].
// Seer: 256×144 landscape, bands null. These values equal the committed
// `apps/web/public/arcana/manifest.json`.

const DIAGNOSIS_BANDS = {
  width: 120,
  height: 160,
  header_rows: [0, 19],
  footer_rows: [147, 160],
} as const;

function diagnosisImage(id: string) {
  return { id, logical: [120, 160], bands: DIAGNOSIS_BANDS } as const;
}

const MANIFEST_FIXTURE = {
  images: [
    // The six cards the Motion_Zone_Table animates.
    diagnosisImage("tower"),
    diagnosisImage("star"),
    diagnosisImage("moon"),
    diagnosisImage("hermit"),
    diagnosisImage("judgement"),
    // The Seer: a 256×144 landscape asset with no text bands.
    { id: "seer", logical: [256, 144], bands: null },
  ],
} as const;

/** The trusted `id -> ArcanaAsset` map, produced by the real boundary loader. */
const ASSETS: ReadonlyMap<string, ArcanaAsset> = loadManifest(MANIFEST_FIXTURE);

/**
 * Resolve the logical size and effective validator `Bands` for a zone's card.
 *
 * For an asset with real bands (the diagnosis cards) the manifest bands are used
 * verbatim. For a bandless asset (the Seer, `bands: null`) a zero-overlap
 * sentinel is returned — a header band entirely above the card (`[-2, -1]`) and
 * a footer band entirely below it (`[h + 1, h + 2]`) — so no in-bounds rect can
 * intersect either, exactly as `PixelCard` treats a bandless asset at runtime.
 */
function resolveCard(zone: MotionZone): { logical: ArcanaAsset["logical"]; bands: Bands } {
  const asset = ASSETS.get(zone.card);
  if (asset === undefined) {
    throw new Error(`motion-zone fixture is missing an asset for "${zone.card}"`);
  }
  const bands = effectiveBands(asset);
  return { logical: asset.logical, bands };
}

/** The validator `Bands` for an asset: real bands, or a zero-overlap sentinel. */
function effectiveBands(asset: ArcanaAsset): Bands {
  const real = asset.bands;
  if (real !== null) {
    return { header: real.header, footer: real.footer };
  }
  // Bandless asset: sentinel bands that cannot overlap any in-bounds rect.
  return {
    header: [-2, -1],
    footer: [asset.logical.h + 1, asset.logical.h + 2],
  };
}

// ── P4: zones inside the card and outside the Text_Bands ─────────────────────

describe("P4 (R4.8, R13.2): every Motion_Zone lies within its card and outside Text_Bands", () => {
  it("every authored MOTION_ZONES entry resolves to a known card asset", () => {
    // Guards the fixture: a zone keyed to an asset the fixture omits would make
    // the property below silently skip that zone, so assert coverage up front.
    for (const zone of MOTION_ZONES) {
      expect(ASSETS.has(zone.card), `fixture has an asset for "${zone.card}"`).toBe(
        true,
      );
    }
  });

  it("raises no out-of-bounds or overlaps-band issue for any table entry", () => {
    // Finite domain (6 zones): constantFrom lets fast-check report a concrete
    // zone as the counterexample, and 1000 runs cover the table many times over.
    fc.assert(
      fc.property(fc.constantFrom(...MOTION_ZONES), (zone) => {
        const { logical, bands } = resolveCard(zone);
        const issues = validateMotionZone(zone, logical, bands);
        const kinds = issues.map((i) => i.kind);
        expect(kinds).not.toContain("out-of-bounds");
        expect(kinds).not.toContain("overlaps-band");
      }),
      { numRuns: 1000 },
    );
  });

  it("flags a rect that leaves the card bounds as out-of-bounds (validator exercised the other way)", () => {
    // Fuzz a rect that provably escapes the card on at least one axis, so the
    // validator must report `out-of-bounds`. Anchored to the diagnosis card
    // size (120×160) with real bands; the escaping extent guarantees the breach
    // regardless of where the band rows fall.
    const DIAGNOSIS = ASSETS.get("tower");
    if (DIAGNOSIS === undefined) throw new Error("fixture missing 'tower'");
    const { logical } = DIAGNOSIS;
    const bands = effectiveBands(DIAGNOSIS);

    fc.assert(
      fc.property(
        fc.record({
          x: fc.integer({ min: 0, max: logical.w }),
          y: fc.integer({ min: 0, max: logical.h }),
          overW: fc.integer({ min: 1, max: 500 }),
          overH: fc.integer({ min: 1, max: 500 }),
          axis: fc.constantFrom<"w" | "h">("w", "h"),
        }),
        ({ x, y, overW, overH, axis }) => {
          // Make the rect overflow on the chosen axis: its far edge exceeds the
          // card by `over*` pixels. The other extent is kept harmless (0).
          const rect: Rect =
            axis === "w"
              ? { x, y, w: logical.w - x + overW, h: 0 }
              : { x, y, w: 0, h: logical.h - y + overH };
          const zone: MotionZone = {
            card: "tower",
            rect,
            effect: "flicker",
            periodMs: 2000,
            steps: 2,
          };
          const kinds = validateMotionZone(zone, logical, bands).map((i) => i.kind);
          expect(kinds).toContain("out-of-bounds");
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("flags a rect overlapping the header band as overlaps-band (validator exercised the other way)", () => {
    // A rect whose rows sit inside the header band [0, 19] of a diagnosis card
    // must raise `overlaps-band` for the header. Width is kept in-bounds so the
    // only issue in play is the band overlap.
    const DIAGNOSIS = ASSETS.get("star");
    if (DIAGNOSIS === undefined) throw new Error("fixture missing 'star'");
    const { logical } = DIAGNOSIS;
    const bands = effectiveBands(DIAGNOSIS);
    const [headerFirst, headerLast] = bands.header;

    fc.assert(
      fc.property(
        fc.record({
          x: fc.integer({ min: 0, max: logical.w }),
          y: fc.integer({ min: headerFirst, max: headerLast }),
        }),
        ({ x, y }) => {
          const rect: Rect = { x, y, w: Math.max(0, logical.w - x), h: 0 };
          const zone: MotionZone = {
            card: "star",
            rect,
            effect: "shimmer",
            periodMs: 2000,
            steps: 2,
          };
          const issues = validateMotionZone(zone, logical, bands);
          const headerOverlap = issues.some(
            (i) => i.kind === "overlaps-band" && i.band === "header",
          );
          expect(headerOverlap).toBe(true);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

// ── P5: zones stay within the Flash_Limit ────────────────────────────────────

describe("P5 (R4.5, R13.3): every Motion_Zone stays within the Flash_Limit", () => {
  it("keeps luminanceChangesPerSecond within 2 and raises no flash-limit issue for any table entry", () => {
    fc.assert(
      fc.property(fc.constantFrom(...MOTION_ZONES), (zone) => {
        const changes = luminanceChangesPerSecond(zone);
        expect(changes).toBeLessThanOrEqual(2);

        const { logical, bands } = resolveCard(zone);
        const kinds = validateMotionZone(zone, logical, bands).map((i) => i.kind);
        expect(kinds).not.toContain("flash-limit");
      }),
      { numRuns: 1000 },
    );
  });

  it("flags a zone that exceeds the Flash_Limit as flash-limit (validator exercised the other way)", () => {
    // Fuzz a (steps, periodMs) pair whose rate strictly exceeds 2 changes/sec,
    // so the validator must report `flash-limit`. The rect is kept trivially
    // valid (in-bounds, outside bands) so the only possible issue is the rate.
    const SEER = ASSETS.get("seer");
    if (SEER === undefined) throw new Error("fixture missing 'seer'");
    const { logical } = SEER;
    const bands = effectiveBands(SEER);

    fc.assert(
      fc.property(
        fc.record({
          steps: fc.integer({ min: 3, max: 50 }),
          periodMs: fc.integer({ min: 100, max: 1000 }),
        }),
        ({ steps, periodMs }) => {
          // Guarantee rate > 2: steps/(periodMs/1000) = steps*1000/periodMs.
          fc.pre((steps * 1000) / periodMs > 2);
          const zone: MotionZone = {
            card: "seer",
            rect: { x: 0, y: 0, w: 0, h: 0 },
            effect: "glow",
            periodMs,
            steps,
          };
          const issues = validateMotionZone(zone, logical, bands);
          const flagged = issues.some((i) => i.kind === "flash-limit");
          expect(flagged).toBe(true);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
