# Implementation Plan: CRT Terminal (`packages/ui-crt` + `apps/web`)

## Overview

This plan builds the CRT Terminal test-first, in dependency order. It begins with the Q8 spike plus the behaviour-preserving `@necro/oracle` schema split (nothing else starts until its success criteria are met), then the `@necro/oracle/client` entry and its import-closure guard, the `@necro/config` env keys, the pure `@necro/ui-crt` core modules with their property tests, the React components, then `apps/web`: protocol and NDJSON stream schemas, the incremental parser, server composition, handlers (phase reporter, external-skip, limiter, budgets, error map, redaction), routes, CSP middleware, the demo bundle generator and fixtures, the sound engine chunk, and finally the e2e/axe/budget verification and the documentation updates. The server half of the oracle is untouched except the pure schema move.

## Implementation Plan

Conventions that apply to every task:

- **Test-first (red, then green).** For each implementation unit, the test task (examples and/or fast-check properties) is written first. Run the new tests and confirm they fail for the expected reason (missing module or behaviour), then implement until they pass. Every test task states this explicitly.
- **All tests are mandatory.** No task or sub-task carries the `*` marker. Every property test P1-P29 and every example, integration, snapshot, lint, build-script, e2e, axe and budget test named in the design's Testing Strategy is a required task.
- **Offline only.** No unit, property, or handler test makes a network, LLM, or sandbox call. Tests use the injected `ApiPort`, `DemoPort`, `GithubGateway`, the fake `ClockPort`, fixture-backed `FetchPort`/`EnvPort`/`RateLimitPort`, fake browser ports, and a `MockReading` builder.
- **Property tests** live in `*.pbt.test.ts` next to the module, each with a `describe` title like `P1 (R2.7, R2.8, R2.14, R2.15): command round-trip` and a `// Feature: 03-crt-terminal, Property N: <title>` tag. Each of P1-P29 is owned by exactly one test task below, minimum 100 runs (cheap pure ones 500).
- **Shared arbitraries** go in `packages/ui-crt/src/testing/arbitraries.ts` and `apps/web` test helpers; each property task adds the arbitraries it needs.
- Cross-package imports go through each package's `src/index.ts`, plus the single permitted `@necro/oracle/client` subpath. `@necro/ui-crt` and client code never import `@necro/github`, `@necro/config`, `@necro/oracle` (main) or `node:*`.

## Tasks

- [x] 1. Q8 spike plus behaviour-preserving oracle schema split (FIRST; nothing else starts until its success criteria are met)
  - [x] 1.1 Split the Reading schemas out of the orchestrator (behaviour-preserving)
    - First confirm `pnpm --filter @necro/oracle test` is green as a baseline, then move `SpreadKindSchema`, `ReadingOptsSchema`, `ReadingSchema` and their inferred types verbatim from `packages/oracle/src/reading/run.ts` into new `packages/oracle/src/reading/schema.ts`.
    - Make `run.ts` import from `./schema.js` and re-export the same names (`SpreadKindSchema`, `ReadingOptsSchema`, `ReadingSchema`, `type SpreadKind`, `type ReadingOpts`, `type Reading`) so `src/index.ts` and every existing test keep their exports unchanged.
    - Success criterion: `pnpm --filter @necro/oracle test` is green with no test edits.
    - _Requirements: R16.5_
  - [x] 1.2 Next `development` export-condition and Vercel tree-sitter WASM file-tracing spike
    - Stand up a minimal `/api/readings` handler in `apps/web` that imports `runReading` from `@necro/oracle`; verify on a Vercel preview that the grammar WASM resolves at runtime (no `createRequire(...).resolve` failure).
    - Determine whether Next's webpack dev server activates the `development` export condition (resolving `@necro/oracle` to raw TypeScript in dev); record the outcome and either keep the dev branch in `next.config.ts` or drop it and transpile instead.
    - Success criteria: the handler builds and runs on a Vercel preview with WASM resolvable; the resolved dev-condition behaviour and the confirmed WASM tracing glob are recorded in the design's "Next configuration" section. Do not start task 2 until both 1.1 and 1.2 success criteria are met.
    - _Requirements: R16.2, R16.6_

- [x] 2. `@necro/oracle/client` Client_Safe_Entry and import-closure guards
  - [x] 2.1 Write the source-level import-closure guard test first
    - Add `packages/oracle/src/client.guard.test.ts`: walk the static import graph from `src/client.ts` with `ts.preProcessFile`, resolving `.js` to `.ts`. Fail if any reachable file is outside `{ registry/schema, registry/cards, snapshot/types, reading/schema, util/errors }`, has a bare import other than `zod`, imports `node:*`/`web-tree-sitter`/`tree-sitter-python`/`smol-toml`, or contains a dynamic `import(`. Confirm it fails before `client.ts` exists.
    - _Requirements: R16.3, R16.5_
  - [x] 2.2 Implement `src/client.ts` and the `./client` export
    - Create `packages/oracle/src/client.ts` exporting only schemas, inferred types, `CARD_REGISTRY`, `getCard`, `RepoRefSchema`/`RepoRef`, `SpreadKindSchema`/`ReadingSchema`/`SpreadKind`/`Reading`, and `NecroError`/`NecroErrorCodeSchema`/`NecroErrorCode`.
    - Add the `./client` entry to `packages/oracle/package.json` exports (same shape as `./node`: `types`, `development`, `import`, `default`).
    - _Requirements: R16.3, R16.5_
  - [x] 2.3 Write the dist-level guard test first, then wire the size-limit entry
    - Add a `dist`-level guard (runs after `pnpm --filter @necro/oracle build`) that reads `dist/client.js` and its relative closure and applies the same allowlist and forbidden-import rules as 2.1. Confirm it fails for the expected reason before the build output exists.
    - Add a second `.size-limit.cjs` entry for `dist/client.js` with zod included, limit `25 KB` gzipped.
    - _Requirements: R16.1, R16.5_

