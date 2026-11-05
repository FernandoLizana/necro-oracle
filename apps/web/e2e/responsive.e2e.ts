// apps/web/e2e/responsive.e2e.ts
//
// Feature: 03-crt-terminal, task 32 — reflow / zoom browser spec.
//
// Covers:
//   - R15.8 content and operability survive 200% text zoom and a 320 CSS-pixel
//           viewport, with NO horizontal scrolling of the Command_Line and the
//           button row
//
// Two conditions are exercised:
//   1. A 320px-wide viewport: the `.crt-input` row and the `.crt-buttons` row
//      must each fit within the viewport (no horizontal overflow of either).
//   2. 200% text scaling, emulated by doubling the root font-size (text-only
//      zoom per WCAG 1.4.4): the same no-horizontal-overflow invariant holds.
//
// The check compares each row's `scrollWidth` to its `clientWidth` (a row that
// overflows horizontally has `scrollWidth > clientWidth`) and also asserts the
// document itself does not grow a horizontal scrollbar.
//
// Planned-red: task 32.2 is not done; run by the maintainer via `pnpm e2e`.
//
// _Requirements: R15.8_

import { expect, test, type Page } from "@playwright/test";

import { bootTerminal } from "./support/terminal.js";

/** True when the element scrolls horizontally (content wider than its box). */
async function overflowsX(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate((el) => {
    const node = el as HTMLElement;
    // Allow a 1px rounding tolerance.
    return node.scrollWidth - node.clientWidth > 1;
  });
}

/** True when the document has a horizontal scrollbar. */
async function documentOverflowsX(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth > 1;
  });
}

test.describe("320px width (R15.8)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("input and button rows do not scroll horizontally at 320px", async ({ page }) => {
    await bootTerminal(page);

    expect(await overflowsX(page, ".crt-input"), ".crt-input overflows x at 320px").toBe(false);
    expect(await overflowsX(page, ".crt-buttons"), ".crt-buttons overflows x at 320px").toBe(
      false,
    );
    expect(await documentOverflowsX(page), "document overflows x at 320px").toBe(false);
  });
});

/**
 * Apply text-only 200% zoom WITHOUT injecting a `<style>`/`<link>` tag. The
 * page serves a strict per-request CSP (`style-src 'self' 'nonce-...'`), which
 * correctly blocks `page.addStyleTag` AND any CSSOM mutation from page script
 * (e.g. `document.documentElement.style.fontSize = ...`). Both are page-origin
 * style and must stay blocked — we do not weaken the CSP.
 *
 * Instead we use the Chrome DevTools Protocol CSS domain to inject an
 * inspector-authored stylesheet (`CSS.createStyleSheet` + `CSS.setStyleSheetText`).
 * An inspector stylesheet is applied at the browser level, outside the page's
 * CSP, so it reflows the real layout exactly as a user's 200% text zoom would —
 * doubling the root font-size so every `rem`/`em`-based measure grows while the
 * viewport width is unchanged. This is the WCAG 1.4.4 text-only zoom case.
 */
async function applyRootFontZoom(page: Page, percent: number): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("DOM.enable");
  await client.send("CSS.enable");
  // The main frame id is needed to anchor the inspector stylesheet.
  const { frameTree } = await client.send("Page.getFrameTree");
  const frameId = frameTree.frame.id;
  const { styleSheetId } = await client.send("CSS.createStyleSheet", { frameId });
  await client.send("CSS.setStyleSheetText", {
    styleSheetId,
    text: `:root { font-size: ${percent}% !important; }`,
  });
}

test.describe("200% text zoom (R15.8)", () => {
  // A narrow-ish viewport combined with doubled text size is the harsh reflow
  // case WCAG 1.4.4 targets.
  test.use({ viewport: { width: 640, height: 720 } });

  test("input and button rows do not scroll horizontally at 200% text", async ({ page }) => {
    await bootTerminal(page);

    // Text-only zoom: double the root font size (so `rem`/`em`-based layout
    // reflows), leaving the viewport width unchanged. Injected via CDP so the
    // strict page CSP stays intact (no `<style>`/CSSOM page-origin style).
    await applyRootFontZoom(page, 200);

    expect(await overflowsX(page, ".crt-input"), ".crt-input overflows x at 200%").toBe(false);
    expect(await overflowsX(page, ".crt-buttons"), ".crt-buttons overflows x at 200%").toBe(
      false,
    );
    expect(await documentOverflowsX(page), "document overflows x at 200%").toBe(false);
  });
});
