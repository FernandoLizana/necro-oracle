// @vitest-environment jsdom
//
// Landing Seer-visibility tests (oracle-landing-polish, task 9.3 — Part B bug 1).
//
// Validates: Requirements R8.1, R8.2, R8.4
//
// Part B, bug 1: before this spec the Seer (the oracle's face) was mounted ONLY
// in the boot/seer region of `<Terminal>`, under the branch
// `seerAsset !== undefined && state.boot.phase === "playing"` (grounding fact
// G1). The common idle screen is `boot.phase === "done"` (and `?boot=skip`
// starts `done`), so the Seer was never visible on the landing where the
// mockups show it. The fix (tasks 8.3 / 9.2) mounts the reused `SeerPortrait`
// inside the landing's `PreviewWindow` whenever the landing is visible and the
// manifest carries the `seer` asset — independent of the boot phase.
//
// This file pins that fix with three example tests:
//
//   1. R8.1 / R8.4 — the Seer IS present on the idle landing AFTER boot is done.
//      `Landing` is rendered directly in a booted-idle (`?boot=skip`-equivalent)
//      state with a manifest carrying the `seer` asset; the Seer portrait
//      (`.crt-seer-portrait` → `img.crt-seer-img`) must be in the DOM. THIS is
//      the assertion that was RED on the pre-fix code (the Seer only showed
//      during boot "playing") and is GREEN now.
//
//   2. R8.2 — the boot-time Seer still renders (no regression). The full
//      `<Terminal>` is rendered with the `seer` manifest in full motion so the
//      boot settles to `phase === "playing"`; the boot-region Seer
//      (`[data-boot-seer="playing"]` wrapping a `SeerPortrait`) must still mount.
//
//   3. R8.4 (fallback parity, R6.6) — with a manifest LACKING the `seer` asset
//      the idle landing shows the Seer TEXT fallback, never a broken image.
//
// These are pure presentational tests: no ports touch the network/LLM/sandbox.
// The `seer` `ArcanaAsset` is resolved through the real `loadManifest` boundary
// from a small fixture mirroring the committed manifest's trusted fields
// (`id`/`logical`/`bands`) — honest sizing, not a hand-built literal.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { loadManifest } from "../arcana/manifest.js";
import { bootedIdleState } from "../testing/arbitraries.js";
import { landingVisible } from "../landing/landing-model.js";
import { makeFakePorts } from "../testing/fake-ports.js";
import { Landing } from "./Landing.js";
import { Terminal } from "./Terminal.js";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Manifest fixtures (mirror the trusted fields of the committed manifest)
// ---------------------------------------------------------------------------
//
// Only `id`, `logical` and `bands` are read by `loadManifest`; everything else
// is tolerated-and-ignored generator bookkeeping. The seer is a 256×144
// landscape asset with no text bands — exactly the committed
// `apps/web/public/arcana/manifest.json` seer entry. The committed `moon` asset
// (120×160, header/footer bands) backs the preview card backs; including it
// keeps the manifest realistic though the Seer is what these tests assert.

const MANIFEST_WITH_SEER = loadManifest({
  images: [
    { id: "seer", logical: [256, 144], bands: null },
    {
      id: "moon",
      logical: [120, 160],
      bands: { header_rows: [0, 19], footer_rows: [147, 160] },
    },
  ],
} as const);

/** A manifest that deliberately LACKS the seer asset (card back only). */
const MANIFEST_WITHOUT_SEER = loadManifest({
  images: [
    {
      id: "moon",
      logical: [120, 160],
      bands: { header_rows: [0, 19], footer_rows: [147, 160] },
    },
  ],
} as const);

/** The available preview area, large enough for an integer scale >= 1. */
const PREVIEW_AREA = { w: 1024, h: 576 } as const;

/** No-op submit/focus stubs: the landing is a screen only (no side effects). */
const NOOP_SUBMIT = (): void => {};
const NOOP_FOCUS = (): void => {};
const NOOP_SUMMON_READ = (): void => {};

// ---------------------------------------------------------------------------
// R8.1 / R8.4 — the Seer is present on the idle landing AFTER boot is done.
//
// This is the assertion that FAILED on the pre-fix code: the boot-region Seer
// branch requires `boot.phase === "playing"`, but the booted idle state is
// `"done"`, so no Seer was mounted anywhere on the idle screen. Mounting the
// Seer in the landing's PreviewWindow (the fix) makes it present here.
// ---------------------------------------------------------------------------

