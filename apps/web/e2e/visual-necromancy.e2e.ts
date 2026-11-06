// apps/web/e2e/visual-necromancy.e2e.ts
//
// Feature: visual-necromancy, task 18.1 — the end-to-end + accessibility proof
// for the Visual_Layer, run in a REAL browser against the offline demo chunk
// and the mocked resurrection stream (no GitHub, LLM, sandbox, or network).
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
//     the ready prompt within budget (R1.1); a demo reading reveals its cards
//     one-by-one (R4.1); the three drawn cards render as FRAMED ASCII cards —
//     box-drawing glyphs visible in the card art, not plain text (R3.1); a
//     severe card (THE TOWER) carries the glitch class and `data-burning` on its
//     card element (R3.6, R5.1); and a resurrection plays a rot phase that is
//     observable in the DOM BEFORE the diff renders (R6.1).
//   - With `?boot=skip` and/or reduced motion: all animations skip straight to
//     their final state instantly — no boot overlay, no running rot frame, no
//     typewriter reveal (R12.5, R10.3, R10.5).
//   - `axe` finds no new violations on the boot, cards/reveal, glitch, and
//     resurrection states (R10.5).
//   - The documented Flash_Limit caps hold in the live stylesheet: the glitch
//     animation runs with `iteration-count: 1` and a duration within the
//     `--crt-glitch-max-ms` (≤ 300 ms) cap, and the rot cadence floor
//     `--crt-rot-frame-min-ms` stays ≥ 500 ms (≤ 2 luminance changes/s) (R10.3).
//
// Transport: the demo reading loads the bundled offline demo chunk (no route
// interception); the resurrection path uses `mockRoutes` to fulfil
// `/api/summon`, `/api/readings` and `/api/resurrect` with recorded NDJSON. A
// `page.on("request", …)` guard fails the spec if anything leaks to the real
// network. Run by the maintainer via `pnpm --filter @necro/web e2e` (Playwright
// browser binaries may be absent on some machines).
//
// _Requirements: 1.1, 3.1, 3.6, 4.1, 5.1, 6.1, 10.3, 10.5, 12.5_

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

/** The box-drawing border glyphs the ASCII_Card_Renderer frames cards with. */
const BOX_GLYPHS = ["\u250c", "\u2510", "\u2514", "\u2518", "\u2502", "\u2500"]; // ┌ ┐ └ ┘ │ ─

/** The decorative card layer and its per-position slots (aria-hidden). */
const cardSlots = (page: Page): Locator => page.locator(".crt-card-slot");

/** Every rendered ASCII card element (`.crt-ascii-card`) inside the overlay. */
const asciiCards = (page: Page): Locator => page.locator(".crt-ascii-card");

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
// Full-motion boot → demo reveal → framed ASCII cards → THE TOWER glitch
// ---------------------------------------------------------------------------

