// apps/web/e2e/lovers-flow.e2e.ts
//
// Feature: lovers-binding, task 14.4 — the end-to-end Lovers_Binding flow in
// the browser, driven entirely offline (NO real GitHub / PyPI / OSV / LLM /
// OpenRouter network).
//
// By this point in the plan the `lovers` command is FULLY wired end-to-end: the
// reducer emits an `api.lovers` effect (`doLovers`), the terminal shell streams
// `POST /api/lovers` through the browser lovers client
// (`terminal/lovers-client.ts`), renders one Progress_Line per Lovers_Phase
// (PLAN / GENERATE / VALIDATE / BIND), renders a settled-result summary block,
// and mounts the lazy DMG `LoversView` from `state.lastLovers`. So this is a
// GENUINE lovers e2e, not a resurrect stand-in: every assertion anchors on the
// REAL rendered copy/tokens and a schema-valid result line.
//
// This spec runs with the server having NO OpenRouter key (OPENROUTER_API_KEY
// UNSET — the Playwright `webServer` inherits the ambient env, which does not
// set it) and the real provider never reached: every `/api/*` call the terminal
// makes is intercepted with `page.route(...)`, so the OpenRouter provider's
// `fetch` is never invoked (if it were, it would throw — there is no key). A
// `page.on("request", …)` leak guard fails the test if ANY request escapes the
// mocks to github / pypi / osv / openrouter.
//
// The DOM/stream contract these assertions anchor on is the REAL source, never
// invented copy:
//   - PRE_BINDING_PHRASE (`@necro/ui-crt` voice/phrases.ts) is pushed by the
//     reducer the instant a binding starts;
//   - each phase's TECHNICAL token line is `LOVERS_PHASE_VOICE[phase].technical`
//     (the reducer surfaces it verbatim so the client/e2e can key off it), the
//     four phases arriving in order PLAN → GENERATE → VALIDATE → BIND;
//   - the terminal `{ result }` line is a schema-valid `LoversResultWireSchema`
//     record (`protocol/lovers-wire.ts`), which the client re-validates before
//     resolving — a malformed result would reject, so a mounted view proves the
//     line was schema-valid;
//   - the DMG `LoversView` (`components/LoversView.tsx`) is a `<section>` region
//     with the accessible name "The Lovers binding" and the three code panes
//     titled PYTHON HEART / CONTRACT / JS BELOVED;
//   - a soft-degrade NOTICE is a `{ skip: true, note }` stream line rendered
//     verbatim as a status block (`loversSkipNoteBlock`);
//   - a hard error is a `{ error: { code, userMessage } }` stream line rendered
//     as `ERROR UPSTREAM_UNAVAILABLE` + the oracle-voice message (`renderError`).
//
// The LOVERS precondition: the mocked `/api/readings` reading includes a draw
// of THE LOVERS (card id "lovers") so the repo reads as bindable; the file we
// bind (`src/greet.py`) is the bindable target. (The server precondition itself
// is fully mocked here — this spec exercises the wired CLIENT flow — but the
// reading faithfully carries the LOVERS draw the real route requires.)
//
// Planned-red note (mirrors the sibling specs byok-flow / resurrect-flow): this
// spec is run by the maintainer via `pnpm --filter @necro/web e2e` AFTER a
// one-time `pnpm --filter @necro/web exec playwright install`. Browser binaries
// may be absent on CI / a fresh machine, so the spec is EXPECTED to be
// not-yet-run there; it type-checks and lints as part of the normal gate.
//
// _Requirements: R14.1, R14.3, R19.1, R19.2, R19.3, R19.4, R19.5, R21.5, R21.6,
//                R22.1, R28.1, R28.2, R29.2, R42.1, R42.2_

import { readFileSync } from "node:fs";

import { expect, test, type Page, type Route } from "@playwright/test";

import { bootTerminal, runCommand, sel } from "./support/terminal.js";

