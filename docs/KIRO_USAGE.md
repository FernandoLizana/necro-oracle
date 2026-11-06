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

### 2026-11-04 - Spec 02-github-summoner, wrap-up
- Note: parts of Day 2 and of the spec 01 requirements and design were done on my other personal Kiro account (Free plan), so they are not fully reflected in this log.
- Spec-driven tasks: the requirements-first workflow produced the spec (requirements, design, tasks). Each task ran as a scoped unit with its requirement links, so the work stayed traceable from R-numbers to code and tests.
- Requirements revision: review added rename redirects, a token-aware tarball path, three more error codes, and the Q16 optional-call carve-out (optional calls degrade and are reported in `degradedFields`).
- Property-based testing: the requirements named 19 properties (P1-P18 and P34). Prework added P19-P33 beside them. Properties were written test-first with fast-check, each tagged with its requirement numbers and run against recorded fixtures, with no network calls.
- Library choice: the tar-stream spike (characterization tests) and a `pnpm view tar-stream versions --json` lookup informed the pick of `tar-stream@3.2.2`, and showed the event form with explicit `next()` is the one that blocks on an unconsumed entry.
- Hooks: `auto-commit-after-task` builds `@necro/oracle`, then runs `pnpm -r typecheck` and `pnpm -r test`. When green, it commits all task changes since the last commit as "Spec 02 tasks <first>-<last>: <summary>". When red only because of planned test-first failures, it skips the commit.
- Steering: `tech.md`, `structure.md` and `security.md` fixed the stack, the dependency direction (adapters behind ports) and the untrusted-repository rules, so none of them needed re-prompting.
- Docs: `docs/DECK.md` needs no change, since no card, grimoire, agent, or gate changed.

### 2026-11-04 — Spec 03-crt-terminal, task 17.2 (tokens, CSS, components, hooks)
- Test-first paid off: task 17.1 had already written the token/CSS parity suite, the Terminal behaviour suite, and the three hook suites (`use-motion`, `use-reveal`, `use-sound`) against exact prop/DOM contracts. Task 17.2 implemented `src/tokens.ts`, `src/crt.css`, nine components (`Screen`, `Terminal`, `OutputLog`, `OutputBlockView`, `Card`, `Spread`, `EvidenceScroll`, `CommandLine`, `ButtonRow`) and four hooks (`use-terminal`, `use-reveal`, `use-motion`, `use-sound`) strictly to satisfy those tests — 271/271 ui-crt tests green, typecheck and lint clean.
- Token adjustment forced by the computed WCAG gate: the design listed `--crt-focus #d9ffe3` as a candidate, but the tokens test computes real sRGB contrast and demands the focus ring reach ≥ 3:1 against BOTH the background and the bright `#33ff66` foreground. `#d9ffe3` scored only ~1.24:1 against the foreground. Because `#33ff66` has a high relative luminance, the only colours that clear 3:1 on both sides sit in a narrow mid-luminance band; the token (and the matching CSS variable) were changed to `#a85c30`, an amber-brown at ~3.69:1 on both sides. Every other candidate (`#33ff66`, `#001a00`, `#29cc52`, `#ff7a7a`) passed unchanged. The test stayed the arbiter; no threshold was weakened.
- Reveal/announce-once reconciliation: the pure reducer (task 15.2) queues every new block for reveal and offers no block-append action for the sound-failure notice. The view layer honoured the design without touching the tested reducer — only Oracle output typewriter-reveals (boot banner and echoed commands show at once), the full block text is always present in the live copy so the screen reader hears it once, and the R19.14 "speakers are silent" notice is a one-shot view notice. Reported both reconciliations rather than editing the reducer.
- Environment fix: importing `crt.css` in the jsdom component suites tripped Vite's PostCSS config search on BOM-prefixed `package.json` files in the monorepo. Stripped the BOM from `packages/ui-crt/package.json` and added an empty `postcss.config.js`; production (Next.js) bundling is unaffected.