- [x] 3. `@necro/config` env keys and `EnvValidationError`
  - [x] 3.1 Write `P22` and the config examples first
    - Add `packages/config/test/env.pbt.test.ts` for **Property 22 (R13.4): daily ceiling config** — for all candidate `NECRO_DAILY_REQUEST_CEILING` values the schema accepts exactly the positive integers, defaults to 1000 when absent or blank, and rejects `0`, `-3`, `1.5`, `1e3`, `" 7"`, `abc` with a typed error naming the key but not the value.
    - Add examples: existing `env.test.ts` still green; `NECRO_CLIENT_IP_HEADER` default `x-real-ip`; `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` optional presence. Confirm they fail before implementation.
    - _Requirements: R13.4_
  - [x] 3.2 Implement the schema keys and `EnvValidationError`
    - In `packages/config/src/index.ts` add `NECRO_DAILY_REQUEST_CEILING` (positive safe integer, default 1000), `NECRO_CLIENT_IP_HEADER` (default `x-real-ip`), optional `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, and `EnvValidationError extends Error` with `readonly keys: readonly string[]`, keeping the existing message format so `env.test.ts` still passes.
    - _Requirements: R13.3, R13.4, R13.9_

- [x] 4. `@necro/ui-crt` package setup and protocol types
  - [x] 4.1 Write the barrel and conformance smoke test first
    - Add a smoke test asserting `@necro/oracle/client` resolves under Vitest and that `src/protocol.ts` types (`SummonSummary`, `ReadingResponse`, `ReadingPhase`, `ProgressEvent`, `ApiPort`, `DemoPort`, `DemoBundle`, `PlayableSpread`) are importable from the barrel. Confirm it fails first.
    - _Requirements: R16.3, R16.7_
  - [x] 4.2 Implement package deps, `protocol.ts`, `ports.ts`, and the barrel
    - Update `packages/ui-crt/package.json`: `react`/`react-dom` peer deps, `@necro/oracle` (`workspace:*`), dev `fast-check`; keep `jsx: react-jsx`.
    - Add `src/protocol.ts` (types only, `exactOptionalPropertyTypes`-safe), `src/ports.ts` (`StoragePort`, `MediaPort`, `VisibilityPort`, `FramePort`, `DemoPort`, `SoundLoaderPort`, `SoundEngine`, `TerminalPorts`), and wire `src/index.ts`.
    - _Requirements: R16.3, R16.7_

- [x] 5. Command parser and printer
  - [x] 5.1 Write `P1`, `P2`, `P3` and parser examples first
    - Add `command/round-trip.pbt.test.ts` for **Property 1 (R2.7, R2.8, R2.14, R2.15)**, `command/totality.pbt.test.ts` for **Property 2 (R2.12, R2.16)**, and `command/whitespace.pbt.test.ts` for **Property 3 (R2.9)**.
    - Add example tests: each name/arg form (R2.1, R2.3-R2.6), bare-token summon (R2.3), empty/whitespace → `null` (R2.10), `unknown` carries the raw entry (R2.11), case-insensitive names (R2.1), and a `Command` arbitrary in `testing/arbitraries.ts`. Confirm all fail first.
    - _Requirements: R2.1, R2.2, R2.3, R2.4, R2.5, R2.6, R2.7, R2.8, R2.9, R2.10, R2.11, R2.12, R2.14, R2.15, R2.16_
  - [x] 5.2 Implement `command/{types,parse,print}.ts`
    - Implement `parseCommand` (total, `null` for empty/whitespace), `printCommand`, and the internal `looksLikeRepoRef`; no network, clock, env, or DOM access.
    - _Requirements: R2.1, R2.2, R2.3, R2.4, R2.5, R2.6, R2.11, R2.13, R2.14, R2.16_

- [x] 6. Text sanitizing and 72-column wrapping
  - [x] 6.1 Write `P4`, `P5` and wrap/sanitize examples first
    - Add `text/sanitize.pbt.test.ts` for **Property 5 (R14.2, R14.3)** (no C0/C1 except `\n`, no ANSI, no bidi override/isolate, idempotent) and `text/wrap.pbt.test.ts` for **Property 4 (R17.1, R17.3)** (≤ 72 columns, non-whitespace preserved in order, over-long tokens cut by code point). Add Unicode/control/ANSI/bidi arbitraries. Confirm they fail first.
    - _Requirements: R14.2, R14.3, R17.1, R17.3_
  - [x] 6.2 Implement `text/sanitize.ts` and `text/wrap.ts`
    - Implement `sanitizeText`, `wrapText`, `wrapSegments`, `Segment`, and `LINE_WIDTH = 72`.
    - _Requirements: R14.2, R14.3, R17.1, R17.3_

- [x] 7. Voice table and fixed phrases
  - [x] 7.1 Write `P6` and phrase examples first
    - Add `voice/voice-table.pbt.test.ts` for **Property 6 (R7.3, R7.4)** — for every `CardId` and both orientations exactly one non-empty mystical line of ≤ 16 words, upright present tense / reversed latent tense, and the rendered heading uses the uppercase `CARD_REGISTRY` name.
    - Add examples for `BOOT_PHRASE`, `PRE_READING_PHRASE`, `DEMO_LABEL`, `PHASE_VOICE` (one entry per `ReadingPhase`), `EXTERNAL_SKIP_NOTE`, and `vitalityVoice` bands (≤ 16 words). Confirm they fail first.
    - _Requirements: R7.3, R7.4, R6.15, R6.21_
  - [x] 7.2 Implement `voice/voice-table.ts` and `voice/phrases.ts`
    - Implement `VOICE_TABLE` (`Record<CardId, Record<Orientation, string>>`, exhaustive from the `oracle-voice` steering), `PHASE_VOICE`, `EXTERNAL_SKIP_NOTE`, `vitalityVoice`, and the fixed phrases.
    - _Requirements: R7.3, R7.4, R6.15, R6.21_

- [x] 8. Evidence-link builder and block/line primitives
  - [x] 8.1 Write `P17` and block/line examples first
    - Add `render/evidence-link.pbt.test.ts` for **Property 17 (R14.4, R14.5)** — target begins with `https://github.com/{owner}/{name}/blob/{sha}/`, every path segment percent-encoded, decodes back to the original segments, `#L{line}` only when `line` is defined, `null` when `path` absent.
    - Add examples for `OutputLine`/`OutputBlock`/`Segment`/`BlockDraft`, `lineText`, `blockText`. Confirm they fail first.
    - _Requirements: R14.4, R14.5_
  - [x] 8.2 Implement `render/blocks.ts` and `render/evidence-link.ts`
    - Implement the block/line/segment model and `buildEvidenceLink` (segment-by-segment `encodeURIComponent`).
    - _Requirements: R14.4, R14.5, R14.6_

