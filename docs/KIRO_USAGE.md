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

### Nov 4, 2026 - Spec 02-github-summoner, task 1 (tar-stream spike)
- Verified `tar-stream@3.2.2` through the `Readable.fromWeb` bridge with committed characterization tests (`packages/github/src/tar-extract.spike.test.ts`): pax global (g) and extended (x) headers and GNU long names resolve into `header.name` and never surface as entries; traversal names pass through verbatim (our normalizer must reject them); destroying extract + bridge, or a byte-counting guard error placed before the bridge, cancels the upstream reader and stops pulling.
- Finding: the async-iterator form (`for await`) does not block on an unconsumed entry. `next()` auto-drains and discards it. Only the event form `extract.on("entry", (header, stream, next) => ...)` blocks until `stream.resume()` + `next()`.
- Decision: the extractor uses the event form with explicit `next()` (design D3). Byte-count guards sit upstream of tar-stream, so skipped-entry bytes count toward the caps (P11 groundwork tests, R3.10 and R3.11).
- Install note: `tar-stream@3.2.2` declares `bare-fs` (plus b4a, streamx, fast-fifo). We never call an fs path, but it enlarges the install footprint.
- Hook: `auto-commit-after-task` now runs `pnpm -r typecheck` and `pnpm -r test`. Added `test` scripts to `@necro/oracle` and `@necro/github`.
- Event-form hazard found while writing the skipped-bytes test: destroying `extract` with an error also errors the in-flight entry stream, and with no `error` listener that is an uncaught exception. Every entry handler in the real extractor must attach `stream.on("error", ...)`.
