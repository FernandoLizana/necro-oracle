// apps/web/e2e/keyboard.e2e.ts
//
// Feature: 03-crt-terminal, task 32 — keyboard-first interaction browser spec.
//
// Covers:
//   - R3.3 Up/Down Arrow walk the command history, stopping at the oldest
//          entry and at an empty line without wrapping
//   - R3.4 Ctrl+L runs `clear`
//   - R3.5 Escape completes a running typewriter reveal immediately
//   - R3.6 Ctrl+C aborts an in-flight request and shows the interrupted note
//
// The in-flight abort uses a HANGING `/api/readings` route (fulfilled only when
// the spec releases it) so there is a deterministic window in which to press
// Ctrl+C — no real network, no race on timing.
//
// Planned-red: task 32.2 is not done; run by the maintainer via `pnpm e2e`.
//
// _Requirements: R3.3, R3.4, R3.5, R3.6_

import { expect, test } from "@playwright/test";

import { bootTerminal, runCommand, sel } from "./support/terminal.js";

test.describe("command history (R3.3)", () => {
  test("Up/Down walk history and stop without wrapping", async ({ page }) => {
    await bootTerminal(page);
    const input = sel.input(page);

    // Two non-empty entries (both land in history). `help` is local/offline.
    await runCommand(page, "help");
    await runCommand(page, "motion");

    // Up → most recent ("motion"); Up again → older ("help").
    await input.press("ArrowUp");
    await expect(input).toHaveValue("motion");
    await input.press("ArrowUp");
    await expect(input).toHaveValue("help");

    // At the oldest entry, a further Up does not wrap past it.
    await input.press("ArrowUp");
    await expect(input).toHaveValue("help");

    // Down returns toward newer, then to the empty line, and stops there.
    await input.press("ArrowDown");
    await expect(input).toHaveValue("motion");
    await input.press("ArrowDown");
    await expect(input).toHaveValue("");
    await input.press("ArrowDown");
    await expect(input).toHaveValue("");
  });
});

test.describe("Ctrl+L clears (R3.4)", () => {
  test("Ctrl+L executes clear and empties the log of prior blocks", async ({ page }) => {
    await bootTerminal(page);
    const input = sel.input(page);
    const log = sel.log(page);

    await runCommand(page, "help");
    await expect(log).toContainText("summon");

    await input.press("Control+l");

    // `clear` removes prior blocks and shows a single "screen cleared" block
    // (R15.10); the help listing must be gone.
    await expect(log).not.toContainText("summon");
    await expect(sel.blocks(page)).toHaveCount(1);
  });
});

test.describe("Escape completes reveal (R3.5)", () => {
  // Full-motion project: the typewriter reveal runs, so Escape has something to
  // complete. The `help` block is long enough to still be revealing briefly.
  test("Escape finishes a running typewriter reveal at once", async ({ page }) => {
    await bootTerminal(page);
    const input = sel.input(page);

    await input.fill("help");
    await input.press("Enter");

    // While revealing, the block carries data-reveal="running".
    const running = page.locator('section.crt-block[data-reveal="running"]');
    // Pressing Escape must drive every block to the done state immediately.
    await input.press("Escape");
    await expect(running).toHaveCount(0);
    // The full help text is now present (reveal completed, not truncated).
    await expect(sel.log(page)).toContainText("explain");
  });
});

test.describe("Ctrl+C aborts an in-flight request (R3.6)", () => {
  test("Ctrl+C interrupts a pending reading and shows the interrupted note", async ({ page }) => {
    // A hanging summon so a request is genuinely in flight when Ctrl+C fires.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/summon", async (route) => {
      await gate; // never resolves until the spec releases it (it does not)
      await route.fulfill({ status: 200, body: "{}" });
    });

    await bootTerminal(page);
    const input = sel.input(page);

    await runCommand(page, "summon graveyard/green-garden");

    // The request is in flight: the Live_Region reports work in progress.
    const log = sel.log(page);
    await expect(log).toHaveAttribute("aria-busy", "true");

    // Ctrl+C aborts it and shows the in-world interrupted message (R3.6).
    await input.press("Control+c");
    await expect(log).toContainText(/interrupt|interrupted/i);
    await expect(log).toHaveAttribute("aria-busy", "false");

    release?.();
  });
});
