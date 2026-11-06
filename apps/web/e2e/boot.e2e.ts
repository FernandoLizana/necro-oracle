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

import { BOOT_PHRASE, BOOT_SKIP_QUERY, NOSCRIPT_NOTE, sel } from "./support/terminal.js";

test.describe("boot (R1.1, R1.2, R15.4)", () => {
  test("shows the boot phrase and focuses the command line", async ({ page }) => {
    // Navigate with `?boot=skip` so this spec lands on the ready prompt without
    // waiting out the Boot_Sequence animation — the full-motion boot is
    // exercised only by `visual-necromancy.e2e.ts`. The boot phrase is the
    // first Output_Block regardless of the skip, so the R1.1 assertion holds.
    await page.goto(`/${BOOT_SKIP_QUERY}`);

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
  // document. The authoritative no-JS note is a PLAIN, VISIBLE element the root
  // layout server-renders in <body> (`#no-js-note.crt-no-js`), so it carries
  // the boot phrase and the requires-JavaScript line with no JavaScript and no
  // reliance on <noscript> content being promoted to live DOM (Chromium does
  // not surface <noscript> text to these queries). The client only hides it —
  // via `html[data-js="ready"]` — once the terminal mounts, which never happens
  // here, so the note stays visible.
  test.use({ javaScriptEnabled: false });

  test("static document shows the phrase and the requires-JS note", async ({ page }) => {
    await page.goto("/");

    // The visible fallback element is present and rendered (not display:none),
    // and carries the exact note `${BOOT_PHRASE} — The terminal requires
    // JavaScript.` (NOSCRIPT_NOTE). Because the terminal never mounts with JS
    // disabled, `html[data-js="ready"]` is never set and the note stays shown.
    const note = page.locator("#no-js-note");
    await expect(note).toBeVisible();
    await expect(note).toHaveText(NOSCRIPT_NOTE);

    // And it surfaces in the rendered body text (where the prior fragile
    // <noscript>-only approach did not, offline).
    await expect(page.locator("body")).toContainText(NOSCRIPT_NOTE);
    await expect(page.locator("body")).toContainText(BOOT_PHRASE);
    await expect(page.locator("body")).toContainText("requires JavaScript");

    // Belt and braces: the secondary <noscript> fallback is still present and
    // its serialized innerHTML carries the note even though its textContent
    // reads empty.
    const noscriptHtml = await page
      .locator("noscript")
      .first()
      .evaluate((el) => (el as HTMLElement).innerHTML);
    expect(noscriptHtml).toContain("requires JavaScript");
  });
});
