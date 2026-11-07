// apps/web/e2e/landing.e2e.ts
//
// Feature: oracle-landing-polish, task 13.1 — the DMG Landing_State end-to-end
// browser suite. It exercises the idle landing the terminal shows on the
// fresh, post-boot, pre-command screen (the booted-idle screen `?boot=skip`
// lands on), entirely offline against the Mock / recorded path (no real
// GitHub, LLM, sandbox, or network).
//
// Covers:
//   - R1.1 / R8.1 the idle landing renders the HUD, the LEGACY REPOS list, the
//          PREVIEW (Seer visible on the idle landing — the Part B bug-1 fix),
//          the three card backs, the ORACLE SAYS line, and the hint bar.
//   - R7.8 / R7.9 keyboard selection: ArrowDown/ArrowUp move the selected
//          option (aria-selected follows, clamped, no wrap); the command chips
//          and the `NECRO>` input stay operable while the landing is visible.
//   - R5.1 activating a concrete repo runs `summon` then `read fates`, the
//          landing dismisses, AND the reading actually renders (the summon's
//          single-in-flight guard no longer swallows the chained read — the
//          read is dispatched once the summon RESOLVES). The ENTER row focuses
//          the `NECRO>` input and does NOT summon (the landing stays visible).
//   - R2.3 `home` returns to the landing after it was dismissed.
//          `B`/`D` runs demo; `H` runs help.
//   - R20.1 / R20.2 axe reports zero WCAG 2.1 A/AA violations on the idle
//          landing and on an in-world error state.
//   - R16.2 under reduced motion no landing animation runs.
//
// Transport: `mockRoutes` intercepts `/api/summon` + `/api/readings` with the
// schema-valid green-garden fixture, so activating ANY concrete landing repo
// drives the mocked summon → read with no live network (regardless of ref).
// A github/pypi/osv/amazonaws request would be aborted by `mockRoutes`; the
// axe + reduced-motion tests additionally guard against any leak.
//
// These specs are run by the maintainer via `pnpm --filter @necro/web e2e`
// (the Playwright browser binaries may be absent on some machines).
//
// _Requirements: R1.1, R2.3, R5.1, R7.8, R7.9, R8.1, R16.2, R20.1, R20.2_

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  bootTerminal,
  mockRoutes,
  PRE_READING_PHRASE,
  runCommand,
  sel,
} from "./support/terminal.js";

// --- Local selectors for the DMG Landing_State DOM (mirror the components) --
//
// Each anchor is the stable role/class the real `@necro/ui-crt` landing
// components render, not invented copy: the landing region is a
// `role="region"` aria-label "Legacy repository landing" (Landing.tsx); the
// LEGACY REPOS list is a `role="listbox"` aria-label "Legacy repositories"
// with `role="option"` rows (LegacyRepoList.tsx); the HUD/hint/preview carry
// the `.crt-landing-*` classes (HudBar / HintBar / PreviewWindow). The Seer
// portrait reuses `.crt-seer-portrait` and the card backs `.crt-landing-cardback`.
const landing = {
  region: (page: Page): Locator =>
    page.getByRole("region", { name: "Legacy repository landing" }),
  list: (page: Page): Locator =>
    page.getByRole("listbox", { name: "Legacy repositories" }),
  options: (page: Page): Locator =>
    page.getByRole("listbox", { name: "Legacy repositories" }).getByRole("option"),
  selectedOption: (page: Page): Locator =>
    page
      .getByRole("listbox", { name: "Legacy repositories" })
      .locator('[role="option"][aria-selected="true"]'),
  hud: (page: Page): Locator => page.locator(".crt-landing-hud"),
  hint: (page: Page): Locator => page.locator(".crt-landing-hint"),
  preview: (page: Page): Locator => page.locator(".crt-landing-preview"),
  seer: (page: Page): Locator =>
    page.locator(".crt-landing-preview .crt-seer-portrait"),
  cardBacks: (page: Page): Locator => page.locator(".crt-landing-cardback"),
  oracleSays: (page: Page): Locator => page.locator(".crt-landing-oracle-says"),
} as const;

/** The WCAG 2.1 A + AA rule set the whole suite uses (mirrors `axe.e2e.ts`). */
async function scan(
  page: Page,
): Promise<Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]> {
  const results = await new AxeBuilder({ page })
    .include("main.crt")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations;
}

