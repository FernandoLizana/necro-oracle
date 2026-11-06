// @vitest-environment jsdom
//
// SeerPortrait component behaviour tests (arcana-visions, task 16.2).
//
// Validates: Requirements R7.2, R7.3, R7.4
//
// `SeerPortrait` is the screen-only landing portrait of the oracle. It renders
// the `seer` landscape asset (native 256×144, no text bands) as a single
// pixelated `<img>` sized by an Integer_Scale, and swaps the image in place for
// a text-landing fallback when it fails to load. These are pure presentational
// tests: no ports, no clock, no network.
//
// The seer `ArcanaAsset` is resolved through the real `loadManifest` boundary
// from a small fixture mirroring the committed manifest's trusted fields
// (`id`/`logical`/`bands`) — honest sizing, not a hand-built literal. The
// `@necro/ui-crt` package may not import across to `apps/web`, so the fixture
// reproduces the committed seer entry (256×144, bands null).
//
// Behaviour asserted:
//   - Pixelated + no filter (R7.2): the `<img>` carries `image-rendering:
//     pixelated` inline and the `.crt-seer-img` class (the `filter: none`
//     no-filter guarantee lives in arcana.css, keyed off that class).
//   - Aspect preserved (R7.3): the outer `.crt-seer-portrait` sets
//     `--arcana-logical-w` = 256 and `--arcana-logical-h` = 144 and an integer
//     `--arcana-scale` >= 1, so arcana.css multiplies out to logical × scale on
//     both axes — the same whole factor on each axis preserves native 16:9.
//   - onError -> text landing (R7.4): firing the img `onError` renders the
//     provided fallback node in place, with the `<img>` gone and no
//     broken-image indicator.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { loadManifest, type ArcanaAsset } from "../arcana/manifest.js";
import type { Size } from "../arcana/integer-scale.js";
import { SeerPortrait } from "./SeerPortrait.js";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Manifest fixture (mirrors the trusted fields of the committed manifest)
// ---------------------------------------------------------------------------
//
// Only `id`, `logical` and `bands` are read by `loadManifest`; everything else
// is tolerated-and-ignored generator bookkeeping. The seer is a 256×144
// landscape asset with no text bands — exactly the committed
// `apps/web/public/arcana/manifest.json` seer entry.

const MANIFEST_FIXTURE = {
  images: [{ id: "seer", logical: [256, 144], bands: null }],
} as const;

/** The trusted seer asset, produced by the real boundary loader. */
const SEER_ASSET: ArcanaAsset = (() => {
  const asset = loadManifest(MANIFEST_FIXTURE).get("seer");
  if (asset === undefined) {
    throw new Error("fixture must contain the seer asset");
  }
  return asset;
})();

const SEER_SRC = "/arcana/seer.webp";

/** A distinctive text-landing fallback so we can see it land in place (R7.4). */
const FALLBACK_TEXT = "THE SEER IS VEILED. TYPE `read owner/repo` TO BEGIN.";
const FALLBACK = <p data-testid="text-landing">{FALLBACK_TEXT}</p>;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function renderSeer(available: Size): {
  readonly portrait: () => HTMLElement | null;
  readonly img: () => HTMLImageElement | null;
} {
  const { container } = render(
    <SeerPortrait
      asset={SEER_ASSET}
      available={available}
      src={SEER_SRC}
      fallback={FALLBACK}
    />,
  );
  return {
    portrait: () =>
      container.querySelector<HTMLElement>(".crt-seer-portrait"),
    img: () => container.querySelector<HTMLImageElement>("img.crt-seer-img"),
  };
}

// ---------------------------------------------------------------------------
// Pixelated + no filter (R7.2)
// ---------------------------------------------------------------------------

describe("SeerPortrait pixelated + no filter (R7.2)", () => {
  it("renders a single img carrying .crt-seer-img and inline image-rendering: pixelated", () => {
    const { img } = renderSeer({ w: 1024, h: 768 });

    const el = img();
    expect(el).not.toBeNull();
    // The no-filter guarantee lives in arcana.css keyed off this class, so the
    // class presence is what wires the img to `filter: none` (R7.2).
    expect(el).toHaveClass("crt-seer-img");
    // Pixelated is set inline on the img (R7.2).
    expect(el?.style.imageRendering).toBe("pixelated");
  });
});

// ---------------------------------------------------------------------------
// Aspect preserved (R7.3)
// ---------------------------------------------------------------------------

describe("SeerPortrait aspect preserved (R7.3)", () => {
  it("sets logical 256x144 and an integer scale >= 1 so both axes share one factor (16:9)", () => {
    // A region many times the logical size; the scale is a whole factor >= 1.
    const { portrait } = renderSeer({ w: 1024, h: 576 });

    const el = portrait();
    expect(el).not.toBeNull();

    // The component pins the native logical size the arcana.css width/height
    // calc multiplies out (R7.3).
    expect(el?.style.getPropertyValue("--arcana-logical-w")).toBe("256");
    expect(el?.style.getPropertyValue("--arcana-logical-h")).toBe("144");

    // The scale is a single whole factor >= 1. Because arcana.css computes
    // width = logical-w * scale and height = logical-h * scale with the SAME
    // scale, both axes scale by one factor and the native 16:9 is preserved
    // with no distortion.
    const scaleText = el?.style.getPropertyValue("--arcana-scale") ?? "";
    const scale = Number(scaleText);
    expect(Number.isInteger(scale)).toBe(true);
    expect(scale).toBeGreaterThanOrEqual(1);
    // 1024/256 = 4, 576/144 = 4 -> the largest whole factor that fits is 4.
    expect(scale).toBe(4);
  });

  it("clamps to scale 1 when the region is smaller than the logical size (R7.3/R1.4)", () => {
    const { portrait } = renderSeer({ w: 100, h: 100 });
    const el = portrait();
    expect(el?.style.getPropertyValue("--arcana-logical-w")).toBe("256");
    expect(el?.style.getPropertyValue("--arcana-logical-h")).toBe("144");
    expect(Number(el?.style.getPropertyValue("--arcana-scale"))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// onError -> text landing, no broken-image indicator (R7.4)
// ---------------------------------------------------------------------------

describe("SeerPortrait image error -> text landing (R7.4)", () => {
  it("replaces the img in place with the text landing fallback and shows no broken image", () => {
    const { img, portrait } = renderSeer({ w: 1024, h: 768 });

    // Before the error: the img is present and the fallback is not.
    const el = img();
    expect(el).not.toBeNull();
    expect(screen.queryByTestId("text-landing")).toBeNull();

    // The seer image fails to load.
    fireEvent.error(el as HTMLImageElement);

    // The text landing now renders in place, inside the same portrait region.
    const landing = screen.getByTestId("text-landing");
    expect(landing).toHaveTextContent(FALLBACK_TEXT);
    expect(portrait()?.contains(landing)).toBe(true);

    // The <img> is gone — no broken-image element remains anywhere.
    expect(img()).toBeNull();
    expect(portrait()?.querySelector("img")).toBeNull();
  });
});
