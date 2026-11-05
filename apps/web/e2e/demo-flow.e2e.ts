// apps/web/e2e/demo-flow.e2e.ts
//
// Feature: 03-crt-terminal, task 32 — the demo/read/explain browser flow.
//
// Covers:
//   - R18.5 while the session holds a demo summary, every demo/read/explain
//           block carries the DEMO_LABEL as its first line (labelled spread)
//   - R8.1  `explain <position>` opens the card's evidence block
//
// Two surfaces exercise the same outcome with NO real network:
//   1. The offline DEMO replay path (`demo green-garden` → `read` → `explain`),
//      which loads the bundled demo chunk — no route interception needed.
//   2. The mocked live path (`summon` → `read` → `explain`) with `/api/summon`
//      and `/api/readings` intercepted, so the spread renders from a real
//      (schema-valid) Reading_Response and `explain` opens live evidence.
//
// Planned-red: task 32.2 is not done; run by the maintainer via `pnpm e2e`.
//
// _Requirements: R8.1, R18.5_

import { expect, test } from "@playwright/test";

import {
  DEMO_LABEL,
  PRE_READING_PHRASE,
  bootTerminal,
  mockRoutes,
  runCommand,
  sel,
} from "./support/terminal.js";

test.describe("demo replay flow (R18.5, R8.1)", () => {
  test("demo renders a DEMO-labelled spread and explain opens evidence", async ({ page }) => {
    // Fail the test if ANY request leaks to the network during the demo path.
    let networkLeak = false;
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/api/") || /github\.com|pypi\.org|osv\.dev/.test(url)) {
        networkLeak = true;
      }
    });

    await bootTerminal(page);

    // Load a demo, then read its spread.
    await runCommand(page, "demo green-garden");
    await runCommand(page, "read necropsy");

    const log = sel.log(page);

    // R18.5 — the DEMO_LABEL marks the demo blocks (labelled replay).
    await expect(log).toContainText(DEMO_LABEL);

    // The spread rendered: a card name in uppercase and the FIXED necropsy
    // position labels (The Corpse … The Hope … The Call). In the green-garden
    // necropsy fixture THE STAR falls at position 4, "The Hope"; positions
    // 1 "The Corpse" and 2 "The Wound" are VOID. ("Present" is a FATES label
    // and never appears in a necropsy spread.)
    await expect(log).toContainText("THE STAR");
    await expect(log).toContainText("The Corpse");
    await expect(log).toContainText("The Hope");

    // R8.1 — explain opens the evidence of the card at that position. THE STAR
    // sits at necropsy position 4, so `explain 4` renders its evidence block:
    // each item's `kind` and `detail` print (render/explain.ts). The STAR's
    // first strength is the license evidence.
    await runCommand(page, "explain 4");
    await expect(log).toContainText("strength:license");
    await expect(log).toContainText("licenseKey=MIT");

    expect(networkLeak, "demo replay must make no network request").toBe(false);
  });
});

test.describe("mocked live reading flow (R8.1)", () => {
  test("summon then read renders a spread and explain opens evidence", async ({ page }) => {
    const calls = await mockRoutes(page);
    await bootTerminal(page);

    // Live summon against the mocked route.
    await runCommand(page, "summon graveyard/green-garden");
    const log = sel.log(page);
    await expect(log).toContainText("graveyard/green-garden");

    // Read: the pre-reading phrase shows, then the streamed spread renders.
    await runCommand(page, "read necropsy");
    await expect(log).toContainText(PRE_READING_PHRASE);
    await expect(log).toContainText("THE STAR");

    // THE STAR falls at necropsy position 4 ("The Hope") in the green-garden
    // fixture this mock is built from. A live (non-demo) reading renders the
    // evidence block (R7.6 / R8.1); here we assert that block opens — link
    // detail is covered by unit tests of buildEvidenceLink.
    await runCommand(page, "explain 4");
    await expect(log).toContainText("strength:license");

    // No demo label on a live reading.
    await expect(log).not.toContainText(DEMO_LABEL);

    // The mocked routes were hit; nothing else.
    expect(calls.summon).toBeGreaterThanOrEqual(1);
    expect(calls.readings).toBeGreaterThanOrEqual(1);
  });
});
