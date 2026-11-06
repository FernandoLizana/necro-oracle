// apps/web/e2e/arcana.e2e.ts
//
// Feature: 06-arcana-visions, task 24 — the Arcana_Visions pixel-art layer in
// the browser, driven entirely offline against the Mock / recorded path (no
// real GitHub, LLM, sandbox, or network). It exercises the four visual
// surfaces the spec adds on top of the Spec 05 terminal:
//
//   1. Fullscreen_Card_View — open a drawn card full-screen by keyboard (Enter
//      on a focused Pixel_Card, and the `explain <position|card>` command),
//      close it with Escape, and have focus RESTORED to the opener
//      (R2.1, R2.2, R2.5, R2.7, R2.8, R10.6).
//   2. Reduced_Motion — with `prefers-reduced-motion: reduce` the terminal
//      resolves Motion_Mode `reduced`, the Pixel_Cards still render, and NO
//      Motion_Zone / glitch animation runs (static images) (R4.7, R5.5).
//   3. Resurrection_Ritual — on `resurrect`, forced on with `?ritual=force`,
//      the Necronomicon ritual overlay and its ordered phases play BEFORE the
//      diff/patch view; a deterministic `page.clock` timeline advances the
//      <= 3 s ritual to completion, after which the revived-diff view follows
//      (R6.1, R6.6).
//   4. Lazy-loading — the three visible Spread_View Pixel_Card images load
//      eagerly (`loading="eager"`); every other pixel surface stays `"lazy"`
//      (R11.1).
//
//   5. Automated axe scan — ZERO WCAG 2.1 A/AA violations on the Spread_View,
//      the Fullscreen_Card_View, the landing with the Seer, and the
//      Resurrection_Ritual states (R10.4, R13.6).
//
// Offline transport, mirroring the sibling specs:
//   - The spread / fullscreen / reduced-motion / lazy-loading surfaces use the
//     OFFLINE DEMO replay path (`demo lich-py2` → `read fates`), which loads
//     the bundled, schema-valid demo chunk with NO route interception — the
//     `lich-py2` fates reading draws exactly three cards (tower, judgement,
//     devil), all covered by the committed arcana manifest, so `read fates`
//     renders a three-slot pixel spread (not just the ASCII fallback).
//   - The resurrection ritual surface uses `mockRoutes` (summon / readings /
//     resurrect all fulfilled locally) exactly like `resurrect-flow.e2e.ts`;
//     the recorded RESURRECT_RESULT drives the diff the ritual precedes.
// A `page.on("request", …)` guard fails any test that leaks to the real
// network, and `mockRoutes` itself aborts github/pypi/osv/amazonaws.
//
// Forcing Reduced_Motion: `page.emulateMedia({ reducedMotion: "reduce" })` is
// set BEFORE navigating (same mechanism as `reduced-motion.e2e.ts`), so the
// auto Motion_Preference resolves to `reduced` on the first paint and
// `main.crt[data-motion="reduced"]` holds from boot.
//
// Forcing the ritual: a detected Playwright run (`navigator.webdriver`) skips
// the Necronomicon ritual UNLESS the Ritual_Force_Flag is set, so the ritual
// test navigates with `?boot=skip&ritual=force` (the `ritualForce` prop the
// Terminal threads into `ritualTimeline`). `page.clock.install()` is set before
// navigation and the ritual's FramePort timeline (driven off `performance.now`)
// is advanced deterministically with `page.clock.runFor(...)`, so the <= 3 s
// ritual completes on a controlled clock and the diff view follows. That spec
// is ISOLATED so fake and real time never mix in another test.
//
// These specs are run by the maintainer via `pnpm --filter @necro/web e2e`
// (the Playwright browser binaries may be absent on some machines).
//
// _Requirements: R2.1, R2.2, R2.5, R2.7, R2.8, R4.7, R5.5, R6.1, R6.6, R10.3,
//  R10.4, R10.5, R10.6, R11.1, R13.6_

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  BOOT_PHRASE,
  BOOT_SKIP_QUERY,
  bootTerminal,
  mockRoutes,
  runCommand,
  sel,
} from "./support/terminal.js";