- [x] 9. Reading, summary, help, explain, demo-label and error renderers
  - [x] 9.1 Write `P7`, `P8`, `P12` and renderer examples first
    - Add `render/reading.pbt.test.ts` for **Property 7 (R7.1, R7.2, R7.11, R7.12)**, `render/evidence.pbt.test.ts` for **Property 8 (R7.5, R8.1)**, and `render/errors.pbt.test.ts` for **Property 12 (R11.1, R11.3, R11.9)**.
    - Add example tests: `renderSummary` (degraded, cache hit, truncated, star/file counts, R5.4-R5.8); `renderHelp` content and no-network (R4.1-R4.4); `renderExplain` targets and errors (R8.2-R8.6); vitality gauge shape (R7.7); void position (R6.10, R7-void); `reading.errors` closing block (Q7); live-vs-demo link gate (R7.6); severity rendered exactly as received including `SEVERITY 0` (R7.2); uppercase names, no emoji (R7.10); `withDemoLabel` prepends the `DEMO_LABEL` (R18.5). Add a `MockReading`/`SpreadPosition`/`Evidence` builder. Confirm all fail first.
    - _Requirements: R4.1, R4.2, R4.3, R4.4, R5.4, R5.5, R5.6, R5.7, R5.8, R6.10, R7.1, R7.2, R7.3, R7.5, R7.6, R7.7, R7.9, R7.10, R7.11, R7.12, R8.1, R8.2, R8.3, R8.4, R8.5, R8.6, R11.1, R11.2, R11.3, R11.8, R11.9, R18.5, R18.11_
  - [x] 9.2 Implement `render/{reading,summary,help,explain,demo-label,errors}.ts`
    - Implement `renderReading`, `renderCardBlock`, `renderExplain`, `renderSummary`, `renderHelp`, `renderError` (splits `userMessage` at first `\n`, `ERROR <CODE>` first line, table entry for all 18 codes), `renderEcho`, `renderProgress`, `renderSkipNote`, `withDemoLabel`, and `RenderContext`.
    - _Requirements: R4.1, R4.2, R4.3, R5.4, R5.5, R5.6, R5.7, R5.8, R6.10, R6.15, R6.21, R7.1, R7.2, R7.3, R7.5, R7.6, R7.7, R7.9, R7.10, R7.12, R8.1, R8.2, R8.3, R8.5, R8.6, R11.1, R11.2, R11.3, R11.8, R11.9, R18.5, R18.11_

- [x] 10. Terminal-raised errors
  - [x] 10.1 Write error-builder examples first
    - Add examples asserting `networkError()` (`NETWORK_TIMEOUT`), `upstreamError()` (`UPSTREAM_UNAVAILABLE`), `invalidResponseError()` (`VALIDATION_FAILED`), and `demoUnavailableError()` (`NETWORK_TIMEOUT`, "reload while online") each build a two-line Oracle_Voice `NecroError` with no stack/cause. Confirm they fail first.
    - _Requirements: R11.4, R11.5, R11.6, R18.9, R18.10_
  - [x] 10.2 Implement the four builders in `render/errors.ts`
    - _Requirements: R11.4, R11.5, R11.6, R18.9, R18.10_

- [x] 11. Motion mode, reveal schedule, and preference loaders
  - [x] 11.1 Write `P9`, `P10`, `P11` first
    - Add `motion/reveal.pbt.test.ts` for **Property 9 (R10.1, R10.2, R10.3, R10.12)**, `motion/motion-mode.pbt.test.ts` for **Property 10 (R10.6, R10.7)**, and `prefs/prefs.pbt.test.ts` for **Property 11 (R10.10, R19.1, R19.12)**. Confirm they fail first.
    - _Requirements: R10.1, R10.2, R10.3, R10.6, R10.7, R10.10, R10.12, R19.1, R19.12_
  - [x] 11.2 Implement `motion/{reveal,motion-mode}.ts` and `prefs/prefs.ts`
    - Implement `resolveMotionMode`, `parseMotionPreference`, `parseSoundPreference`, `revealRate`, `revealedChars`, `revealDurationMs`, and the storage-key constants.
    - _Requirements: R10.1, R10.2, R10.3, R10.6, R10.7, R10.10, R10.12, R19.1, R19.12_

- [x] 12. History and output log
  - [x] 12.1 Write `P15`, `P20` and examples first
    - Add `session/history.pbt.test.ts` for **Property 15 (R3.2, R3.3)** (≤ 50 entries, index within bounds no wrap, oldest discarded first) and `session/log.pbt.test.ts` for **Property 20 (R17.6)** (≤ 500 lines, retained lines are the most recent suffix in order). Confirm they fail first.
    - _Requirements: R3.2, R3.3, R17.6_
  - [x] 12.2 Implement `session/history.ts` and `session/log.ts`
    - Implement `historyPush`, `historyPrev`, `historyNext`, `appendBlocks`, and the `HISTORY_MAX`/`LOG_MAX_LINES` constants.
    - _Requirements: R3.2, R3.3, R17.6_

- [x] 13. Sound reducer
  - [x] 13.1 Write `P26` first
    - Add `sound/sound-reducer.pbt.test.ts` for **Property 26 (R19.1, R19.2, R19.7, R19.8, R19.13, R19.16)** — inactive until `gesture` after `load` (no sound at load even when stored preference is `on`), hum/click active exactly when `preference === "on" && gesture && visible`, both inactive after `sound_off` regardless of later events. Add sound-event arbitraries. Confirm it fails first.
    - _Requirements: R19.1, R19.2, R19.7, R19.8, R19.13, R19.16_
  - [x] 13.2 Implement `sound/sound-reducer.ts`
    - Implement `SoundState`, `SoundEvent`, `soundReducer` (`load` resets `gesture: false`), and `soundActivity`.
    - _Requirements: R19.1, R19.2, R19.7, R19.8, R19.13, R19.16_