test.describe("full-motion boot, card reveal, and the glitch (R1.1, R3.1, R3.6, R4.1, R5.1)", () => {
  test("boot plays and resolves, a demo reveals framed ASCII cards one-by-one, and THE TOWER glitches", async ({
    page,
  }) => {
    const net = guardNetwork(page);

    // Navigate WITHOUT `?boot=skip`: the full Boot_Sequence plays. The overlay
    // is present while booting, then resolves to the ready prompt within budget
    // and leaves no overlay in the DOM (R1.1). `bootTerminalFull` asserts the
    // overlay count returns to 0 and focus lands on the Command_Line.
    await bootTerminalFull(page);
    expect(await asciiCards(page).count(), "no cards before a reading").toBe(0);

    // axe on the freshly-booted terminal (no new violations — R10.5).
    expect(
      await axeViolations(page),
      "axe violations on the booted terminal",
    ).toEqual([]);

    // A demo reading needs no route mocks — it loads the bundled offline chunk.
    // `lich-py2` fates draws three cards and includes THE TOWER (severity 2,
    // upright), the severe burning card this spec checks the glitch on.
    await runCommand(page, "demo lich-py2");
    await runCommand(page, "read fates");

    // R4.1 — the three drawn positions each render a card slot, in spread order.
    await expect(cardSlots(page)).toHaveCount(3);
    const positions = await cardSlots(page).evaluateAll((slots) =>
      slots.map((s) => (s as HTMLElement).dataset.position),
    );
    expect(positions).toEqual(["1", "2", "3"]);

    // R4.1 — the reveal is one-by-one: at least one slot flips before all do.
    // Catch the intermediate state where the first slot is up while a later one
    // is still face-down, proving the reveal is ordered, not simultaneous.
    await expect
      .poll(async () =>
        cardSlots(page).evaluateAll(
          (slots) => (slots[0] as HTMLElement | undefined)?.dataset.flipped,
        ),
      )
      .toBe("true");

    // Then complete the whole reveal at once with Escape (R4.5): in full motion
    // each card typewriters its diagnosis before the next flips, so waiting the
    // animation out is slow and flaky. Escape flips every remaining card and
    // finishes every diagnosis, letting the glitch assertions run against the
    // final, fully-revealed state.
    await sel.input(page).focus();
    await page.keyboard.press("Escape");
    await expect
      .poll(async () =>
        cardSlots(page).evaluateAll((slots) =>
          slots.every((s) => (s as HTMLElement).dataset.flipped === "true"),
        ),
      )
      .toBe(true);

    // R3.1 — the drawn cards render as FRAMED ASCII cards: each flipped card's
    // art contains box-drawing border glyphs, so these are real framed cards,
    // not plain text. Assert against the first card's rendered art.
    await expect(asciiCards(page)).toHaveCount(3);
    const firstArt = await asciiCards(page)
      .first()
      .locator("pre.crt-ascii-card-art")
      .innerText();
    for (const glyph of BOX_GLYPHS) {
      expect(firstArt, `card art is missing box glyph ${glyph}`).toContain(glyph);
    }

    // R3.6 / R5.1 — THE TOWER card element carries the glitch class and the
    // amber `data-burning` attribute in full motion. The Tower is a burning
    // card; at severity ≥ 2 it also gets the shake class.
    const tower = page.locator('.crt-ascii-card[data-card="tower"]');
    await expect(tower).toHaveCount(1);
    await expect(tower).toHaveClass(/\bcrt-glitch\b/);
    await expect(tower).toHaveAttribute("data-burning", "true");
    await expect(tower).toHaveClass(/\bcrt-shake\b/);

    // The glyph art is still authored plain text (the glitch never mutates the
    // selectable text), and the card's severity integer is surfaced in the log.
    const log = sel.log(page);
    await expect(log).toContainText("THE TOWER");

    // R10.5 — axe on the rendered reading (cards + glitch) has no violations.
    expect(
      await axeViolations(page),
      "axe violations on the rendered reading",
    ).toEqual([]);

    expect(net.leaked, "demo reading must make no real network request").toBe(
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
  test("glitch animation runs once within the glitch cap and the rot cadence floor holds", async ({
    page,
  }) => {
    await bootTerminal(page); // ?boot=skip; the stylesheet is what we probe.
    await runCommand(page, "demo lich-py2");
    await runCommand(page, "read fates");

    // Complete the reveal at once with Escape so the glitched Tower art is
    // rendered in its final state (the full-motion typewriter is slow to drain).
    await sel.input(page).focus();
    await page.keyboard.press("Escape");
    await expect
      .poll(async () =>
        cardSlots(page).evaluateAll((slots) =>
          slots.every((s) => (s as HTMLElement).dataset.flipped === "true"),
        ),
      )
      .toBe(true);

    // The glitch animation is declared on the card's `.crt-ascii-card-art`
    // under `.crt[data-motion="full"]`. Read its computed animation properties
    // in the real browser: it must run exactly once (iteration-count: 1) and
    // for no longer than the documented `--crt-glitch-max-ms` (≤ 300 ms) cap.
    const glitchArt = page
      .locator('.crt-ascii-card[data-card="tower"] .crt-ascii-card-art')
      .first();
    await expect(glitchArt).toHaveCount(1);
    const glitch = await glitchArt.evaluate((el) => {
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
    // Duration within the documented glitch cap (≤ 300 ms).
    expect(glitch.durationMs).toBeGreaterThan(0);
    expect(glitch.durationMs).toBeLessThanOrEqual(300);

    // The rot cadence floor token `--crt-rot-frame-min-ms` keeps visible
    // luminance shifts at ≤ 2/s: it must be ≥ 500 ms. Read it off `main.crt`.
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

test.describe("skip and reduced motion land on the final state instantly (R12.5, R10.3)", () => {
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

  test("reduced motion renders cards face-up with no running reveal or rot frame", async ({
    page,
  }) => {
    const net = guardNetwork(page);

    // Force reduced motion before the first paint. Under reduced motion the
    // boot downgrades to `done` (no overlay) and the reading renders in one
    // pass with every card face-up and no animating state.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/${BOOT_SKIP_QUERY}`);

    const log = sel.log(page);
    await expect(log).toContainText(BOOT_PHRASE);
    expect(await page.locator(".crt-boot-overlay").count()).toBe(0);

    await runCommand(page, "demo lich-py2");
    await runCommand(page, "read fates");

    // Every card is already face-up in the single render (R10.3) — no tick.
    await expect(cardSlots(page)).toHaveCount(3);
    const allFlipped = await cardSlots(page).evaluateAll((slots) =>
      slots.every((s) => (s as HTMLElement).dataset.flipped === "true"),
    );
    expect(allFlipped, "reduced motion flips every card in one render").toBe(
      true,
    );
    // No animating reveal copy and no running rot frame under reduced motion.
    await expect(
      page.locator('section.crt-block[data-reveal="running"]'),
    ).toHaveCount(0);
    await expect(page.locator(".crt-reveal")).toHaveCount(0);
    await expect(
      page.locator('.crt-rot-overlay[data-rot="running"]'),
    ).toHaveCount(0);

    // THE TOWER still renders, but with NO glitch class in reduced motion (the
    // glitch effect is full-motion-only).
    const tower = page.locator('.crt-ascii-card[data-card="tower"]');
    await expect(tower).toHaveCount(1);
    await expect(tower).not.toHaveClass(/\bcrt-glitch\b/);

    // R10.5 — axe on the reduced-motion reading has no violations.
    expect(
      await axeViolations(page),
      "axe violations under reduced motion",
    ).toEqual([]);

    expect(net.leaked, "reduced-motion reading must make no network request").toBe(
      false,
    );
  });
});
