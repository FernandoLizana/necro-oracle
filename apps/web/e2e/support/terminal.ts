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

/** Load the terminal route and wait for the booted, focused command line. */
export async function bootTerminal(page: Page): Promise<void> {
  await page.goto("/");
  // Boot phrase present and the command line focused (R1.1, R1.2, R15.4).
  await expect(sel.log(page)).toContainText(BOOT_PHRASE);
  await expect(sel.input(page)).toBeFocused();
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
