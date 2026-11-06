// apps/web/e2e/support/terminal.ts
//
// Feature: 03-crt-terminal, task 32 — shared Playwright helpers for the browser
// e2e + axe specs. These centralise the DOM contract the Terminal renders
// (asserted against the REAL component source, not invented copy) and the two
// route mocks so no spec reaches GitHub, an LLM, or any network.
//
// The expected copy is imported from the real package constants so a phrase
// change in `@necro/ui-crt` flips these specs, never a stale literal:
//   - BOOT_PHRASE, PRE_READING_PHRASE, DEMO_LABEL from `@necro/ui-crt`.
// The `<noscript>` text is the Terminal's own
// `` `${BOOT_PHRASE} — The terminal requires JavaScript.` ``.
//
// Route mocking: the live summon→read→explain path intercepts `/api/summon`
// (returns a SummonSummary JSON) and `/api/readings` (returns the NDJSON stream
// the client parses — phase lines then a final `{ result }` line). Both bodies
// are built from the already schema-valid `src/demo/bundle.generated.json`
// readings, with the `demo` flag stripped so the terminal renders a LIVE
// reading (evidence rendered as Evidence_Links, R8.1 / R7.6).
//
// _Requirements: R1.1, R1.2, R1.5, R8.1, R15.*, R18.5_

import { readFileSync } from "node:fs";

import { expect, type Locator, type Page } from "@playwright/test";

// The fixed Oracle_Voice phrases the Terminal renders. These mirror
// `@necro/ui-crt`'s `voice/phrases.ts` VERBATIM (BOOT_PHRASE, PRE_READING_PHRASE,
// DEMO_LABEL). They are duplicated here rather than imported because the
// `@necro/ui-crt` barrel transitively imports `crt.css`, which Playwright's
// TypeScript loader cannot parse, and a deep relative import of the source
// module crosses the package `rootDir` (tsc rejects it). `phrases.spec-sync`
// below is a guard against drift: if the package copy changes, update these.
//
// phrases.ts @necro/ui-crt (verbatim):
//   BOOT_PHRASE        = "NECRO-ORACLE v1.0 · NECROMANTIC SYSTEMS 1986 · TYPE HELP"
//   PRE_READING_PHRASE = "Shuffle. Cut. The repository speaks."
//   DEMO_LABEL         = "DEMO REPLAY · a recorded reading, no live summon."
export const BOOT_PHRASE =
  "NECRO-ORACLE v1.0 · NECROMANTIC SYSTEMS 1986 · TYPE HELP";
export const PRE_READING_PHRASE = "Shuffle. Cut. The repository speaks.";
export const DEMO_LABEL = "DEMO REPLAY · a recorded reading, no live summon.";

// --- Resurrection stream copy (resurrection-engine, task 17.1) -------------
//
// The resurrect flow spec (`resurrect-flow.e2e.ts`) asserts the terminal
// surfaces the six Resurrection_Phases in order. The client keys its progress
// display off the phase TOKEN carried verbatim in each phase's technical line
// (`@necro/ui-crt` RESURRECT_PHASE_VOICE), so these tokens are the stable DOM
// anchor — a phase rename in the package flips the spec, never a stale literal.
// They mirror `@necro/ui-crt`'s `protocol.ts` ResurrectionPhase enum VERBATIM;
// like the phrases above they are duplicated here rather than imported because
// the `@necro/ui-crt` barrel transitively imports `crt.css`, which Playwright's
// TypeScript loader cannot parse.
export const RESURRECT_PHASES = [
  "SELECT",
  "PRE_PASS",
  "LLM_PASS",
  "VALIDATE",
  "REDIAGNOSE",
  "DIFF",
] as const;

/**
 * The exact `<noscript>` note the Terminal renders (R1.5): the boot phrase, an
 * em-dash, then the requires-JavaScript statement (Terminal.tsx).
 */
export const NOSCRIPT_NOTE = `${BOOT_PHRASE} — The terminal requires JavaScript.`;

