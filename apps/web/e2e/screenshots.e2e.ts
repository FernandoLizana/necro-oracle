// apps/web/e2e/screenshots.e2e.ts
//
// Feature: visual-necromancy, task 22.1 — marketing screenshot capture for the
// README and the Devpost write-up. This is a CAPTURE-ONLY spec: it adds NO
// production code and alters NO Visual_Layer code. It drives the SAME offline
// demo path and mocked resurrection stream as `visual-necromancy.e2e.ts`, in
// FULL motion, and writes four deterministic PNGs into `docs/screenshots/`.
//
// Determinism: the demo path is seeded by `DEMO_SEED` (glitch + rot), so the
// Tower glitch frame and the resurrection rot are reproducible run-to-run. No
// network is touched — the demo reading loads the bundled offline chunk and the
// resurrection uses `mockRoutes` (recorded NDJSON), matching the visual spec.
//
// This spec is SKIPPED by default so the normal `pnpm --filter @necro/web e2e`
// run (and CI) is unaffected and never writes files into `docs/`. A maintainer
// or a dedicated CI job captures the images with the capture flag set:
//
//     CAPTURE_SCREENSHOTS=1 pnpm --filter @necro/web screenshots
//
// (the `screenshots` script in `apps/web/package.json` runs
// `playwright test screenshots.e2e.ts` with that flag). If Playwright cannot
// launch a browser on the host, point it at a local channel, e.g.
// `PLAYWRIGHT_CHROMIUM_CHANNEL=msedge` or `=chrome`.
//
// The four shots:
//   (1) boot logo frame — the `.crt-boot-overlay` while the NECROMANTIC
//       SYSTEMS 1986 wordmark is on screen (navigated WITHOUT `?boot=skip`),
//       captured with the virtual clock FROZEN on the logo step so the
//       otherwise ~500 ms logo window is deterministic (see `bootLogoShot`);
//   (2) a full 3-card reading — after `demo lich-py2` / `read fates`, with the
//       reveal completed via Escape, showing the framed ASCII cards;
//   (3) THE TOWER glitch frame — the burning Tower card element in full motion;
//   (4) the resurrection diff — after `resurrect`, once the rot overlay reaches
//       `data-rot="done"` and the unchanged diff is in the log.
//
// Arcana_Visions (task 25) adds four MORE deterministic frames for the
// pixel-art Visual_Layer, each in its OWN test so fake and real clocks never
// mix within a single test (the same isolation the boot-logo shot above uses):
//   (5) the Spread_View with Pixel_Cards — after `demo lich-py2` / `read fates`
//       the terminal renders the integer-scaled pixel spread (`.crt-spread-pixel`)
//       because the `apps/web` Arcana manifest is present; captured on a
//       normally-clocked page (no clock needed — the spread is a static layout);
//   (6) a Fullscreen_Card_View — click a `.crt-pixel-card` (a `role="dialog"`
//       opener) and wait for the `.crt-fullscreen-card` modal, then screenshot it;
//       also normally-clocked;
//   (7) the Resurrection_Ritual open-book frame — navigate with `?ritual=force`
//       (task 20's flag) so the Necronomicon ritual plays even under a Playwright
//       run, with the virtual clock FROZEN on the `crossfade` step (the open book
//       fading in over the closed one) via `page.clock.pauseAt`, mirroring how
//       `bootLogoShot` freezes on the logo step so an otherwise ~600 ms window is
//       deterministic;
//   (8) the landing with the Seer_Image — the Seer mounts only while
//       `state.boot.phase === "playing"` (Terminal.tsx renders
//       `.crt-seer-region[data-boot-seer="playing"]` with `.crt-seer-portrait`
//       during boot), so this reuses the boot-logo freeze technique: navigate
//       WITHOUT `?boot=skip` and PAUSE the clock mid-boot so the boot phase holds
//       "playing" and the Seer stays on screen for a stable capture.
//
// Oracle_Landing_Polish (task 13.2) adds two MORE deterministic frames for the
// DMG Landing_State (R21.5), each in its OWN normally-clocked test (the landing
// is a static screen — no clock control needed):
//   (9) the idle DMG landing (mockup concept3) — navigate WITH `?boot=skip`
//       (`bootTerminal`) so the boot is already done and the landing IS visible
//       on the idle screen (the Part B fix mounts the Seer on the idle landing
//       now, independent of boot phase, so no mid-boot freeze is needed unlike
//       shot 08). Waits for `.crt-landing` (role=region "Legacy repository
//       landing"), its listbox + options, the HUD, the PREVIEW (Seer
//       `.crt-seer-portrait` + three `.crt-landing-cardback`), and the hint bar;
//  (10) the landing AFTER selecting a repo (mockup concept3-summon) — from the
//       idle landing, move the selection to a concrete repo so that row is
//       inverted (`aria-selected="true"`) and the PREVIEW's ORACLE SAYS line
//       reflects it, and capture that selected-preview frame BEFORE activating
//       (so the shot shows the "after selecting a repo" preview, NOT the
//       dismissed-landing reading — the summon is deliberately NOT dispatched).
//       Selection is moved by HOVERING the target option (`onMouseEnter` →
//       `onSelect` in `LegacyRepoList`): the landing's keydown handler is scoped
//       to the landing subtree, but the idle screen focuses the sibling `NECRO>`
//       input, so a page-level ArrowDown never reaches the landing — hover is the
//       deterministic, in-contract way to move the cursor without activating.
//
// Lovers_Binding (task 16.1) adds three MORE deterministic frames for the DMG
// Lovers_View and the two Soul_Source_HUD modes (R33.1, R21.*, R24.4, R30.*),
// each in its OWN normally-clocked test (the Lovers surfaces are static once
// settled — no clock control needed). Every one of these runs the WIRED lovers
// flow entirely OFFLINE: `/api/summon` + `/api/readings` (the reading carrying
// a THE LOVERS draw so the repo reads as bindable) + `/api/lovers` are all
// intercepted with `page.route(...)`, so the OpenRouter provider's `fetch` is
// never reached — the same offline patterns the sibling `lovers-flow.e2e.ts`
// spec uses. No new production code; this is capture-only.
//   (11) the DMG Lovers_View split view — after a successful `lovers <file> js`
//        binding the lazy `LoversView` mounts: a `<section>` region named "The
//        Lovers binding" with the three code panes PYTHON HEART / CONTRACT /
//        JS BELOVED rising into view. Waits for the region + all three pane
//        headings + the bound code bodies before the capture (R21.1, R21.2,
//        R33.1);
//   (12) the Soul_Source_HUD in ORACLE mode — the always-present HUD status
//        line `SOUL SOURCE: ORACLE` on the idle screen with NO key set (the
//        default Soul_Source), captured tight on the HUD element (R24.4,
//        R33.1);
//   (13) the Soul_Source_HUD in YOURS mode — after `key set` enters a key
//        through the masked `SoulKeyInput`, the HUD flips to `SOUL SOURCE:
//        YOURS`; captured tight on the HUD element. The key value is only ever
//        typed into the masked field and never appears in the shot (R24.4,
//        R33.1).
//
// _Requirements: 9.1, 9.3, 13.7, 21.5, 21.6, 33.1, 21.1, 24.4, 30.1_

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

