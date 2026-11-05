// apps/web/e2e/boot.e2e.ts
//
// Feature: 03-crt-terminal, task 32 — boot and no-JS browser specs.
//
// Covers:
//   - R1.1  the boot phrase is the first thing the booted terminal shows
//   - R1.2  a command-line prompt appears and keyboard focus moves to it
//   - R15.4 focus lands on the Command_Line when the route finishes loading
//   - R1.5  with JavaScript disabled the static document still carries the boot
//           phrase AND the "requires JavaScript" note
//
// Planned-red: task 32.2 (data-*/ARIA adjustments) is not done, so some role
// queries may not yet resolve; run by the maintainer via `pnpm e2e`.
//
// _Requirements: R1.1, R1.2, R1.5, R15.4_

import { expect, test } from "@playwright/test";

import { BOOT_PHRASE, NOSCRIPT_NOTE, sel } from "./support/terminal.js";

test.describe("boot (R1.1, R1.2, R15.4)", () => {
  test("shows the boot phrase and focuses the command line", async ({ page }) => {
    await page.goto("/");

    // R1.1 — the boot phrase is present in the live log.
    const log = sel.log(page);
    await expect(log).toContainText(BOOT_PHRASE);

    // R1.2 / R15.4 — the command line exists and holds keyboard focus.
    const input = sel.input(page);
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();

    // The terminal landmark carries its accessible name (R15.2 smoke check).
    await expect(sel.terminal(page)).toBeVisible();
  });
});

test.describe("no JavaScript (R1.5)", () => {
  // A browser context with scripting disabled: the page stays a static
  // document. The `<noscript>` content becomes visible and must carry both the
  // boot phrase and the statement that the terminal requires JavaScript.
  test.use({ javaScriptEnabled: false });

  test("static document shows the phrase and the requires-JS note", async ({ page }) => {
    await page.goto("/");

    // With scripting disabled Chromium renders the <noscript> CONTENTS as live
    // DOM nodes, so the note is visible in the document body — but the
    // <noscript> element's own `textContent` reads empty. So assert against the
    // rendered body text (where the note actually appears), not the <noscript>
    // element. The exact note the Terminal renders is `${BOOT_PHRASE} — The
    // terminal requires JavaScript.` (NOSCRIPT_NOTE).
    await expect(page.locator("body")).toContainText(NOSCRIPT_NOTE);
    await expect(page.locator("body")).toContainText(BOOT_PHRASE);
    await expect(page.locator("body")).toContainText("requires JavaScript");

    // Belt and braces: the <noscript> element is present and its serialized
    // innerHTML carries the note even though its textContent is empty.
    const noscriptHtml = await page
      .locator("noscript")
      .evaluate((el) => (el as HTMLElement).innerHTML);
    expect(noscriptHtml).toContain("requires JavaScript");
  });
});