- [x] 14. Pinned reference and demo catalog
  - [x] 14.1 Write pinned-ref and catalog examples first
    - Add examples for `formatPinnedRef` and the `DEMO_CATALOG`/`DEMO_NAME_PATTERN` shape (2-3 entries: `lich-py2`, `mixed-ruins`, `green-garden`). Confirm they fail first. (The `P18` round-trip through `parseRepoRef` lives server-side in task 20.)
    - _Requirements: R5.3, R6.1, R18.1_
  - [x] 14.2 Implement `session/pinned-ref` helper and `demo/catalog.ts`
    - _Requirements: R5.3, R6.1, R18.1_

- [x] 15. Session reducer and effects
  - [x] 15.1 Write `P19`, `P24`, `P25`, `P27` and reducer examples first
    - Add `session/inflight.pbt.test.ts` for **Property 19 (R3.11)**, `session/demo-isolation.pbt.test.ts` for **Property 24 (R18.5, R18.6, R18.7, R18.11)**, `session/demo-resolution.pbt.test.ts` for **Property 25 (R18.2, R18.3, R18.4)**, and `session/independence.pbt.test.ts` for **Property 27 (R19.11, R19.15)**.
    - Add example tests: boot; submit/echo/history-push (R3.1); over-length rejection (R2.13); `null` → fresh prompt (R2.10); `clear` keeps summary/readings/lastSpread (R15.10); `read` with no summary / `celtic` / held spread (R6.2, R6.3, R6.12); summon replaces demo (R18.14); abort (R3.6); skip-reveal (R3.5); completes running reveal before submit (R10.5); local-command latency (R16.8); button equivalents incl. SUMMON fills `summon ` and focuses, SOUND toggles and counts as gesture (R3.8-R3.12); `api.progress` appends exactly one status block per phase and keeps `aria-busy`/`inflight` until final `api.read` (R6.15, R15.13); stale `api.progress`/`api.*` ignored by `requestId`; `api.summoned` clears readings (R5.4); `focus` effect emitted only for typed/SUMMON commands (R15.4, R15.5); `prefs.save` only for the two allowed keys (R1.6). Add reducer action-sequence arbitraries. Confirm all fail first.
    - _Requirements: R1.6, R2.10, R2.13, R3.1, R3.5, R3.6, R3.8, R3.9, R3.10, R3.11, R3.12, R5.4, R6.2, R6.3, R6.12, R6.13, R6.15, R10.5, R15.4, R15.5, R15.10, R15.13, R16.8, R18.2, R18.3, R18.4, R18.5, R18.6, R18.7, R18.11, R18.14, R18.15, R19.11, R19.15_
  - [x] 15.2 Implement `session/state.ts` and `session/reducer.ts`
    - Implement `initialState`, `step(state, action)` producing `{ state, effects }` with all the branch rules in the design's "Session reducer and effects", `withDemoLabel` applied to non-echo demo blocks, `appendBlocks` on every new block, reveal-queue only in `full` motion.
    - _Requirements: R1.6, R2.10, R2.13, R3.1, R3.4, R3.5, R3.6, R3.11, R5.4, R6.1, R6.2, R6.3, R6.12, R6.13, R6.15, R10.5, R15.4, R15.5, R15.10, R15.13, R16.8, R18.3, R18.4, R18.5, R18.6, R18.7, R18.14, R18.15, R19.11_

- [x] 16. Sound engine lazy chunk
  - [x] 16.1 Write sound-engine examples first
    - Add examples (injected `AudioContext` constructor): `start`/`apply`/`release` graph; `MASTER_GAIN` ≤ `MAX_MASTER_GAIN` = 0.2 (R19.10); hum stops within 200 ms (R19.4); missing/failing Web Audio → rejection path that drives `sound_off` and the in-world message (R19.14); generated click/hum use Web Audio nodes only, no file (R19.9). Confirm they fail first.
    - _Requirements: R19.3, R19.4, R19.9, R19.10, R19.14_
  - [x] 16.2 Implement `sound/{engine-types,load-engine,engine}.ts`
    - Implement `createEngine(ctor?)`, the `loadEngine` literal-path dynamic import (separate chunk), and the hum/click Web Audio graph capped at `MASTER_GAIN`.
    - _Requirements: R19.3, R19.4, R19.9, R19.10, R19.17_