import {
  bootLogoShot,
  bootTerminal,
  mockRoutes,
  runCommand,
  sel,
} from "./support/terminal.js";

// Only run when a maintainer/CI explicitly asks to capture. The normal e2e gate
// stays fast and never writes into the repo's `docs/` tree.
const CAPTURE = Boolean(process.env.CAPTURE_SCREENSHOTS);

// `docs/screenshots/` relative to this file: apps/web/e2e → repo root/docs.
const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "docs",
  "screenshots",
);

/** Resolve a PNG path inside `docs/screenshots/`. */
function shot(name: string): string {
  return join(OUT_DIR, `${name}.png`);
}

/** Per-position decorative card slots (aria-hidden). */
const cardSlots = (page: Page): Locator => page.locator(".crt-card-slot");
/** Every rendered ASCII card element. */
const asciiCards = (page: Page): Locator => page.locator(".crt-ascii-card");
/** Every rendered pixel-art diagnosis card in the live Spread_View. */
const pixelCards = (page: Page): Locator =>
  page.locator(".crt-spread-pixel-region .crt-pixel-card");

/** The DMG Landing_State region (role=region "Legacy repository landing"). */
const landing = (page: Page): Locator =>
  page.getByRole("region", { name: "Legacy repository landing" });
/** The LEGACY REPOS listbox inside the landing. */
const repoList = (page: Page): Locator =>
  page.getByRole("listbox", { name: "Legacy repositories" });
/** Every selectable option row in the LEGACY REPOS listbox. */
const repoOptions = (page: Page): Locator => repoList(page).getByRole("option");

// ---------------------------------------------------------------------------
// Lovers_Binding capture helpers (task 16.1). These mirror the OFFLINE route
// mocks and copy anchors in the sibling `lovers-flow.e2e.ts` VERBATIM so the
// lovers shots exercise the same wired flow with zero real network: the
// `@necro/ui-crt` barrel transitively imports crt.css (which Playwright's TS
// loader cannot parse), so the few copy anchors are restated here rather than
// imported, exactly as `support/terminal.ts` restates its phrase constants.
// ---------------------------------------------------------------------------

/** The DMG `LoversView` region accessible name (components/LoversView.tsx). */
const LOVERS_VIEW_REGION = "The Lovers binding";

/** The three code-pane titles the DMG split view renders. */
const LOVERS_PANE_TITLES = ["PYTHON HEART", "CONTRACT", "JS BELOVED"] as const;

/** The four ordered Lovers_Phases, the wire `{ phase }` tokens. */
const LOVERS_PHASES = ["PLAN", "GENERATE", "VALIDATE", "BIND"] as const;

/** The bindable file we bind in these shots. */
const BINDABLE_FILE = "src/greet.py";

/** A representative fake OpenRouter-style user key (only ever typed, masked). */
const FAKE_USER_KEY = "sk-or-v1-necro-lovers-shot-secret-abcd99";

/** NDJSON headers the lovers stream sets (mirrors lovers-flow.e2e.ts). */
const NDJSON_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

/** The demo bundle the live-reading-with-lovers body is built from. */
const bundlePath = new URL("../src/demo/bundle.generated.json", import.meta.url);

