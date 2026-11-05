// apps/web/e2e/reduced-motion.e2e.ts
//
// Feature: 03-crt-terminal, task 32 — reduced-motion boot browser spec.
//
// Covers:
//   - R10.11 when the route loads with Motion_Preference `auto` and the
//            `prefers-reduced-motion: reduce` media query matches, the first
//            Output_Block is shown with NO typewriter reveal
//
// The spec forces the `prefers-reduced-motion: reduce` media query with
// `page.emulateMedia(...)` BEFORE navigating, so it matches on the very first
// paint while the default Motion_Preference is still `auto`. The boot block
// must therefore render in the `done` state with its full text present and
// never pass through `data-reveal="running"`.
//
// Planned-red: task 32.2 is not done; run by the maintainer via `pnpm e2e`.
//
// _Requirements: R10.11_

import { expect, test } from "@playwright/test";

import { BOOT_PHRASE, sel } from "./support/terminal.js";

test.describe("reduced-motion boot (R10.11)", () => {
  test("first block appears without a typewriter reveal", async ({ page }) => {
    // Force the OS-level reduced-motion query before the first paint so the
    // auto Motion_Preference resolves to `reduced` on boot (R10.11).
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const log = sel.log(page);
    await expect(log).toContainText(BOOT_PHRASE);

    // No block is ever in the animating (`running`) state under reduced motion.
    await expect(page.locator('section.crt-block[data-reveal="running"]')).toHaveCount(0);

    // The boot block is present and already fully revealed (data-reveal=done).
    const boot = page.locator('section.crt-block[data-reveal="done"]').first();
    await expect(boot).toContainText(BOOT_PHRASE);

    // No aria-hidden reveal copy exists when motion is reduced.
    await expect(page.locator(".crt-reveal")).toHaveCount(0);
  });
});
