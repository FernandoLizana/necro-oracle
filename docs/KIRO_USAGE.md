# How Kiro Was Used

A daily log of how Kiro (specs, steering, hooks, MCP, agents, CLI) shaped this project. Raw material for the submission write-up.

## Steering
## Specs
## Hooks
## MCP
## Custom agents & CLI
## Property-based testing

## Daily log

### Day 1 — Nov 3, 2026
- Created public repo with MIT license.
- Added 9 curated steering files (`always` / `fileMatch` / `auto` inclusion).
- Configured MCP servers: GitHub, Context7.
- Kiro scaffolded the full pnpm workspaces monorepo skeleton (13 workspace packages, `apps/web` Next.js placeholder, root `tsconfig.json` with composite project references, Vitest 3.x with `projects:` array, ESLint 9 flat config with split type-aware/syntax-only blocks) in a single session — Context7 MCP was used to pull current pnpm action-setup, Vitest 3.2 deprecation notes, and Next.js App Router tsconfig requirements. The steering files (`tech.md`, `structure.md`) drove every naming and architecture decision without needing re-prompting.
