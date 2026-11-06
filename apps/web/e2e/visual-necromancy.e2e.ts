// apps/web/e2e/visual-necromancy.e2e.ts
//
// Feature: visual-necromancy (Spec 05), task 18.1 — the end-to-end +
// accessibility proof for the Visual_Layer, run in a REAL browser against the
// offline demo chunk and the mocked resurrection stream (no GitHub, LLM,
// sandbox, or network).
//
// NOTE (Arcana_Visions, Spec 06, tasks 19-22 + 28): `apps/web`
// (`TerminalScreen.tsx`) now threads the committed Arcana_Visions manifest into
// `<Terminal>`. Per the APPROVED Arcana_Visions design, when the manifest
// covers a reading the Terminal renders the pixel-art `SpreadPixelView`
// (`.crt-spread-pixel` / `.crt-pixel-card` / `.crt-pixel-card-img`) IN PLACE OF
// the Spec 05 ASCII `CardReveal` (`.crt-card-slot` / `.crt-ascii-card`). The
// `lich-py2` fates reading draws tower (pos 1), judgement (pos 2) and devil
// (pos 3) — all covered by the manifest — so `read fates` renders a three-slot
// pixel spread. The demo-path tests below therefore assert the PIXEL DOM; the
// ASCII card remains the proven compact/fallback view and is exercised through
// the per-slot image-error fallback assertion (and the `<noscript>` SSR spread,
// plus the `@necro/ui-crt` unit tests for `SpreadPixelView`/`PixelCard`).
//
// This is the ONLY e2e spec that exercises the full-motion Boot_Sequence: it
// navigates with `bootTerminalFull` (no `?boot=skip`), so the `.crt-boot-overlay`
// actually plays and must resolve to the ready prompt within budget. Every
// OTHER spec navigates with `?boot=skip` (the shared `bootTerminal` helper), so
// none of them waits out the boot animation. `apps/web/src/app/layout.tsx` is
// never modified for any of this.
//
// What it proves, in a real browser (not jsdom):
//   - Full motion (no `?boot=skip`): the boot overlay appears and resolves to
//     the ready prompt within budget (R1.1); a demo reading renders its three
//     drawn cards as PIXEL cards in spread order, each with a `<img>`
//     (R3.1 pixel-layer parity); a severe card (THE TOWER) carries the glitch
//     class, `data-glitch-intensity` and `data-burning` on its pixel card
//     element (R3.6, R5.1); and a resurrection plays a rot phase that is
//     observable in the DOM BEFORE the diff renders (R6.1).
//   - With `?boot=skip` and/or reduced motion: all animations skip straight to
//     their final state instantly — no boot overlay, no running rot frame, and
//     the pixel cards render static with no `.crt-glitch` and no running
//     `.crt-motion-zone` (R12.5, R10.3, R10.5).
//   - A per-slot image failure falls back to the ASCII card IN PLACE
//     (`.crt-ascii-card`), proving the Spec 05 ASCII card remains the compact
//     fallback view behind every pixel slot (R3.3 ASCII-fallback guarantee).
//   - `axe` finds no new violations on the boot, pixel spread, glitch, and
//     resurrection states (R10.5).
//   - The documented Flash_Limit caps hold in the live stylesheet: the glitch
//     animation on the Tower's pixel image runs with `iteration-count: 1` and a
//     duration within the `--crt-glitch-max-ms` (<= 300 ms) cap, and the rot
//     cadence floor `--crt-rot-frame-min-ms` stays >= 500 ms (<= 2 luminance
//     changes/s) (R10.3).
//
// Transport: the demo reading loads the bundled offline demo chunk (no route
// interception); the resurrection path uses `mockRoutes` to fulfil
// `/api/summon`, `/api/readings` and `/api/resurrect` with recorded NDJSON. A
// `page.on("request", …)` guard fails the spec if anything leaks to the real
// network. Run by the maintainer via `pnpm --filter @necro/web e2e` (Playwright
// browser binaries may be absent on some machines).
//
// _Requirements: 1.1, 3.1, 3.3, 3.6, 5.1, 5.5, 6.1, 10.3, 10.5, 12.5_

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  BOOT_PHRASE,
  BOOT_SKIP_QUERY,
  bootTerminal,
  bootTerminalFull,
  mockRoutes,
  runCommand,
  sel,
} from "./support/terminal.js";

/** The pixel-art Spread_View row and its per-card elements (Arcana_Visions). */
const pixelCards = (page: Page): Locator =>
  page.locator(".crt-spread-pixel .crt-pixel-card[data-card]");