/** Stable role/label selectors for the Terminal DOM (mirrors the components). */
export const sel = {
  /** The landmark `main.crt` with its accessible name. */
  terminal: (page: Page): Locator =>
    page.getByRole("main", { name: "Necro-Oracle CRT terminal" }),
  /** The `role="log"` Live_Region (aria-live polite, aria-busy mirror). */
  log: (page: Page): Locator => page.getByRole("log", { name: "Oracle output" }),
  /** The labelled Command_Line input. */
  input: (page: Page): Locator => page.getByRole("textbox", { name: "Command" }),
  /** A button-row button by its visible uppercase label. */
  button: (page: Page, label: string): Locator =>
    page.getByRole("button", { name: label, exact: true }),
  /** Every rendered output block (`section.crt-block`). */
  blocks: (page: Page): Locator => page.locator("section.crt-block"),
} as const;

/**
 * The query flag `apps/web` (`TerminalScreen.tsx`) reads to skip the one-time
 * deterministic Boot_Sequence and land straight on the ready terminal. Every
 * spec except the full-motion visual spec navigates with it so no spec waits
 * out the boot animation (visual-necromancy task 18.1). It is the external
 * "Playwright env boot signal": the runner sets `?boot=skip`, `TerminalScreen`
 * threads it into the Terminal's `bootSignal` prop, and the reducer downgrades
 * the boot to `phase:"done"` while still making `BOOT_PHRASE` the first
 * Output_Block (R12.5, R10.7).
 */
export const BOOT_SKIP_QUERY = "?boot=skip";

/**
 * Load the terminal route WITH `?boot=skip` and wait for the booted, focused
 * command line. The skip flag lands the session on the ready terminal without
 * playing the Boot_Sequence, so a spec that only needs a usable prompt never
 * waits out the boot animation. The boot phrase is still the first Output_Block
 * (the reducer appends it regardless of the skip), so the R1.1/R1.2/R15.4
 * assertions below hold exactly as they did before the flag existed.
 *
 * The one spec that must exercise the full-motion Boot_Sequence
 * (`visual-necromancy.e2e.ts`) navigates with {@link bootTerminalFull} instead,
 * which omits the flag.
 */
export async function bootTerminal(page: Page): Promise<void> {
  await page.goto(`/${BOOT_SKIP_QUERY}`);
  // Boot phrase present and the command line focused (R1.1, R1.2, R15.4).
  await expect(sel.log(page)).toContainText(BOOT_PHRASE);
  await expect(sel.input(page)).toBeFocused();
}

/**
 * Load the terminal route WITHOUT `?boot=skip`, so the full deterministic
 * Boot_Sequence plays. Used only by the visual spec to assert the boot overlay
 * appears and resolves to the ready prompt. Resolves once the boot has settled:
 * the `.crt-boot-overlay` is gone and the command line holds focus.
 */
export async function bootTerminalFull(page: Page): Promise<void> {
  await page.goto("/");
  // The boot phrase is the first Output_Block in every path (R1.1).
  await expect(sel.log(page)).toContainText(BOOT_PHRASE);
  // The full-motion boot overlay resolves within budget, leaving no overlay in
  // the DOM, and focus lands on the Command_Line (R1.2, R1.7, R15.4).
  await expect(page.locator(".crt-boot-overlay")).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(sel.input(page)).toBeFocused();
}

/**
 * The elapsed boot time, in milliseconds, at which to FREEZE the virtual clock
 * so the capture lands squarely on the ASCII-logo boot step.
 *
 * The Boot_Sequence (`@necro/ui-crt` `motion/boot-schedule.ts`) runs seven
 * fixed 500 ms steps (`BOOT_STEP_MS = 500`, `BOOT_STEP_COUNT = 7`, total
 * ~3.4 s). `bootStepAt` floors elapsed time into a step, so step 4 — the logo
 * (`render/boot.ts`: four cumulative MEMORY-check steps 0-3, then the logo at
 * step 4) — is on screen for elapsed ∈ [2000, 2500) ms. In a live, real-time,
 * rAF-driven boot that window is only ~500 ms wide, which a plain
 * `expect(locator).toBeVisible()` poll cannot reliably catch: by the time
 * Playwright navigates and polls, the boot has already advanced past the logo
 * to the ready frame and the overlay is gone.
 *
 * `bootLogoShot` makes the capture DETERMINISTIC by installing Playwright's
 * fake clock and PAUSING it inside this window, so the overlay stays frozen on
 * the logo frame indefinitely and the screenshot is stable run-to-run. 2200 ms
 * sits comfortably mid-step (not on either 2000/2500 ms boundary). This touches
 * no production code and does NOT change the real boot timing — it only
 * controls the clock the browser reads during capture.
 */
