// apps/web/e2e/screenshots.e2e.ts
//
// Feature: visual-necromancy, task 22.1 — marketing screenshot capture for the
// README and the Devpost write-up. This is a CAPTURE-ONLY spec: it adds NO
// production code and alters NO Visual_Layer code. It drives the SAME offline
// demo path and mocked resurrection stream as `visual-necromancy.e2e.ts`, in
// FULL motion, and writes four deterministic PNGs into `docs/screenshots/`.
//
// Determinism: the demo path is seeded by `DEMO_SEED` (glitch + rot), so the
// Tower glitch frame and the resurrection rot are reproducible run-to-run. No
// network is touched — the demo reading loads the bundled offline chunk and the
// resurrection uses `mockRoutes` (recorded NDJSON), matching the visual spec.
//
// This spec is SKIPPED by default so the normal `pnpm --filter @necro/web e2e`
// run (and CI) is unaffected and never writes files into `docs/`. A maintainer
// or a dedicated CI job captures the images with the capture flag set:
//
//     CAPTURE_SCREENSHOTS=1 pnpm --filter @necro/web screenshots
//
// (the `screenshots` script in `apps/web/package.json` runs
// `playwright test screenshots.e2e.ts` with that flag). If Playwright cannot
// launch a browser on the host, point it at a local channel, e.g.
// `PLAYWRIGHT_CHROMIUM_CHANNEL=msedge` or `=chrome`.
//
// The four shots:
//   (1) boot logo frame — the `.crt-boot-overlay` while the NECROMANTIC
//       SYSTEMS 1986 wordmark is on screen (navigated WITHOUT `?boot=skip`),
//       captured with the virtual clock FROZEN on the logo step so the
//       otherwise ~500 ms logo window is deterministic (see `bootLogoShot`);
//   (2) a full 3-card reading — after `demo lich-py2` / `read fates`, with the
//       reveal completed via Escape, showing the framed ASCII cards;
//   (3) THE TOWER glitch frame — the burning Tower card element in full motion;
//   (4) the resurrection diff — after `resurrect`, once the rot overlay reaches
//       `data-rot="done"` and the unchanged diff is in the log.
//
// Arcana_Visions (task 25) adds four MORE deterministic frames for the
// pixel-art Visual_Layer, each in its OWN test so fake and real clocks never
// mix within a single test (the same isolation the boot-logo shot above uses):
//   (5) the Spread_View with Pixel_Cards — after `demo lich-py2` / `read fates`
//       the terminal renders the integer-scaled pixel spread (`.crt-spread-pixel`)
//       because the `apps/web` Arcana manifest is present; captured on a
//       normally-clocked page (no clock needed — the spread is a static layout);
//   (6) a Fullscreen_Card_View — click a `.crt-pixel-card` (a `role="dialog"`
//       opener) and wait for the `.crt-fullscreen-card` modal, then screenshot it;
//       also normally-clocked;
//   (7) the Resurrection_Ritual open-book frame — navigate with `?ritual=force`
//       (task 20's flag) so the Necronomicon ritual plays even under a Playwright
//       run, with the virtual clock FROZEN on the `crossfade` step (the open book
//       fading in over the closed one) via `page.clock.pauseAt`, mirroring how
//       `bootLogoShot` freezes on the logo step so an otherwise ~600 ms window is
//       deterministic;
//   (8) the landing with the Seer_Image — the Seer mounts only while
//       `state.boot.phase === "playing"` (Terminal.tsx renders
//       `.crt-seer-region[data-boot-seer="playing"]` with `.crt-seer-portrait`
//       during boot), so this reuses the boot-logo freeze technique: navigate
//       WITHOUT `?boot=skip` and PAUSE the clock mid-boot so the boot phase holds
//       "playing" and the Seer stays on screen for a stable capture.
//
// _Requirements: 9.1, 9.3, 13.7_

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  bootLogoShot,
  bootTerminal,
  mockRoutes,
  runCommand,
  sel,
} from "./support/terminal.js";