// ---------------------------------------------------------------------------
// Copy anchors drawn from the REAL source (mirrors the duplication rationale in
// support/terminal.ts: the `@necro/ui-crt` barrel transitively imports crt.css,
// which Playwright's TS loader cannot parse, so these constants are restated
// here VERBATIM and a drift in the package flips the spec, never a stale literal.)
// ---------------------------------------------------------------------------

/**
 * `PRE_BINDING_PHRASE` (@necro/ui-crt voice/phrases.ts), VERBATIM — the line the
 * reducer pushes the instant a binding starts. Restated here (not imported)
 * because the `@necro/ui-crt` barrel transitively imports crt.css, which the
 * Playwright TS loader cannot parse; the support helper does not re-export it.
 */
const PRE_BINDING_PHRASE =
  "THE LOVERS draw close. Two tongues, one contract, bound across the seam.";

/**
 * `LOVERS_PHASE_VOICE[phase].technical` (@necro/ui-crt voice/phrases.ts),
 * VERBATIM, in pipeline order. The reducer renders each as a status block and
 * carries the token in the technical line, so these are the stable DOM anchors
 * for the ordered phase stream (R19.2).
 */
const LOVERS_PHASE_TECHNICAL = [
  "PLAN: mapping each function's params and return types.",
  "GENERATE: drafting the JavaScript client and the contract.",
  "VALIDATE: parsing both sides and checking the contract.",
  "BIND: stitching the Python heart to the JS beloved.",
] as const;

/** The four ordered Lovers_Phases, the wire `{ phase }` tokens. */
const LOVERS_PHASES = ["PLAN", "GENERATE", "VALIDATE", "BIND"] as const;

/** The DMG `LoversView` region accessible name (components/LoversView.tsx). */
const LOVERS_VIEW_REGION = "The Lovers binding";

/** The three code-pane titles the DMG split view renders. */
const PANE_TITLES = ["PYTHON HEART", "CONTRACT", "JS BELOVED"] as const;

/** The bindable file we bind in this flow. */
const BINDABLE_FILE = "src/greet.py";

// ---------------------------------------------------------------------------
// A schema-valid LoversResult wire record (protocol/lovers-wire.ts
// `LoversResultWireSchema`). The client re-validates the `{ result }` line
// against this schema before resolving, so if the shape drifted the view would
// never mount — a mounted view is itself proof the line was schema-valid. The
// pair is minimal but real: one planned function `greet`, both sides defining
// it, a draft-2020-12 contract. Kept as a plain literal (not imported from the
// coven barrel, which pulls node-only modules).
// ---------------------------------------------------------------------------

