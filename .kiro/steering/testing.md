---
inclusion: fileMatch
fileMatchPattern: ["**/*.test.ts", "**/*.pbt.test.ts", "**/*.e2e.ts", "**/fixtures/**", "**/vitest.config.*"]
---
# Testing standards

- Every requirement in a spec maps to at least one test; property tests reference requirement IDs in their `describe` title.
- Use **fast-check** for properties. Prefer `fc.assert(fc.property(...))` with explicit `numRuns` (default 200; 1000 for fixers, spreads, normalizers). Always print the seed on failure; when a counterexample is found, add it as a permanent example test (regression) next to the property.
- Build reusable arbitraries in `packages/*/test/arbitraries.ts`: `arbRepoSnapshot`, `arbPy2Program` (grammar-based generator of small py2 programs), `arbLedgerEvents`, `arbGateResults`, `arbGithubUrl`.
- Canonical properties to prefer: determinism, idempotence, round-trip (patch apply, ledger fold/replay, TOML), monotonicity (vitality, verdict), invariants (no card twice, evidence paths exist, tests unchanged), metamorphic relations (adding an unrelated file doesn't change unrelated cards).
- Golden fixtures for grimoires: `fixtures/<case>/before` → `after`; a fixer change that alters a golden output must update the fixture in the same commit with a reason.
- No network, LLM, or sandbox in unit/property tests. Integration tests that need sandboxes are tagged `@sandbox` and run only in the nightly workflow.
- e2e (Playwright): boot → summon a graveyard repo (Mock LLM) → spread visible → explain card → ritual (recorded ledger) → verdict → body. Also axe accessibility check.