// Only run when a maintainer/CI explicitly asks to capture. The normal e2e gate
// stays fast and never writes into the repo's `docs/` tree.
const CAPTURE = Boolean(process.env.CAPTURE_SCREENSHOTS);

// `docs/screenshots/` relative to this file: apps/web/e2e → repo root/docs.
const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "docs",
  "screenshots",
);

/** Resolve a PNG path inside `docs/screenshots/`. */
function shot(name: string): string {
  return join(OUT_DIR, `${name}.png`);
}

/** Per-position decorative card slots (aria-hidden). */
const cardSlots = (page: Page): Locator => page.locator(".crt-card-slot");
/** Every rendered ASCII card element. */
const asciiCards = (page: Page): Locator => page.locator(".crt-ascii-card");
/** Every rendered pixel-art diagnosis card in the live Spread_View. */
const pixelCards = (page: Page): Locator =>
  page.locator(".crt-spread-pixel-region .crt-pixel-card");

/**
 * The virtual-clock instant (ms from the ritual's first frame) at which to
 * FREEZE for the Necronomicon open-book shot. The ritual phases are
 * `closed-glitch` 600 ms → `tremble` 300 ms → `crossfade` 600 ms →
 * `rising-diff`, so the `crossfade` window (the open book fading in over the
 * closed one) is `[~900, ~1500) ms`. 1200 ms sits mid-crossfade with enough
 * margin that the ±60 ms seed jitter in `ritualTimeline` never pushes the frozen
 * instant out of the window. See `ritual-timeline.ts` for the phase budget.
 */
const RITUAL_CROSSFADE_FREEZE_MS = 1200;

/**
 * The virtual-clock instant (ms) at which to FREEZE the boot so its phase holds
 * `"playing"` and the Seer_Image stays mounted for the landing shot. Mirrors
 * `BOOT_LOGO_FREEZE_MS` (2200 ms) — comfortably inside the ~3.4 s boot, before
 * it settles to the ready prompt, so `state.boot.phase === "playing"` and the
 * `.crt-seer-region[data-boot-seer="playing"]` is on screen.
 */
const SEER_BOOT_FREEZE_MS = 2200;