### 2026-11-05 - Spec 03-crt-terminal, wrap-up
- Spec-driven tasks: the requirements-first workflow produced the full spec (requirements.md → design.md → tasks.md). Tasks were structured test-first, with every property P1-P29 owned by exactly one `*.pbt.test.ts` and tagged with its requirement numbers, so the work stayed traceable from R-numbers to code and tests.
- Steering (`oracle-voice`): drove the voice table (`packages/ui-crt/src/voice/voice-table.ts`) and the fixed phrases — the exhaustive card×orientation mystical lines came straight from the steering tone/vocabulary rules rather than ad-hoc prompting.
- Property-based testing (fast-check), no network/LLM/sandbox: the command parser (round-trip, totality, whitespace tolerance), the text sanitiser/wrapper, the session reducer, the streaming phase machine, the rate-limiter arithmetic, secret redaction, and evidence-link construction were each covered by named properties (P1-P29) run against fixtures.
- Hooks: `auto-commit-after-task` (`.kiro/hooks/auto-commit-after-task.json`, PostTaskExec) built `@necro/oracle`, then ran typecheck and test across every package, and committed on green after each task — keeping the test-first cadence honest.
- Steering (`tech` / `structure` / `security` / `product`, `tarot-ux`, `testing`): constrained the stack and boundaries without re-prompting — e.g. the `@necro/oracle/client` import boundary and the ESLint boundary rules that enforce the dependency direction.
- Boundary + budget gates: the spec workflow drove the ESLint boundary rules and the web JS budget gate (task 31), plus the Playwright e2e and axe accessibility specs (task 32).
- Honest note: the Playwright e2e browser run is maintainer-run and on this machine is currently blocked by a Node 26 vs Playwright runtime mismatch (unit/typecheck/lint/build all green); the e2e/axe specs are written and the component axe contract passes under a supported browser.
- Docs: `docs/DECK.md` needs no change, since no card, grimoire, agent, or gate changed.

### 2026-11-05 — Spec resurrection-engine, task 17.2 (docs for the new grimoire and public API)
- Spec-driven build: the requirements-first workflow produced the resurrection-engine spec (requirements → design → tasks). Each task ran as a scoped unit with its R-number links, so the engine stayed traceable from requirements to code — the design was grounded in the already-complete `@necro/oracle` and the existing `apps/web` NDJSON/limiter/redaction surface, which the engine reused rather than reinventing.
- Property-based testing (fast-check), no network/LLM/sandbox: sixteen named properties (P1–P16) cover candidate selection and the 50-file/1 MB caps, Pre_Pass idempotence and determinism, "output always parses as Python 3 or is reported unconverted", the `computeVitalityDelta` consistency, the changed-card difference, and the round-tripping unified-diff patch — each `describe` tagged with its requirement IDs and run against the Mock provider and recorded fixtures. The grimoire-authoring rule (idempotence + literal/comment preservation per fixer) drove the fixer property tests.
- Steering did the heavy lifting without re-prompting: `structure` fixed the dependency direction `oracle ← grimoires ← coven ← apps/web` (enforced by an import-ban test mirroring the oracle client-guard) and the `src/index.ts`-only cross-package imports plus the Node-only `@necro/coven/node` subpath; `coven-contracts` shaped the ports, the append-only increasing-`seq` ledger, and the "every LLM call has a schema + budget + timeout + cache key + Mock fixture" rule; `security` drove the untrusted-code delimiters, parse-only sandbox, and cross-sink secret masking; `oracle-voice` wrote the Degraded_Mode and sandbox-breaker skip-notes and every error `userMessage`.
- Docs discipline (this task): per the `structure` docs-discipline rule and the `grimoire-authoring` "update docs/DECK.md when a grimoire is added" rule, this change documents the engine's packages and public API in `docs/ARCHITECTURE.md` and creates `docs/DECK.md` with the JUDGEMENT → `py2to3` card ↔ grimoire link — the first deck change since spec 01, so the first time DECK.md was warranted.