/** One LOVERS (VI) draw — card id "lovers" — the bindability precondition. */
const LOVERS_DRAW = {
  card: "lovers",
  evidence: [
    {
      detail: `bindable public function greet in ${BINDABLE_FILE}`,
      kind: "bindable_function",
      path: BINDABLE_FILE,
      line: 1,
      source: "static",
    },
  ],
  grimoires: ["lovers-js"],
  orientation: "upright",
  severity: 1,
  summary:
    "The Lovers draw close: a bindable soul waits to cross from Python to JavaScript.",
} as const;

/** The HUD status region accessible name in each Soul_Source mode. */
function soulSourceHud(page: Page, mode: "ORACLE" | "YOURS"): Locator {
  return page.getByRole("status", { name: `SOUL SOURCE: ${mode}` });
}

/** NDJSON body from an array of line objects (one JSON object per line). */
function ndjson(lines: readonly unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

/**
 * Build the LIVE readings body whose reading carries the LOVERS draw (the
 * bindability precondition), reusing the schema-valid green-garden necropsy
 * fixture with the demo flag stripped and the LOVERS draw injected into both
 * the draw list and an empty spread slot (mirrors lovers-flow.e2e.ts).
 */
function liveReadingWithLovers(): { summary: unknown; reading: unknown } {
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as Record<
    string,
    { necropsy: { summary: Record<string, unknown>; reading: Record<string, unknown> } }
  >;
  const base = bundle["green-garden"]?.necropsy;
  if (base === undefined) {
    throw new Error("demo bundle is missing the green-garden necropsy fixture");
  }
  const { demo: _demo, ...summary } = base.summary as { demo?: unknown };
  const reading = JSON.parse(JSON.stringify(base.reading)) as {
    draws?: unknown[];
    spread?: { draw: unknown; label: string; position: number }[];
  };
  reading.draws = [...(reading.draws ?? []), LOVERS_DRAW];
  if (Array.isArray(reading.spread)) {
    const emptySlot = reading.spread.find((slot) => slot.draw === null);
    if (emptySlot !== undefined) {
      emptySlot.draw = LOVERS_DRAW;
    }
  }
  return { summary, reading };
}

/** One deterministic, schema-valid LoversResult for the bound file. */
function loversResult(
  overrides: { path?: "llm" | "template"; soulSource?: "ORACLE" | "YOURS" } = {},
): Record<string, unknown> {
  const path = overrides.path ?? "llm";
  const soulSource = overrides.soulSource ?? "ORACLE";
  return {
    file: BINDABLE_FILE,
    targetLang: "javascript",
    pair: {
      pythonHeart:
        "import sys, json\n" +
        "def greet(name):\n" +
        '    return "Hello, " + name\n' +
        'if __name__ == "__main__":\n' +
        "    for line in sys.stdin:\n" +
        "        req = json.loads(line)\n" +
        '        out = {"id": req["id"], "ok": True, "value": greet(**req["args"])}\n' +
        '        sys.stdout.write(json.dumps(out, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\\n")\n' +
        "        sys.stdout.flush()\n",
      jsBeloved:
        "export function greet(name) {\n  return `Hello, ${name}`;\n}\n",
      contractSchema:
        '{"$schema":"https://json-schema.org/draft/2020-12/schema",' +
        '"$defs":{"greet.request":{"type":"object",' +
        '"properties":{"name":{"type":"string"}},' +
        '"required":["name"],"additionalProperties":false},' +
        '"greet.response":{"type":"string"}}}',
      pythonTests:
        "def test_greet():\n" + '    assert greet("Mort") == "Hello, Mort"\n',
      jsTests:
        'import { greet } from "./greet.js";\n' +
        'test("greet", () => { expect(greet("Mort")).toBe("Hello, Mort"); });\n',
    },
    plan: {
      functions: [
        {
          name: "greet",
          params: [
            {
              name: "name",
              pyType: "str",
              jsonType: "string",
              jsType: "string",
              required: true,
            },
          ],
          returns: { pyType: "str", jsonType: "string", jsType: "string" },
          bindable: true,
          edgeCases: [],
        },
      ],
      typeMap: [{ py: "str", json: "string", js: "string" }],
    },
    path,
    soulsSpent: {
      promptTokens: path === "llm" ? 180 : 0,
      completionTokens: path === "llm" ? 64 : 0,
      costUsd: path === "llm" ? 0.0012 : 0,
      soulSource,
      byModel:
        path === "llm"
          ? [
              {
                model: "openai/gpt-4o-mini",
                promptTokens: 180,
                completionTokens: 64,
                costUsd: 0.0012,
              },
            ]
          : [],
    },
    soulSource,
    demo: false,
  };
}

/**
 * Intercept `/api/summon`, `/api/readings` (reading carries the LOVERS draw),
 * and `/api/lovers` (the four phases then a schema-valid result line) entirely
 * offline, so the lovers shots touch ZERO real network (the OpenRouter
 * provider's `fetch` is never reached). Mirrors lovers-flow.e2e.ts.
 */
async function mockLoversFlow(
  page: Page,
  result: Record<string, unknown>,
): Promise<void> {
  const response = liveReadingWithLovers();

  await page.route("**/api/summon", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify(response.summary),
    });
  });

  await page.route("**/api/readings", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      headers: NDJSON_HEADERS,
      body: ndjson([
        { phase: "SUMMON" },
        { phase: "DOWNLOAD" },
        { phase: "EXTERNAL" },
        { phase: "READING" },
        { result: response },
      ]),
    });
  });

  await page.route("**/api/lovers", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      headers: NDJSON_HEADERS,
      body: ndjson([
        ...LOVERS_PHASES.map((phase) => ({ phase })),
        { result },
      ]),
    });
  });

  // Fail loudly if any request escapes the mocks to a real host.
  await page.route(
    /github\.com|pypi\.org|osv\.dev|amazonaws\.com|openrouter/,
    (route) => route.abort(),
  );
}