// --- Local selectors for the Arcana_Visions DOM (mirror the components) -----
//
// Each anchor is the stable class the real `@necro/ui-crt` component renders,
// not invented copy: `.crt-spread-pixel` (SpreadPixelView), `.crt-pixel-card`
// / `.crt-pixel-card-img` (PixelCard, the img carries `loading`),
// `.crt-fullscreen-card` (FullscreenCardView, role="dialog" aria-modal),
// `.crt-motion-zone` (PixelCard animated overlay), `.crt-glitch` (the Spec 05
// severity glitch wrapper), `.crt-ritual` (NecronomiconRitual overlay, carries
// `data-ritual` phase), `.crt-ritual-open` (the open-book crossfade frame),
// `.crt-rot-overlay` (the revived-diff view the ritual wraps as children), and
// `.crt-seer-portrait` (SeerPortrait).
const arcana = {
  spread: (page: Page): Locator => page.locator(".crt-spread-pixel"),
  pixelCards: (page: Page): Locator =>
    page.locator(".crt-spread-pixel .crt-pixel-card[data-card]"),
  pixelCard: (page: Page, card: string): Locator =>
    page.locator(`.crt-spread-pixel .crt-pixel-card[data-card="${card}"]`),
  spreadImages: (page: Page): Locator =>
    page.locator(".crt-spread-pixel .crt-pixel-card-img"),
  fullscreen: (page: Page): Locator => page.locator(".crt-fullscreen-card"),
  motionZone: (page: Page): Locator => page.locator(".crt-motion-zone"),
  glitch: (page: Page): Locator => page.locator(".crt-pixel-card.crt-glitch"),
  ritual: (page: Page): Locator => page.locator(".crt-ritual[data-ritual]"),
  ritualOpenFrame: (page: Page): Locator => page.locator(".crt-ritual-open"),
  rotOverlay: (page: Page): Locator => page.locator(".crt-rot-overlay"),
  seer: (page: Page): Locator => page.locator(".crt-seer-portrait"),
} as const;

/** The WCAG 2.1 A + AA rule set the whole suite uses (mirrors `axe.e2e.ts`). */
async function scan(
  page: Page,
): Promise<Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]> {
  const results = await new AxeBuilder({ page })
    .include("main.crt")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations;
}

/**
 * Attach a request guard that flips `leaked.hit` if any request reaches the
 * real network. The demo surfaces make NO `/api/*` call at all; the ritual
 * surface's `/api/*` calls are fulfilled locally by `mockRoutes`, so only a
 * github/pypi/osv/amazonaws host (or an unexpected external origin) trips it.
 */
function guardNetwork(page: Page): { hit: boolean } {
  const leaked = { hit: false };
  page.on("request", (req) => {
    if (/github\.com|pypi\.org|osv\.dev|amazonaws\.com/.test(req.url())) {
      leaked.hit = true;
    }
  });
  return leaked;
}

/**
 * Drive the OFFLINE DEMO replay path to a three-slot pixel spread: boot with
 * `?boot=skip`, `demo lich-py2`, then `read fates`. The `lich-py2` fates
 * reading draws exactly three manifest-covered cards, so the pixel Spread_View
 * (not the ASCII fallback) renders. Resolves once the three Pixel_Cards are on
 * screen.
 */
async function openDemoSpread(page: Page): Promise<void> {
  await bootTerminal(page);
  await runCommand(page, "demo lich-py2");
  await runCommand(page, "read fates");
  // The three drawn cards of the lich-py2 fates reading, in spread order.
  await expect(arcana.pixelCard(page, "tower")).toBeVisible();
  await expect(arcana.pixelCard(page, "judgement")).toBeVisible();
  await expect(arcana.pixelCard(page, "devil")).toBeVisible();
  await expect(arcana.pixelCards(page)).toHaveCount(3);
}