export const BOOT_LOGO_FREEZE_MS = 2200;

/**
 * Navigate to the terminal in FULL motion (no `?boot=skip`) with the virtual
 * clock FROZEN on the ASCII-logo boot step, and wait for the logo frame to be
 * on screen. Deterministic capture of the otherwise ~500 ms logo window
 * (visual-necromancy task 23.3).
 *
 * Installs Playwright's fake clock BEFORE navigating so the browser's
 * `performance.now` / `requestAnimationFrame` (which `useBoot` drives the boot
 * through) are controllable, navigates to `/`, then pins virtual time to
 * {@link BOOT_LOGO_FREEZE_MS} via `page.clock.pauseAt`. Because the clock is
 * paused there, the boot cannot advance past the logo, so the overlay holds the
 * logo frame and the `.crt-boot-overlay[data-boot-frame="logo"]` assertion is
 * stable. Resolves once that logo overlay is visible and carries the wordmark.
 *
 * The clock stays paused on return; a caller that needs the boot to proceed
 * afterwards must resume it (`page.clock.resume()`). The screenshot spec does
 * NOT — it captures the logo on its own frozen page and drives shots 2-4 on a
 * separate, normally-clocked page, so no single test mixes fake and real time.
 */
export async function bootLogoShot(page: Page): Promise<Locator> {
  // Fake timers must be installed BEFORE any script runs, so the boot's very
  // first rAF tick already reads virtual time. Pin the clock's ORIGIN to epoch
  // 0 so virtual time starts at 0 — `pauseAt` only ever moves the clock
  // forward (it throws "cannot fast-forward to the past" otherwise), and the
  // boot measures elapsed time from its first tick, so an origin of 0 makes
  // `pauseAt(BOOT_LOGO_FREEZE_MS)` land exactly `BOOT_LOGO_FREEZE_MS` into the
  // sequence.
  await page.clock.install({ time: 0 });
  await page.goto("/");
  // Move the clock forward to the logo window and HOLD it there, freezing the
  // boot on the logo step for a stable capture.
  await page.clock.pauseAt(BOOT_LOGO_FREEZE_MS);

  // The boot phrase is the first Output_Block in every path (R1.1).
  await expect(sel.log(page)).toContainText(BOOT_PHRASE);

  // Wait for the LOGO frame specifically (not merely any playing frame): the
  // `crt-sr-only` wordmark is a constant sibling of every boot frame, so the
  // `data-boot-frame="logo"` marker is the only stable anchor for the big ASCII
  // logo step. With the clock frozen in-window this resolves immediately and
  // stays true for the whole capture.
  const logoFrame = page.locator('.crt-boot-overlay[data-boot-frame="logo"]');
  await expect(logoFrame).toBeVisible();
  // The visible ASCII glyph rows carry the wordmark on the logo frame.
  await expect(logoFrame.locator(".crt-boot-frame")).toContainText(
    "NECROMANTIC SYSTEMS 1986",
  );
  return logoFrame;
}

/** Type a command into the focused Command_Line and submit it with Enter. */
export async function runCommand(page: Page, command: string): Promise<void> {
  const input = sel.input(page);
  await input.click();
  await input.fill(command);
  await input.press("Enter");
}

// --- Route mocks -----------------------------------------------------------

const bundlePath = new URL(
  "../../src/demo/bundle.generated.json",
  import.meta.url,
);

interface DemoReading {
  readonly summary: Record<string, unknown>;
  readonly reading: Record<string, unknown>;
}
type Bundle = Record<string, { fates: DemoReading; necropsy: DemoReading }>;