describe("Landing Seer on the idle landing (R8.1, R8.4 — Part B bug 1 fix)", () => {
  it("renders the Seer portrait on the booted-idle landing (boot.phase done, ?boot=skip-equivalent)", () => {
    const state = bootedIdleState();

    // Precondition: this is exactly the landing-visible idle screen — boot is
    // DONE (not "playing"), the landing is not dismissed, the log holds only
    // the boot banner, and there is no summary. On the pre-fix code there was
    // no Seer anywhere in this state (G1).
    expect(state.boot.phase).toBe("done");
    expect(landingVisible(state)).toBe(true);

    const { container } = render(
      <Landing
        state={state}
        manifest={MANIFEST_WITH_SEER}
        motionMode="full"
        available={PREVIEW_AREA}
        submit={NOOP_SUBMIT}
        onSummonAndRead={NOOP_SUMMON_READ}
        focusInput={NOOP_FOCUS}
      />,
    );

    // The Seer IS in the DOM: the reused SeerPortrait mounts its pixelated
    // `<img>` inside the `.crt-seer-portrait` region. (Pre-fix: RED — absent.)
    const portrait = container.querySelector(".crt-seer-portrait");
    expect(portrait).not.toBeNull();
    expect(portrait?.getAttribute("data-asset")).toBe("seer");

    const img = container.querySelector<HTMLImageElement>("img.crt-seer-img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/arcana/seer.webp");
    expect(img?.style.imageRendering).toBe("pixelated");
  });

  it("returns null (no Seer, no landing) once the landing is dismissed", () => {
    // Guard: the landing — and therefore its Seer — is gated by
    // `landingVisible`. A dismissed state renders nothing, so the Seer in the
    // preview never leaks onto a populated screen.
    const dismissed = { ...bootedIdleState(), landingDismissed: true };
    expect(landingVisible(dismissed)).toBe(false);

    const { container } = render(
      <Landing
        state={dismissed}
        manifest={MANIFEST_WITH_SEER}
        motionMode="full"
        available={PREVIEW_AREA}
        submit={NOOP_SUBMIT}
        onSummonAndRead={NOOP_SUMMON_READ}
        focusInput={NOOP_FOCUS}
      />,
    );

    expect(container.querySelector(".crt-landing")).toBeNull();
    expect(container.querySelector(".crt-seer-portrait")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R8.2 — the boot-time Seer still renders (no regression).
//
// The landing fix must NOT disturb the Spec 05 / Arcana_Visions boot-region
// Seer. With a seer manifest in full motion the boot starts `phase: "playing"`,
// so the `[data-boot-seer="playing"]` region still mounts a `SeerPortrait`.
// ---------------------------------------------------------------------------

describe("Boot-time Seer still renders (R8.2 — no regression)", () => {
  it("mounts the boot-region Seer while boot.phase is playing", () => {
    // Full motion (stored `necro.motion: on`), not reduced, no bootSignal → the
    // reducer starts `boot.phase: "playing"`, which is the one branch that
    // mounts the boot-region Seer (G1). The Terminal is driven by the standard
    // in-memory fakes used by the other Terminal component tests.
    const fakes = makeFakePorts({ storage: { "necro.motion": "on" } });

    const { container } = render(
      <Terminal ports={fakes.ports} manifest={MANIFEST_WITH_SEER} />,
    );

    // The boot-region branch is still present and still wraps a SeerPortrait.
    const bootSeerRegion = container.querySelector(
      '[data-boot-seer="playing"]',
    );
    expect(bootSeerRegion).not.toBeNull();

    const bootPortrait =
      bootSeerRegion?.querySelector(".crt-seer-portrait") ?? null;
    expect(bootPortrait).not.toBeNull();
    expect(bootPortrait?.getAttribute("data-asset")).toBe("seer");
    expect(
      bootSeerRegion?.querySelector("img.crt-seer-img"),
    ).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R8.4 / R6.6 — missing seer asset degrades to the TEXT fallback, not a broken
// image (fallback parity).
// ---------------------------------------------------------------------------

describe("Idle landing without a seer asset degrades to text (R8.4, R6.6)", () => {
  it("shows the Seer text fallback and no image when the manifest lacks the seer asset", () => {
    const state = bootedIdleState();
    expect(landingVisible(state)).toBe(true);

    const { container } = render(
      <Landing
        state={state}
        manifest={MANIFEST_WITHOUT_SEER}
        motionMode="full"
        available={PREVIEW_AREA}
        submit={NOOP_SUBMIT}
        onSummonAndRead={NOOP_SUMMON_READ}
        focusInput={NOOP_FOCUS}
      />,
    );

    // No Seer image / portrait (the manifest has no seer asset).
    expect(container.querySelector(".crt-seer-portrait")).toBeNull();
    expect(container.querySelector("img.crt-seer-img")).toBeNull();

    // The plain phosphor text fallback stands in — never a broken image.
    const fallback = container.querySelector(".crt-landing-seer-fallback");
    expect(fallback).not.toBeNull();
    expect(screen.getByText("THE SEER")).toBeTruthy();
  });
});