test.describe("marketing screenshots (demo mode, full motion) — R9.1, R9.3", () => {
  // Capture-only: skipped unless CAPTURE_SCREENSHOTS is set. This keeps the
  // default e2e suite fast and side-effect free (no writes into docs/).
  test.skip(
    !CAPTURE,
    "capture-only: set CAPTURE_SCREENSHOTS=1 to write docs/screenshots PNGs",
  );

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  // --- (1) Boot logo frame ----------------------------------------------
  // Its OWN test on a fresh page with the virtual clock installed and FROZEN on
  // the logo step. The logo is step 4 of 7 in a ~500 ms/step schedule, so in a
  // live rAF-driven boot it is on screen for only ~500 ms — too narrow for a
  // plain `toBeVisible()` poll to catch reliably. `bootLogoShot` installs
  // Playwright's fake clock before navigating and pauses it mid-logo-window, so
  // the overlay holds the logo frame indefinitely and the capture is
  // deterministic. Isolating it in its own test keeps fake and real time from
  // ever mixing within a single test: shots 2-4 run on a separate,
  // normally-clocked page (next test), where the reveal/rot FramePort ticks
  // advance in real time exactly as in production.
  test("captures the boot logo frame (clock frozen on the logo step)", async ({
    page,
  }) => {
    // `bootLogoShot` freezes the clock on the logo step and asserts the logo
    // overlay + wordmark are on screen; capture the whole CRT screen so the
    // shot frames the big ASCII logo centred over the boot overlay.
    await bootLogoShot(page);
    await page.screenshot({ path: shot("01-boot-logo"), animations: "allow" });
  });

  test("captures 3-card reading, Tower glitch, and resurrection diff", async ({
    page,
  }) => {
    // Land on the ready prompt in full motion without waiting out the boot, so
    // this test runs on a normally-clocked page: navigate WITHOUT `?boot=skip`
    // and let the real-time boot resolve to the focused Command_Line.
    await page.goto("/");
    await expect(sel.log(page)).toContainText("NECRO-ORACLE");
    await expect(page.locator(".crt-boot-overlay")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(sel.input(page)).toBeFocused();

    // --- (2) Full 3-card reading ----------------------------------------
    // Offline demo chunk (no route mocks). `lich-py2` fates draws three cards
    // and includes THE TOWER. Complete the one-by-one reveal with Escape so all
    // framed ASCII cards are up for the shot.
    await runCommand(page, "demo lich-py2");
    await runCommand(page, "read fates");
    await expect(cardSlots(page)).toHaveCount(3);

    await sel.input(page).focus();
    await page.keyboard.press("Escape");
    await expect
      .poll(async () =>
        cardSlots(page).evaluateAll((slots) =>
          slots.every((s) => (s as HTMLElement).dataset.flipped === "true"),
        ),
      )
      .toBe(true);
    await expect(asciiCards(page)).toHaveCount(3);
    await page.screenshot({
      path: shot("02-three-card-reading"),
      animations: "allow",
    });

    // --- (3) THE TOWER glitch frame -------------------------------------
    // The burning Tower card carries the glitch class and `data-burning` in
    // full motion. Capture the card element itself for a tight glitch shot.
    const tower = page.locator('.crt-ascii-card[data-card="tower"]');
    await expect(tower).toHaveCount(1);
    await expect(tower).toHaveClass(/\bcrt-glitch\b/);
    await expect(tower).toHaveAttribute("data-burning", "true");
    await tower.screenshot({ path: shot("03-tower-glitch"), animations: "allow" });

    // --- (4) Resurrection diff (after rot-and-rebirth) ------------------
    // The resurrection path needs the mocked NDJSON stream. Install the mocks,
    // bring a live reading into scope, then resurrect. Once the rot overlay
    // reaches `data-rot="done"` and the diff is in the log, capture the screen.
    const calls = await mockRoutes(page);
    await runCommand(page, "summon graveyard/green-garden");
    const log = sel.log(page);
    await expect(log).toContainText("graveyard/green-garden");
    await runCommand(page, "read necropsy");
    await expect(log).toContainText("THE STAR");

    await runCommand(page, "resurrect");
    await expect(page.locator('.crt-rot-overlay[data-rot="done"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(log).toContainText("FILE src/legacy.py");
    await expect(log).toContainText("VITALITY 40/100 -> 55/100 (+15)");

    // The previous capture framed only the revived line + vitality: the diff
    // block is below the fold (the log auto-scrolls past it and the rot overlay
    // sits above), so the PNG never actually showed the diff. Scroll the
    // per-file diff block into view, then assert the `-`/`+` diff lines AND the
    // now phosphor-styled DOWNLOAD PATCH button are visible, so the shot frames
    // the whole diff + button rather than a cropped tail of the log.
    const diffBlock = page
      .locator("section.crt-block")
      .filter({ hasText: "FILE src/legacy.py" });
    await expect(diffBlock).toBeVisible();
    await diffBlock.scrollIntoViewIfNeeded();
    // The removed / added Python-2→3 diff lines from RESURRECT_RESULT.
    await expect(diffBlock).toContainText('- print "hello"');
    await expect(diffBlock).toContainText('+ print("hello")');

    // The styled CRT phosphor DOWNLOAD PATCH button (task 23.5) is present and
    // visible for the capture — it carries the `.crt-patch-download` class that
    // the new crt.css rule styles.
    const downloadButton = page.getByRole("button", {
      name: "DOWNLOAD PATCH",
      exact: true,
    });
    await expect(downloadButton).toBeVisible();
    await expect(downloadButton).toHaveClass(/\bcrt-patch-download\b/);
    await downloadButton.scrollIntoViewIfNeeded();

    // Full page so the whole diff block and the button are framed together.
    await page.screenshot({
      path: shot("04-resurrection-diff"),
      fullPage: true,
      animations: "allow",
    });

    expect(calls.resurrect).toBeGreaterThanOrEqual(1);
  });

  // --- (5) Spread_View with Pixel_Cards --------------------------------
  // Its OWN test on a normally-clocked page. The `apps/web` Terminal_Route
  // supplies the Arcana manifest, so a completed reading renders the pixel-art
  // `SpreadPixelView` (`.crt-spread-pixel-region` → `.crt-spread-pixel` with a
  // `.crt-pixel-card` per drawn card) rather than the Spec 05 ASCII reveal. A
  // `fates` reading draws exactly three cards, so three pixel-card slots appear
  // in spread order. No clock control is needed: the pixel spread is a static
  // integer-scaled layout, deterministic from the demo reading alone.
  test("captures the pixel-art Spread_View (3-card fates pixel spread)", async ({
    page,
  }) => {
    await bootTerminal(page);
    await runCommand(page, "demo lich-py2");
    await runCommand(page, "read fates");

    // The pixel spread renders with exactly three Pixel_Cards (fates = 3).
    const spread = page.locator(".crt-spread-pixel-region .crt-spread-pixel");
    await expect(spread).toBeVisible();
    await expect(pixelCards(page)).toHaveCount(3);
    // Wait for each card's pixel image to be attached so the shot frames the
    // art, not an empty slot (the three spread cards load eagerly, R11.1).
    await expect(page.locator(".crt-pixel-card-img")).toHaveCount(3);

    await page.screenshot({
      path: shot("05-pixel-spread"),
      animations: "allow",
    });
  });

  // --- (6) Fullscreen_Card_View ----------------------------------------
  // Its OWN test on a normally-clocked page. After the pixel spread renders,
  // clicking a `.crt-pixel-card` (wired to open the Fullscreen_Card_View) opens
  // the `role="dialog"` modal (`.crt-fullscreen-card`), which shows the single
  // large Pixel_Card. Capture the dialog once it is visible.
  test("captures the Fullscreen_Card_View (one card opened full screen)", async ({
    page,
  }) => {
    await bootTerminal(page);
    await runCommand(page, "demo lich-py2");
    await runCommand(page, "read fates");
    await expect(pixelCards(page)).toHaveCount(3);

    // Open the first card's fullscreen inspector by clicking it (the card root
    // is a role="button"; a click activates it exactly like Enter/Space).
    await pixelCards(page).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass(/\bcrt-fullscreen-card\b/);
    // The large card image inside the modal is up before the capture.
    await expect(dialog.locator(".crt-pixel-card-img")).toBeVisible();

    await page.screenshot({
      path: shot("06-fullscreen-card"),
      animations: "allow",
    });
  });

  // --- (7) Resurrection_Ritual open-book frame -------------------------
  // Its OWN test with the virtual clock installed and FROZEN on the `crossfade`
  // step. The ritual's four phases (`closed-glitch` 600 ms → `tremble` 300 ms →
  // `crossfade` 600 ms → `rising-diff`) are driven through the FramePort, i.e.
  // `requestAnimationFrame` + `performance.now` — both controlled by
  // `page.clock`. `ritualTimeline` normally SKIPS the ritual under a Playwright
  // run, so we navigate with `?ritual=force` (task 20) to force the full ritual;
  // `?boot=skip` lands us on the ready prompt without waiting out the boot while
  // the force flag overrides the skip gate.
  //
  // Determinism: the clock is installed at time 0 BEFORE navigation (so the very
  // first rAF reads virtual time), the offline flow brings a reading into scope
  // and fires `resurrect`, then `pauseAt(RITUAL_CROSSFADE_FREEZE_MS)` fast-
  // forwards virtual time — firing the ritual's rAF ticks up to that instant and
  // then holding. The ritual anchors its timeline to its first rAF (≈ time 0
  // under the paused clock), so freezing at 1200 ms lands squarely inside the
  // crossfade window `[~900, ~1500) ms` (phase 3; the ±60 ms seed jitter keeps
  // it comfortably mid-window), holding `data-ritual="crossfade"` with the open
  // Necronomicon frame fading in. Isolating this in its own test keeps the fake
  // clock from ever touching the normally-clocked shots above.
  test("captures the Necronomicon open-book frame (clock frozen on crossfade)", async ({
    page,
  }) => {
    // Fake timers must be installed BEFORE any script runs so the ritual's first
    // rAF already reads virtual time. Origin at epoch 0 (pauseAt only moves the
    // clock forward from here).
    await page.clock.install({ time: 0 });
    await mockRoutes(page);

    // Land on the ready prompt with the ritual forced to play even under the
    // Playwright run (?ritual=force overrides the ?boot=skip skip gate).
    await page.goto("/?boot=skip&ritual=force");
    await expect(sel.log(page)).toContainText("NECRO-ORACLE");
    await expect(sel.input(page)).toBeFocused();

    // Bring a live reading into scope, then resurrect. The mocked NDJSON stream
    // resolves via promises (not clock timers), so the ritual mounts without the
    // clock advancing.
    await runCommand(page, "summon graveyard/green-garden");
    const log = sel.log(page);
    await expect(log).toContainText("graveyard/green-garden");
    await runCommand(page, "read necropsy");
    await expect(log).toContainText("THE STAR");
    await runCommand(page, "resurrect");

    // The ritual wrapper is mounted (the Necronomicon frames are layered).
    const ritual = page.locator('.crt-ritual[data-ritual]');
    await expect(ritual).toBeVisible();

    // Fast-forward the virtual clock to mid-crossfade and HOLD it there, so the
    // open book is fading in over the closed one and the frame is stable.
    await page.clock.pauseAt(RITUAL_CROSSFADE_FREEZE_MS);
    await expect(
      page.locator('.crt-ritual[data-ritual="crossfade"]'),
    ).toBeVisible();

    await page.screenshot({
      path: shot("07-necronomicon-open"),
      animations: "allow",
    });
  });

  // --- (8) Landing with the Seer_Image ---------------------------------
  // Its OWN test with the virtual clock installed and FROZEN mid-boot. The Seer
  // renders only while `state.boot.phase === "playing"` (Terminal.tsx mounts
  // `.crt-seer-region[data-boot-seer="playing"]` holding the `.crt-seer-portrait`
  // during the boot). In a live rAF-driven boot that window passes in a few
  // seconds; freezing the clock mid-boot (same technique as `bootLogoShot`)
  // holds the boot in "playing" indefinitely so the Seer stays on screen for a
  // deterministic capture. Navigate WITHOUT `?boot=skip` so the boot actually
  // plays (a skipped boot never enters "playing" and never shows the Seer).
  test("captures the landing with the Seer image (clock frozen mid-boot)", async ({
    page,
  }) => {
    await page.clock.install({ time: 0 });
    await page.goto("/");
    // Hold the boot mid-sequence (same freeze point the logo shot uses), well
    // before the boot settles, so the boot phase stays "playing" and the Seer
    // region is mounted.
    await page.clock.pauseAt(SEER_BOOT_FREEZE_MS);

    const seerRegion = page.locator('.crt-seer-region[data-boot-seer="playing"]');
    await expect(seerRegion).toBeVisible();
    // The Seer portrait (and its pixel image) is mounted inside the region.
    await expect(seerRegion.locator(".crt-seer-portrait")).toBeVisible();
    await expect(seerRegion.locator("img.crt-seer-img")).toBeVisible();

    await page.screenshot({
      path: shot("08-seer-landing"),
      animations: "allow",
    });
  });
});