- [x] 17. React components, hooks, CRT tokens and CSS
  - [x] 17.1 Write the tokens/CSS test and component/hook examples first
    - Add the tokens/CSS test: parse `src/crt.css`, assert values equal `src/tokens.ts`; compute WCAG contrast for fg/dim/error/focus over bg with the scanline composite (≥ 4.5:1 text, ≥ 3:1 focus, R15.6, R15.7); assert flicker ≤ 3 changes/s and ≤ 5 % (R9.4), scanline/glow CSS-only with no `url(` (R9.8).
    - Add component/hook examples (jsdom): boot renders `BOOT_PHRASE` first and focuses input (R1.1, R1.2); DOM text is selectable, no canvas (R1.3, R1.4); `<noscript>` statement present (R1.5); `role="log"` live region with `aria-live="polite"`/`aria-relevant="additions"` and announce-once (full text added at append, reveal copy `aria-hidden`) (R10.4, R15.1); `aria-busy` set one tick after in-progress block and kept through the final block (R15.3, Q12); Command_Line label and `main` landmark name (R15.2); `lang="en"` and title (R12/R15.12); keys Enter/ArrowUp/ArrowDown/Ctrl+L/Escape/Ctrl+C and Tab not trapped (R3.1-R3.7); button row and equivalents (R3.8-R3.12); scroll container behaviour (R17.4, R17.5); reduced mode no reveal and no rAF loop when idle (R10.3, R10.11, R16.9); evidence link `rel`/`target` and only link is the evidence link (R14.1, R14.5); `use-reveal`/`use-motion`/`use-sound` wiring (gesture, visibility, gain apply, failure fallback). Confirm all fail first.
    - _Requirements: R1.1, R1.2, R1.3, R1.4, R1.5, R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R3.7, R3.8, R3.9, R3.10, R3.11, R3.12, R9.1, R9.2, R9.3, R9.4, R9.5, R9.6, R9.7, R9.8, R10.3, R10.4, R10.8, R10.9, R10.11, R14.1, R14.5, R14.8, R15.1, R15.2, R15.3, R15.4, R15.5, R15.6, R15.7, R15.11, R15.12, R15.13, R16.9, R17.4, R17.5, R19.5, R19.6, R19.8, R19.14_
  - [x] 17.2 Implement `tokens.ts`, `crt.css`, components and hooks
    - Implement `src/tokens.ts`, `src/crt.css` (layers, data-motion rules), `components/{Screen,Terminal,OutputLog,OutputBlockView,Card,Spread,EvidenceScroll,CommandLine,ButtonRow}.tsx`, and `hooks/{use-terminal,use-reveal,use-motion,use-sound}.ts`; all hook/handler files start with `"use client"`.
    - _Requirements: R1.1, R1.2, R1.3, R1.4, R1.5, R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R3.7, R3.8, R3.9, R3.10, R3.11, R3.12, R9.1, R9.2, R9.3, R9.4, R9.5, R9.6, R9.7, R9.8, R10.1, R10.2, R10.3, R10.4, R10.8, R10.9, R10.11, R14.1, R14.5, R14.8, R15.1, R15.2, R15.3, R15.4, R15.5, R15.6, R15.7, R15.11, R15.12, R15.13, R16.9, R17.2, R17.4, R17.5, R19.5, R19.6, R19.8, R19.14_

- [x] 18. Checkpoint - `@necro/ui-crt` is complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 19. `apps/web` protocol schemas, NDJSON stream schemas and incremental parser
  - [x] 19.1 Write protocol/stream schema conformance and NDJSON parser examples first
    - Add examples asserting `SummonRequestSchema`, `ReadingRequestSchema`, `SummonSummarySchema`, `ReadingResponseSchema`, `ErrorEnvelopeSchema` shapes and the compile-time conformance assertions against the `ui-crt` types (D2); `ReadingRequestSchema` rejects `celtic` (Q15) and non-40-hex refs.
    - Add `protocol/stream.ts` schema examples (`PhaseLineSchema`, `SkipNoteLineSchema`, `ResultLineSchema`, `ErrorLineSchema`, `StreamLineSchema`).
    - Add `terminal/ndjson.ts` `createNdjsonParser` examples: a line split across several `push` chunks reassembles; multiple complete lines in one chunk yield ordered `StreamLine`s; a chunk with no trailing newline buffers until `flush`; a malformed line (bad JSON or failing `StreamLineSchema`) is reported as an error. Confirm all fail first.
    - _Requirements: R6.14, R6.18, R12.1, R12.3_
  - [x] 19.2 Implement `protocol/schemas.ts`, `protocol/stream.ts`, and `terminal/ndjson.ts`
    - _Requirements: R6.14, R6.18, R12.1, R12.3_

- [x] 20. Pinned-reference round-trip and client IP hashing
  - [x] 20.1 Write `P18` and client-ip examples first
    - Add `apps/web/src/server/pinned-ref.pbt.test.ts` for **Property 18 (R5.3, R6.1, R6.4)** — for all valid `RepoRef`, `parseRepoRef(formatPinnedRef(ref))` yields the same owner/name/sha.
    - Add `client-ip` examples: configured header read, IPv4/IPv6 validation, missing/invalid → `"anonymous"`, id is `sha256(ip).slice(0,32)` (never raw IP, R13.9). Confirm they fail first.
    - _Requirements: R5.3, R6.1, R6.4, R13.9_
  - [x] 20.2 Implement `server/pinned-ref.ts` and `server/client-ip.ts`
    - _Requirements: R5.3, R6.1, R6.4, R13.9_

- [x] 21. Error mapper and redaction
  - [x] 21.1 Write `P13`, `P14` and error-map examples first
    - Add `server/error-map.pbt.test.ts` for **Property 13 (R12.4, R12.5)** — full code→status table (R12.4/Q2/Q10): `INVALID_REPO_URL`/`VALIDATION_FAILED` → 400, `REPO_PRIVATE` → 403, `REPO_NOT_FOUND`/`REF_NOT_FOUND` → 404, `DOWNLOAD_TOO_LARGE` → 413, `RATE_LIMITED` → 429, `AUTH_INVALID`/`UPSTREAM_UNAVAILABLE` → 502, `NETWORK_TIMEOUT` → 504, every other → 500, non-NecroError → 500/`UPSTREAM_UNAVAILABLE` with no exception text and no `cause`.
    - Add `server/redact.pbt.test.ts` for **Property 14 (R12.6, R14.7)** — for all token values, `redactString`/`redactDeep` leave no token in any string leaf; undefined token leaves input unchanged.
    - Add examples: `rateLimitedError`/`Retry-After` arithmetic; `cause` never serialized (R12.7). Confirm all fail first.
    - _Requirements: R12.4, R12.5, R12.6, R12.7, R14.7_
  - [x] 21.2 Implement `server/error-map.ts` and `server/redact.ts`
    - Implement `statusFor`, `mapError`, `rateLimitedError`, `redactString`, `redactDeep`.
    - _Requirements: R12.4, R12.5, R12.6, R12.7, R14.7_

