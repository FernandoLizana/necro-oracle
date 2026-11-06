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
// _Requirements: 9.1, 9.3_

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  bootLogoShot,
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
});
