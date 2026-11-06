# Implementation Plan: Resurrection Engine

## Overview

This plan builds the Resurrection Engine bottom-up along the enforced dependency
direction `oracle ← grimoires/py2to3 ← coven ← apps/web`, with adapters
(`@necro/llm`, `@necro/sandbox`) injected into the coven runner through ports.
`@necro/oracle` is reused unchanged.

Work proceeds in this order so nothing is left orphaned: first the shared port
and data-model contracts in `@necro/coven`; then the injectable adapters
(`@necro/llm` Mock provider, optional `@necro/sandbox` parse-only) and the
server-only env key in `@necro/config`; then the pure `py2to3` grimoire (fixers,
LLM step, validate, fixtures) from the `_template`; then the registry and local
coven runner that drive SELECT → PRE_PASS → LLM_PASS → VALIDATE → REDIAGNOSE →
DIFF; then the `apps/web` Resurrection_Route and NDJSON schema additions reusing
the existing stream/limiter/redact/error-map; and finally demo-mode wiring, the
deterministic `lich-py2` improvement, and docs. Each component is wired into a
prior one as it lands, and tests (including fast-check property tests named by
the design's correctness properties) accompany each unit.

Property-based tests use fast-check with `numRuns` 1000 for the
fixer/selection/diff/registry properties (P1–P5, P8, P9, P14) and 200 for the
rest, printing the seed on failure, with `describe` titles naming the
requirement IDs. No network, LLM, or sandbox is touched in unit/property tests:
the Mock `LlmPort` and recorded fixtures stand in. User-facing strings in tests
follow the oracle-voice steering (two layers, ASCII only, no emoji, ≤ 72
columns).

## Tasks

- [x] 1. Establish coven port and data-model contracts
  - [x] 1.1 Define port interfaces in `@necro/coven`
    - Create `packages/coven/src/ports.ts` with `LlmRequest`, `LlmResult`, `LlmPort`, `SandboxPort`, `LedgerPort`, `ClockPort`, `RitualPorts`, plus the `Grimoire`/`Fixer`/`FixerContext`/`FixResult`/`LlmStep` interfaces from the design's Components section
    - Export all port types through `packages/coven/src/index.ts` (cross-package imports go only through `src/index.ts`)
    - _Requirements: 4.1, 4.7, 5.5, 10.1, 15.7_
    - _Design: Port interfaces, Grimoire interface_

  - [x] 1.2 Define zod data models and ritual types in `@necro/coven`
    - Create `packages/coven/src/models.ts` with `CandidateFileSchema`, `ResidualEntrySchema`, `DiffLineSchema`, `FileResultSchema`, `RitualResultSchema`, `LanguagePairId`, `ResurrectTarget`, `RitualInput`, and `RitualResult` inferred types
    - Extend the reused `NecroError` code set with `PAIR_UNKNOWN`, `PAIR_DUPLICATE`, `REDIAGNOSIS_FAILED`, `BUDGET_EXHAUSTED`, `DEMO_FIXTURE_MISSING` (reusing existing `RATE_LIMITED`, `VALIDATION_FAILED`, `NETWORK_TIMEOUT`, `UPSTREAM_UNAVAILABLE`)
    - Export the schemas and types through `packages/coven/src/index.ts`
    - _Requirements: 8.1, 8.2, 8.3, 7.7, 6.2, 6.3, 12.5, 13.5, 14.3_
    - _Design: Data Models, Error Handling_

  - [x] 1.3 Write unit tests for the coven data-model schemas
    - Assert `ResidualEntrySchema.reason` accepts each documented reason and rejects others; assert `RitualResultSchema` nullability of `afterVitality`/`vitalityDelta`
    - _Requirements: 6.5, 8.1, 8.3_

- [x] 2. Build the injectable adapters and server env key
  - [x] 2.1 Implement the Mock LlmPort provider in `@necro/llm`
    - Create `packages/llm/src/providers/mock.ts` implementing `LlmPort` with `providerId: "mock"`, returning deterministic text from the request with no network access; add `cache.ts` (cache by `cacheKey`) and `budget.ts` (token/timeout budget helpers)
    - Export the Mock provider and budget/cache helpers through `packages/llm/src/index.ts`
    - _Requirements: 4.1, 4.7, 4.8, 14.4_
    - _Design: Port interfaces, LLM_Pass_

  - [x] 2.2 Write unit tests for the Mock provider and budget/cache
    - Assert determinism (same request ⇒ byte-identical result), `cached` flag behavior on repeat `cacheKey`, and that no network module is imported
    - _Requirements: 4.7, 4.8, 14.4_

  - [x] 2.3 Implement the optional E2B SandboxPort (parse-only) in `@necro/sandbox`
    - Create `packages/sandbox/src/providers/e2b.ts` implementing `SandboxPort.parseCheckPython3` as a compile-only (`py_compile`-style) check that never executes repository code, plus `dispose()`; add `allowlist.ts`; export through `packages/sandbox/src/index.ts`. Guard behind config presence so the local path needs no E2B account
    - _Requirements: 5.4, 5.5, 10.5_
    - _Design: Default vs optional runtime, Validation_

  - [x] 2.4 Add the server-only LLM API key to `@necro/config`
    - Add `NECRO_LLM_API_KEY` to `EnvSchema` using the existing `blankToUndefined` preprocessor and the documented regex so blank/whitespace is treated as unset; keep it optional
    - _Requirements: 13.1, 13.5_
    - _Design: Config / env_

  - [x] 2.5 Write unit tests for the env key parsing
    - Assert absent and empty/whitespace values parse to `undefined` (Degraded_Mode input) and a valid key parses through; assert the key value is never emitted by any config serializer
    - _Requirements: 13.1, 13.2, 13.5_

- [~] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Scaffold the py2to3 grimoire and its pure fixers
  - [x] 4.1 Scaffold `packages/grimoires/py2to3` from `_template`
    - Create the package from the `_template` scaffold with `src/index.ts`, `fixers/`, `llm/`, `validate.ts`, `fixtures/`, `package.json` scoped `@necro/grimoires-py2to3` (or per existing convention); declare the `Grimoire` object shell with `id: "py2to3"`, `pair`, input/output schemas, empty `fixers`, and a placeholder `llm` step; import `@necro/oracle` only (no adapters)
    - _Requirements: 15.4, 15.5, 15.6_
    - _Design: Package map, Grimoire interface, Dependency direction_

  - [x] 4.2 Implement the six deterministic Pre_Pass fixers
    - In `packages/grimoires/py2to3/fixers/` implement `print_statement`, `except_comma`, `dict_iter`, `unicode_str`, `long_literal`, and `ne_operator` as pure `(source, ctx) => FixResult` functions that parse once via the injected `parsePython`, collect spans in document order, apply non-overlapping edits right-to-left, never alter string-literal/comment contents, and record unconverted constructs as `ResidualEntry`s; on tree-sitter parse failure leave content unchanged and record a `parse_failed` residual
    - Wire the fixers, in fixed order, into the grimoire's `fixers` array in `src/index.ts`
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.7, 3.8_
    - _Design: Pre_Pass transforms_

  - [x] 4.3 Write property test for Pre_Pass idempotence
    - **Property 3: Pre_Pass is idempotent** — applying the Pre_Pass twice equals applying it once (byte-identical)
    - fast-check `numRuns: 1000` over `arbPy2Program`; `describe` title names the requirement
    - **Validates: Requirements 3.4**

  - [x] 4.4 Write property test for Pre_Pass determinism
    - **Property 4: Pre_Pass is deterministic** — two independent invocations from a clean state produce byte-identical `After_Content` and identical `Residual_List`
    - fast-check `numRuns: 1000` over `arbPy2Program`
    - **Validates: Requirements 3.6, 3.8**

  - [x] 4.5 Write golden fixtures for the Pre_Pass transforms
    - Add `fixtures/<case>/before` → `after` golden pairs under `packages/grimoires/py2to3/fixtures` covering each of the six fixers; add a test that asserts each `before` produces its pinned `after`
    - _Requirements: 3.1, 3.8_

- [x] 5. Implement the grimoire LLM step and validation
  - [x] 5.1 Implement the declarative LlmStep (prompt, schema, mock fixture, apply)
    - In `packages/grimoires/py2to3/llm/` implement `buildRequest` to mask secret-like substrings via oracle `maskSecret` before placing code in the prompt, wrap the masked code in the fixed `UNTRUSTED_REPOSITORY_CODE` delimiters marked as data-not-instructions, and set `maxTokens`/`timeoutMs`/`cacheKey = sha256(pairId + construct + prompt)`; define `outputSchema` (zod), `apply(source, parsed)`, and a deterministic `mockFixture`
    - Wire the `LlmStep` into the grimoire `llm` field; fixers and the step import no adapters
    - _Requirements: 4.1, 4.2, 4.3, 12.3, 15.6, 15.7_
    - _Design: LLM_Pass_

  - [x] 5.2 Implement `validate()` Target_Parser check
    - In `packages/grimoires/py2to3/validate.ts` implement `validate(after)` using `parsePython` and counting error nodes (zero ⇒ valid Python 3); return a `ValidationResult`; never execute repository code
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
    - _Design: Validation_

  - [x] 5.3 Write property test for output-parses-or-reported (incl. delimiters)
    - **Property 5: Output always parses as Python 3 or is reported unconverted** — every produced `After_Content` parses with zero error nodes; every excluded construct appears in the `Residual_List`; the LLM prompt wraps code in the fixed untrusted-data delimiters
    - fast-check `numRuns: 1000`, using the Mock provider; generators include unparseable inputs
    - **Validates: Requirements 4.2, 5.1, 5.2, 5.3**

  - [x] 5.4 Write unit tests for LLM retry/timeout/no-key paths and Residual completeness
    - Cover zod-failure-then-retry-then-`llm_invalid_output` (R4.4), timeout/unavailable ⇒ `llm_unavailable` (R4.5), no-key skip retains residuals (R4.6), and Residual_List entries carry valid path+line
    - **Property 8: Residual_List completeness and well-formedness** (as example + property seed) — entry count equals attempted-but-unconfirmed conversions; zero residuals ⇒ fully converted
    - **Validates: Requirements 4.4, 4.5, 4.6, 3.5, 8.1, 8.2, 8.3**

  - [x] 5.5 Write import-ban static test for the grimoire fixers
    - Assert the fixers and LLM step import no adapter modules and call no `eval`/`child_process` (mirrors oracle client-guard tests)
    - **Validates: Requirements 3.2, 3.3, 5.4, 15.6, 15.7**

- [~] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement the Language_Pair_Registry
  - [x] 7.1 Implement the registry in `@necro/coven`
    - Create `packages/coven/src/registry.ts` with `register` (duplicate id ⇒ `NecroError("PAIR_DUPLICATE", …)`, leaving the existing binding unchanged), `resolve` (unknown id ⇒ `NecroError("PAIR_UNKNOWN", …)` before any sandbox/LLM work), and `has`; register the `python2->python3` grimoire at runner construction; export through `src/index.ts`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_
    - _Design: Language_Pair_Registry_

  - [x] 7.2 Write property test for registry resolution and guards
    - **Property 14: Language_Pair_Registry resolution is a unique, guarded binding** — resolving a registered id returns its grimoire; unknown id throws the typed unknown-id error; re-registering throws the typed already-bound error and leaves the first binding intact
    - fast-check `numRuns: 1000` over sets of grimoire ids
    - **Validates: Requirements 15.1, 15.2, 15.3**

- [x] 8. Implement candidate selection
  - [x] 8.1 Implement candidate selection from reading evidence
    - In `packages/coven/src/select.ts` derive `Candidate_File`s as the distinct `.py` paths referenced by Python-2-classified `reading.draws[].evidence[].path`; bare target ⇒ all such paths ascending by path capped at 50; card-id target ⇒ restricted to that card's evidence paths; file-path target ⇒ single exact match; exclude files > 1 MB with a skip-note; emit deferred-count skip-note when over the 50-file cap; reject repos > 50 MB or > 5,000 files with an `Error_Line`-mapped NecroError
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.5, 2.6, 2.7_
    - _Design: Candidate_File selection rule_

  - [x] 8.2 Write property test for candidate selection matching evidence
    - **Property 1: Candidate selection matches the reading evidence** — selected files are exactly the distinct py2-classified `.py` paths the target scopes to, with no path appearing twice
    - fast-check `numRuns: 1000` over `arbRepoSnapshot` + reading arbitraries
    - **Validates: Requirements 1.2, 1.3, 1.4, 2.1, 2.2**

  - [x] 8.3 Write property test for selection ordering and the per-run cap
    - **Property 2: Selection ordering and the per-run cap** — engine processes the ascending-by-path prefix of length `min(n, 50)` and reports a deferred count of `max(0, n - 50)`, excluding any file over 1 MB with a naming skip-note
    - fast-check `numRuns: 1000`
    - **Validates: Requirements 1.5, 2.5, 2.6**

  - [x] 8.4 Write unit tests for selection guard cases
    - Cover unknown card id (R2.3 / R1.8), zero-candidate target Result_Line (R1.7 / R2.4), and repo-too-large error (R2.7)
    - _Requirements: 1.7, 1.8, 2.3, 2.4, 2.7_

- [x] 9. Implement diff, patch, and vitality re-diagnosis
  - [x] 9.1 Implement per-file diff and unified Patch generation
    - In `packages/coven/src/diff.ts` compute a line-oriented LCS diff into `DiffLine[]` (identical content ⇒ context-only, no add/remove), and generate a single unified-diff `Patch` over validated, changed files only (excluding not-validated files; zero changed ⇒ empty patch) such that applying the patch to `Before_Content` reproduces `After_Content` byte-for-byte
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_
    - _Design: Diff and Patch_

  - [x] 9.2 Write property test for patch round-trip and unvalidated exclusion
    - **Property 9: Patch round-trips and excludes unvalidated files** — the Patch contains exactly validated+changed files; applying it to each `Before_Content` yields the `After_Content`; zero changed+validated ⇒ empty patch
    - fast-check `numRuns: 1000` over `arbFileResult`
    - **Validates: Requirements 7.4, 7.5, 7.7**

  - [x] 9.3 Implement vitality re-diagnosis via snapshot overlay
    - In `packages/coven/src/rediagnose.ts` overlay validated `After_Content` into a copy of the `RepoSnapshot` (updating `contents` and `files` size/sha for changed paths), call `runReading` with the same spread, compute `beforeVitality`/`afterVitality` via `computeVitality` and `vitalityDelta` via `computeVitalityDelta`, and compute the changed-card set as the `(presence, severity, orientation)` difference with an `improved` flag; on post-reading failure preserve the pre-reading, set `afterVitality`/`vitalityDelta` to null, and surface a `REDIAGNOSIS_FAILED` error for that step without discarding File_Results
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
    - _Design: Vitality re-diagnosis_

  - [x] 9.4 Write property test for Vitality_Delta consistency
    - **Property 6: Vitality_Delta is consistent with the oracle** — reported `Vitality_Delta` equals `computeVitalityDelta(before, after)` equals `after - before`
    - fast-check `numRuns: 200`
    - **Validates: Requirements 6.3**

  - [x] 9.5 Write property test for the changed-card set
    - **Property 7: Changed-card set is the exact draw difference** — reported changed cards are exactly those whose draw differs in presence, severity, or orientation; no unchanged card is reported
    - fast-check `numRuns: 200`
    - **Validates: Requirements 6.4**

- [~] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement the local Coven_Runner orchestration
  - [x] 11.1 Implement the local runner driving the phase pipeline
    - Create `packages/coven/src/runners/local.ts` implementing `CovenRunner.run` to drive SELECT → PRE_PASS → LLM_PASS → VALIDATE → REDIAGNOSE → DIFF through a monotonic `emit`, injecting `RitualPorts`; skip LLM_PASS when no `LlmPort` is injected (Degraded_Mode) emitting exactly one oracle-voice skip-note; call the optional `SandboxPort` parse-check when injected and fall back to the Target_Parser with a skip-note on timeout/unavailability; mark VALIDATE-budget files `validated: false` with a `not_validated` residual and exclude them from the Patch; enforce a wall-clock budget that ends the Ritual, disposes any sandbox, and returns partial File_Results with a `BUDGET_EXHAUSTED` error; append ledger events (append-only, increasing `seq`); wire registry, selection, diff, and rediagnose modules together
    - _Requirements: 4.6, 5.5, 5.6, 5.8, 9.7, 10.1, 10.4, 10.5, 13.3, 13.4_
    - _Design: Coven_Runner, Default vs optional runtime, Degraded mode_

  - [x] 11.2 Write unit tests for runner orchestration edge paths
    - Cover sandbox fallback skip-note (R5.6), VALIDATE-budget trigger (R5.8/R9.7), re-diagnosis failure preserving File_Results (R6.5), budget exhaustion returning partials and disposing sandbox (R10.4/R10.5), and Degraded_Mode selection + single skip-note (R13.3/R13.4)
    - _Requirements: 5.6, 5.8, 6.5, 9.7, 10.4, 10.5, 13.3, 13.4_

  - [x] 11.3 Write property test for ordered, once-each phase emission
    - **Property 10: Phases are emitted in order, once each** — emitted `Phase_Line`s are a non-repeating prefix of `SELECT, PRE_PASS, LLM_PASS, VALIDATE, REDIAGNOSE, DIFF`
    - fast-check `numRuns: 200` over simulated progressions
    - **Validates: Requirements 9.2**

  - [x] 11.4 Add the optional Inngest runner
    - Create `packages/coven/src/runners/inngest.ts` that, where the Inngest env is configured, runs long sandbox work as background steps polled with `step.sleep`, each step idempotent on `(ritualId, phase)`, ending the Ritual and disposing the sandbox on a failed/stalled poll; selected only when Inngest env is present
    - _Requirements: 10.2, 10.5_
    - _Design: Default vs optional runtime_

- [x] 12. Implement secret masking and typed-error guarantees
  - [x] 12.1 Implement cross-sink secret masking and error typing in the runner path
    - Ensure every diff, Patch, Stream_Line, ledger entry, and LLM prompt routes through `maskSecret`/`redactDeep` so no raw secret value (including the LLM key) survives; if masking cannot complete for a content item, withhold it from all sinks and raise a typed NecroError; ensure every failure is a `NecroError` with non-empty `code` and oracle-voice `userMessage` containing no path, secret, or stack
    - _Requirements: 12.3, 12.4, 12.5, 13.2_
    - _Design: Error Handling_

  - [x] 12.2 Write property test for no-secret-in-any-output
    - **Property 12: No secret survives into any output** — for content with secret-like values routed through any sink (diff, Patch, Stream_Line, LLM prompt, log, error), no raw secret appears; every occurrence is the fixed mask token
    - fast-check `numRuns: 200`
    - **Validates: Requirements 12.3, 13.2**

  - [x] 12.3 Write property test for well-formed typed NecroError
    - **Property 13: Every failure is a well-formed typed NecroError** — raised value is a `NecroError` with non-empty `code` and oracle-voice `userMessage`, no path/secret/stack
    - fast-check `numRuns: 200`
    - **Validates: Requirements 12.5**

- [x] 13. Wire the engine into apps/web
  - [x] 13.1 Add the resurrection NDJSON schemas
    - Create `apps/web/src/protocol/resurrect-stream.ts` with `ResurrectionPhaseSchema`, `ResurrectPhaseLineSchema`, `ResurrectResultLineSchema` (redaction-safe wire form of `RitualResult`), and `ResurrectStreamLineSchema` reusing `SkipNoteLineSchema` and `ErrorLineSchema` verbatim; add `ResurrectRequestSchema` to `apps/web/src/protocol/schemas.ts`
    - _Requirements: 9.1, 9.5_
    - _Design: Resurrection NDJSON additions, Request schema_

  - [x] 13.2 Implement the Resurrection_Route handler
    - Create `apps/web/src/server/handlers/resurrect.ts` mirroring `handleReading`: method guard → `checkLimit` (per-IP + global) → body guard → strict `ResurrectRequestSchema` parse (pre-stream 400) → begin `application/x-ndjson` stream under an overall budget → drive the local runner, emitting monotonic Phase_Lines and per-phase time-bounded Skip_Note_Lines → write exactly one terminal Result_Line/Error_Line; validate every Stream_Line against `ResurrectStreamLineSchema` before writing (on failure, do not write and terminate with a redacted Error_Line); route all strings through `redactDeep` and errors through `mapError`; return control within 50 s; reject when no completed reading is in scope with a reading-required Error_Line; skip LLM_Pass when the LLM Spend_Breaker is open and the sandbox check when the sandbox Spend_Breaker is open, each with a skip-note, continuing with partial results
    - Register the route (e.g. `apps/web/src/app/api/resurrect`) so the terminal `resurrect` command can POST to it
    - _Requirements: 1.1, 1.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.3, 11.1, 11.2, 11.3, 11.4, 11.5, 12.1, 12.2_
    - _Design: Resurrection_Route, Error Handling_

  - [x] 13.3 Write property test for stream termination and error envelope
    - **Property 11: Exactly one terminal line with a two-field error envelope** — the stream ends with exactly one terminal line; any `Error_Line` payload contains exactly `code` and `userMessage`, no `cause`/stack/other field
    - fast-check `numRuns: 200`
    - **Validates: Requirements 9.3, 12.1**

  - [x] 13.4 Write unit tests for the route guard and breaker paths
    - Cover no-reading-in-scope (R1.6), limiter reject with retry-after (R11.2), LLM/sandbox breaker skip-notes continuing the Ritual (R11.3/R11.4/R11.5), invalid-line termination (R9.6), time-bounded-phase skip-note (R9.4), and unknown-code fallback envelope (R12.2)
    - _Requirements: 1.6, 9.4, 9.6, 11.2, 11.3, 11.4, 11.5, 12.2_

- [ ] 14. Implement the terminal Resurrect_Command client (@necro/ui-crt + apps/web)
  - [x] 14.1 Parse `resurrect [<card-or-file>]` in the ui-crt command parser
    - Extend `packages/ui-crt/src/command/parse.ts` (and `types.ts`) to recognize the `resurrect` command with an optional single argument that is a card id or a file path; a bare `resurrect` is allowed; parse-level validation only (trim, reject extra arguments and empty-but-present tokens) while leaving semantic validation (card/file existence, py2 classification) to the server; add the `resurrect` entry (command + argument description) to the HELP text in `packages/ui-crt/src/render/help.ts`, ASCII-only and ≤ 72 columns in the oracle voice; expose the parsed `ResurrectTarget` shape (card id | file path | bare) to the terminal session reducer. ui-crt imports no node/github/oracle-main modules (browser-safe only)
    - _Requirements: 1.1, 1.4_
    - _Design: Browser/terminal rendering, Resurrect_Command_

  - [x] 14.2 Write unit tests for the resurrect command parser and HELP entry
    - Cover bare `resurrect`, a card-id argument, a file-path argument, and malformed args (extra tokens, empty token); assert the HELP text lists the command and argument and stays ASCII-only within the column budget
    - _Requirements: 1.1, 1.4_

  - [x] 14.3 Extend the browser API client to POST to the Resurrection_Route and consume its NDJSON stream
    - In `apps/web/src/terminal/api-client.ts` add a `resurrect(pinned, target, spread, signal, onProgress)` method mirroring `read`: POST the `ResurrectRequestSchema` body to `/api/resurrect` with `accept: application/x-ndjson`, read the body with the existing `createNdjsonParser` from `apps/web/src/terminal/ndjson.ts`, and validate each line against `ResurrectStreamLineSchema`; dispatch Phase_Lines, Skip_Note_Lines, the terminal Result_Line (re-validated against the `RitualResult` wire schema) and Error_Lines (raised as `NecroError`), reusing the user-abort vs 55 s timeout discrimination already in the client; surface phase/skip/error text to the terminal in the oracle voice via `packages/ui-crt/src/voice/phrases.ts`, pushed through an `aria-live` region so updates are announced. In demo mode the server already applies the `[DEMO]` prefix to every line; render it verbatim and do not add a second prefix client-side
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 14.3_
    - _Design: Resurrection NDJSON additions, Browser/terminal rendering, Demo mode_

  - [x] 14.4 Write unit tests for the resurrect stream client over a recorded NDJSON sequence
    - Drive the client with a recorded line sequence (phases in order → a skip-note → a Result_Line) asserting progress callbacks and the resolved `RitualResult`, plus an error-terminal case (an Error_Line raises a `NecroError` with only `code`/`userMessage`); no real network — use a mocked `fetch`/readable stream; assert a demo sequence is rendered with its server-applied `[DEMO]` prefix and never double-prefixed
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 14.3_

  - [x] 14.5 Render the per-file before/after diff and the Residual_List in the CRT terminal
    - Add a diff renderer in `packages/ui-crt/src/render/` that turns a `FileResult.diff` (`DiffLine[]`) into CRT lines marking added `+`, removed `-`, and context ` ` lines, ASCII-only and wrapped/truncated to ≤ 72 columns in the phosphor palette; render each file's `Residual_List` entries as `path:line` with the unconverted construct, and render a fully-converted indication when `residuals.length === 0`; an identical before/after renders as unchanged with no add/remove lines; wire the renderer into the terminal result view in `apps/web/src/components`
    - _Requirements: 7.1, 7.2, 8.1, 8.3_
    - _Design: Browser/terminal rendering, Diff and Patch_

  - [x] 14.6 Write unit tests for the diff and residual renderers
    - Cover an added/removed/context mix (correct marks, column budget, ASCII-only), an unchanged file (no add/remove lines), a file with residuals (`path:line` + construct), and a zero-residual fully-converted file
    - _Requirements: 7.1, 7.2, 8.1, 8.3_

  - [x] 14.7 Offer the unified Patch as a client-side download
    - Add a browser download helper (in `apps/web/src/terminal` or `apps/web/src/components`) that builds a downloadable artifact from `RitualResult.patch` (a `Blob` + object URL with a `.patch`/`.diff` filename and `text/x-patch` mime), triggered from the terminal with no server round-trip; an empty patch is handled gracefully (either a disabled/absent download or an empty-but-valid artifact, no throw)
    - _Requirements: 7.3, 7.4_
    - _Design: Diff and Patch, Browser/terminal rendering_

  - [~] 14.8 Write unit tests for the patch download-trigger builder
    - Assert the builder produces the correct filename and mime for a non-empty patch and handles the empty-patch case gracefully, using a DOM/URL mock (`URL.createObjectURL`/`Blob`) — no real network and no real file write
    - _Requirements: 7.3, 7.4_

  - [x] 14.9 Show the Vitality_Delta and the changed-card set in the terminal
    - Render `beforeVitality`/`afterVitality`, the signed `vitalityDelta`, and each entry of `changedCards` (card, change kind, `improved` flag) as CRT lines in the oracle voice (ASCII-only, ≤ 72 columns); when re-diagnosis failed (`afterVitality`/`vitalityDelta` are `null`) render a re-diagnosis-incomplete line instead of a delta. The delta and changed-card data arrive on the Result_Line
    - _Requirements: 6.3, 6.4, 6.5, 9.3_
    - _Design: Vitality re-diagnosis, Browser/terminal rendering_

  - [x] 14.10 Write unit tests for the vitality/changed-card renderer
    - Cover a positive delta with at least one improved changed card, a zero/negative delta, and the null case (re-diagnosis incomplete) rendering the incomplete line rather than a delta
    - _Requirements: 6.3, 6.4, 6.5_

  - [x] 14.11 Respect reduced-motion and the web JS budget for the new terminal code
    - Ensure the diff reveal and result rendering honor `prefers-reduced-motion` and the terminal `quiet` command (no motion when either is set), reusing the existing ui-crt motion/prefs modules; keep the terminal route within the ≤ 250 KB gzipped budget by lazy-loading any heavy diff/patch helper and keeping card images lazy, so the new code adds no eager weight to the initial route
    - _Requirements: 14.1, 14.5_
    - _Design: Browser/terminal rendering, Default vs optional runtime_

  - [x] 14.12 Extend the web budget test and add a reduced-motion unit test
    - Extend `apps/web/src/budget.test.ts` so the terminal initial-route JS set still asserts under the 250 KB gzipped budget with the resurrection client included (any heavy diff/patch helper appears only as a separate dynamic chunk); add a reduced-motion unit test asserting the diff reveal emits no motion when `prefers-reduced-motion`/`quiet` is set
    - _Requirements: 14.1, 14.5_

- [~] 15. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Implement demo mode and the deterministic lich-py2 improvement
  - [x] 16.1 Author the lich-py2 demo fixtures Pre_Pass-sufficient
    - Ensure `fixtures/graveyard/lich-py2` contains legacy constructs (e.g. `print "…"`, `except Exception, e:`, `0L`, `<>`) authored so the deterministic Pre_Pass alone, with no LLM key, removes them and improves the Judgement draw; add the pinned golden `Vitality_Delta` and changed-card set
    - _Requirements: 16.4_
    - _Design: Demo mode_

  - [x] 16.2 Wire Demo_Mode into the runner and route
    - When `demo: true`, load the Ritual from `fixtures/graveyard/lich-py2`, wire the Mock `LlmPort`, block any outbound network via a guard that throws rather than reaching the wire, prefix every emitted line with `[DEMO]`, and return a `DEMO_FIXTURE_MISSING` Error_Line when a required fixture is missing/unreadable
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.6_
    - _Design: Demo mode_

  - [x] 16.3 Write property tests for demo labelling and determinism
    - **Property 15: Demo output is fully `[DEMO]`-labelled** — every emitted stream line carries the `[DEMO]` prefix (`numRuns: 200`)
    - **Property 16: Demo output is deterministic across runs** — repeated `lich-py2` demo runs produce byte-identical serialized output including `Vitality_Delta` and changed-card set (`numRuns: 200`)
    - **Validates: Requirements 14.3, 14.5, 16.3**

  - [x] 16.4 Write the lich-py2 deterministic-improvement demo test
    - Assert the Demo_Mode `lich-py2` Ritual reports `Vitality_Delta > 0` and at least one changed card including an improved draw (e.g. JUDGEMENT/THE TOWER → THE STAR), matching the pinned goldens, with no LLM key configured
    - _Requirements: 16.1, 16.2, 16.4_

- [ ] 17. End-to-end and docs
  - [~] 17.1 Add the Playwright end-to-end resurrection flow
    - Boot → summon a graveyard repo (Mock LLM) → run a reading → `resurrect` → phases stream → per-file diff visible → downloadable patch → re-diagnosis delta shown; include the axe accessibility check (CRT rendering, reduced-motion)
    - _Requirements: 1.1, 7.1, 7.3, 9.1_

  - [x] 17.2 Update docs for the new grimoire and public API
    - Update `docs/DECK.md` and `docs/ARCHITECTURE.md` to document the `py2to3` grimoire, the `Language_Pair_Registry`, and the Resurrection_Route public surface; append a dated entry to `docs/KIRO_USAGE.md` for the spec-driven work
    - _Requirements: 15.4, 15.5_
    - _Design: Package map, Dependency direction_

- [~] 18. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests, e2e) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific sub-requirement IDs for traceability and, where helpful, the design section it builds.
- Property tests are placed next to the implementation they validate so errors are caught early; each names its property number and the requirement IDs it checks, with fast-check `numRuns` per the design (1000 for fixers/selection/diff/registry; 200 otherwise).
- Golden fixtures pin the Pre_Pass transforms and the `lich-py2` demo improvement; a fixer change that alters a golden updates the fixture in the same change.
- `@necro/oracle` is reused unchanged; adapters are injected into the coven runner through ports and are never imported by grimoire fixers.
- User-facing strings in tests follow the oracle-voice steering (two layers, ASCII only, no emoji, ≤ 72 columns).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.3", "2.4"] },
    { "id": 2, "tasks": ["1.3", "2.1", "7.1", "8.1", "9.1", "16.1"] },
    { "id": 3, "tasks": ["2.2", "2.5", "4.1", "7.2", "8.2", "8.3", "8.4", "9.2"] },
    { "id": 4, "tasks": ["4.2", "9.3"] },
    { "id": 5, "tasks": ["4.3", "4.4", "4.5", "5.1", "5.2", "9.4", "9.5"] },
    { "id": 6, "tasks": ["5.3", "5.4", "5.5", "11.1"] },
    { "id": 7, "tasks": ["11.2", "11.3", "11.4", "12.1"] },
    { "id": 8, "tasks": ["12.2", "12.3", "13.1", "16.2"] },
    { "id": 9, "tasks": ["13.2", "16.3", "16.4"] },
    { "id": 10, "tasks": ["13.3", "13.4", "14.1", "17.2"] },
    { "id": 11, "tasks": ["14.2", "14.3", "14.5", "14.9", "14.11"] },
    { "id": 12, "tasks": ["14.4", "14.6", "14.7", "14.10", "14.12"] },
    { "id": 13, "tasks": ["14.8", "17.1"] }
  ]
}
```