- [x] 22. Rate limiter: Upstash primary, Fallback_Limiter, and chain
  - [x] 22.1 Write `P16`, `P21` and limiter examples first
    - Add `server/limiter/arithmetic.pbt.test.ts` for **Property 16 (R13.2, R13.5)** — 11th readings request from one IP within one hour → `RATE_LIMITED`, `Retry-After` ≥ 1 s, wait ≥ 1 whole minute, no GitHub request for a limited request.
    - Add `server/limiter/fallback.pbt.test.ts` for **Property 21 (R13.2, R13.3, R13.5, R13.6, R13.7, R13.8)** — against a RateLimitPort that always fails, the Fallback_Limiter allows exactly the same requests (≤ 20 summon, ≤ 10 readings per IP/hour, ≤ daily ceiling), rejects the rest with `RATE_LIMITED`, never returns `UPSTREAM_UNAVAILABLE` from a limiter outage, and makes no GitHub request for a limited request.
    - Add examples: `createRateLimitChain` 30 s open-circuit on `RateLimitUnavailableError` measured only with `ClockPort`, `primary: null` always uses fallback (D5); Upstash adapter timeout race → `RateLimitUnavailableError`; `evaluateFixedWindow` pure core; window reset on access. Add request-sequence and clock-timeline arbitraries. Confirm all fail first.
    - _Requirements: R13.1, R13.2, R13.3, R13.5, R13.6, R13.7, R13.8, R13.10_
  - [x] 22.2 Implement `server/limiter/{port,upstash,fallback,chain}.ts`
    - Implement `RateLimitPort`/`RateLimitUnavailableError`, `createUpstashLimiter` (own timeout race, never the Upstash fail-open option), `FallbackLimiter` (ClockPort-aligned fixed windows, `maxKeys` eviction), and `createRateLimitChain` (per-request primary with 30 s open-circuit).
    - _Requirements: R13.1, R13.2, R13.3, R13.5, R13.6, R13.7, R13.8, R13.10_

- [x] 23. Phase reporter and external-skip decision
  - [x] 23.1 Write `P28`, `P29` and wrapper examples first
    - Add `server/handlers/phase.pbt.test.ts` for **Property 28 (R6.14, R6.15, R6.16)** — `advancePhase` emits a prefix of `SUMMON`, `DOWNLOAD`, `EXTERNAL`, `READING`, each at most once, never backwards, one Progress_Line per emitted phase; throws on out-of-order/repeat. Add out-of-order/repeated phase-sequence arbitraries.
    - Add `server/handlers/external-skip.pbt.test.ts` for **Property 29 (R6.20, R6.21, R6.22)** — `decideExternalSkip({elapsedMs, skipped})` returns skip exactly when `elapsedMs > 10000` or `skipped`, and on skip produces a non-empty Oracle_Voice note and omits both `registryData`/`osvData`. Add `{elapsedMs, skipped}` arbitraries spanning both sides of 10 s.
    - Add phase-reporting wrapper examples: happy-path emits `SUMMON`/`DOWNLOAD`/`EXTERNAL`/`READING` then a `result` line; cache-hit still emits `DOWNLOAD` once (R6.16). Confirm all fail first.
    - _Requirements: R6.14, R6.15, R6.16, R6.20, R6.21, R6.22_
  - [x] 23.2 Implement `server/handlers/phase.ts` and `server/handlers/external-skip.ts`
    - Implement `advancePhase`, `initialPhaseState`, `createPhaseReporter`, `EXTERNAL_SUB_BUDGET_MS`, and `decideExternalSkip`.
    - _Requirements: R6.14, R6.15, R6.16, R6.20, R6.21, R6.22_

- [x] 24. Composition root and route dependencies
  - [x] 24.1 Write composition/deps examples first
    - Add examples: `createRouteDeps(overrides)` pure assembly; `getRouteDeps` memoises one `GitHubSummoner` so its cache survives warm requests (R12.10, R12.12); `composition.ts` starts with `import "server-only"` and is the only reader of `process.env`; Upstash limiter built only when both `UPSTASH_*` keys exist else `primary: null`; `GithubGateway` wraps `summon` and `fetchExternalData` over the injected `FetchPort`. Confirm they fail first.
    - _Requirements: R12.12, R16.4, R16.6_
  - [x] 24.2 Implement `server/deps.ts` and `server/composition.ts`
    - _Requirements: R12.12, R16.4, R16.6_

- [ ] 25. Summon handler
  - [~] 25.1 Write summon-handler examples first
    - Add examples (fake `RouteDeps`): method 405 + `Allow: POST` (R12.2); non-`application/json` → 400, body > 2 KB → 413, invalid JSON/zod → 400 (R12.1, R12.3); limiter-before-GitHub via gateway spy (R13.1); `no-store` + `nosniff` headers (R12.8); `toSummonSummary` field-by-field build with no snapshot contents, no token/Authorization in any body/header (R5.9, R12.6, R14.7); NecroError → mapped Error_Envelope (R5.10); outgoing body validated by `SummonSummarySchema` (R6.7-analog); never loads/executes repo content (R12.11). Confirm they fail first.
    - _Requirements: R5.2, R5.3, R5.9, R5.10, R12.1, R12.2, R12.3, R12.6, R12.8, R12.11, R13.1, R14.7_
  - [~] 25.2 Implement `server/handlers/guard.ts` and `server/handlers/summon.ts`
    - Implement the shared guard pipeline (client-ip, limiter, body read/size, zod) and `handleSummon` (parse, summon, `toSummonSummary`, redact, validate, JSON response).
    - _Requirements: R5.2, R5.3, R5.9, R5.10, R12.1, R12.2, R12.3, R12.6, R12.8, R12.11, R13.1, R14.7_