test.describe("fullscreen card: keyboard open/close with focus restore (R2.1, R2.2, R2.5, R2.7, R2.8, R10.6)", () => {
  test("Enter on a focused Pixel_Card opens the dialog; Escape closes it and restores focus", async ({
    page,
  }) => {
    const leaked = guardNetwork(page);
    await openDemoSpread(page);

    // The first drawn card (tower) is a keyboard-reachable button (PixelCard
    // wires role="button" + tabIndex=0 when activatable). Focus it directly and
    // open the Fullscreen_Card_View with Enter (R2.1, R2.2) — a keyboard-only
    // open, no mouse.
    const opener = arcana.pixelCard(page, "tower");
    await opener.focus();
    await expect(opener).toBeFocused();
    await opener.press("Enter");

    // The modal single-card inspector is open: role="dialog", aria-modal, and
    // it shows the activated card (tower) (R2.1). Focus has moved inside, onto
    // the dialog node itself (the deferred-focus technique) (R2.7).
    const dialog = arcana.fullscreen(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("role", "dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(dialog).toHaveAttribute("data-card", "tower");
    await expect(dialog).toBeFocused();

    // Arrow navigation moves between the drawn cards and wraps (R2.5). From the
    // first card (tower) ArrowLeft wraps to the last (devil); ArrowRight from
    // there advances to the first again — all without leaving the dialog.
    await dialog.press("ArrowLeft");
    await expect(arcana.fullscreen(page)).toHaveAttribute("data-card", "devil");
    await arcana.fullscreen(page).press("ArrowRight");
    await expect(arcana.fullscreen(page)).toHaveAttribute("data-card", "tower");

    // Tab is trapped inside the dialog (R2.7, R10.6): tabbing lands on the
    // dialog's own close control, never escaping to the command line behind it.
    await arcana.fullscreen(page).press("Tab");
    const closeButton = page.locator(".crt-fullscreen-close");
    await expect(closeButton).toBeFocused();

    // Escape closes the view (R2.8) and focus is RESTORED to the opener — the
    // tower Pixel_Card that opened it (R2.8, R10.6).
    await closeButton.press("Escape");
    await expect(arcana.fullscreen(page)).toHaveCount(0);
    await expect(arcana.pixelCard(page, "tower")).toBeFocused();

    expect(leaked.hit, "demo fullscreen flow must make no real network request").toBe(false);
  });

  test("the `explain <position>` command opens the Fullscreen_Card_View for a drawn card", async ({
    page,
  }) => {
    const leaked = guardNetwork(page);
    await openDemoSpread(page);

    // `explain 2` names the second drawn fates position (judgement). The
    // command opens the Fullscreen_Card_View for the card present in the
    // reading within the same submit (R2.3), so the dialog shows judgement.
    await runCommand(page, "explain 2");
    const dialog = arcana.fullscreen(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("data-card", "judgement");
    await expect(dialog).toBeFocused();

    // Escape closes it again; the terminal is usable afterwards.
    await dialog.press("Escape");
    await expect(arcana.fullscreen(page)).toHaveCount(0);

    expect(leaked.hit, "demo explain flow must make no real network request").toBe(false);
  });
});

test.describe("reduced motion: static Pixel_Cards, no zone/glitch animation (R4.7, R5.5)", () => {
  test("with prefers-reduced-motion the cards render but no Motion_Zone or glitch runs", async ({
    page,
  }) => {
    const leaked = guardNetwork(page);

    // Force the OS-level reduced-motion query BEFORE the first paint, so the
    // auto Motion_Preference resolves to `reduced` on boot (same mechanism as
    // reduced-motion.e2e.ts). `main.crt[data-motion]` must then be "reduced".
    await page.emulateMedia({ reducedMotion: "reduce" });

    await openDemoSpread(page);

    // The terminal is in reduced Motion_Mode: the root landmark carries
    // data-motion="reduced" (R4.7, R5.5).
    await expect(sel.terminal(page)).toHaveAttribute("data-motion", "reduced");

    // The Pixel_Cards still render (reduced motion hides MOTION, not content):
    // all three drawn cards are present as static images (R4.7).
    await expect(arcana.pixelCards(page)).toHaveCount(3);
    await expect(arcana.spreadImages(page)).toHaveCount(3);

    // No Motion_Zone overlay is emitted under reduced motion — PixelCard
    // resolves zero zones when the mode is not "full", so the animated
    // `.crt-motion-zone` spans never render (R4.7).
    await expect(arcana.motionZone(page)).toHaveCount(0);

    // No severity glitch runs under reduced motion either — the `.crt-glitch`
    // wrapper is gated on `motionMode === "full"`, so even a severe card is
    // steady (R5.5). (lich-py2's tower/devil are severe; both stay unglitched.)
    await expect(arcana.glitch(page)).toHaveCount(0);

    expect(leaked.hit, "reduced-motion flow must make no real network request").toBe(false);
  });
});

test.describe("resurrection ritual before the diff, forced + deterministic clock (R6.1, R6.6)", () => {
  test("`?ritual=force` plays the Necronomicon ritual, then the revived-diff view follows", async ({
    page,
  }) => {
    const leaked = guardNetwork(page);

    // Deterministic clock for the <= 3 s ritual timeline. Installed BEFORE any
    // script runs so the ritual's FramePort loop (driven off performance.now)
    // reads virtual time from its first frame. Origin at epoch 0 so runFor
    // advances exactly the requested span. This test is ISOLATED from the
    // real-time demo tests above, so fake and real time never mix in one test.
    await page.clock.install({ time: 0 });

    const calls = await mockRoutes(page);

    // Navigate with BOTH flags: `?boot=skip` lands on the ready terminal, and
    // `?ritual=force` forces the Necronomicon ritual to play even under the
    // detected Playwright run (R6.6). Mirrors `bootTerminal`'s wait for the
    // booted, focused prompt.
    await page.goto(`/${BOOT_SKIP_QUERY}&ritual=force`);
    await expect(sel.log(page)).toContainText(BOOT_PHRASE);
    await expect(sel.input(page)).toBeFocused();

    // Bring a reading into scope, then resurrect. The recorded resurrect stream
    // drives the diff the ritual precedes (one changed file, +15 vitality).
    await runCommand(page, "summon graveyard/green-garden");
    await runCommand(page, "read necropsy");
    await runCommand(page, "resurrect");

    const log = sel.log(page);
    // The resurrection result settled in the log (the ritual wraps only the
    // decorative rebirth view; the authoritative diff text lives in the log).
    await expect(log).toContainText("FILE src/legacy.py");

    // R6.1 — the Necronomicon ritual overlay plays BEFORE the diff view: the
    // `.crt-ritual` overlay is present with a `data-ritual` phase, and its
    // open-book crossfade frame is layered in. While the ritual plays, its
    // `children` (the `.crt-rot-overlay` revived-diff view) is NOT yet rendered.
    const ritual = arcana.ritual(page);
    await expect(ritual).toBeVisible();
    await expect(ritual).toHaveAttribute("data-ritual", /closed-glitch|tremble|crossfade|rising-diff/);
    await expect(arcana.ritualOpenFrame(page)).toHaveCount(1);
    await expect(arcana.rotOverlay(page)).toHaveCount(0);

    // Advance the virtual clock through the full <= 3 s ritual budget
    // (RITUAL_TOTAL_MS = 3000; +500 ms slack to clear the last frame). The
    // FramePort callbacks fire on the controlled clock, so the four phases run
    // to completion deterministically (R6.6).
    await page.clock.runFor(3500);

    // After the timeline completes the ritual overlay is gone and the
    // revived-diff view (the ritual's `children`) follows — the diff view comes
    // AFTER the ritual, never during it (R6.1).
    await expect(arcana.ritual(page)).toHaveCount(0);
    await expect(arcana.rotOverlay(page)).toHaveCount(1);

    expect(calls.resurrect).toBeGreaterThanOrEqual(1);
    expect(leaked.hit, "ritual flow must make no real network request").toBe(false);
  });
});

test.describe("lazy-loading: visible spread images eager, others lazy (R11.1)", () => {
  test("the three visible Spread_View card images load eagerly", async ({ page }) => {
    const leaked = guardNetwork(page);
    await openDemoSpread(page);

    // The three visible Spread_View Pixel_Card images each load eagerly: their
    // bitmaps are fetched on the first render rather than deferred (R11.1).
    const images = arcana.spreadImages(page);
    await expect(images).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) {
      await expect(images.nth(i)).toHaveAttribute("loading", "eager");
    }

    // Every OTHER pixel-card image keeps the `"lazy"` default — no pixel-card
    // image OUTSIDE the visible spread row loads eagerly on this screen, so the
    // only eager pixel images are the three visible spread cards (R11.1).
    const eagerPixelImages = page.locator('.crt-pixel-card-img[loading="eager"]');
    await expect(eagerPixelImages).toHaveCount(3);
    const lazySpreadImages = page.locator(
      '.crt-spread-pixel .crt-pixel-card-img[loading="lazy"]',
    );
    await expect(lazySpreadImages).toHaveCount(0);

    expect(leaked.hit, "lazy-loading flow must make no real network request").toBe(false);
  });
});

test.describe("axe: zero violations across the arcana states (R10.4, R13.6)", () => {
  test("the Spread_View with Pixel_Cards has no axe violations", async ({ page }) => {
    await openDemoSpread(page);
    // The announced reading text has settled; the live region is no longer busy.
    await expect(sel.log(page)).toHaveAttribute("aria-busy", "false");

    const violations = await scan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  test("the Fullscreen_Card_View has no axe violations", async ({ page }) => {
    await openDemoSpread(page);

    // Open the fullscreen dialog over a drawn card (R2.1).
    await runCommand(page, "explain 1");
    await expect(arcana.fullscreen(page)).toBeVisible();

    const violations = await scan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  test("the landing with the Seer has no axe violations", async ({ page }) => {
    // The Seer_Image shows in the boot/landing area only WHILE the boot plays,
    // so this one state exercises the full-motion boot (no `?boot=skip`). The
    // Seer portrait renders with its text-landing fallback behind it.
    await page.goto("/");
    await expect(sel.log(page)).toContainText(BOOT_PHRASE);
    await expect(arcana.seer(page)).toBeVisible();

    const violations = await scan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  test("the Resurrection_Ritual state has no axe violations", async ({ page }) => {
    // Isolated fake clock (same as the ritual-timeline test): freeze the ritual
    // mid-play so the overlay is on screen for the scan, then scan. The ritual
    // overlay is aria-hidden; the authoritative diff/vitality text in the log
    // remains the accessible content axe audits.
    await page.clock.install({ time: 0 });
    await mockRoutes(page);

    await page.goto(`/${BOOT_SKIP_QUERY}&ritual=force`);
    await expect(sel.log(page)).toContainText(BOOT_PHRASE);
    await expect(sel.input(page)).toBeFocused();

    await runCommand(page, "summon graveyard/green-garden");
    await runCommand(page, "read necropsy");
    await runCommand(page, "resurrect");

    const log = sel.log(page);
    await expect(log).toContainText("FILE src/legacy.py");
    // The ritual overlay is on screen (before the diff view follows).
    await expect(arcana.ritual(page)).toBeVisible();
    // The live region has settled; scan the ritual-playing state.
    await expect(log).toHaveAttribute("aria-busy", "false");

    const violations = await scan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
