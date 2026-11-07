// Vitest setup for the jsdom component / axe suites in `apps/web`: register the
// jest-dom matchers (`toBeInTheDocument`, `toHaveAttribute`, ...) on Vitest's
// `expect`. It mirrors `@necro/ui-crt`'s `src/testing/setup-dom.ts`.
//
// This file is listed in `vitest.config.ts` `setupFiles`. It only extends
// `expect` and imports the jest-dom matcher types, so it is a no-op for the
// pure node suites (which never call a DOM matcher) while giving the jsdom
// suites the assertions they need.

import "@testing-library/jest-dom/vitest";
