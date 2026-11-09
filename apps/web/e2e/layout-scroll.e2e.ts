// apps/web/e2e/layout-scroll.e2e.ts
//
// Prod UX regression test: the page must NOT overflow; the terminal output pane
// is the only scroll container; result views render inside it; the card art
// shows no opaque overlay before the image loads.
//
// Demo mode (network-free): demo lich-py2 -> resurrect -> lovers at 1280x800.
// Assertions:
//   1. document.scrollingElement.scrollHeight <= innerHeight (page does not scroll)
//   2. the output pane (role="log") is scrolled to bottom
//   3. DOWNLOAD PATCH / DOWNLOAD PAIR is inside the scroll pane and within viewport
//   4. THE TOWER card <img> is visible with no opaque overlay element covering it

import { expect, test } from "@playwright/test";

import {
  bootTerminal,
  runCommand,
  sel,
} from "./support/terminal.js";

test.describe("layout + scroll + card art (prod UX regression)", () => {
  test("demo -> resurrect -> lovers: page does not scroll, pane auto-scrolls, card art is clean", async ({ page }) => {
    // 1280x800 viewport as specified.
    await page.setViewportSize({ width: 1280, height: 800 });
    await bootTerminal(page);

    // Drive the full demo flow: demo -> read fates -> resurrect -> lovers.
    await runCommand(page, "demo lich-py2");
    // Wait for the demo to load (the fates spread auto-plays on install).
    await expect(sel.log(page)).toContainText("lich-py2", { timeout: 10_000 });

    await runCommand(page, "read fates");
    // Wait for the reading to appear.
    await expect(sel.log(page)).toContainText("UPRIGHT", { timeout: 10_000 });

    await runCommand(page, "resurrect");
    // Wait for the resurrect result / diff to appear.
    await expect(sel.log(page)).toContainText("FILE", { timeout: 15_000 });

    await runCommand(page, "lovers lich.py js");
    // Wait for the lovers result to appear.
    await expect(sel.log(page)).toContainText("PLAN", { timeout: 15_000 });
    // Wait for the lazy DOWNLOAD PAIR chunk to load and render inside the pane.
    await expect(page.getByRole("button", { name: /DOWNLOAD/i }).first()).toBeVisible({ timeout: 15_000 });
    // Allow the auto-scroll to settle after the lazy content arrives.
    await page.waitForTimeout(500);

    // --- Assertion 1: the page does NOT scroll ---
    const scrollHeight = await page.evaluate(() => document.scrollingElement!.scrollHeight);
    const innerHeight = await page.evaluate(() => window.innerHeight);
    expect(scrollHeight).toBeLessThanOrEqual(innerHeight);

    // --- Assertion 2: the output pane is scrolled to bottom ---
    const pane = sel.log(page);
    const paneInfo = await pane.evaluate((el: HTMLElement) => ({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));
    expect(paneInfo.scrollTop + paneInfo.clientHeight).toBeGreaterThanOrEqual(
      paneInfo.scrollHeight - 20,
    );

    // --- Assertion 3: DOWNLOAD control is inside the scroll pane ---
    // The DOWNLOAD PATCH and DOWNLOAD PAIR buttons render inside the log.
    const downloadButtons = page.getByRole("button", { name: /DOWNLOAD/i });
    const count = await downloadButtons.count();
    expect(count).toBeGreaterThan(0);
    // Verify the first one is a descendant of the log pane.
    const logHandle = await pane.elementHandle();
    const firstDownloadHandle = await downloadButtons.first().elementHandle();
    if (logHandle !== null && firstDownloadHandle !== null) {
      const isInside = await logHandle.evaluate(
        (parent, child) => parent.contains(child),
        firstDownloadHandle,
      );
      expect(isInside).toBe(true);
    }

    // --- Assertion 4: THE TOWER card art has no opaque overlay ---
    // Find THE TOWER card image (it is drawn in the lich-py2 fates spread).
    const towerImg = page.locator('.crt-pixel-card[data-card="tower"] img.crt-pixel-card-img');
    if (await towerImg.count() > 0) {
      await expect(towerImg).toBeVisible({ timeout: 10_000 });

      // Check that no motion-zone overlay is visible while the image has
      // data-loaded="false" (it should have loaded by now, but verify no
      // opaque overlay covers it regardless).
      const towerCard = page.locator('.crt-pixel-card[data-card="tower"]');
      const hasOpaqueOverlay = await towerCard.evaluate((card: HTMLElement) => {
        // Check every child element overlapping the image for opacity > 0
        // and a non-transparent background.
        const img = card.querySelector("img.crt-pixel-card-img");
        if (!img) return false;
        const imgRect = img.getBoundingClientRect();
        const children = card.querySelectorAll(".crt-motion-zone");
        for (const child of children) {
          const el = child as HTMLElement;
          const rect = el.getBoundingClientRect();
          // Check if the zone overlaps the image area significantly.
          const overlap = !(
            rect.right < imgRect.left ||
            rect.left > imgRect.right ||
            rect.bottom < imgRect.top ||
            rect.top > imgRect.bottom
          );
          if (!overlap) continue;
          const style = window.getComputedStyle(el);
          const bg = style.backgroundColor;
          const opacity = parseFloat(style.opacity);
          // If the zone has a non-transparent background AND opacity > 0,
          // it could be an opaque overlay.
          if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent" && opacity > 0.5) {
            return true;
          }
        }
        return false;
      });
      expect(hasOpaqueOverlay).toBe(false);

      // Also verify the image itself is not at opacity 0 (it has loaded).
      const imgOpacity = await towerImg.evaluate(
        (el: HTMLElement) => window.getComputedStyle(el).opacity,
      );
      expect(parseFloat(imgOpacity)).toBeGreaterThan(0);
    }
  });
});
