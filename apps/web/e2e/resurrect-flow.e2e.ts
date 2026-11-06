// apps/web/e2e/resurrect-flow.e2e.ts
//
// Feature: resurrection-engine, task 17.1 — the end-to-end resurrection flow in
// the browser, driven entirely offline against the Mock/recorded path (no real
// network, LLM, or sandbox).
//
// The flow, mirroring `demo-flow.e2e.ts`'s mocked-live structure:
//   boot → summon a graveyard repo → read a spread (to bring a reading into
//   scope) → `resurrect` → the six Resurrection_Phases stream in order
//   (SELECT..DIFF) → the per-file before/after diff and the Residual_List
//   render → the Vitality_Delta and the changed-card line render → the
//   DOWNLOAD PATCH affordance appears.
//
// Transport: `mockRoutes` intercepts `/api/summon`, `/api/readings` AND
// `/api/resurrect` (the last added for this spec), so the whole path is
// deterministic and offline — the resurrection stream is a recorded NDJSON
// sequence (the six phases, then one `{ result }` line carrying a
// redaction-safe RitualResult). A `page.on("request", …)` guard fails the test
// if any request leaks to GitHub/PyPI/OSV or escapes the mocks.
//
// The DOM assertions anchor on the stable Oracle_Voice the `@necro/ui-crt`
// renderers emit for a resurrection result:
//   - the phase TOKENS the client surfaces from RESURRECT_PHASE_VOICE
//     (`SELECT`, `PRE_PASS`, … `DIFF`), in order;
//   - the per-file diff header `FILE src/legacy.py` and its `+`/`-` diff lines
//     (render/resurrect-diff.ts);
//   - the fully-converted Residual_List line (zero residuals, R8.3);
//   - the `VITALITY 40/100 -> 55/100 (+15)` line and the `JUDGEMENT` changed
//     card (render/resurrect-vitality.ts, R6.3/R6.4);
//   - the DOWNLOAD PATCH affordance (R7.3) — a clickable control that builds
//     the patch artifact client-side with no server round-trip.
//
// Planned-red: the terminal session reducer's `resurrect` command case (the
// api.resurrect effect, the diff/vitality result view and the DOWNLOAD PATCH
// affordance) is the remaining wiring for this flow; until it lands this spec
// is EXPECTED to fail / not-yet-run. Like the sibling e2e specs it is run by
// the maintainer via `pnpm --filter @necro/web e2e` (the Node/Playwright
// runtime and browser binaries may be absent on the authoring machine).
//
// _Requirements: R1.1, R7.1, R7.3, R9.1_

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  DEMO_LABEL,
  PRE_READING_PHRASE,
  RESURRECT_PHASES,
  bootTerminal,
  mockRoutes,
  runCommand,
  sel,
} from "./support/terminal.js";

test.describe("resurrection flow (R1.1, R7.1, R7.3, R9.1)", () => {
  test("summon → read → resurrect streams phases, renders the diff/vitality, and offers DOWNLOAD PATCH", async ({
    page,
  }) => {
    // Fail the test if ANY request leaks to the real network. The three mocked
    // `/api/*` routes are fulfilled by `mockRoutes`; a GitHub/PyPI/OSV hit or an
    // unmocked `/api/*` call flips this guard.
    let networkLeak = false;
    page.on("request", (req) => {
      const url = req.url();
      if (/github\.com|pypi\.org|osv\.dev|amazonaws\.com/.test(url)) {
        networkLeak = true;
      }
    });

    const calls = await mockRoutes(page);
    await bootTerminal(page);

    const log = sel.log(page);

    // Bring a reading into scope: summon the graveyard repo, then read it. The
    // resurrect command requires a completed reading (R1.6); this is the
    // offline live path, so no demo label appears.
    await runCommand(page, "summon graveyard/green-garden");
    await expect(log).toContainText("graveyard/green-garden");

    await runCommand(page, "read necropsy");
    await expect(log).toContainText(PRE_READING_PHRASE);
    await expect(log).toContainText("THE STAR");
    await expect(log).not.toContainText(DEMO_LABEL);

    // Resurrect every Python-2 candidate (bare target, R1.4). The recorded
    // resurrection stream drives the six phases then the terminal result line.
    await runCommand(page, "resurrect");

    // R9.1/R9.2 — the six Resurrection_Phases surface in order. The client keys
    // its progress display off each phase's token (RESURRECT_PHASE_VOICE), so
    // asserting the tokens appear, in document order, pins the ordered stream.
    for (const phase of RESURRECT_PHASES) {
      await expect(log).toContainText(phase);
    }

    // R7.1 — the per-file before/after diff renders: the file header and both a
    // removed (`-`) and an added (`+`) line for the single changed file.
    await expect(log).toContainText("FILE src/legacy.py");
    await expect(log).toContainText('- print "hello"');
    await expect(log).toContainText('+ print("hello")');

    // R8.3 — a fully-converted file states so (zero residuals).
    await expect(log).toContainText("Fully resurrected");

    // R6.3/R6.4 — the Vitality_Delta and the changed-card set render. The
    // recorded result raises vitality 40 → 55 (+15) and improves JUDGEMENT.
    await expect(log).toContainText("VITALITY 40/100 -> 55/100 (+15)");
    await expect(log).toContainText("JUDGEMENT");

    // R7.3 — the DOWNLOAD PATCH affordance appears: a clickable control that
    // builds the patch artifact in the browser with no server round-trip.
    const download = sel.button(page, "DOWNLOAD PATCH");
    await expect(download).toBeVisible();

    // Every mocked route was hit exactly on the path we drove; nothing leaked.
    expect(calls.summon).toBeGreaterThanOrEqual(1);
    expect(calls.readings).toBeGreaterThanOrEqual(1);
    expect(calls.resurrect).toBeGreaterThanOrEqual(1);
    expect(networkLeak, "resurrect flow must make no real network request").toBe(false);
  });
});

test.describe("axe on the post-resurrection screen (R15.1, R15.7)", () => {
  test("the rendered resurrection result has no axe violations", async ({ page }) => {
    await mockRoutes(page);
    await bootTerminal(page);

    await runCommand(page, "summon graveyard/green-garden");
    await runCommand(page, "read necropsy");
    await runCommand(page, "resurrect");

    const log = sel.log(page);
    // Through the terminal result line: once the diff header is present the
    // stream has settled and aria-busy is back to false.
    await expect(log).toContainText("FILE src/legacy.py");
    await expect(log).toHaveAttribute("aria-busy", "false");

    // The same AA rule set the booted-terminal and spread axe specs use, scoped
    // to the terminal, over the post-resurrection screen (diff + vitality +
    // DOWNLOAD PATCH). Mirrors `axe.e2e.ts`'s reusable scan pattern.
    const results = await new AxeBuilder({ page })
      .include("main.crt")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
