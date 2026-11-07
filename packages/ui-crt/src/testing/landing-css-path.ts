// Shared test helper: locate `src/landing/landing.css` regardless of the
// vitest working directory.
//
// The landing CSS-scan suites (oracle-landing-polish tasks 8.4/8.5) read the
// stylesheet source off disk. Those files run under jsdom, where
// `import.meta.url` is an `http://` URL that `fileURLToPath` rejects, so they
// cannot anchor on the module URL. Resolving from `process.cwd()` alone is
// fragile: `pnpm --filter @necro/ui-crt test` runs with CWD at the package
// root, but the repo-root `pnpm test` (the monorepo projects run) has CWD at
// the repo root. This helper tries the known candidate locations and returns
// the first that exists, so both run modes read the same source file.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Candidate locations for the landing stylesheet, most-specific first. */
const CANDIDATES = [
  // CWD = packages/ui-crt (filtered package run).
  resolve(process.cwd(), "src/landing/landing.css"),
  // CWD = repo root (monorepo `pnpm test` projects run).
  resolve(process.cwd(), "packages/ui-crt/src/landing/landing.css"),
];

/**
 * Absolute path to `packages/ui-crt/src/landing/landing.css`, resolved from
 * whichever working directory vitest launched in. Throws a clear error listing
 * the paths it checked if none exist.
 */
export function resolveLandingCss(): string {
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `landing.css not found. Checked:\n  ${CANDIDATES.join("\n  ")}`,
  );
}
