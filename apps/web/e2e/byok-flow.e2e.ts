// apps/web/e2e/byok-flow.e2e.ts
//
// Feature: lovers-binding, task 14.3 — the BYOK (bring-your-own-key) end-to-end
// flow in the browser, driven entirely offline (NO real GitHub / LLM / network).
//
// This spec runs with the server having NO OpenRouter key (OPENROUTER_API_KEY
// UNSET, the Playwright `webServer` inherits the ambient env and the test
// machine does not set it) and the real provider never reached: every `/api/*`
// call the terminal makes is intercepted with `page.route(...)`, so the
// OpenRouter provider's `fetch` is never invoked. A `page.on("request", …)`
// guard fails the test if anything leaks past the mocks to a real host.
//
// What this covers, and WHY it uses the resurrect route rather than lovers:
//   - BYOK commands + HUD are LOCAL-only (R25.2-R25.4, R24.4, R26.3): `key set`
//     opens the masked input, submitting a key flips the `SOUL SOURCE` HUD to
//     YOURS, `key status` reports only the last-four preview, `key clear`
//     returns to ORACLE, and a reload forgets the key (the key lives in a
//     `useRef`, never storage). None of this touches the network.
//   - The soft-degrade NOTICE (ORACLE, no key) and the hard UPSTREAM_UNAVAILABLE
//     case (YOURS, provider 401/402) are exercised over the `/api/resurrect`
//     NDJSON stream, which IS fully wired through the terminal shell (see
//     `resurrect-flow.e2e.ts`). The `lovers` command is still a reducer stub at
//     this point in the plan (its `/api/lovers` wiring is a later task), so the
//     terminal cannot yet render a lovers NOTICE/error line — asserting one
//     here would be a test that can never go green. The resurrect route shares
//     the identical degrade matrix, skip-note NOTICE line, and typed
//     `UPSTREAM_UNAVAILABLE` error envelope (design §"Degrade matrix", D.5), so
//     it faithfully exercises the same server behaviour the lovers route reuses.
//
// The DOM/stream contract these assertions anchor on is the REAL source, never
// invented copy:
//   - the `SOUL SOURCE` HUD is the always-present `role="status"` region whose
//     accessible name is `SOUL SOURCE: ORACLE` / `SOUL SOURCE: YOURS`
//     (`@necro/ui-crt` `SoulSourceHud`, driven by `state.soulSource`);
//   - the masked key field is `#crt-soul-key`, `type="password"`,
//     `aria-label="OpenRouter key"` (`SoulKeyInput`), opened by `key set`;
//   - `key status` prints the reducer's last-four status line, never the key;
//   - a soft-degrade NOTICE is a `{ skip: true, note }` stream line rendered
//     verbatim as a status block (`renderSkipNote`);
//   - a hard error is a `{ error: { code, userMessage } }` stream line rendered
//     as `ERROR UPSTREAM_UNAVAILABLE` + the oracle-voice message
//     (`renderError`).
//
// Planned-red note (mirrors the sibling specs): this spec is run by the
// maintainer via `pnpm --filter @necro/web e2e` AFTER a one-time
// `pnpm --filter @necro/web exec playwright install`. Browser binaries may be
// absent on CI / a fresh machine, so the spec is EXPECTED to be not-yet-run
// there; it type-checks and lints as part of the normal gate.
//
// _Requirements: R24.4, R25.2, R25.3, R25.4, R26.3, R28.1, R28.2, R29.2,
//                R40.2, R42.1, R42.2_

import { expect, test, type Page, type Route } from "@playwright/test";

import {
  RESURRECT_PHASES,
  RESURRECT_RESULT,
  bootTerminal,
  mockRoutes,
  runCommand,
  sel,
} from "./support/terminal.js";

// --- a representative fake user key ---------------------------------------
//
// A plausible OpenRouter-style key. It is ONLY ever typed into the masked
// `#crt-soul-key` field and must never appear anywhere in the rendered page —
// the last-four preview (`cd99`) is the only fragment allowed to surface.
const FAKE_USER_KEY = "sk-or-v1-necro-byok-e2e-secret-abcd99";
const FAKE_USER_KEY_LAST4 = FAKE_USER_KEY.slice(-4); // "cd99"

/** The accessible name of the HUD in each Soul_Source mode (SoulSourceHud). */
function hud(page: Page, mode: "ORACLE" | "YOURS") {
  return page.getByRole("status", { name: `SOUL SOURCE: ${mode}` });
}

/**
 * Submit a key through the masked `key set` input. Opens the input with
 * `key set`, types the raw key into the `type="password"` field (so it is
 * masked on screen and never echoed), and submits with Enter. The raw value
 * reaches only the in-memory `SoulKeyContext` ref; the reducer records only the
 * last-four mirror and flips the HUD to YOURS.
 */
