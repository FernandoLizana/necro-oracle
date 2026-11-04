// Vitest setup for the jsdom component/hook suites: register the jest-dom
// matchers (`toBeInTheDocument`, `toHaveAttribute`, `toHaveTextContent`, ...)
// on Vitest's `expect`, and auto-cleanup React trees between tests.
//
// This file is listed in `vitest.config.ts` `setupFiles`. It extends `expect`
// and imports the jest-dom matcher types, so it is a no-op for the pure node
// suites (which simply never call a DOM matcher) while giving the jsdom suites
// the assertions they need.

import "@testing-library/jest-dom/vitest";
