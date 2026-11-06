// Unit tests for the arcana manifest loader (Arcana_Visions, task 3.2).
//
// Validates: Requirements 1.6
//
// These example tests pin the trusted view `loadManifest` distils from the
// committed asset manifest: it keeps only `id`, `logical` and `bands`, tolerates
// but discards all generator bookkeeping (png/webp/preview paths, byte counts,
// box, dither, workspace paths, header_frac/footer_frac, note), and throws a
// typed `NecroError` on an invalid shape. The suite exercises both small
// hand-built fixtures (for the error and passthrough cases) and the real
// manifest JSON read as data from `apps/web/public/arcana/manifest.json`, so the
// 12 diagnosis ids, the two 256×144 landscape assets and the closed book are
// asserted end to end against what actually ships.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { NecroError } from "@necro/oracle/client";
import { describe, expect, it } from "vitest";

import {
  DIAGNOSIS_CARD_IDS,
  loadManifest,
  type ArcanaAsset,
} from "./manifest.js";

/**
 * The real committed manifest, read as plain data (never imported as a module,
 * so the ui-crt type graph stays inside `src`). It lives six directory hops up
 * from this file, under the web app's public assets.
 */
const REAL_MANIFEST: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../../apps/web/public/arcana/manifest.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
);

/** The keys a trusted `ArcanaAsset` is allowed to carry — nothing else. */
const TRUSTED_KEYS = ["id", "logical", "bands"] as const;

describe("loadManifest (R1.6): distils the trusted arcana view", () => {
  it("yields a ReadonlyMap keyed by id with the right logical sizes and bands", () => {
    const raw = {
      images: [
        {
          id: "judgement",
          logical: [120, 160],
          bands: { header_rows: [0, 19], footer_rows: [147, 160] },
        },
        {
          id: "seer",
          logical: [256, 144],
          bands: null,
        },
      ],
    };

    const map = loadManifest(raw);

    expect(map.size).toBe(2);
    expect(map.get("judgement")).toEqual<ArcanaAsset>({
      id: "judgement",
      logical: { w: 120, h: 160 },
      bands: { header: [0, 19], footer: [147, 160] },
    });
    expect(map.get("seer")).toEqual<ArcanaAsset>({
      id: "seer",
      logical: { w: 256, h: 144 },
      bands: null,
    });
  });

  it("tolerates but discards generator bookkeeping fields", () => {
    const raw = {
      // ignored top-level bookkeeping
      variant: "final",
      dither: "none",
      card_logical: [120, 160],
      images: [
        {
          id: "tower",
          logical: [120, 160],
          // ignored per-image bookkeeping
          png: "/workspace/necro-cards/pixel/final/tower.png",
          png_bytes: 2607,
          webp: "/workspace/necro-cards/pixel/final/tower.webp",
          webp_bytes: 1456,
          preview_4x: "/workspace/necro-cards/pixel/final/tower@4x.png",
          box: [0, 0, 120, 160],
          dither: false,
          bands: {
            // ignored per-band bookkeeping
            width: 120,
            height: 160,
            header_rows: [0, 19],
            footer_rows: [147, 160],
            header_frac: 0.12,
            footer_frac: 0.08,
            note: "Header/footer blanked to bg.",
          },
        },
      ],
    };

    const asset = loadManifest(raw).get("tower");

    expect(asset).toEqual<ArcanaAsset>({
      id: "tower",
      logical: { w: 120, h: 160 },
      bands: { header: [0, 19], footer: [147, 160] },
    });
    // The trusted asset carries ONLY id/logical/bands — no png/webp/box/dither/
    // note/header_frac/workspace paths leak onto it.
    expect(Object.keys(asset as object).sort()).toEqual(
      [...TRUSTED_KEYS].sort(),
    );
    expect(asset).not.toHaveProperty("png");
    expect(asset).not.toHaveProperty("webp");
    expect(asset).not.toHaveProperty("preview_4x");
    expect(asset).not.toHaveProperty("box");
    expect(asset).not.toHaveProperty("dither");
    // And the bands subobject carries only header/footer — no width/height/
    // *_frac/note.
    expect(Object.keys(asset!.bands as object).sort()).toEqual(
      ["footer", "header"],
    );
    expect(asset!.bands).not.toHaveProperty("note");
    expect(asset!.bands).not.toHaveProperty("header_frac");
    expect(asset!.bands).not.toHaveProperty("width");
  });

  it("throws a typed NecroError on an invalid shape", () => {
    // `images` missing entirely.
    expect(() => loadManifest({})).toThrow(NecroError);

    // `images` present but empty (schema requires >= 1).
    expect(() => loadManifest({ images: [] })).toThrow(NecroError);

    // An image with a non-positive / wrong-arity logical size.
    const badLogical = {
      images: [{ id: "tower", logical: [0, 160], bands: null }],
    };
    expect(() => loadManifest(badLogical)).toThrow(NecroError);

    // An image missing its id.
    const noId = {
      images: [{ logical: [120, 160], bands: null }],
    };
    expect(() => loadManifest(noId)).toThrow(NecroError);

    // Non-object input.
    expect(() => loadManifest(null)).toThrow(NecroError);
    expect(() => loadManifest("not a manifest")).toThrow(NecroError);
  });

  it("surfaces a VALIDATION_FAILED code with an oracle-voice message, not the raw issue", () => {
    try {
      loadManifest({ images: [] });
      expect.unreachable("loadManifest should have thrown on an empty manifest");
    } catch (err) {
      expect(err).toBeInstanceOf(NecroError);
      const necro = err as NecroError;
      expect(necro.code).toBe("VALIDATION_FAILED");
      expect(necro.userMessage).toBe(
        "The grimoire's index is corrupted; the arcana cannot be summoned.",
      );
      // The thrown error keeps the zod issue as its cause for debugging, but the
      // user-facing message does not leak it.
      expect(necro.cause).toBeDefined();
    }
  });
});

describe("loadManifest (R1.6): the real committed manifest", () => {
  const map = loadManifest(REAL_MANIFEST);

  it("resolves every one of the 12 diagnosis ids to 120×160 with header [0,19] / footer [147,160]", () => {
    expect(DIAGNOSIS_CARD_IDS).toHaveLength(12);
    for (const id of DIAGNOSIS_CARD_IDS) {
      const asset = map.get(id);
      expect(asset, `diagnosis card "${id}" is missing from the manifest`).toBeDefined();
      expect(asset).toEqual<ArcanaAsset>({
        id,
        logical: { w: 120, h: 160 },
        bands: { header: [0, 19], footer: [147, 160] },
      });
    }
  });

  it("resolves seer and necronomicon-open to 256×144 landscape with no bands", () => {
    for (const id of ["seer", "necronomicon-open"] as const) {
      expect(map.get(id)).toEqual<ArcanaAsset>({
        id,
        logical: { w: 256, h: 144 },
        bands: null,
      });
    }
  });

  it("resolves necronomicon-closed to 108×144 with no bands", () => {
    expect(map.get("necronomicon-closed")).toEqual<ArcanaAsset>({
      id: "necronomicon-closed",
      logical: { w: 108, h: 144 },
      bands: null,
    });
  });

  it("keeps only trusted keys on every real asset (no bookkeeping leaks)", () => {
    for (const asset of map.values()) {
      expect(Object.keys(asset).sort()).toEqual([...TRUSTED_KEYS].sort());
    }
  });
});