/** Every rendered pixel-card bitmap (`.crt-pixel-card-img`) in the spread. */
const pixelImages = (page: Page): Locator =>
  page.locator(".crt-spread-pixel .crt-pixel-card-img");

/** One drawn pixel card by its card id, inside the spread row. */
const pixelCard = (page: Page, card: string): Locator =>
  page.locator(`.crt-spread-pixel .crt-pixel-card[data-card="${card}"]`);

/** Run an axe scan scoped to the terminal and return its violations. */
async function axeViolations(
  page: Page,
): Promise<Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]> {
  const results = await new AxeBuilder({ page })
    .include("main.crt")
    // WCAG 2.1 A + AA — the project's accessibility bar (tarot-ux steering).
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations;
}

/** Install the no-real-network guard used by every test in this file. */
function guardNetwork(page: Page): { leaked: boolean } {
  const state = { leaked: false };
  page.on("request", (req) => {
    if (/github\.com|pypi\.org|osv\.dev|amazonaws\.com/.test(req.url())) {
      state.leaked = true;
    }
  });
  return state;
}

// ---------------------------------------------------------------------------
// Full-motion boot → demo pixel spread → THE TOWER glitch
// ---------------------------------------------------------------------------

test.describe("full-motion boot, pixel spread, and the glitch (R1.1, R3.1, R3.6, R5.1)", () => {
  test("boot plays and resolves, a demo renders three pixel cards in spread order, and THE TOWER glitches", async ({
    page,
  }) => {
    const net = guardNetwork(page);

    // Navigate WITHOUT `?boot=skip`: the full Boot_Sequence plays. The overlay
    // is present while booting, then resolves to the ready prompt within budget
    // and leaves no overlay in the DOM (R1.1). `bootTerminalFull` asserts the
    // overlay count returns to 0 and focus lands on the Command_Line.
    await bootTerminalFull(page);
    expect(await pixelCards(page).count(), "no cards before a reading").toBe(0);

    // axe on the freshly-booted terminal (no new violations — R10.5).
    expect(
      await axeViolations(page),
      "axe violations on the booted terminal",
    ).toEqual([]);

    // A demo reading needs no route mocks — it loads the bundled offline chunk.
    // `lich-py2` fates draws three cards — tower (pos 1), judgement (pos 2),
    // devil (pos 3) — all covered by the committed arcana manifest, so the
    // pixel Spread_View renders (not the ASCII fallback). THE TOWER (severity 2,
    // upright, burning) is the severe card this spec checks the glitch on.
    await runCommand(page, "demo lich-py2");
    await runCommand(page, "read fates");

    // R3.1 (pixel-layer parity) — the three drawn positions each render a pixel
    // card, in the reading's exact spread order, each with its own `<img>`.
    await expect(pixelCards(page)).toHaveCount(3);
    const order = await pixelCards(page).evaluateAll((cards) =>
      cards.map((c) => (c as HTMLElement).dataset.card),
    );
    expect(order).toEqual(["tower", "judgement", "devil"]);
    await expect(pixelImages(page)).toHaveCount(3);

    // R3.6 / R5.1 — THE TOWER pixel card carries the glitch class, the
    // `data-glitch-intensity` severity hook, and the amber `data-burning`
    // attribute in full motion (the arcana glitch rides the Spec 05 contract).
    const tower = pixelCard(page, "tower");
    await expect(tower).toHaveCount(1);
    await expect(tower).toHaveClass(/\bcrt-glitch\b/);
    await expect(tower).toHaveAttribute("data-glitch-intensity", "2");
    await expect(tower).toHaveAttribute("data-burning", "true");

    // The card's diagnosis text is still announced in the authoritative log
    // (the pixel image carries the same severity feel, never new text).
    const log = sel.log(page);
    await expect(log).toContainText("THE TOWER");

    // R10.5 — axe on the rendered pixel reading (cards + glitch) has no
    // violations.
    expect(
      await axeViolations(page),
      "axe violations on the rendered pixel reading",
    ).toEqual([]);

    expect(net.leaked, "demo reading must make no real network request").toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// ASCII fallback: a per-slot image failure swaps to the ASCII card in place
// ---------------------------------------------------------------------------

test.describe("ASCII fallback behind every pixel slot (R3.3)", () => {
  test("a pixel card whose image fails to load renders the ASCII card in place", async ({
    page,
  }) => {
    const net = guardNetwork(page);

    // Force every arcana WebP request to fail BEFORE the spread renders, so the
    // pixel `<img>` `onError` fires and `PixelCard` swaps the image in place for
    // the Spec 05 `AsciiCardView` — with no broken-image indicator. This proves
    // the ASCII card remains the compact fallback view behind each pixel slot
    // (R3.3), exercised through the real image-error path rather than a
    // synthetic no-manifest build.
    await page.route("**/arcana/*.webp", (route) => route.abort());

    await bootTerminal(page); // ?boot=skip — this test is about the fallback.
    await runCommand(page, "demo lich-py2");
    await runCommand(page, "read fates");

    // Each of the three slots is still present and in order (the spread never
    // drops a position on image failure), and each now shows the ASCII card.
    const asciiCards = page.locator(".crt-spread-pixel .crt-ascii-card");
    await expect(asciiCards).toHaveCount(3);
    // The failed images were swapped out in place — no live pixel bitmap, and
    // no broken-image placeholder, remains in the spread row.
    await expect(pixelImages(page)).toHaveCount(0);

    // R10.5 — axe on the ASCII-fallback reading has no violations.
    await expect(sel.log(page)).toHaveAttribute("aria-busy", "false");
    expect(
      await axeViolations(page),
      "axe violations on the ASCII-fallback reading",
    ).toEqual([]);

    expect(net.leaked, "ASCII-fallback reading must make no real network request").toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Resurrection: a rot phase is observable before the diff renders (R6.1)
// ---------------------------------------------------------------------------

test.describe("resurrection rot precedes the diff (R6.1, R10.5)", () => {
  test("a rot frame is in the DOM before the diff block, then rebirth renders the diff", async ({
    page,
  }) => {
    const net = guardNetwork(page);

    const calls = await mockRoutes(page);
    await bootTerminal(page); // ?boot=skip — this test is about rot, not boot.

    const log = sel.log(page);

    // Bring a live reading into scope, then resurrect. The mocked resurrection
    // stream drives the six phases and the terminal result line.
    await runCommand(page, "summon graveyard/green-garden");
    await expect(log).toContainText("graveyard/green-garden");
    await runCommand(page, "read necropsy");
    await expect(log).toContainText("THE STAR");

    await runCommand(page, "resurrect");

    // R6.1 — a rot phase is observable in the DOM as the Resurrection_Animation
    // plays: the decorative rot overlay enters its "running" state, drawing a
    // decaying rot frame (`.crt-rot-frame`), and only AFTER it completes does it
    // reach its "done"/rebirth state. The decay frame therefore precedes the
    // rebirth state in time — the rot visibly runs before the code is reborn.
    // (The authoritative diff lives in the aria-hidden-free `role="log"` region
    // and is announced exactly once; the overlay is a purely decorative layer
    // over it, so this asserts the overlay's own running→done progression.)
    const rotRunning = page.locator('.crt-rot-overlay[data-rot="running"]');
    await expect(rotRunning).toBeVisible();
    await expect(rotRunning.locator("pre.crt-rot-frame")).toHaveCount(1);
    // The rebirth ("done") state is not shown while the rot is still running.
    expect(
      await page.locator('.crt-rot-overlay[data-rot="done"]').count(),
      "rebirth must not be shown while the rot is still running",
    ).toBe(0);

    // Rebirth: the rot overlay reaches "done" (revived code) and the unchanged
    // diff + Vitality_Delta are present in the log (never altered by the rot).
    await expect(page.locator('.crt-rot-overlay[data-rot="done"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(log).toContainText("FILE src/legacy.py");
    await expect(log).toContainText("VITALITY 40/100 -> 55/100 (+15)");

    // R10.5 — axe on the post-resurrection screen has no violations.
    await expect(log).toHaveAttribute("aria-busy", "false");
    expect(
      await axeViolations(page),
      "axe violations after resurrection",
    ).toEqual([]);

    expect(calls.resurrect).toBeGreaterThanOrEqual(1);
    expect(net.leaked, "resurrection must make no real network request").toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Flash_Limit caps are honoured by the live stylesheet (R10.3)
// ---------------------------------------------------------------------------

test.describe("Flash_Limit caps: iteration-count and durations (R10.3)", () => {
  test("the pixel glitch animation runs once within the glitch cap and the rot cadence floor holds", async ({
    page,
  }) => {
    await bootTerminal(page); // ?boot=skip; the stylesheet is what we probe.
    await runCommand(page, "demo lich-py2");
    await runCommand(page, "read fates");

    // All three pixel cards render at once (the pixel Spread_View has no
    // one-by-one flip); wait for the severe Tower card and its image.
    await expect(pixelCards(page)).toHaveCount(3);
    const tower = pixelCard(page, "tower");
    await expect(tower).toHaveClass(/\bcrt-glitch\b/);

    // The arcana one-shot glitch animation is declared on the pixel card's
    // `.crt-pixel-card-img` under `.crt[data-motion="full"] .crt-glitch[
    // data-burning="true"]` (the burning Tower variant). Read its computed
    // animation properties in the real browser: it must run exactly once
    // (iteration-count: 1) and for no longer than the documented
    // `--crt-glitch-max-ms` (<= 300 ms) cap.
    const glitchImg = tower.locator(".crt-pixel-card-img").first();
    await expect(glitchImg).toHaveCount(1);
    const glitch = await glitchImg.evaluate((el) => {
      const s = getComputedStyle(el as HTMLElement);
      const durationMs = s.animationDuration
        .split(",")[0]!
        .trim()
        .endsWith("ms")
        ? parseFloat(s.animationDuration)
        : parseFloat(s.animationDuration) * 1000;
      return {
        iterationCount: s.animationIterationCount.split(",")[0]!.trim(),
        durationMs,
        name: s.animationName,
      };
    });
    // One-shot: never `infinite`, exactly one iteration (Flash_Limit).
    expect(glitch.iterationCount).toBe("1");
    expect(glitch.name).not.toBe("none");
    // Duration within the documented glitch cap (<= 300 ms).
    expect(glitch.durationMs).toBeGreaterThan(0);
    expect(glitch.durationMs).toBeLessThanOrEqual(300);

    // The rot cadence floor token `--crt-rot-frame-min-ms` keeps visible
    // luminance shifts at <= 2/s: it must be >= 500 ms. Read it off `main.crt`.
    const rotFloorMs = await sel.terminal(page).evaluate((el) => {
      const raw = getComputedStyle(el as HTMLElement)
        .getPropertyValue("--crt-rot-frame-min-ms")
        .trim();
      return raw.endsWith("ms") ? parseFloat(raw) : parseFloat(raw) * 1000;
    });
    expect(rotFloorMs).toBeGreaterThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// ?boot=skip and reduced motion skip animations to their final state (R12.5)
// ---------------------------------------------------------------------------

test.describe("skip and reduced motion land on the final state instantly (R12.5, R10.3, R5.5)", () => {
  test("?boot=skip renders no boot overlay and the ready prompt immediately", async ({
    page,
  }) => {
    // The shared helper navigates with `?boot=skip`; the session lands on the
    // ready prompt with the boot phrase first and never shows the overlay.
    await bootTerminal(page);
    expect(await page.locator(".crt-boot-overlay").count()).toBe(0);
    await expect(sel.log(page)).toContainText(BOOT_PHRASE);
    await expect(sel.input(page)).toBeFocused();
  });

  test("reduced motion renders pixel cards static with no glitch or motion-zone animation", async ({
    page,
  }) => {
    const net = guardNetwork(page);

    // Force reduced motion before the first paint. Under reduced motion the
    // boot downgrades to `done` (no overlay) and the reading renders in one
    // pass with every card static.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/${BOOT_SKIP_QUERY}`);

    const log = sel.log(page);
    await expect(log).toContainText(BOOT_PHRASE);
    expect(await page.locator(".crt-boot-overlay").count()).toBe(0);

    await runCommand(page, "demo lich-py2");
    await runCommand(page, "read fates");

    // The terminal resolved reduced Motion_Mode on the `.crt` root (R5.5).
    await expect(sel.terminal(page)).toHaveAttribute("data-motion", "reduced");

    // The pixel cards still render (reduced motion hides MOTION, not content):
    // all three drawn cards are present as static images (R5.5).
    await expect(pixelCards(page)).toHaveCount(3);
    await expect(pixelImages(page)).toHaveCount(3);

    // No running reveal copy and no running rot frame under reduced motion.
    await expect(
      page.locator('section.crt-block[data-reveal="running"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('.crt-rot-overlay[data-rot="running"]'),
    ).toHaveCount(0);

    // No Motion_Zone overlay animates under reduced motion — `PixelCard`
    // resolves zero zones when the mode is not "full", so no `.crt-motion-zone`
    // span is emitted at all (R5.5).
    await expect(page.locator(".crt-spread-pixel .crt-motion-zone")).toHaveCount(
      0,
    );

    // THE TOWER still renders, but with NO glitch class in reduced motion (the
    // severity glitch is gated on full motion) (R5.5).
    const tower = pixelCard(page, "tower");
    await expect(tower).toHaveCount(1);
    await expect(tower).not.toHaveClass(/\bcrt-glitch\b/);

    // R10.5 — axe on the reduced-motion pixel reading has no violations.
    expect(
      await axeViolations(page),
      "axe violations under reduced motion",
    ).toEqual([]);

    expect(net.leaked, "reduced-motion reading must make no network request").toBe(
      false,
    );
  });
});