/**
 * Attach a request guard that flips `leaked.hit` if any request reaches the
 * real network (github/pypi/osv/amazonaws). The landing surfaces make no
 * `/api/*` call until a repo is activated, and `mockRoutes` fulfils those
 * locally, so only an external host trips it.
 */
function guardNetwork(page: Page): { hit: boolean } {
  const leaked = { hit: false };
  page.on("request", (req) => {
    if (/github\.com|pypi\.org|osv\.dev|amazonaws\.com/.test(req.url())) {
      leaked.hit = true;
    }
  });
  return leaked;
}

test.describe("idle landing renders (R1.1, R8.1)", () => {
  test("the HUD, list, preview with the Seer, card backs, oracle line, and hint bar all render", async ({
    page,
  }) => {
    const leaked = guardNetwork(page);

    // `?boot=skip` lands on the booted-idle screen where the landing IS
    // visible (boot done, landing not dismissed, log holds only the boot
    // banner, summary null).
    await bootTerminal(page);

    // R1.1 — the landing region is on screen as a named `region` landmark.
    const region = landing.region(page);
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute("role", "region");

    // The LEGACY REPOS listbox with its four options (three concrete repos
    // then the "> ENTER ANY REPO..." row).
    await expect(landing.list(page)).toBeVisible();
    await expect(landing.options(page)).toHaveCount(4);

    // The HUD chrome: NECRO-ORACLE and PY2 CURSE: ACTIVE (scoped to the HUD so
    // the BOOT_PHRASE's own "NECRO-ORACLE" in the log never matches here).
    await expect(landing.hud(page)).toContainText("NECRO-ORACLE");
    await expect(landing.hud(page)).toContainText("PY2 CURSE: ACTIVE");

    // The fixed key-binding hint strip.
    await expect(landing.hint(page)).toContainText(
      "\u25b2\u25bc SELECT  A:SUMMON  B:DEMO  START:HELP",
    );

    // R8.1 — the Seer's face is visible on the idle landing (the Part B bug-1
    // fix: the Seer is mounted in the PREVIEW whenever the landing is visible,
    // independent of boot phase).
    await expect(landing.seer(page)).toBeVisible();

    // Three face-down eye/moon card backs and the ORACLE SAYS line.
    await expect(landing.cardBacks(page)).toHaveCount(3);
    await expect(landing.oracleSays(page)).toBeVisible();
    await expect(landing.oracleSays(page)).not.toBeEmpty();

    expect(leaked.hit, "idle landing must make no real network request").toBe(false);
  });
});

test.describe("keyboard selection moves the inverted row, clamped (R7.8, R7.9)", () => {
  test("ArrowDown advances the selected option by one and ArrowUp returns, no wrap", async ({
    page,
  }) => {
    await bootTerminal(page);
    const options = landing.options(page);
    const region = landing.region(page);
    await expect(options).toHaveCount(4);

    // The first row starts selected (local cursor index 0).
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");

    // Focus the landing region so the root keydown handler (which lives on the
    // landing container, not window) sees the key presses. The root is
    // keyboard-focusable (tabIndex 0) so a keyboard user can Tab in and drive
    // the list.
    await region.focus();
    await expect(region).toBeFocused();

    // ArrowDown advances the selection by exactly one — the inverted row
    // follows the cursor (R7.8).
    await region.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "false");

    // ArrowUp returns to the previous row (R7.8).
    await region.press("ArrowUp");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");

    // ArrowUp at the first row does not wrap past the top (clamped).
    await region.press("ArrowUp");
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");

    // Drive to the last row: three ArrowDowns reach option index 3.
    await region.press("ArrowDown");
    await region.press("ArrowDown");
    await region.press("ArrowDown");
    await expect(options.nth(3)).toHaveAttribute("aria-selected", "true");

    // A further ArrowDown does not wrap past the last row (clamped, no wrap).
    await region.press("ArrowDown");
    await expect(options.nth(3)).toHaveAttribute("aria-selected", "true");

    // Exactly one option is ever selected.
    await expect(landing.selectedOption(page)).toHaveCount(1);
  });
});