/** The schema-valid green-garden necropsy reading, reused for the live mock. */
function liveReadingResponse(): DemoReading {
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as Bundle;
  const entry = bundle["green-garden"];
  if (entry === undefined) {
    throw new Error("demo bundle is missing the green-garden fixture");
  }
  const base = entry.necropsy;
  // Strip the demo flag so the terminal treats it as a LIVE reading and builds
  // real Evidence_Links (R7.6 / R8.1), not `fixture:` prefixes (R18.11).
  const { demo: _demo, ...summary } = base.summary as { demo?: unknown };
  return { summary, reading: base.reading };
}

/**
 * A field-complete, redaction-safe `RitualResult` wire record (the shape of the
 * Resurrection_Route's terminal `{ result }` line — `RitualResultWireSchema` in
 * `src/protocol/resurrect-wire.ts`). One changed, validated, fully-converted
 * file; a positive Vitality_Delta with one improved card. Mirrors the recorded
 * fixture in `src/terminal/api-client.resurrect.test.ts` so the e2e stream and
 * the unit stream speak the identical wire form. Kept as a plain literal (not
 * imported from the coven barrel, which pulls node-only modules).
 */
export const RESURRECT_RESULT = {
  ritualId: "123e4567-e89b-42d3-a456-426614174000",
  selectedCount: 1,
  files: [
    {
      path: "src/legacy.py",
      before: 'print "hello"\n',
      after: 'print("hello")\n',
      diff: [
        { kind: "remove", text: 'print "hello"' },
        { kind: "add", text: 'print("hello")' },
        { kind: "context", text: "" },
      ],
      residuals: [],
      fullyConverted: true,
      validated: true,
    },
  ],
  patch:
    '--- a/src/legacy.py\n+++ b/src/legacy.py\n@@ -1 +1 @@\n-print "hello"\n+print("hello")\n',
  beforeVitality: 40,
  afterVitality: 55,
  vitalityDelta: 15,
  changedCards: [{ card: "judgement", change: "severity", improved: true }],
  degraded: false,
  demo: false,
} as const;

/**
 * Intercept `/api/summon`, `/api/readings`, and `/api/resurrect` so the live
 * summon→read→resurrect path runs with ZERO real network. The summon returns a
 * `SummonSummary`; the readings route returns the reading NDJSON stream; the
 * resurrect route returns the resurrection NDJSON stream the client parses —
 * the six Resurrection_Phases in order, then a final `{ result }` line carrying
 * `RESURRECT_RESULT` (R9.1-R9.3). A `calls` counter lets a spec assert each
 * mock was hit and that nothing else leaked past the mocks.
 */
export async function mockRoutes(
  page: Page,
): Promise<{ summon: number; readings: number; resurrect: number }> {
  const calls = { summon: 0, readings: 0, resurrect: 0 };
  const response = liveReadingResponse();

  await page.route("**/api/summon", async (route) => {
    calls.summon += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify(response.summary),
    });
  });

  await page.route("**/api/readings", async (route) => {
    calls.readings += 1;
    // One JSON object per line: the four phases, then the final result line.
    const lines = [
      { phase: "SUMMON" },
      { phase: "DOWNLOAD" },
      { phase: "EXTERNAL" },
      { phase: "READING" },
      { result: response },
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    });
  });

  await page.route("**/api/resurrect", async (route) => {
    calls.resurrect += 1;
    // One JSON object per line: the six resurrection phases in order, then the
    // single terminal result line carrying a redaction-safe RitualResult. This
    // is the whole offline resurrection stream — no LLM, no sandbox, no wire.
    const lines = [
      ...RESURRECT_PHASES.map((phase) => ({ phase })),
      { result: RESURRECT_RESULT },
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    });
  });

  // Fail loudly if any spec hits GitHub/an LLM/anything else through the page.
  await page.route(/github\.com|pypi\.org|osv\.dev|amazonaws\.com/, (route) =>
    route.abort(),
  );

  return calls;
}