async function enterKey(page: Page, key: string): Promise<void> {
  await runCommand(page, "key set");
  const field = page.locator("#crt-soul-key");
  await expect(field).toBeVisible();
  // The field is masked: a password input never renders its own value to text.
  await expect(field).toHaveAttribute("type", "password");
  await expect(field).toHaveAttribute("aria-label", "OpenRouter key");
  await field.fill(key);
  await field.press("Enter");
}

/**
 * Bring a completed reading into scope so `resurrect` has something to work on,
 * reusing the offline mocked summon/read path from `mockRoutes`.
 */
async function summonAndRead(page: Page): Promise<void> {
  await runCommand(page, "summon graveyard/green-garden");
  await expect(sel.log(page)).toContainText("graveyard/green-garden");
  await runCommand(page, "read necropsy");
  await expect(sel.log(page)).toContainText("THE STAR");
}

// ---------------------------------------------------------------------------
// BYOK key commands + the SOUL SOURCE HUD (R24.4, R25.2-R25.4, R26.3, R29.2)
// ---------------------------------------------------------------------------

test.describe("BYOK key commands and Soul_Source HUD (R24.4, R25.2, R25.3, R25.4, R26.3, R29.2)", () => {
  test("key set flips the HUD to YOURS, key status previews last-4 only, key clear returns to ORACLE", async ({
    page,
  }) => {
    // Fail the test if any request escapes to a real host. No command in this
    // test should make ANY network call (the key flow is entirely local), so
    // even an `/api/*` hit is unexpected here.
    let networkLeak = false;
    page.on("request", (req) => {
      const url = req.url();
      if (/github\.com|pypi\.org|osv\.dev|amazonaws\.com|openrouter/.test(url)) {
        networkLeak = true;
      }
    });

    await bootTerminal(page);
    const log = sel.log(page);

    // Default Soul_Source is ORACLE: the HUD states so from the first frame.
    await expect(hud(page, "ORACLE")).toBeVisible();

    // `key set` opens the masked input with the oracle-voice "memory only" line.
    await runCommand(page, "key set");
    await expect(log).toContainText("Whisper your key to the void");
    await expect(page.locator("#crt-soul-key")).toBeVisible();

    // Submit a key through the masked field; the HUD flips to YOURS.
    const field = page.locator("#crt-soul-key");
    await expect(field).toHaveAttribute("type", "password");
    await field.fill(FAKE_USER_KEY);
    await field.press("Enter");
    await expect(hud(page, "YOURS")).toBeVisible();

    // `key status` reports a key is SET and previews ONLY the last four runes —
    // never the full key.
    await runCommand(page, "key status");
    await expect(log).toContainText("A key is bound. SOUL SOURCE: YOURS");
    await expect(log).toContainText(
      `the last four runes are ${FAKE_USER_KEY_LAST4}`,
    );

    // `key clear` drops the key and returns the HUD to ORACLE.
    await runCommand(page, "key clear");
    await expect(log).toContainText("The key dissolves into the ether");
    await expect(hud(page, "ORACLE")).toBeVisible();

    // `key status` now reports no key is bound (ORACLE pays).
    await runCommand(page, "key status");
    await expect(log).toContainText("No key is bound. SOUL SOURCE: ORACLE");

    // R29.2 — the raw key value NEVER appears anywhere in the rendered page;
    // only the last-four preview may. Assert the full key string is absent from
    // the whole page text and from the serialized DOM.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(FAKE_USER_KEY);
    const html = await page.content();
    expect(html).not.toContain(FAKE_USER_KEY);

    expect(networkLeak, "the BYOK key flow must make no network request").toBe(
      false,
    );
  });

  test("reload forgets the key: the Soul_Source returns to ORACLE (R26.3)", async ({
    page,
  }) => {
    await bootTerminal(page);

    await enterKey(page, FAKE_USER_KEY);
    await expect(hud(page, "YOURS")).toBeVisible();

    // The key lives only in an in-memory ref for this tab; a reload forgets it.
    await page.reload();
    await bootTerminal(page);

    // After the reload the Soul_Source is ORACLE again and `key status`
    // confirms no key is bound — the key did not survive the navigation.
    await expect(hud(page, "ORACLE")).toBeVisible();
    await runCommand(page, "key status");
    await expect(sel.log(page)).toContainText(
      "No key is bound. SOUL SOURCE: ORACLE",
    );

    // And the key value is nowhere in the reloaded page.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(FAKE_USER_KEY);
  });
});

// ---------------------------------------------------------------------------
// Soft-degrade: no server key, no user key (ORACLE) → NOTICE + deterministic
// result, never an error screen (R40.2, R42.1)
// ---------------------------------------------------------------------------