test.describe("activating a concrete repo summons then reads, and dismisses (R5.1)", () => {
  test("Enter on the first repo runs summon + read fates, the landing disappears, and the reading renders", async ({
    page,
  }) => {
    // `mockRoutes` intercepts ANY `/api/summon` + `/api/readings` with the
    // green-garden fixture, so activating any concrete landing repo drives the
    // mocked summon → read regardless of its ref — no live network. Note the
    // readings mock serves the green-garden NECROPSY fixture for /api/readings
    // regardless of the requested spread, so `read fates` resolves to that
    // reading's content (its drawn "star" card → "THE STAR").
    const calls = await mockRoutes(page);
    await bootTerminal(page);

    const options = landing.options(page);
    const region = landing.region(page);
    await expect(region).toBeVisible();

    // The first concrete repo is the default selection. Focus the region and
    // activate the selected row with Enter (R5.1).
    await region.focus();
    await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
    await region.press("Enter");

    const log = sel.log(page);

    // The first accepted command dismissed the landing: the region is gone.
    await expect(landing.region(page)).toHaveCount(0);

    // Activation dispatched `summon <ref>`. The mocked summon settled: the
    // summoned repo's acknowledgement is in the log and the summon route was
    // hit — `mockRoutes` serves the green-garden summary for any ref, so the
    // pinned-repo line appears regardless of the landing ref.
    await expect(log).toContainText("The repository answers the summons.");
    await expect(log).toContainText("graveyard/green-garden");
    expect(calls.summon).toBeGreaterThanOrEqual(1);

    // The FULL R5.1 contract: `read fates` actually ran once the summon
    // resolved (it is no longer swallowed by the single-in-flight guard). The
    // pre-reading phrase leads the read, and the reading content renders — the
    // green-garden fixture draws THE STAR and a vitality gauge closes it.
    await expect(log).toContainText(PRE_READING_PHRASE);
    await expect(log).toContainText("THE STAR");
    await expect(log).toContainText("VITALITY");
    expect(
      calls.readings,
      "the chained read fates must reach the readings route",
    ).toBeGreaterThanOrEqual(1);

    // The read settled: the live region is no longer busy.
    await expect(log).toHaveAttribute("aria-busy", "false");
  });

  test("the ENTER row focuses the NECRO> input and does not summon; the landing stays", async ({
    page,
  }) => {
    const calls = await mockRoutes(page);
    await bootTerminal(page);

    const options = landing.options(page);
    // The fourth option is the "> ENTER ANY REPO..." row. A click selects AND
    // activates it in one gesture (mouse path), equivalent to focusing it and
    // pressing Enter via the keyboard bindings.
    const enterRow = options.nth(3);
    await enterRow.click();

    // Activating the ENTER row focuses the command line and dispatches NO
    // summon (R5.1, R5.2): the input holds focus and the landing is unchanged.
    await expect(sel.input(page)).toBeFocused();
    await expect(landing.region(page)).toBeVisible();
    expect(calls.summon, "the ENTER row never summons").toBe(0);
  });
});

test.describe("home round-trip restores the landing (R2.3)", () => {
  test("a command dismisses the landing and `home` brings it back", async ({ page }) => {
    await bootTerminal(page);
    await expect(landing.region(page)).toBeVisible();

    // Any accepted command dismisses the landing (offline `help`).
    await runCommand(page, "help");
    await expect(landing.region(page)).toHaveCount(0);

    // `home` empties the log and restores the idle landing (R2.3).
    await runCommand(page, "home");
    await expect(landing.region(page)).toBeVisible();
    await expect(landing.options(page)).toHaveCount(4);
  });
});

test.describe("B/D demo and H help key bindings (R7.8)", () => {
  test("pressing `b` on the landing runs the demo catalog and dismisses", async ({ page }) => {
    await bootTerminal(page);
    const region = landing.region(page);
    await region.focus();

    // `b` (and `d`) map to the demo binding — `demo` with no name lists the
    // recorded-reading catalog.
    await region.press("b");

    const log = sel.log(page);
    await expect(log).toContainText("The crypt holds these recorded readings:");
    await expect(log).toContainText("lich-py2");
    await expect(landing.region(page)).toHaveCount(0);
  });

  test("pressing `h` on the landing runs help and dismisses", async ({ page }) => {
    await bootTerminal(page);
    const region = landing.region(page);
    await region.focus();

    // `h` maps to the help binding — the static command grimoire.
    await region.press("h");

    const log = sel.log(page);
    await expect(log).toContainText("COMMANDS");
    await expect(landing.region(page)).toHaveCount(0);
  });
});

