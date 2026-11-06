// apps/web/playwright.config.ts
//
// Feature: 03-crt-terminal, task 32 — the Playwright runner config for the
// browser e2e + axe specs. These specs live only under `apps/web/e2e/*.e2e.ts`
// and are run by the maintainer via `pnpm e2e` (root) / `pnpm --filter
// @necro/web e2e`. They are NEVER started by a unit test: the web Vitest config
// (`vitest.config.ts`) includes only `src/**/*.test.ts` and
// `src/**/*.pbt.test.ts`, so nothing under `e2e/` is picked up by Vitest.
//
// Transport: the specs boot the real Next production server (`next build &&
// next start`) through Playwright's `webServer`, then intercept `/api/summon`
// and `/api/readings` with `page.route(...)` so NO real GitHub/LLM/network
// call occurs (R16.11 spirit applied to e2e). The DEMO replay path needs no
// route interception at all — it loads the bundled, offline demo chunk.
//
// Boot signal (visual-necromancy task 18.1): every spec except the full-motion
// visual spec navigates with `?boot=skip` (the shared `bootTerminal` helper in
// `e2e/support/terminal.ts` appends it). `apps/web`'s `TerminalScreen` reads
// that flag into the Terminal's `bootSignal`, so the session lands on the ready
// prompt without waiting out the ~3.4 s Boot_Sequence. `visual-necromancy.e2e.ts`
// is the ONLY spec that navigates WITHOUT the flag, exercising the full boot.
// `apps/web/src/app/layout.tsx` is never modified for any of this.
//
// Planned-red note: as of task 32.1 the data-*/ARIA adjustments of task 32.2
// are not implemented and Playwright browser binaries may be absent, so these
// specs are EXPECTED to fail / not-yet-run. The maintainer installs browsers
// once (`pnpm --filter @necro/web exec playwright install`) before running.
//
// _Requirements: R1.1, R1.2, R1.5, R3.3-R3.6, R8.1, R10.11, R15.*, R18.5_

import { defineConfig, devices } from "@playwright/test";

/** The port the test Next server binds to (kept off the dev-server 3000). */
const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// The capture-only marketing-screenshot spec (`screenshots.e2e.ts`,
// visual-necromancy task 22.1) is skipped unless `CAPTURE_SCREENSHOTS` is set,
// so the default `pnpm --filter @necro/web e2e` / CI gate never writes PNGs
// into `docs/screenshots/`. The `screenshots` npm script targets that spec by
// filename; detect that invocation here and enable capture, so a maintainer can
// run `pnpm --filter @necro/web screenshots` cross-platform without exporting an
// env var first. Running the whole suite (no explicit screenshots target) keeps
// the spec skipped. An explicit `CAPTURE_SCREENSHOTS=1` is always honoured.
if (process.argv.some((arg) => arg.includes("screenshots.e2e.ts"))) {
  process.env.CAPTURE_SCREENSHOTS = "1";
}

export default defineConfig({
  // Only the explicit browser specs — never a stray `src` unit test.
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,

  // One retry locally is noise; CI gets one. No test depends on retries.
  retries: process.env.CI ? 1 : 0,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never" }]]
    : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // A deterministic, generous action timeout; the terminal reveal completes
    // any single block within ~3 s in full motion (R10.2).
    actionTimeout: 10_000,
  },

  // A single Chromium project. The reduced-motion boot spec (R10.11) forces the
  // `prefers-reduced-motion: reduce` media query itself with
  // `page.emulateMedia(...)` before navigating, so it needs no dedicated
  // project.
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Default to Playwright's own Chromium (installed via `playwright
        // install`). A maintainer on a machine where that download is blocked
        // can point the suite at a locally installed browser with
        // `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome` (or `msedge`) without editing
        // this file.
        ...(process.env.PLAYWRIGHT_CHROMIUM_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL }
          : {}),
      },
    },
  ],

  // Boot the real production build. `reuseExistingServer` lets a maintainer
  // keep a server up between runs locally; CI always starts a fresh one.
  webServer: {
    command: "pnpm run build && pnpm exec next start --port " + PORT,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