- [ ] 26. Reading handler with streaming, budgets and external skip
  - [~] 26.1 Write reading-handler streaming and budget examples first
    - Add examples (fake `RouteDeps`, fake `ClockPort`): `Content-Type: application/x-ndjson` + `no-store` on the stream (R6.14, D13); happy path emits phases then a validated `{ result }` final line (R6.6, R6.7, R6.14, R6.16); `celtic`/non-40-hex ref → `VALIDATION_FAILED` (R6.4, Q15); cache-hit path performs no tarball (R12.10) via integration with the real summoner over a tiny `FetchPort`; 40 s Overall_Budget abort → final `{ error: NETWORK_TIMEOUT }` with no `result` line, finishing before 40 s writes no error (R6.11, R6.19); 10 s External_Sub_Budget: slow `externalData` → skip-note line and `runReading` without registry/OSV data, `skipped: true` within 10 s → same skip, real data within 10 s → passed through and no skip-note (R6.20, R6.22); token redaction end-to-end (R14.7); the outgoing Reading_Response validated by `ReadingResponseSchema` before writing (R6.7); no snapshot file contents returned (R6.6). Confirm all fail first.
    - _Requirements: R6.4, R6.5, R6.6, R6.7, R6.11, R6.14, R6.16, R6.19, R6.20, R6.22, R12.8, R12.9, R12.10, R12.11, R14.7_
  - [~] 26.2 Implement `server/handlers/readings.ts`
    - Implement the streamed pipeline: `SUMMON` → `github.summon` → `DOWNLOAD` → `EXTERNAL` → external race under the sub-budget → skip decision → `READING` → `runReading` → validate → `{ result }`, all under the 40 s `AbortController`; mid-stream failure/budget → final `{ error }` line.
    - _Requirements: R6.4, R6.5, R6.6, R6.7, R6.11, R6.14, R6.16, R6.19, R6.20, R6.22, R12.8, R12.9, R12.10, R12.11, R14.7_

- [ ] 27. Route files and CSP middleware
  - [~] 27.1 Write route and middleware examples first
    - Add route examples: `runtime="nodejs"`, `dynamic="force-dynamic"`, `maxDuration=50` (R6.11); `POST` wired to handlers; `GET`/`PUT`/`PATCH`/`DELETE`/`OPTIONS`/`HEAD` → 405 + `Allow: POST` + `VALIDATION_FAILED` + `no-store` (R12.2).
    - Add middleware examples: per-request base64 nonce from Web Crypto; CSP disallows inline script and lists `'self'` + nonce + `'strict-dynamic'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`; `x-nonce` forwarded; matcher excludes `/_next/static`, `/_next/image`, `/favicon.ico`, `/api` (R14.9, D10, Q9). Confirm all fail first.
    - _Requirements: R6.11, R12.2, R14.9_
  - [~] 27.2 Implement `app/api/summon/route.ts`, `app/api/readings/route.ts`, `app/{layout,page}.tsx`, `components/TerminalScreen.tsx`, `terminal/{api-client,browser-ports}.ts`, and `src/middleware.ts`
    - Implement the routes, the server-rendered shell with `<noscript>` and `await headers()`, the client `TerminalScreen` building browser ports, `createApiPort` (summon outcome table + streaming reader), `createBrowserPorts`, and the CSP middleware.
    - _Requirements: R1.5, R6.11, R11.4, R11.5, R11.6, R11.7, R12.2, R12.8, R14.9, R16.4_

- [ ] 28. API client streaming-reader and summon outcome tests
  - [~] 28.1 Write API-client examples first
    - Add Summon_Route outcome-table examples (fake `fetch`): `TypeError`/timeout → `NETWORK_TIMEOUT`; user abort → `AbortError` rethrown; ok + valid schema → value; ok + bad schema/not JSON → `VALIDATION_FAILED`; `!ok` + valid envelope → mapped `NecroError`; ≥ 500 no envelope → `UPSTREAM_UNAVAILABLE`; < 500 no envelope → `VALIDATION_FAILED` (R5.4, R5.10, R11.4, R11.5, R11.6, R11.7).
    - Add streaming-reader examples (scripted `ReadableStream`): each Progress_Event dispatched to `onProgress` incrementally as its line arrives; final `result` line validated by `ReadingResponseSchema` and resolves (R6.18); `error` line → mapped `NecroError`; stream ends with no `result`/`error` → `networkError()` → `NETWORK_TIMEOUT` (R6.17, R11.6); 55 s client timeout → `NETWORK_TIMEOUT` (R11.6); malformed line → `invalidResponseError()` → `VALIDATION_FAILED` (R6.9); user abort → `AbortError`. Confirm all fail first.
    - _Requirements: R5.4, R5.10, R6.8, R6.9, R6.17, R6.18, R11.4, R11.5, R11.6, R11.7_
  - [~] 28.2 Implement the streaming-reader and summon paths in `terminal/api-client.ts`
    - _Requirements: R5.4, R5.10, R6.8, R6.9, R6.17, R6.18, R11.4, R11.5, R11.6, R11.7_

- [ ] 29. Demo fixtures, bundle generator and loader
  - [~] 29.1 Write `P23` and demo examples first
    - Author `fixtures/graveyard/{lich-py2,mixed-ruins,green-garden}/` (`repo/`, `demo.json`, `registry.json`, `osv.json`), with `green-garden` strictly highest vitality and only obviously fake token-shaped strings.
    - Add `apps/web/src/demo/demo-bundle.pbt.test.ts` for **Property 23 (R18.9, R18.12, R18.13)** — every bundled Reading_Response is valid against `ReadingResponseSchema` and equals a fresh `runReading` on the fixture with the fixed `DEMO_NOW` clock and fixture registry/OSV data, comparing every field except the minted `id` (checked for UUID shape and deterministic derivation).
    - Add examples: catalog shape and `green-garden` strictly highest vitality (R18.1); loader failure → `demoUnavailableError` (R18.10); schema failure → `invalidResponseError` (R18.9); idle prefetch best-effort (R18.8); demo paths rendered as `fixture:` with no link (R18.11). Confirm all fail first.
    - _Requirements: R18.1, R18.8, R18.9, R18.10, R18.11, R18.12, R18.13_
  - [~] 29.2 Implement `demo/build-demo.ts`, `scripts/demo-bundle/generate.ts`, `bundle.generated.json`, and `demo/load-bundle.ts`
    - Implement `buildDemoBundle`, `demoId`, `DEMO_NOW`, the root `demo:bundle` script (regenerates the JSON via `@necro/oracle/node`), and the memoised validating `loadDemoBundle` with a literal-path dynamic import (separate chunk).
    - _Requirements: R18.3, R18.8, R18.9, R18.10, R18.12, R18.13, R16.12_