test.describe("the command line and chips stay operable while the landing shows (R7.8, R7.9)", () => {
  test("typing into NECRO> works and the HELP chip is clickable with the landing visible", async ({
    page,
  }) => {
    await bootTerminal(page);
    await expect(landing.region(page)).toBeVisible();

    // The `NECRO>` input is present and operable while the landing is visible:
    // typing a command into it and submitting it works (the landing never traps
    // focus or steals the key stream — the keydown handler lives on the landing
    // root, not window, so a sibling input is untouched).
    const input = sel.input(page);
    await input.click();
    await input.fill("help");
    await input.press("Enter");

    const log = sel.log(page);
    await expect(log).toContainText("COMMANDS");
    // The first accepted command dismissed the landing.
    await expect(landing.region(page)).toHaveCount(0);

    // Restore the landing and confirm a command chip is clickable with the
    // landing visible: `home` brings the landing back, then the HELP button in
    // the button row activates without the landing intercepting it.
    await runCommand(page, "home");
    await expect(landing.region(page)).toBeVisible();
    await sel.button(page, "HELP").click();
    await expect(log).toContainText("COMMANDS");
  });
});

test.describe("axe: zero violations on the idle landing and on an error state (R20.1, R20.2)", () => {
  test("the idle landing has no axe violations", async ({ page }) => {
    await bootTerminal(page);
    await expect(landing.region(page)).toBeVisible();
    // The idle screen is settled; the live region is not busy.
    await expect(sel.log(page)).toHaveAttribute("aria-busy", "false");

    const violations = await scan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  test("an in-world error state has no axe violations", async ({ page }) => {
    // Drive a bad-repo (404) summon so the reducer renders the oracle-voice
    // error block (REPO_NOT_FOUND → "No repository answers by this name.").
    await page.route("**/api/summon", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({
          error: {
            code: "REPO_NOT_FOUND",
            userMessage: "No repository answers by this name.",
          },
        }),
      });
    });

    await bootTerminal(page);
    await runCommand(page, "summon owner/does-not-exist");

    const log = sel.log(page);
    // The in-world error surfaced (and the landing dismissed on the command).
    await expect(log).toContainText("No repository answers by this name.");
    await expect(log).toHaveAttribute("aria-busy", "false");

    const violations = await scan(page);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});

test.describe("reduced motion: no landing animation runs (R16.2)", () => {
  test("with prefers-reduced-motion the landing renders static (no running animation)", async ({
    page,
  }) => {
    const leaked = guardNetwork(page);

    // Force the OS-level reduced-motion query BEFORE the first paint, so the
    // auto Motion_Preference resolves to `reduced` on boot (same mechanism as
    // reduced-motion.e2e.ts / arcana.e2e.ts).
    await page.emulateMedia({ reducedMotion: "reduce" });

    await bootTerminal(page);

    // The terminal resolved reduced Motion_Mode: the root landmark carries
    // data-motion="reduced", and the landing region mirrors it as its motion
    // zone marker (R16.2).
    await expect(sel.terminal(page)).toHaveAttribute("data-motion", "reduced");
    const region = landing.region(page);
    await expect(region).toBeVisible();
    await expect(region).toHaveAttribute("data-motion", "reduced");

    // No landing element reports a RUNNING CSS animation under reduced motion:
    // the candle-flicker / cursor-blink keyframes live only inside the
    // `.crt[data-motion="full"]` motion zones, so with the zone marked
    // "reduced" every descendant resolves `animation-name: none` (R16.2).
    const runningCount = await region.evaluate((root) => {
      const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
      let running = 0;
      for (const node of nodes) {
        const name = getComputedStyle(node as Element).animationName;
        if (name && name !== "none") running += 1;
      }
      return running;
    });
    expect(runningCount, "no landing element animates under reduced motion").toBe(0);

    expect(leaked.hit, "reduced-motion landing must make no real network request").toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Task 19.1 — no vertical scroll + every landing part within the viewport (R29)
// ---------------------------------------------------------------------------
//
// R29 (viewport fit): at the three desktop sizes the judges capture at, the
// whole idle landing must fit on screen with NO vertical scrollbar, and every
// landing part must be fully inside the viewport (not clipped off any edge).
// This is the e2e that proves the height-bounded preview (task 18.1) and the
// no-overflow layout (task 18.2) actually fit, not just at one size but across
// 1280×720, 1366×768 and 1920×1080.
//
// Transport: the idle landing makes NO `/api/*` call, so `guardNetwork` alone
// is enough — nothing to mock. The viewport is set BEFORE `bootTerminal` so the
// landing lays out at the target size from the first paint.
//
// _Requirements: R29_

/** The three desktop capture sizes R29 pins the no-scroll / fit contract to. */
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

/**
 * True when the scrolling root overflows vertically — content taller than its
 * box grows a vertical scrollbar (`scrollHeight > clientHeight`). Checks the
 * documentElement (the scrolling root) and double-checks `document.body`, with
 * a 1px rounding tolerance. Mirrors the horizontal `documentOverflowsX` helper
 * in `responsive.e2e.ts`.
 */
async function documentOverflowsY(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const roots = [document.documentElement, document.body];
    return roots.some((root) => root.scrollHeight - root.clientHeight > 1);
  });
}

/**
 * Assert a single element is fully within the viewport: its bounding rect top
 * and left are >= 0 and its bottom/right are <= the viewport inner size, with a
 * ~1px sub-pixel epsilon. Reads the rect in-page so the assertion sees the same
 * layout the browser paints. Fails with the element label and its rect so a
 * regression names the offending part and size.
 */
async function expectInViewport(
  locator: Locator,
  label: string,
  size: { width: number; height: number },
): Promise<void> {
  // The element must be present and laid out before its rect is meaningful.
  await expect(locator, `${label} should be visible`).toBeVisible();
  const rect = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });
  const eps = 1;
  const why = `${label} escapes the ${size.width}×${size.height} viewport: ${JSON.stringify(
    rect,
  )}`;
  expect(rect.top, why).toBeGreaterThanOrEqual(-eps);
  expect(rect.left, why).toBeGreaterThanOrEqual(-eps);
  expect(rect.bottom, why).toBeLessThanOrEqual(size.height + eps);
  expect(rect.right, why).toBeLessThanOrEqual(size.width + eps);
}

test.describe("the whole landing fits the viewport with no vertical scroll (R29)", () => {
  for (const size of VIEWPORTS) {
    test(`at ${size.width}×${size.height}: no vertical scrollbar and every landing part is in view`, async ({
      page,
    }) => {
      const leaked = guardNetwork(page);

      // Size the viewport BEFORE booting so the landing lays out at the target
      // size from the first paint (not reflowed after the fact).
      await page.setViewportSize({ width: size.width, height: size.height });
      await bootTerminal(page);

      // The idle landing is on screen (boot done, not dismissed).
      const region = landing.region(page);
      await expect(region).toBeVisible();

      // (a) The scrolling root shows NO vertical scrollbar — the landing plus
      // the shell (boot banner, input, chips) fit the viewport height (R29).
      expect(
        await documentOverflowsY(page),
        `document overflows vertically at ${size.width}×${size.height}`,
      ).toBe(false);

      // (b) Each landing part is fully within the viewport.
      // The HUD_Bar.
      await expectInViewport(landing.hud(page), "HUD_Bar", size);

      // The Legacy_Repo_List (role="listbox" name "Legacy repositories").
      await expectInViewport(landing.list(page), "Legacy_Repo_List", size);

      // Each of the three Card_Backs.
      const backs = landing.cardBacks(page);
      await expect(backs).toHaveCount(3);
      for (let i = 0; i < 3; i += 1) {
        await expectInViewport(backs.nth(i), `Card_Back[${i}]`, size);
      }

      // The ORACLE SAYS line and the Hint_Bar.
      await expectInViewport(landing.oracleSays(page), "ORACLE_SAYS", size);
      await expectInViewport(landing.hint(page), "Hint_Bar", size);

      // The boot banner line — the first Output_Block in the log carries the
      // BOOT_PHRASE (the reducer prepends it on every path). The first
      // `.crt-block` section is that banner.
      await expectInViewport(
        sel.log(page).locator("section.crt-block").first(),
        "boot banner line",
        size,
      );

      // The `NECRO>` command line input.
      await expectInViewport(sel.input(page), "NECRO> input", size);

      // The command chips — every button in the command-shortcuts row. Each
      // chip must sit within the viewport (none clipped off the bottom/side).
      const chips = page
        .getByRole("group", { name: "Command shortcuts" })
        .getByRole("button");
      const chipCount = await chips.count();
      expect(chipCount, "the command-shortcut chip row should render buttons").toBeGreaterThan(
        0,
      );
      for (let i = 0; i < chipCount; i += 1) {
        await expectInViewport(chips.nth(i), `command chip[${i}]`, size);
      }

      expect(
        leaked.hit,
        "the idle landing must make no real network request",
      ).toBe(false);
    });
  }
});