/** Bring a bindable reading into scope: summon then read the necropsy spread. */
async function summonAndRead(page: Page): Promise<void> {
  await runCommand(page, "summon graveyard/green-garden");
  await expect(sel.log(page)).toContainText("graveyard/green-garden");
  await runCommand(page, "read necropsy");
  await expect(sel.log(page)).toContainText("THE STAR");
}

/** Submit a user key through the masked `key set` input (SoulKeyInput). */
async function enterKey(page: Page, key: string): Promise<void> {
  await runCommand(page, "key set");
  const field = page.locator("#crt-soul-key");
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute("type", "password");
  await field.fill(key);
  await field.press("Enter");
}

/**
 * The virtual-clock instant (ms from the ritual's first frame) at which to
 * FREEZE for the Necronomicon open-book shot. The ritual phases are
 * `closed-glitch` 600 ms → `tremble` 300 ms → `crossfade` 600 ms →
 * `rising-diff`, so the `crossfade` window (the open book fading in over the
 * closed one) is `[~900, ~1500) ms`. 1200 ms sits mid-crossfade with enough
 * margin that the ±60 ms seed jitter in `ritualTimeline` never pushes the frozen
 * instant out of the window. See `ritual-timeline.ts` for the phase budget.
 */
const RITUAL_CROSSFADE_FREEZE_MS = 1200;

/**
 * The virtual-clock instant (ms) at which to FREEZE the boot so its phase holds
 * `"playing"` and the Seer_Image stays mounted for the landing shot. Mirrors
 * `BOOT_LOGO_FREEZE_MS` (2200 ms) — comfortably inside the ~3.4 s boot, before
 * it settles to the ready prompt, so `state.boot.phase === "playing"` and the
 * `.crt-seer-region[data-boot-seer="playing"]` is on screen.
 */
const SEER_BOOT_FREEZE_MS = 2200;

