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

### Nov 2026 - Spec 02-github-summoner, wrap-up
- Spec-driven tasks: the requirements-first workflow produced the spec (requirements, design, tasks). Each task ran as a scoped unit with its requirement links, so the work stayed traceable from R-numbers to code and tests.
- Requirements revision: review added rename redirects, a token-aware tarball path, three more error codes, and the Q16 optional-call carve-out (optional calls degrade and are reported in `degradedFields`).
- Property-based testing: the requirements named 19 properties (P1-P18 and P34). Prework added P19-P33 beside them. Properties were written test-first with fast-check, each tagged with its requirement numbers and run against recorded fixtures, with no network calls.
- Library choice: the tar-stream spike (characterization tests) and a `pnpm view tar-stream versions --json` lookup informed the pick of `tar-stream@3.2.2`, and showed the event form with explicit `next()` is the one that blocks on an unconsumed entry.
- Hooks: `auto-commit-after-task` builds `@necro/oracle`, then runs `pnpm -r typecheck` and `pnpm -r test`. When green, it commits all task changes since the last commit as "Spec 02 tasks <first>-<last>: <summary>". When red only because of planned test-first failures, it skips the commit.
- Steering: `tech.md`, `structure.md` and `security.md` fixed the stack, the dependency direction (adapters behind ports) and the untrusted-repository rules, so none of them needed re-prompting.
- Docs: `docs/DECK.md` needs no change, since no card, grimoire, agent, or gate changed.