/** One deterministic, schema-valid LoversResult for the bound file. */
function loversResult(
  overrides: {
    path?: "llm" | "template";
    soulSource?: "ORACLE" | "YOURS";
  } = {},
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
        "export function greet(name) {\n" +
        "  return `Hello, ${name}`;\n" +
        "}\n",
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

// ---------------------------------------------------------------------------
// Offline route mocks. We do NOT reuse support/terminal.ts `mockRoutes` for the
// readings line because this spec needs the reading to carry a LOVERS draw (the
// bindability precondition); we build a bespoke readings body from the same
// schema-valid green-garden necropsy fixture with a `lovers` draw injected into
// both `reading.draws` and the in-scope spread, and strip the demo flag so the
// terminal renders a LIVE reading.
// ---------------------------------------------------------------------------

const bundlePath = new URL(
  "../src/demo/bundle.generated.json",
  import.meta.url,
);

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

/**
 * Build the LIVE readings NDJSON body: the four reading phases then a `{ result }`
 * line carrying a `ReadingResponse` whose reading includes the LOVERS draw. The
 * green-garden necropsy fixture is the base; the demo flag is stripped so the
 * terminal treats it as a live reading (real Evidence_Links), and the LOVERS
 * draw is inserted into both `reading.draws` and an empty spread slot so the
 * repo reads as bindable.
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
  // Strip the demo flag so the terminal renders a LIVE reading (not a replay).
  const { demo: _demo, ...summary } = base.summary as { demo?: unknown };

  // Deep-clone the reading and inject the LOVERS draw into its draw list and
  // into the first empty spread slot so the reading is bindable.
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

/** NDJSON body from an array of line objects (one JSON object per line). */
function ndjson(lines: readonly unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

const NDJSON_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

/**
 * Intercept `/api/summon` and `/api/readings` offline (the reading carries the
 * LOVERS draw). `/api/lovers` is NOT mocked here — each test registers its own
 * `/api/lovers` handler for the scenario it drives. Returns a per-route call
 * counter and installs the cross-host leak guard.
 */
async function mockSummonAndReadings(
  page: Page,
): Promise<{ summon: number; readings: number }> {
  const calls = { summon: 0, readings: 0 };
  const response = liveReadingWithLovers();

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

  return calls;
}

/**
 * Attach a leak guard that fails the test if any request escapes the mocks to a
 * real host — github / pypi / osv / openrouter. Returns a getter for the flag.
 */
function installLeakGuard(page: Page): () => boolean {
  let leaked = false;
  page.on("request", (req) => {
    if (/github\.com|pypi\.org|osv\.dev|amazonaws\.com|openrouter/.test(req.url())) {
      leaked = true;
    }
  });
  return () => leaked;
}

/** The HUD region accessible name in each Soul_Source mode (SoulSourceHud). */
function hud(page: Page, mode: "ORACLE" | "YOURS") {
  return page.getByRole("status", { name: `SOUL SOURCE: ${mode}` });
}

/** A representative fake OpenRouter-style user key (only ever typed, masked). */
const FAKE_USER_KEY = "sk-or-v1-necro-lovers-e2e-secret-abcd99";

/** Submit a user key through the masked `key set` input (SoulKeyInput). */
async function enterKey(page: Page, key: string): Promise<void> {
  await runCommand(page, "key set");
  const field = page.locator("#crt-soul-key");
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute("type", "password");
  await field.fill(key);
  await field.press("Enter");
}

/** Bring a bindable reading into scope: summon then read the necropsy spread. */
async function summonAndRead(page: Page): Promise<void> {
  await runCommand(page, "summon graveyard/green-garden");
  await expect(sel.log(page)).toContainText("graveyard/green-garden");
  await runCommand(page, "read necropsy");
  // The star draw still anchors the reading render; the LOVERS draw rides along.
  await expect(sel.log(page)).toContainText("THE STAR");
}

// ---------------------------------------------------------------------------
// 1. Happy flow: PRE_BINDING_PHRASE → four phases in order → result line →
//    the DMG LoversView mounts (R14.1, R19.1-R19.5, R21.5, R21.6, R22.1)
// ---------------------------------------------------------------------------

test.describe("Lovers happy flow: phases stream in order, then the DMG view mounts (R14.1, R19.1, R19.2, R19.3, R19.4, R19.5, R21.5, R21.6, R22.1)", () => {
  test("summon → read → lovers streams PLAN/GENERATE/VALIDATE/BIND then mounts the split view", async ({
    page,
  }) => {
    const leaked = installLeakGuard(page);
    const calls = await mockSummonAndReadings(page);

    // The lovers stream: the four ordered phases, then one schema-valid result
    // line. No LLM, no sandbox, no wire — the whole binding is this NDJSON.
    let loversCalls = 0;
    await page.route("**/api/lovers", async (route: Route) => {
      loversCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        headers: NDJSON_HEADERS,
        body: ndjson([
          ...LOVERS_PHASES.map((phase) => ({ phase })),
          { result: loversResult({ path: "llm", soulSource: "ORACLE" }) },
        ]),
      });
    });

    await bootTerminal(page);
    const log = sel.log(page);

    await summonAndRead(page);

    // Start the binding. The reducer pushes PRE_BINDING_PHRASE immediately.
    await runCommand(page, `lovers ${BINDABLE_FILE} js`);
    await expect(log).toContainText(PRE_BINDING_PHRASE);

    // R19.2 — the four phase technical tokens appear IN ORDER. Asserting each in
    // sequence pins ordering: a later assertion only passes once its token is in
    // the log, and the stream emits them PLAN → GENERATE → VALIDATE → BIND.
    for (const technical of LOVERS_PHASE_TECHNICAL) {
      await expect(log).toContainText(technical);
    }
    // Belt-and-braces: the rendered order of the four tokens matches the pipeline.
    const logText = await log.innerText();
    const indices = LOVERS_PHASE_TECHNICAL.map((t) => logText.indexOf(t));
    expect(indices.every((i) => i >= 0)).toBe(true);
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);

    // R19.3/R21.* — the terminal `{ result }` summary renders (the authoritative
    // log line names the file, the function count, and the LLM path).
    await expect(log).toContainText(`BOUND ${BINDABLE_FILE} to JavaScript`);
    await expect(log).toContainText("1 function(s)");
    await expect(log).toContainText("THE LOVERS are bound");

    // The stream has settled: aria-busy is back to false, no error block.
    await expect(log).toHaveAttribute("aria-busy", "false");
    await expect(log).not.toContainText("ERROR ");

    // R22.1 — the lazy DMG LoversView mounts: a region named "The Lovers
    // binding". The result line re-validated against LoversResultWireSchema
    // before resolving, so a mounted view proves the line was schema-valid.
    const view = page.getByRole("region", { name: LOVERS_VIEW_REGION });
    await expect(view).toBeVisible();

    // The three code panes render, each with its real title.
    for (const title of PANE_TITLES) {
      await expect(view.getByRole("heading", { name: title })).toBeVisible();
    }
    // The bound code bodies actually rendered in their panes.
    await expect(view).toContainText("def greet(name):");
    await expect(view).toContainText("export function greet(name)");
    await expect(view).toContainText("greet.request");

    // R21.5/R21.6 — the page itself never scrolls (the view fits the viewport);
    // any overflow scrolls INSIDE a pane. Assert the document is not scrollable
    // at three common desktop sizes.
    for (const size of [
      { width: 1280, height: 720 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size);
      await expect(view).toBeVisible();
      const scrolls = await page.evaluate(() => {
        const el = document.scrollingElement ?? document.documentElement;
        return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
      });
      expect(scrolls, `page must not scroll at ${size.width}x${size.height}`).toBe(false);
    }

    // The Download pair affordance is present (R22.1) — a client-side ZIP build.
    await expect(
      view.getByRole("button", { name: "Download the bound pair as a ZIP" }),
    ).toBeVisible();

    expect(calls.summon).toBeGreaterThanOrEqual(1);
    expect(calls.readings).toBeGreaterThanOrEqual(1);
    expect(loversCalls).toBeGreaterThanOrEqual(1);
    expect(leaked(), "the lovers flow must make no real network request").toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. ORACLE soft-degrade: no key → a NOTICE + a deterministic template result,
//    the view still mounts, NO error block (R42.1)
// ---------------------------------------------------------------------------

test.describe("Lovers ORACLE soft-degrade: no key yields a NOTICE and a template result, never an error (R42.1)", () => {
  test("lovers with no key streams a degrade NOTICE and a deterministic result that still mounts the view", async ({
    page,
  }) => {
    // The oracle-voice NOTICE a no-key ORACLE run emits: the mystical line then
    // the plain fact. It travels as a `{ skip, note }` line and renders verbatim.
    const NOTICE_LINE =
      "The living tongue slumbered; no key opened its lips.\n" +
      "No LLM key configured; the old rite binds this pair instead.";

    const leaked = installLeakGuard(page);
    await mockSummonAndReadings(page);

    // The soft-degrade stream: the four phases, the NOTICE skip-note line, then
    // a deterministic `path:"template"` result. The provider is never reached.
    await page.route("**/api/lovers", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        headers: NDJSON_HEADERS,
        body: ndjson([
          ...LOVERS_PHASES.map((phase) => ({ phase })),
          { skip: true, note: NOTICE_LINE },
          { result: loversResult({ path: "template", soulSource: "ORACLE" }) },
        ]),
      });
    });

    await bootTerminal(page);
    const log = sel.log(page);

    // Soul_Source is ORACLE throughout (no key set).
    await expect(hud(page, "ORACLE")).toBeVisible();

    await summonAndRead(page);
    await runCommand(page, `lovers ${BINDABLE_FILE} js`);

    // The NOTICE renders verbatim as plain text in the log (both oracle layers).
    await expect(log).toContainText("The living tongue slumbered; no key opened its lips");
    await expect(log).toContainText("the old rite binds this pair instead");

    // SOFT degrade: the deterministic result still settles and the view mounts —
    // and NO error block appears.
    await expect(log).toContainText(`BOUND ${BINDABLE_FILE} to JavaScript`);
    await expect(log).not.toContainText("ERROR UPSTREAM_UNAVAILABLE");
    await expect(log).not.toContainText("ERROR ");
    await expect(log).toHaveAttribute("aria-busy", "false");

    const view = page.getByRole("region", { name: LOVERS_VIEW_REGION });
    await expect(view).toBeVisible();
    for (const title of PANE_TITLES) {
      await expect(view.getByRole("heading", { name: title })).toBeVisible();
    }

    expect(leaked(), "the soft-degrade path must make no real request").toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. YOURS hard failure: a user key whose provider returns 401/402 →
//    ERROR UPSTREAM_UNAVAILABLE, no success view, key never leaks
//    (R28.1, R28.2, R29.2, R42.2)
// ---------------------------------------------------------------------------

test.describe("Lovers YOURS hard failure: a user-key 401/402 surfaces a typed error, no silent fallback, key never leaks (R28.1, R28.2, R29.2, R42.2)", () => {
  test("lovers with a user key whose provider rejects shows ERROR UPSTREAM_UNAVAILABLE and mounts no view", async ({
    page,
  }) => {
    // The typed oracle-voice error the route returns when a USER key is refused
    // at OpenRouter (401/402). It travels as a `{ error: { code, userMessage } }`
    // terminal line and renders as `ERROR UPSTREAM_UNAVAILABLE` + the message.
    const ERROR_USER_MESSAGE =
      "Your soul was refused at the gate.\n" +
      "OpenRouter rejected your key (401/402); the oracle will not pay in your stead.";

    const leaked = installLeakGuard(page);
    await mockSummonAndReadings(page);

    // Emit a terminal error line AFTER the stream committed to 200 — exactly how
    // the route carries a post-stream failure. The user-key 401/402 is the HARD
    // case: the route does NOT fall back to a server key, it emits the typed
    // error. No real provider is reached.
    await page.route("**/api/lovers", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        headers: NDJSON_HEADERS,
        body: ndjson([
          { phase: "PLAN" },
          { phase: "GENERATE" },
          { error: { code: "UPSTREAM_UNAVAILABLE", userMessage: ERROR_USER_MESSAGE } },
        ]),
      });
    });

    await bootTerminal(page);
    const log = sel.log(page);

    // Bind a user key so the Soul_Source is YOURS for the run (HUD flips).
    await enterKey(page, FAKE_USER_KEY);
    await expect(hud(page, "YOURS")).toBeVisible();

    await summonAndRead(page);
    await runCommand(page, `lovers ${BINDABLE_FILE} js`);

    // The typed oracle-voice error renders (hard case): the `ERROR <CODE>`
    // header and BOTH oracle-voice layers. No silent fallback.
    await expect(log).toContainText("ERROR UPSTREAM_UNAVAILABLE");
    await expect(log).toContainText("Your soul was refused at the gate");
    await expect(log).toContainText(
      "OpenRouter rejected your key (401/402); the oracle will not pay in your stead",
    );

    // No success view mounts: the DMG LoversView region is absent, and the
    // settled-result summary line never appears.
    await expect(page.getByRole("region", { name: LOVERS_VIEW_REGION })).toHaveCount(0);
    await expect(log).not.toContainText(`BOUND ${BINDABLE_FILE} to JavaScript`);

    // R29.2 — the user key value NEVER appears anywhere in the rendered page,
    // not in the error block nor the serialized DOM.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(FAKE_USER_KEY);
    const html = await page.content();
    expect(html).not.toContain(FAKE_USER_KEY);

    expect(leaked(), "the hard-failure path must make no real request").toBe(false);
  });
});