- [~] 30. Checkpoint - server, routes and demo are complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 31. Boundary lint rules and web budget script
  - [~] 31.1 Write lint/grep boundary tests and budget-script checks first
    - Add grep-backed tests for the ESLint rules: `ui-crt` and client files never import `@necro/github`, `node:*`, or `@necro/oracle` (non-`/client`); client code has no `dangerouslySetInnerHTML`/`eval`/`new Function`/`postMessage`/non-literal dynamic `import` (R14.1, R14.8, R16.2, R16.3, R16.4, R16.7).
    - Add `scripts/check-web-budget.mjs` tests/assertions: initial-route JS ≤ 250 000 bytes gzipped from the Next manifests; forbidden-marker scan over `.next/static/**/*.js` (`api.github.com`, `codeload.github.com`, `GITHUB_TOKEN`, `tree-sitter-python.wasm`, `tar-stream`); demo bundle and sound engine each exist as separate chunks (R16.1, R16.2, R16.12). Confirm they fail first.
    - _Requirements: R14.1, R14.8, R16.1, R16.2, R16.3, R16.4, R16.7, R16.12_
  - [~] 31.2 Implement the ESLint `no-restricted-syntax`/import rules and `scripts/check-web-budget.mjs`
    - _Requirements: R14.1, R14.8, R16.1, R16.2, R16.3, R16.4, R16.7, R16.12_

- [ ] 32. Playwright e2e and axe accessibility checks
  - [~] 32.1 Write the e2e and axe specs first
    - Add `apps/web/e2e/*.e2e.ts` and `playwright.config.ts`: boot shows the phrase and focuses the input (R1.1, R1.2, R15.4); JS-disabled page shows the phrase and the "requires JavaScript" note (R1.5); mocked-route demo flow renders a labelled spread and `explain` opens evidence (R18.5, R8.1); keyboard history, `Ctrl+L`, `Escape`, `Ctrl+C` abort (R3.3-R3.6); reduced-motion shows the first block without reveal (R10.11); 200 % zoom and 320 px width with no horizontal scroll of the input/button row (R15.8).
    - Add `@axe-core/playwright` checks on the booted terminal and a rendered spread: roles, `role="log"` live region announce-once, `aria-busy` through the final block, label association, focus-visible, contrast, and no colour-only state (R15.1, R15.2, R15.3, R15.6, R15.7, R15.9). These specs are run by the maintainer (never auto-started by a unit test).
    - _Requirements: R1.1, R1.2, R1.5, R3.3, R3.4, R3.5, R3.6, R8.1, R10.11, R15.1, R15.2, R15.3, R15.4, R15.6, R15.7, R15.8, R15.9, R18.5_
  - [~] 32.2 Implement any `data-*`/ARIA adjustments the e2e/axe specs require
    - Make minimal attribute/label/focus adjustments in `apps/web` and `@necro/ui-crt` components so the e2e and axe specs pass; no behavioural change to the reducer.
    - _Requirements: R15.1, R15.2, R15.3, R15.4, R15.6, R15.7, R15.8, R15.9_

- [ ] 33. Documentation updates
  - [~] 33.1 Update `docs/ARCHITECTURE.md`
    - Append a `## @necro/ui-crt and the web terminal` section: module map, the `@necro/oracle/client` rule, the API contracts (request, response, status table, headers, NDJSON stream), rate-limit and fallback behaviour, CSP, the Demo_Bundle workflow, and the bundle budget. Append only; leave existing sections unchanged.
    - _Requirements: R16.13_
  - [~] 33.2 Add a dated `docs/KIRO_USAGE.md` entry
    - Append `### <date> - Spec 03-crt-terminal` listing the Kiro features that helped (spec workflow, `oracle-voice` steering for the voice table, PBT for the parser and reducers, any hooks used).
    - _Requirements: R16.13_

- [~] 34. Final verification checkpoint
  - Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:pbt`, `pnpm e2e`, `pnpm build`, `node scripts/check-web-budget.mjs`, and `pnpm size-limit`; ensure all pass. Ask the user if questions arise.
  - _Requirements: R16.1, R16.2, R16.5, R16.11_

## Notes

- Every task is required; no task or sub-task is marked optional.
- Each implementation task is preceded by its test task (red, then green).
- Every property P1-P29 is owned by exactly one `*.pbt.test.ts` task and annotated with its property number and the requirement clauses it validates.
- Checkpoints (tasks 18, 30, 34) ensure incremental validation at package and layer boundaries.
- Task 1 (Q8 spike + schema split) is a hard prerequisite for everything else.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.2"] },
    { "id": 3, "tasks": ["2.3", "5.1", "6.1", "7.1", "11.1", "13.1"] },
    { "id": 4, "tasks": ["5.2", "6.2", "7.2", "11.2", "13.2"] },
    { "id": 5, "tasks": ["8.1", "12.1", "14.1", "16.1"] },
    { "id": 6, "tasks": ["8.2", "12.2", "14.2", "16.2"] },
    { "id": 7, "tasks": ["9.1"] },
    { "id": 8, "tasks": ["9.2"] },
    { "id": 9, "tasks": ["10.1"] },
    { "id": 10, "tasks": ["10.2", "15.1"] },
    { "id": 11, "tasks": ["15.2", "17.1"] },
    { "id": 12, "tasks": ["17.2"] },
    { "id": 13, "tasks": ["19.1", "20.1", "21.1", "22.1", "23.1", "24.1"] },
    { "id": 14, "tasks": ["19.2", "20.2", "21.2", "22.2", "23.2", "24.2"] },
    { "id": 15, "tasks": ["25.1", "26.1"] },
    { "id": 16, "tasks": ["25.2", "26.2"] },
    { "id": 17, "tasks": ["27.1", "28.1", "29.1"] },
    { "id": 18, "tasks": ["27.2", "28.2", "29.2"] },
    { "id": 19, "tasks": ["31.1", "32.1"] },
    { "id": 20, "tasks": ["31.2", "32.2"] },
    { "id": 21, "tasks": ["33.1", "33.2"] }
  ]
}
```
