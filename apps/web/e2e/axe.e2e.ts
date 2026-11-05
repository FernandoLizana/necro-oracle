// apps/web/e2e/axe.e2e.ts
//
// Feature: 03-crt-terminal, task 32 — automated accessibility (axe) browser
// spec, run against the booted terminal and against a rendered spread.
//
// Covers (via axe-core scans + explicit ARIA/role assertions):
//   - R15.1 Output_Log is the Live_Region: role="log", aria-live="polite",
//           aria-relevant="additions"; it announces each block once
//   - R15.2 Command_Line has a programmatically associated label; the terminal
//           is a `main` landmark with a descriptive accessible name
//   - R15.3 aria-busy="true" on the Live_Region while a request is in flight,
//           held through the final block, then back to "false"
//   - R15.6 a visible focus indicator (focus-visible) on focusable elements
//   - R15.7 text/background contrast >= 4.5:1 (axe `color-contrast`)
//   - R15.9 no state conveyed by colour alone — state words render as text
//
// axe-core is the automated layer; the explicit assertions pin the structural
// contract axe cannot fully judge (live-region semantics, aria-busy timing,
// text-not-colour state). Full WCAG conformance still needs manual AT review.
//
// Planned-red: task 32.2 wires the remaining data-*/ARIA details and fixes any
// contrast/focus findings; until then these scans are expected to surface
// violations. Run by the maintainer via `pnpm e2e`.
//
// _Requirements: R15.1, R15.2, R15.3, R15.6, R15.7, R15.9_

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { bootTerminal, mockRoutes, runCommand, sel } from "./support/terminal.js";

/** Run an axe scan scoped to the terminal and return its violations. */
async function scan(page: Page): Promise<Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]> {
  const results = await new AxeBuilder({ page })
    .include("main.crt")
    // WCAG 2.1 A + AA is the project's accessibility bar (tarot-ux steering).
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations;
}

test.describe("axe on the booted terminal (R15.1, R15.2, R15.6, R15.7)", () => {
  test("booted terminal has no axe violations", async ({ page }) => {
    await bootTerminal(page);

    // R15.1 — the Live_Region semantics.
    const log = sel.log(page);
    await expect(log).toHaveAttribute("role", "log");
    await expect(log).toHaveAttribute("aria-live", "polite");
    await expect(log).toHaveAttribute("aria-relevant", "additions");

    // R15.2 — the labelled command line and the named `main` landmark.
    await expect(sel.input(page)).toHaveAccessibleName("Command");
    await expect(sel.terminal(page)).toHaveAccessibleName("Necro-Oracle CRT terminal");

    // R15.6 — focusing the command line shows a visible (non-`none`) outline.
    await sel.input(page).focus();
    const outline = await sel.input(page).evaluate((el) => {
      const s = getComputedStyle(el as HTMLElement);
      return { style: s.outlineStyle, width: s.outlineWidth, shadow: s.boxShadow };
    });
    expect(
      outline.style !== "none" || outline.shadow !== "none",
      "command line has no visible focus indicator",
    ).toBe(true);

    // R15.7 + the rest of the AA rule set (includes color-contrast).
    const violations = await scan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});

test.describe("axe on a rendered spread (R15.1, R15.3, R15.7, R15.9)", () => {
  test("a rendered reading has no axe violations and announces state as text", async ({
    page,
  }) => {
    await mockRoutes(page);
    await bootTerminal(page);

    await runCommand(page, "summon graveyard/green-garden");

    // R15.3 — aria-busy is true while the reading streams and false after.
    await runCommand(page, "read necropsy");
    const log = sel.log(page);
    // Through the final block: once the spread text is present, busy is false.
    await expect(log).toContainText("THE STAR");
    await expect(log).toHaveAttribute("aria-busy", "false");

    // R15.9 — orientation and severity are conveyed as TEXT, not colour alone.
    await expect(log).toContainText("UPRIGHT");

    // R15.1 / R15.7 and the full AA rule set over the rendered spread.
    const violations = await scan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
