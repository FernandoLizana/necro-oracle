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
//       SYSTEMS 1986 wordmark is on screen (navigated WITHOUT `?boot=skip`);
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

test.describe("marketing screenshots (demo mode, full motion) — R9.1, R9.3", () => {
  // Capture-only: skipped unless CAPTURE_SCREENSHOTS is set. This keeps the
  // default e2e suite fast and side-effect free (no writes into docs/).
  test.skip(
    !CAPTURE,
    "capture-only: set CAPTURE_SCREENSHOTS=1 to write docs/screenshots PNGs",
  );

  // One browser context/page for all four shots keeps the capture fast and the
  // boot overlay available for the very first shot.
  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  test("captures boot logo, 3-card reading, Tower glitch, and resurrection diff", async ({
    page,
  }) => {
    // --- (1) Boot logo frame --------------------------------------------
    // Navigate WITHOUT `?boot=skip` so the full-motion Boot_Sequence plays and
    // the overlay is on screen. Grab the frame while the wordmark is up, before
    // the boot resolves to the ready prompt.
    await page.goto("/");
    const overlay = page.locator(".crt-boot-overlay");
    await expect(overlay).toBeVisible();
    // The accessible wordmark equivalent confirms the logo frame is showing.
    await expect(page.locator("span.crt-sr-only")).toContainText(
      "NECROMANTIC SYSTEMS 1986",
    );
    await page.screenshot({ path: shot("01-boot-logo"), animations: "allow" });

    // Let the boot settle before driving commands.
    await expect(overlay).toHaveCount(0, { timeout: 10_000 });
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
    await page.screenshot({
      path: shot("04-resurrection-diff"),
      fullPage: true,
      animations: "allow",
    });

    expect(calls.resurrect).toBeGreaterThanOrEqual(1);
  });
});
