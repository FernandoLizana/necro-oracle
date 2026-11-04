---
inclusion: always
---
# Technology stack and constraints

## Stack (prefer these; do not introduce alternatives without asking)
- **TypeScript (strict)** on **Node 22**, **pnpm** workspaces monorepo. ESM only.
- **Web:** Next.js (App Router) + React, deployed on **Vercel** (alternative: AWS Amplify Hosting). Custom DOM-based CRT terminal (no canvas-only terminals; accessibility matters).
- **Durable orchestration:** **Inngest** (functions served at `/api/inngest`). Long sandbox commands run in background and are polled with `step.sleep`; never block a serverless function for more than ~50 s.
- **Sandboxes:** **E2B** (TS SDK `e2b`) with custom templates `necro-py27`, `necro-py312`; **LocalDocker** provider for CLI/dev. Python exists ONLY inside sandboxes.
- **LLM:** **Vercel AI SDK** with providers Amazon Bedrock (default), Anthropic, OpenAI, and a deterministic **Mock** provider. Use structured outputs (`generateObject`) with **zod** schemas. Cache by prompt hash.
- **State:** **Upstash Redis** (Streams for the ledger, cache, `@upstash/ratelimit`). TTL 7 days on ritual data.
- **GitHub:** Octokit. Public data: OSV.dev, PyPI JSON API, npm registry.
- **Parsing:** `web-tree-sitter` + tree-sitter-python WASM; TOML parser for pyproject; never execute repository code outside the sandbox.
- **MCP:** `@modelcontextprotocol/sdk` (stdio first).
- **CLI:** `commander` (+ `ink` optional), ANSI phosphor theme.
- **Voice:** Amazon Polly (cached), Web Speech API fallback.
- **Tests:** Vitest, **fast-check** for property-based tests, Playwright for e2e, golden fixtures for grimoires; Hypothesis inside Python sandboxes.

## Engineering rules
- zod validation at every boundary (HTTP, MCP, LLM outputs, sandbox outputs, env vars).
- Pure functions for detectors, spreads, scoring, fixers, gates. Side effects only in adapters behind ports (`LlmPort`, `SandboxPort`, `GitHubPort`, `LedgerPort`, `VoicePort`).
- No network, LLM, or sandbox calls in unit/property tests: use Mock providers and recorded fixtures.
- Errors are typed (`NecroError` with `code`, `userMessage` in oracle voice, `cause`). Never swallow errors.
- Every LLM call has: a schema, a token budget, a timeout, a cache key, and a Mock fixture.
- Secrets only via environment variables validated at startup (`packages/config`). Never print tokens. Never commit `.env*`.
- Performance budgets: first reading p50 ≤ 20 s for ≤ 500 files; web JS bundle for the terminal route ≤ 250 KB gzipped (card images lazy-loaded).

## Commands
- `pnpm i` · `pnpm dev` (web + Inngest dev server) · `pnpm test` (Vitest, all packages, single run) · `pnpm test:pbt` · `pnpm e2e` · `pnpm lint` · `pnpm typecheck` · `pnpm build`
- `pnpm --filter @necro/cli start -- read <owner/repo>`
- `pnpm sandbox:templates` (build E2B templates)