test.describe("marketing screenshots (demo mode, full motion) — R9.1, R9.3", () => {
  // Capture-only: skipped unless CAPTURE_SCREENSHOTS is set. This keeps the
  // default e2e suite fast and side-effect free (no writes into docs/).
  test.skip(
    !CAPTURE,
    "capture-only: set CAPTURE_SCREENSHOTS=1 to write docs/screenshots PNGs",
  );

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  // --- (1) Boot logo frame ----------------------------------------------
  // Its OWN test on a fresh page with the virtual clock installed and FROZEN on
  // the logo step. The logo is step 4 of 7 in a ~500 ms/step schedule, so in a
  // live rAF-driven boot it is on screen for only ~500 ms — too narrow for a
  // plain `toBeVisible()` poll to catch reliably. `bootLogoShot` installs
  // Playwright's fake clock before navigating and pauses it mid-logo-window, so
  // the overlay holds the logo frame indefinitely and the capture is
  // deterministic. Isolating it in its own test keeps fake and real time from
  // ever mixing within a single test: shots 2-4 run on a separate,
  // normally-clocked page (next test), where the reveal/rot FramePort ticks
  // advance in real time exactly as in production.
  test("captures the boot logo frame (clock frozen on the logo step)", async ({
    page,
  }) => {
    // `bootLogoShot` freezes the clock on the logo step and asserts the logo
    // overlay + wordmark are on screen; capture the whole CRT screen so the
    // shot frames the big ASCII logo centred over the boot overlay.
    await bootLogoShot(page);
    await page.screenshot({ path: shot("01-boot-logo"), animations: "allow" });
  });

  test("captures 3-card reading, Tower glitch, and resurrection diff", async ({
    page,
  }) => {
    // Land on the ready prompt in full motion without waiting out the boot, so
    // this test runs on a normally-clocked page: navigate WITHOUT `?boot=skip`
    // and let the real-time boot resolve to the focused Command_Line.
    await page.goto("/");
    await expect(sel.log(page)).toContainText("NECRO-ORACLE");
    await expect(page.locator(".crt-boot-overlay")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(sel.input(page)).toBeFocused();

    // --- (2) Full 3-card reading ----------------------------------------
    // Offline demo chunk (no route mocks). `lich-py2` fates draws three cards
    // and includes THE TOWER. Complete the one-by-one reveal with Escape so all
    // framed ASCII cards are up for the shot.
    await runCommand(page, "demo lich-py2");
    await runCommand(page, "read fates");
    await expect(cardSlots(page)).toHaveCount(3);

    await sel.input(page).focus();
    await page.keyboard.press("Escape");
    await expect
      .poll(async () =>
        cardSlots(page).evaluateAll((slots) =>
          slots.every((s) => (s as HTMLElement).dataset.flipped === "true"),
        ),
      )
      .toBe(true);
    await expect(asciiCards(page)).toHaveCount(3);
    await page.screenshot({
      path: shot("02-three-card-reading"),
      animations: "allow",
    });

    // --- (3) THE TOWER glitch frame -------------------------------------
    // The burning Tower card carries the glitch class and `data-burning` in
    // full motion. Capture the card element itself for a tight glitch shot.
    const tower = page.locator('.crt-ascii-card[data-card="tower"]');
    await expect(tower).toHaveCount(1);
    await expect(tower).toHaveClass(/\bcrt-glitch\b/);
    await expect(tower).toHaveAttribute("data-burning", "true");
    await tower.screenshot({ path: shot("03-tower-glitch"), animations: "allow" });

    // --- (4) Resurrection diff (after rot-and-rebirth) ------------------
    // The resurrection path needs the mocked NDJSON stream. Install the mocks,
    // bring a live reading into scope, then resurrect. Once the rot overlay
    // reaches `data-rot="done"` and the diff is in the log, capture the screen.
    const calls = await mockRoutes(page);
    await runCommand(page, "summon graveyard/green-garden");
    const log = sel.log(page);
    await expect(log).toContainText("graveyard/green-garden");
    await runCommand(page, "read necropsy");
    await expect(log).toContainText("THE STAR");

    await runCommand(page, "resurrect");
    await expect(page.locator('.crt-rot-overlay[data-rot="done"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(log).toContainText("FILE src/legacy.py");
    await expect(log).toContainText("VITALITY 40/100 -> 55/100 (+15)");

    // The previous capture framed only the revived line + vitality: the diff
    // block is below the fold (the log auto-scrolls past it and the rot overlay
    // sits above), so the PNG never actually showed the diff. Scroll the
    // per-file diff block into view, then assert the `-`/`+` diff lines AND the
    // now phosphor-styled DOWNLOAD PATCH button are visible, so the shot frames
    // the whole diff + button rather than a cropped tail of the log.
    const diffBlock = page
      .locator("section.crt-block")
      .filter({ hasText: "FILE src/legacy.py" });
    await expect(diffBlock).toBeVisible();
    await diffBlock.scrollIntoViewIfNeeded();
    // The removed / added Python-2→3 diff lines from RESURRECT_RESULT.
    await expect(diffBlock).toContainText('- print "hello"');
    await expect(diffBlock).toContainText('+ print("hello")');

    // The styled CRT phosphor DOWNLOAD PATCH button (task 23.5) is present and
    // visible for the capture — it carries the `.crt-patch-download` class that
    // the new crt.css rule styles.
    const downloadButton = page.getByRole("button", {
      name: "DOWNLOAD PATCH",
      exact: true,
    });
    await expect(downloadButton).toBeVisible();
    await expect(downloadButton).toHaveClass(/\bcrt-patch-download\b/);
    await downloadButton.scrollIntoViewIfNeeded();

    // Full page so the whole diff block and the button are framed together.
    await page.screenshot({
      path: shot("04-resurrection-diff"),
      fullPage: true,
      animations: "allow",
    });

    expect(calls.resurrect).toBeGreaterThanOrEqual(1);
  });

  // --- (5) Spread_View with Pixel_Cards --------------------------------
  // Its OWN test on a normally-clocked page. The `apps/web` Terminal_Route
  // supplies the Arcana manifest, so a completed reading renders the pixel-art
  // `SpreadPixelView` (`.crt-spread-pixel-region` → `.crt-spread-pixel` with a
  // `.crt-pixel-card` per drawn card) rather than the Spec 05 ASCII reveal. A
  // `fates` reading draws exactly three cards, so three pixel-card slots appear
  // in spread order. No clock control is needed: the pixel spread is a static
  // integer-scaled layout, deterministic from the demo reading alone.
  test("captures the pixel-art Spread_View (3-card fates pixel spread)", async ({
    page,
  }) => {
    await bootTerminal(page);
    await runCommand(page, "demo lich-py2");
    await runCommand(page, "read fates");

    // The pixel spread renders with exactly three Pixel_Cards (fates = 3).
    const spread = page.locator(".crt-spread-pixel-region .crt-spread-pixel");
    await expect(spread).toBeVisible();
    await expect(pixelCards(page)).toHaveCount(3);
    // Wait for each card's pixel image to be attached so the shot frames the
    // art, not an empty slot (the three spread cards load eagerly, R11.1).
    await expect(page.locator(".crt-pixel-card-img")).toHaveCount(3);

    await page.screenshot({
      path: shot("05-pixel-spread"),
      animations: "allow",
    });
  });

  // --- (6) Fullscreen_Card_View ----------------------------------------
  // Its OWN test on a normally-clocked page. After the pixel spread renders,
  // clicking a `.crt-pixel-card` (wired to open the Fullscreen_Card_View) opens
  // the `role="dialog"` modal (`.crt-fullscreen-card`), which shows the single
  // large Pixel_Card. Capture the dialog once it is visible.
  test("captures the Fullscreen_Card_View (one card opened full screen)", async ({
    page,
  }) => {
    await bootTerminal(page);
    await runCommand(page, "demo lich-py2");
    await runCommand(page, "read fates");
    await expect(pixelCards(page)).toHaveCount(3);

    // Open the first card's fullscreen inspector by clicking it (the card root
    // is a role="button"; a click activates it exactly like Enter/Space).
    await pixelCards(page).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass(/\bcrt-fullscreen-card\b/);
    // The large card image inside the modal is up before the capture.
    await expect(dialog.locator(".crt-pixel-card-img")).toBeVisible();

    await page.screenshot({
      path: shot("06-fullscreen-card"),
      animations: "allow",
    });
  });

  // --- (7) Resurrection_Ritual open-book frame -------------------------
  // Its OWN test with the virtual clock installed and FROZEN on the `crossfade`
  // step. The ritual's four phases (`closed-glitch` 600 ms → `tremble` 300 ms →
  // `crossfade` 600 ms → `rising-diff`) are driven through the FramePort, i.e.
  // `requestAnimationFrame` + `performance.now` — both controlled by
  // `page.clock`. `ritualTimeline` normally SKIPS the ritual under a Playwright
  // run, so we navigate with `?ritual=force` (task 20) to force the full ritual;
  // `?boot=skip` lands us on the ready prompt without waiting out the boot while
  // the force flag overrides the skip gate.
  //
  // Determinism: the clock is installed at time 0 BEFORE navigation (so the very
  // first rAF reads virtual time), the offline flow brings a reading into scope
  // and fires `resurrect`, then `pauseAt(RITUAL_CROSSFADE_FREEZE_MS)` fast-
  // forwards virtual time — firing the ritual's rAF ticks up to that instant and
  // then holding. The ritual anchors its timeline to its first rAF (≈ time 0
  // under the paused clock), so freezing at 1200 ms lands squarely inside the
  // crossfade window `[~900, ~1500) ms` (phase 3; the ±60 ms seed jitter keeps
  // it comfortably mid-window), holding `data-ritual="crossfade"` with the open
  // Necronomicon frame fading in. Isolating this in its own test keeps the fake
  // clock from ever touching the normally-clocked shots above.
  test("captures the Necronomicon open-book frame (clock frozen on crossfade)", async ({
    page,
  }) => {
    // Fake timers must be installed BEFORE any script runs so the ritual's first
    // rAF already reads virtual time. Origin at epoch 0 (pauseAt only moves the
    // clock forward from here).
    await page.clock.install({ time: 0 });
    await mockRoutes(page);

    // Land on the ready prompt with the ritual forced to play even under the
    // Playwright run (?ritual=force overrides the ?boot=skip skip gate).
    await page.goto("/?boot=skip&ritual=force");
    await expect(sel.log(page)).toContainText("NECRO-ORACLE");
    await expect(sel.input(page)).toBeFocused();

    // Bring a live reading into scope, then resurrect. The mocked NDJSON stream
    // resolves via promises (not clock timers), so the ritual mounts without the
    // clock advancing.
    await runCommand(page, "summon graveyard/green-garden");
    const log = sel.log(page);
    await expect(log).toContainText("graveyard/green-garden");
    await runCommand(page, "read necropsy");
    await expect(log).toContainText("THE STAR");
    await runCommand(page, "resurrect");

    // The ritual wrapper is mounted (the Necronomicon frames are layered).
    const ritual = page.locator('.crt-ritual[data-ritual]');
    await expect(ritual).toBeVisible();

    // Fast-forward the virtual clock to mid-crossfade and HOLD it there, so the
    // open book is fading in over the closed one and the frame is stable.
    await page.clock.pauseAt(RITUAL_CROSSFADE_FREEZE_MS);
    await expect(
      page.locator('.crt-ritual[data-ritual="crossfade"]'),
    ).toBeVisible();

    await page.screenshot({
      path: shot("07-necronomicon-open"),
      animations: "allow",
    });
  });

  // --- (8) Landing with the Seer_Image ---------------------------------
  // Its OWN test with the virtual clock installed and FROZEN mid-boot. The Seer
  // renders only while `state.boot.phase === "playing"` (Terminal.tsx mounts
  // `.crt-seer-region[data-boot-seer="playing"]` holding the `.crt-seer-portrait`
  // during the boot). In a live rAF-driven boot that window passes in a few
  // seconds; freezing the clock mid-boot (same technique as `bootLogoShot`)
  // holds the boot in "playing" indefinitely so the Seer stays on screen for a
  // deterministic capture. Navigate WITHOUT `?boot=skip` so the boot actually
  // plays (a skipped boot never enters "playing" and never shows the Seer).
  test("captures the landing with the Seer image (clock frozen mid-boot)", async ({
    page,
  }) => {
    await page.clock.install({ time: 0 });
    await page.goto("/");
    // Hold the boot mid-sequence (same freeze point the logo shot uses), well
    // before the boot settles, so the boot phase stays "playing" and the Seer
    // region is mounted.
    await page.clock.pauseAt(SEER_BOOT_FREEZE_MS);

    const seerRegion = page.locator('.crt-seer-region[data-boot-seer="playing"]');
    await expect(seerRegion).toBeVisible();
    // The Seer portrait (and its pixel image) is mounted inside the region.
    await expect(seerRegion.locator(".crt-seer-portrait")).toBeVisible();
    await expect(seerRegion.locator("img.crt-seer-img")).toBeVisible();

    await page.screenshot({
      path: shot("08-seer-landing"),
      animations: "allow",
    });
  });

  // --- (9) Idle DMG Landing_State (mockup concept3) --------------------
  // Its OWN test on a normally-clocked page. Navigate WITH `?boot=skip`
  // (`bootTerminal`) so the boot is already DONE and `landingVisible(state)` is
  // true on the idle screen. The Part B fix mounts the reused `SeerPortrait`
  // inside the landing's PREVIEW whenever the manifest carries the `seer` asset
  // (independent of boot phase), so the Seer is on the idle landing here — no
  // mid-boot clock freeze is needed (unlike shot 08, which froze mid-boot for
  // the boot-REGION Seer). The `apps/web` Terminal route supplies the Arcana
  // manifest (the same manifest shots 5/6 rely on), so the Seer and the eye/moon
  // card backs render. Wait for the whole landing chrome — region, listbox +
  // options, HUD, PREVIEW (Seer + three card backs + ORACLE SAYS), hint bar —
  // before the capture so the frame is complete and deterministic.
  test("captures the idle DMG landing (HUD, list, preview, hint)", async ({
    page,
  }) => {
    await bootTerminal(page);

    // The landing region is visible on the idle screen (R1.1).
    await expect(landing(page)).toBeVisible();

    // The LEGACY REPOS listbox with its four option rows (three repos + the
    // ENTER row).
    await expect(repoList(page)).toBeVisible();
    await expect(repoOptions(page)).toHaveCount(4);

    // The HUD bar (NECRO-ORACLE label, SOUL hearts, PY2 CURSE: ACTIVE).
    const hud = page.getByRole("group", { name: "Oracle status" });
    await expect(hud).toBeVisible();
    await expect(hud).toContainText("NECRO-ORACLE");
    await expect(hud).toContainText("PY2 CURSE: ACTIVE");

    // The PREVIEW window: the reused Seer portrait + three face-down eye/moon
    // card backs + the ORACLE SAYS line. The Seer mounts because the apps/web
    // manifest carries the `seer` asset (Part B bug 1 fix).
    const preview = page.getByRole("group", { name: "Reading preview" });
    await expect(preview).toBeVisible();
    await expect(preview.locator(".crt-seer-portrait")).toBeVisible();
    await expect(preview.locator("img.crt-seer-img")).toBeVisible();
    await expect(preview.locator(".crt-landing-cardback")).toHaveCount(3);
    await expect(preview.locator(".crt-landing-oracle-says")).toBeVisible();

    // The hint bar (▲▼ SELECT  A:SUMMON  B:DEMO  START:HELP).
    await expect(landing(page).locator(".crt-landing-hint")).toBeVisible();

    // R30: the idle-landing baseline MUST be captured scrolled to the TOP of
    // the terminal with the full Landing_State in frame — never a mid-scroll
    // crop. Scroll the window and the output-log scroll container back to the
    // top, so the HUD_Bar (the top-most landing chrome) sits at the top of the
    // viewport and the whole landing — HUD, list, preview, hint — is in frame.
    // The R29 layout keeps the landing within the viewport with no vertical
    // scroll, so this scroll-to-top is a belt-and-braces guarantee for the
    // capture frame and does not alter any production behaviour.
    const log = sel.log(page);
    await log.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });

    // Assert the capture starts at the top: the HUD_Bar's top edge is within a
    // small epsilon of the viewport top, proving shot 09 is NOT a mid-scroll
    // crop (R30). The HUD is the first landing panel, so if it sits at the top
    // the full landing below it is in frame.
    const hudTop = await hud.evaluate((el) => el.getBoundingClientRect().top);
    expect(hudTop, "HUD_Bar must sit at the top of the frame for R30").toBeLessThan(80);

    await page.screenshot({
      path: shot("09-landing-idle"),
      animations: "allow",
    });
  });

  // --- (10) Landing after selecting a repo (mockup concept3-summon) ----
  // Its OWN test on a normally-clocked page. From the idle landing, MOVE the
  // selection to a concrete repo so that option is inverted
  // (`aria-selected="true"`) and the PREVIEW's ORACLE SAYS line reflects it,
  // then capture THAT selected-preview frame. We do NOT activate (no summon is
  // dispatched): the frame must show the "after selecting a repo" preview, not
  // the dismissed-landing reading.
  //
  // Selection is moved by HOVERING the target option. The landing's keydown
  // handler lives on the landing root and only fires while focus is inside the
  // landing subtree, but `?boot=skip` lands focus on the sibling `NECRO>`
  // input, so a page-level ArrowDown never reaches the landing. `LegacyRepoList`
  // wires `onMouseEnter` → `onSelect`, and hover (unlike click) selects WITHOUT
  // activating — exactly the selected-but-not-summoned state this shot wants.
  test("captures the landing after selecting a concrete repo (preview reflects it)", async ({
    page,
  }) => {
    await bootTerminal(page);
    await expect(landing(page)).toBeVisible();
    await expect(repoOptions(page)).toHaveCount(4);

    // Move the cursor onto the SECOND concrete repo (index 1) by hovering it.
    // Index 0 is already selected by default, so hovering index 1 demonstrates
    // the selection moving — the inverted row follows the cursor (R4.5). Hover
    // selects but does not activate (only click activates), so no summon fires.
    const target = repoOptions(page).nth(1);
    await target.hover();

    // The hovered option is now the single selected (inverted) row (R4.5).
    await expect(target).toHaveAttribute("aria-selected", "true");
    // Exactly one option is selected at a time.
    await expect(
      repoList(page).locator('[role="option"][aria-selected="true"]'),
    ).toHaveCount(1);

    // The PREVIEW's ORACLE SAYS line is visible and reflects the selected repo.
    const preview = page.getByRole("group", { name: "Reading preview" });
    const oracleSays = preview.locator(".crt-landing-oracle-says");
    await expect(oracleSays).toBeVisible();
    await expect(oracleSays).not.toBeEmpty();

    // Guard: the landing is still up — we did NOT activate/summon, so the
    // reading never replaced the landing (this is the selected-preview frame).
    await expect(landing(page)).toBeVisible();

    await page.screenshot({
      path: shot("10-landing-summon"),
      animations: "allow",
    });
  });

  // --- (11) DMG Lovers_View split view ---------------------------------
  // Its OWN test on a normally-clocked page. Drive the WIRED lovers flow fully
  // offline (summon → read [reading carries a THE LOVERS draw] → `lovers
  // <file> js`): the NDJSON stream emits the four phases then a schema-valid
  // `{ result }` line, the client re-validates it, and the lazy DMG
  // `LoversView` mounts — a `<section>` region named "The Lovers binding" with
  // the three code panes PYTHON HEART / CONTRACT / JS BELOVED. Wait for the
  // region, all three pane headings, and the bound code bodies so the frame is
  // complete and deterministic before the capture (R21.1, R21.2, R33.1). No
  // clock control: the split view is static once the stream settles.
  test("captures the DMG Lovers split view (region + three code panes)", async ({
    page,
  }) => {
    await mockLoversFlow(page, loversResult({ path: "llm", soulSource: "ORACLE" }));
    await bootTerminal(page);
    const log = sel.log(page);

    await summonAndRead(page);

    // Start the binding and let the stream settle (aria-busy back to false).
    await runCommand(page, `lovers ${BINDABLE_FILE} js`);
    await expect(log).toContainText(`BOUND ${BINDABLE_FILE} to JavaScript`);
    await expect(log).toHaveAttribute("aria-busy", "false");

    // The lazy DMG LoversView region mounts (a mounted view proves the result
    // line was schema-valid, since the client re-validates before resolving).
    const view = page.getByRole("region", { name: LOVERS_VIEW_REGION });
    await expect(view).toBeVisible();
    for (const title of LOVERS_PANE_TITLES) {
      await expect(view.getByRole("heading", { name: title })).toBeVisible();
    }
    // The bound code bodies actually rendered in their panes.
    await expect(view).toContainText("def greet(name):");
    await expect(view).toContainText("export function greet(name)");
    await expect(view).toContainText("greet.request");

    // Scroll the view to the top of the frame so the split view is captured in
    // full (the Lovers_View fits the viewport with no page scroll — R21.5).
    await view.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });

    await page.screenshot({
      path: shot("11-lovers-view"),
      animations: "allow",
    });
  });

  // --- (12) Soul_Source_HUD — ORACLE mode ------------------------------
  // Its OWN test on a normally-clocked page. With NO key set, the always-present
  // Soul_Source HUD reads `SOUL SOURCE: ORACLE` (the default source, R24.4). The
  // HUD is a `role="status"` line whose accessible name IS that text. Capture it
  // tight on the HUD element on the idle screen (no flow needed — the mode is
  // the default and the HUD is static). (R24.4, R33.1, R30.1)
  test("captures the Soul_Source HUD in ORACLE mode (no key)", async ({
    page,
  }) => {
    await bootTerminal(page);

    const hud = soulSourceHud(page, "ORACLE");
    await expect(hud).toBeVisible();
    await expect(hud).toContainText("SOUL SOURCE: ORACLE");

    await hud.scrollIntoViewIfNeeded();
    await hud.screenshot({ path: shot("12-soul-source-oracle"), animations: "allow" });
  });

  // --- (13) Soul_Source_HUD — YOURS mode -------------------------------
  // Its OWN test on a normally-clocked page. After `key set` enters a key
  // through the masked `SoulKeyInput`, the Soul_Source flips to `YOURS` and the
  // HUD reads `SOUL SOURCE: YOURS` (R24.4). The key value is only ever typed
  // into the masked (`type="password"`) field and is never echoed, so it never
  // appears in the shot. Capture the HUD tight on the element. (R24.4, R33.1,
  // R30.1)
  test("captures the Soul_Source HUD in YOURS mode (after key set)", async ({
    page,
  }) => {
    await bootTerminal(page);

    // The HUD starts in ORACLE, then flips to YOURS once a key is bound.
    await expect(soulSourceHud(page, "ORACLE")).toBeVisible();
    await enterKey(page, FAKE_USER_KEY);

    const hud = soulSourceHud(page, "YOURS");
    await expect(hud).toBeVisible();
    await expect(hud).toContainText("SOUL SOURCE: YOURS");

    // Guard: the typed key value never leaks into the rendered page.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(FAKE_USER_KEY);

    await hud.scrollIntoViewIfNeeded();
    await hud.screenshot({ path: shot("13-soul-source-yours"), animations: "allow" });
  });
});