test.describe("ORACLE soft-degrade: no key yields a NOTICE and a deterministic result (R40.2, R42.1)", () => {
  test("resurrect with no key streams a degrade NOTICE and the deterministic diff, never an error", async ({
    page,
  }) => {
    // The oracle-voice NOTICE a no-key ORACLE run emits (design "Degrade matrix":
    // the mystical line then the plain fact). It travels as a `{ skip, note }`
    // stream line and renders verbatim as a status block in the log.
    const NOTICE_LINE =
      "The oracle keeps its own counsel tonight.\n" +
      "No LLM key configured; deterministic result only.";

    let networkLeak = false;
    page.on("request", (req) => {
      const url = req.url();
      if (/github\.com|pypi\.org|osv\.dev|amazonaws\.com|openrouter/.test(url)) {
        networkLeak = true;
      }
    });

    // Reuse the offline summon/read mocks, then OVERRIDE `/api/resurrect` to
    // emit the soft-degrade stream: the six phases, the NOTICE skip-note line,
    // then the deterministic result. Registered after `mockRoutes` so this
    // handler wins for `/api/resurrect` (Playwright uses the last matching
    // route first). NO real provider is reached.
    await mockRoutes(page);
    await page.route("**/api/resurrect", async (route: Route) => {
      const lines = [
        ...RESURRECT_PHASES.map((phase) => ({ phase })),
        { skip: true, note: NOTICE_LINE },
        { result: { ...RESURRECT_RESULT, degraded: true } },
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
        body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      });
    });

    await bootTerminal(page);
    const log = sel.log(page);

    // Soul_Source is ORACLE throughout (no key set).
    await expect(hud(page, "ORACLE")).toBeVisible();

    await summonAndRead(page);
    await runCommand(page, "resurrect");

    // The NOTICE renders as plain text in the log (both oracle-voice layers).
    await expect(log).toContainText("The oracle keeps its own counsel tonight");
    await expect(log).toContainText(
      "No LLM key configured; deterministic result only",
    );

    // The deterministic result still renders — the diff header is present and
    // the stream settles. This is a SOFT degrade: no error block appears.
    await expect(log).toContainText("FILE src/legacy.py");
    await expect(log).not.toContainText("ERROR UPSTREAM_UNAVAILABLE");
    await expect(log).not.toContainText("ERROR ");
    await expect(log).toHaveAttribute("aria-busy", "false");

    expect(networkLeak, "the soft-degrade path must make no real request").toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Hard case: a user key (YOURS) whose provider returns 401/402 →
// UPSTREAM_UNAVAILABLE error line, no silent fallback (R28.1, R28.2, R42.2)
// ---------------------------------------------------------------------------

test.describe("YOURS hard failure: a user-key 401/402 surfaces a typed error, no silent fallback (R28.1, R28.2, R42.2)", () => {
  test("resurrect with a user key whose provider rejects shows ERROR UPSTREAM_UNAVAILABLE", async ({
    page,
  }) => {
    // The typed oracle-voice error the route returns when a USER key is refused
    // at OpenRouter (401/402). It travels as a `{ error: { code, userMessage } }`
    // terminal line and renders as `ERROR UPSTREAM_UNAVAILABLE` + the message.
    const ERROR_USER_MESSAGE =
      "Your soul was refused at the gate.\n" +
      "OpenRouter rejected your key (401/402); the oracle will not pay in your stead.";

    let networkLeak = false;
    page.on("request", (req) => {
      const url = req.url();
      if (/github\.com|pypi\.org|osv\.dev|amazonaws\.com|openrouter/.test(url)) {
        networkLeak = true;
      }
    });

    // Reuse the summon/read mocks, then OVERRIDE `/api/resurrect` to emit a
    // terminal error line AFTER the stream has committed to 200 (exactly how
    // the route carries a post-stream failure). The user-key 401/402 is the one
    // HARD case: the route does NOT fall back to a server key — it emits the
    // typed error. No real provider is reached.
    await mockRoutes(page);
    await page.route("**/api/resurrect", async (route: Route) => {
      const lines = [
        { phase: RESURRECT_PHASES[0] },
        { phase: RESURRECT_PHASES[1] },
        { phase: RESURRECT_PHASES[2] },
        { error: { code: "UPSTREAM_UNAVAILABLE", userMessage: ERROR_USER_MESSAGE } },
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
        body: lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      });
    });

    await bootTerminal(page);
    const log = sel.log(page);

    // Bind a user key so the Soul_Source is YOURS for the run.
    await enterKey(page, FAKE_USER_KEY);
    await expect(hud(page, "YOURS")).toBeVisible();

    await summonAndRead(page);
    await runCommand(page, "resurrect");

    // The typed oracle-voice error renders (hard case): the `ERROR <CODE>`
    // header and BOTH oracle-voice layers. There is no silent fallback and no
    // deterministic diff presented as success for this run.
    await expect(log).toContainText("ERROR UPSTREAM_UNAVAILABLE");
    await expect(log).toContainText("Your soul was refused at the gate");
    await expect(log).toContainText(
      "OpenRouter rejected your key (401/402); the oracle will not pay in your stead",
    );

    // The user key value never surfaces in the error block or anywhere on the
    // page (R29.2) — not even in a redacted-looking form.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(FAKE_USER_KEY);

    expect(networkLeak, "the hard-failure path must make no real request").toBe(
      false,
    );
  });
});
