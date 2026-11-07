# Implementation Plan: The Lovers Binding

## Overview

This plan builds Lovers_Binding as one additive layer along the enforced
dependency direction `oracle <- grimoires <- coven <- (web, ui-crt)`, with the
only network-capable module (the OpenRouter provider) injected into the runners
through the existing `LlmPort`. It is sequenced test-first and bottom-up so that
nothing is left orphaned: first the shared port/schema/env foundations; then the
pure LLM core (Model_Router, structured output, prompt templates, usage fold);
then the real OpenRouter provider behind an injectable `fetch`; then the
Resurrection `LLM_Pass` chunking + gate (Part B); then the oracle JavaScript
grammar + WASM tracing; then the Lovers grimoire and its runner (Part C); then
the web + ui-crt surfaces, the streaming route, and BYOK (Part D); then the
security, e2e, and screenshot coverage; and finally the no-regression + budget +
WASM-trace gate and docs. Each component is wired into a prior one as it lands,
and fast-check property tests named by the design's correctness properties
accompany each unit.

The governing rule throughout is **do no harm**: every prior-spec test stays
green, the public `RitualResult`/`FileResult` and resurrect NDJSON wire shapes
are extended only additively, `BUDGET_BYTES` stays `250000`, the Lovers_View and
the ZIP builder are distinct lazy chunks, and the Mock provider remains the
default network-free provider. The deck rule holds: deterministic detectors and
gates decide, while the LLM only interprets, narrates, and may only downgrade.
No unit or property test touches the network, an LLM, or a sandbox — the Mock
provider, an injected `fetchImpl`, and recorded fixtures stand in.

All code is TypeScript (strict, ESM) per the design and the project tech stack.

## Tasks

- [x] 1. Establish port, schema, prompt-version, and env foundations
  - [x] 1.1 Widen `LlmPort`, add `ModelRouterPort`, and extend the LLM contract additively
    - In `packages/coven/src/ports.ts` widen `LlmPort.providerId` to `"mock" | "bedrock" | "anthropic" | "openai" | "openrouter"`; add `LlmCallOptions { apiKey?, modelOverride?, timeoutMs? }` and the optional `opts` parameter to `complete`; add optional `LlmRequest.model`/`LlmRequest.promptVersion` and optional `LlmResult.usage`; add the pure `ModelRouterPort { route(signals), resolveModel(tier, override?) }` and an optional `router?` on `RitualPorts`/`LoversPorts` (the runners depend only on this port type so `@necro/llm` never imports `@necro/coven`); export the new types through `packages/coven/src/index.ts`. Every existing `providerId: "mock"` value and caller stays valid.
    - _Requirements: 1.1, 32.2, 35.1, 35.4_
    - _Design: A.1 Port additions, Resolved decision 7_

  - [x] 1.2 Add the `UsageRecord`/`UsageAggregate` models and `sumUsage` fold in `@necro/llm`
    - Create `packages/llm/src/usage/accounting.ts` with `UsageRecordSchema` (`.strict()`: model-actually-served, promptTokens, completionTokens, costUsd), `UsageAggregateSchema` (`.strict()`: promptTokens, completionTokens, costUsd, soulSource, `byModel[]` per-model breakdown), and the pure `sumUsage(records, soulSource)` fold that sums tokens AND cost AND keeps the per-model breakdown; export all through `packages/llm/src/index.ts`.
    - _Requirements: 5.5, 6.1, 6.2, 6.3, 43.5, 43.7_
    - _Design: A.6 Usage / cost accounting_

  - [x]* 1.3 Write property test for the usage accounting fold
    - **Property 8 (R6.1, R6.2, R6.3): `sumUsage` is a sound non-negative associative/commutative fold with a per-model breakdown**
    - fast-check over lists of `UsageRecord`s; assert associativity, commutativity over token/cost fields, non-negative totals, and that the per-model breakdown sums equal the aggregate totals.
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [x] 1.4 Add `PROMPT_VERSION`
    - Create `packages/llm/src/prompts/version.ts` exporting `export const PROMPT_VERSION = "v1";`; export it through `packages/llm/src/index.ts`.
    - _Requirements: 8.1, 8.4_
    - _Design: A.4 Prompt templates + PROMPT_VERSION_

  - [x] 1.5 Add OpenRouter/model/ceiling/cap env keys to `@necro/config`
    - In `packages/config/src/index.ts` add to `EnvSchema` (all optional/defaulted, `blankToUndefined`, secrets never printed): `OPENROUTER_API_KEY`, `NECRO_LLM_MODEL_FAST`, `NECRO_LLM_MODEL_STRONG`, `NECRO_LLM_MODEL_FALLBACKS` (comma list transformed to `string[]`), `NECRO_LLM_DAILY_CEILING` (default 1000), `NECRO_LOVERS_DAILY_CEILING` (default 200), `NECRO_LLM_MAX_CALLS_PER_READING` (default 12), `NECRO_PUBLIC_URL`. No `NECRO_LLM_SEED` env var or seed constant is added (seed is never sent; determinism = temperature 0 + cache). Add the cross-field rule: if `OPENROUTER_API_KEY` is present but `NECRO_LLM_MODEL_FAST`/`NECRO_LLM_MODEL_STRONG` is missing, `loadEnv` does NOT throw — it logs a key-name-only warning naming ONLY the missing key and composition keeps the Mock/deterministic default (the app stays alive on Mock). Model ids stay configuration; any genuine `EnvValidationError` names only offending keys, never values.
    - _Requirements: 2.1, 2.2, 2.5, 2.7, 20.1, 35.3, 36.1_
    - _Design: A.7 Env additions, A.3 resolveModel precedence_

  - [x]* 1.6 Write unit tests for the new env keys
    - Assert absent/blank values parse to `undefined` (Mock default path), the fallbacks comma list transforms to an array, `NECRO_LLM_MAX_CALLS_PER_READING` defaults to 12, the key-present-but-model-missing cross-field rule does NOT throw but logs a key-name-only warning and keeps the Mock default, and invalid values report an error naming only the key and never a secret value.
    - _Requirements: 2.1, 2.2, 2.7, 35.3, 36.1_

- [x] 2. Implement the pure LLM core
  - [x] 2.1 Implement the pure Model_Router, resolveModel, and signal extraction
    - Create `packages/llm/src/router/signals.ts` (pure `DifficultyFlags` derivation by substring/AST inspection of the minimal context, no model call, no network) and `packages/llm/src/router/model-router.ts` with `routeModel(RouterSignals): ModelTier` (pinned `FAST_DIAGNOSTIC_LIMIT = 6`, `FAST_TOKEN_LIMIT = 1200`: any hard-difficulty flag OR over-limit diagnostics/tokens => `STRONG`, else `FAST`; a Lovers GENERATE unit is routed by function count and token estimate, so `crossLangTypeMapping` informs PLAN difficulty but does not force every GENERATE to STRONG) and the pure `resolveModel(tier, override?)` resolver (precedence: YOURS-only override, then the tier env model); export all through `packages/llm/src/index.ts`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 35.2, 35.4_
    - _Design: A.3 Model_Router + resolveModel precedence_

  - [x]* 2.2 Write property tests for the Model_Router and resolveModel
    - **Property 1 (R3.1-R3.7): Model_Router is a pure, total function of its signals**
    - **Property 29 (R35.2): resolveModel precedence (YOURS-only override, else tier env)**
    - fast-check over arbitrary `RouterSignals`; assert exactly one tier, no side effects, the pinned-limit rule, that GENERATE routes by count/tokens (not a blanket STRONG), and that the Model_Router property coverage required by R23.3 is in place; fast-check over tiers/overrides for resolveModel precedence.
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 23.3, 35.2**

  - [x] 2.3 Implement strict structured-output parsing and zod->JSON-schema mechanics
    - Create `packages/llm/src/response/zod-to-schema.ts` (`toStrictJsonSchema(name, schema)` via `zod-to-json-schema`, post-processed into OpenAI-strict form: all properties `required`, `additionalProperties:false`, unsupported keywords like min/max/minLength stripped and re-enforced by zod post-parse; a `description` per field from `.describe(...)`) and `packages/llm/src/response/structured.ts` with `parseStructured<T>(text, schema)`: primary strict `json_schema` path with `provider.require_parameters:true` sent ONLY alongside `response_format`, `temperature` (exactly 0), and `max_tokens` and with NO `seed` field (so endpoints lacking `seed` stay routable; determinism = temperature 0 + cache), extract-first-balanced-JSON-object-plus-zod fallback, cost read from `usage.cost` (never the deprecated `usage.include`), the served response `model` recorded, and a result union that defers to the one unified retry policy (A.8) before the deterministic fallback without throwing; export through `packages/llm/src/index.ts`.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 43.1, 43.2, 43.3, 43.4, 43.5_
    - _Design: A.5 Structured output + zod->json-schema + usage.cost (no seed)_

  - [x]* 2.4 Write property test for structured-output one-retry fallback and mechanics
    - **Property 5 (R7.3, R7.4): structured-output one unified retry then deterministic fallback**
    - **Property 37 (R43.1-R43.5): zod->strict-schema, require_parameters, no seed, temperature 0, usage.cost, served model**
    - fast-check over malformed/valid model text; assert exactly one retry carrying the exact error then deterministic fallback (never a throw), the generated schema is OpenAI-strict with a per-field description, `provider.require_parameters:true` is sent only alongside `response_format`/`temperature`/`max_tokens`, NO `seed` field is sent, `temperature` is 0, cost comes from `usage.cost`, and the served `model` is recorded.
    - **Validates: Requirements 7.3, 7.4, 43.1, 43.2, 43.3, 43.4, 43.5**

  - [x] 2.5 Implement the single-source-of-truth prompt templates with delimiter neutralisation
    - Create `packages/llm/src/prompts/templates.ts` with the catalogue keyed by purpose (`py2to3.chunk`, `lovers.plan`, `lovers.generate`), each stamped with `PROMPT_VERSION` and carrying the VERBATIM system-prompt text from design A.5a, the VERBATIM USER-message template (carrying the UNTRUSTED_OPEN/…/UNTRUSTED_CLOSE-delimited data + the structured inputs), the VERBATIM REPAIR user message for the second call, explicit rules, the output JSON schema name, and one short few-shot example pair per purpose; before wrapping, `neutraliseDelimiters(src)` escapes any literal `UNTRUSTED_OPEN`/`UNTRUSTED_CLOSE` occurrence so the built request has exactly one opening and one closing marker; the cache-key inputs follow R5.3; this module is the ONE source of truth for prompts, and `packages/grimoires/py2to3/src/llm/index.ts` is refactored so its `LlmStep.buildRequest` delegates here (purpose `py2to3.chunk`). Export through `packages/llm/src/index.ts`.
    - _Requirements: 8.1, 8.2, 8.4, 43.8, 43.9_
    - _Design: A.4 Prompt templates, A.5a verbatim prompts, A.9 neutralisation_

  - [x]* 2.6 Write tests for delimiter wrapping/escaping and injection-cannot-pass-validation
    - **Property 6 (R8.2, R8.3): delimiter wrapping + escaping in the built request, and injected instructions cannot pass schema + gate + deny-list**
    - (a) unit/fast-check over source containing the literal marker strings: assert the BUILT request contains exactly one `UNTRUSTED_OPEN` and one `UNTRUSTED_CLOSE`; (b) fast-check over injected instructions that would add disallowed code: assert the output is rejected by schema + gate + deny-list and never accepted.
    - **Validates: Requirements 8.2, 8.3**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement the OpenRouter provider (injectable fetch, outside the no-network guard)
  - [x] 4.1 Implement `createOpenRouterLlmPort` behind an injectable fetch
    - Create `packages/llm/src/providers/openrouter.ts` implementing `LlmPort` with `providerId: "openrouter"`: an OpenAI-compatible `POST /chat/completions` over an injectable `fetchImpl` (defaulting to platform `fetch`), armed with an `AbortController` + `setTimeout(abort, opts.timeoutMs ?? req.timeoutMs)` where `timeoutMs` comes from the single-request DEADLINE model (A.8); headers `Authorization: Bearer <opts.apiKey ?? serverKey>`, `Content-Type: application/json`, `HTTP-Referer`, `X-Title: Necro-Oracle`; the OpenRouter `models` fallback array from `NECRO_LLM_MODEL_FALLBACKS`; strict `response_format.json_schema` (generated in task 2.3) with `provider.require_parameters:true` sent ONLY alongside `response_format`, `temperature`, and `max_tokens` and with NO `seed` field in the body; build the minimal AST-sliced context (target unit + referenced signatures/imports), place the stable system prompt first, set bounded per-purpose `max_tokens`, and temperature EXACTLY 0; parse `choices[0].message.content` and build a `UsageRecord` from `usage` (cost from `usage.cost`, model from the served `model`); map `401`/`402` => `UPSTREAM_UNAVAILABLE`, timeout/abort => `NETWORK_TIMEOUT`, other 5xx/network => `UPSTREAM_UNAVAILABLE`; reuse the shared `withCache` so `cached` behaves identically to Mock; the cache key follows R5.3 and never the user key, and only schema-AND-gate-passed outputs are written; reuse the per-request token cap and daily ceiling from `NECRO_LLM_DAILY_CEILING`. Never log the key, prompt body, or code body — only ids/sizes/tokens/cost. The file lives OUTSIDE the `no-network.guard.test.ts` `GUARDED_FILES` set. Export `createOpenRouterLlmPort` + `OpenRouterOptions` through `packages/llm/src/index.ts`; Mock stays the default export.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.3, 2.4, 2.6, 5.1, 5.2, 5.4, 7.1, 9.1, 9.2, 9.3, 10.1, 43.6_
    - _Design: A.2 OpenRouter provider (no seed), A.5 structured output, A.8 deadline + cache rule_

  - [x]* 4.2 Write golden-fixture tests for the provider keyed per PROMPT_VERSION
    - Drive the provider with an injected `fetchImpl` recorded-fixture responder (per `PROMPT_VERSION`): assert the request body/headers/`models` fallback array/`response_format`, that the request body NEVER contains a `seed` field and that `provider.require_parameters` appears only alongside `response_format`/`temperature`/`max_tokens` with `temperature` equal to 0, the parsed `LlmResult` + `UsageRecord`, `401`/`402` => `UPSTREAM_UNAVAILABLE`, timeout/abort => `NETWORK_TIMEOUT`, and the shared-cache `cached` flag.
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.6, 7.1, 9.3, 10.1, 43.3_

  - [x]* 4.3 Write property test for secrets never appearing in provider output
    - **Property 7 (R9.2): secrets never appear in provider logs or outputs**
    - fast-check over completions with key/prompt/code bodies; assert the provider's log sink and the returned `LlmResult` contain no API key, prompt body, or code body — only ids, sizes, tokens, cost.
    - **Validates: Requirements 9.2**

  - [x]* 4.4 Extend the existing no-network guard to cover the Mock default and provider placement
    - **Property 4 (R1.8, R10.2, R10.3): Mock stays the default network-free provider**
    - Merge the network-free-default assertions INTO the existing `packages/llm/src/no-network.guard.test.ts`: the guarded files import no network module, the OpenRouter provider lives OUTSIDE that set, and it is reachable only through an injected `fetchImpl` or configured key (no socket in unit/property tests).
    - **Validates: Requirements 1.8, 10.2, 10.3**

- [x] 5. Implement the Resurrection LLM_Pass chunking and validation gate (Part B)
  - [x] 5.1 Implement pure residual chunking
    - Create `packages/coven/src/chunk/residual-chunk.ts` with `ResidualChunk` and the pure `groupResiduals(path, source, residuals)` that groups residuals by enclosing function/class via the oracle parser's node spans, carries only that chunk's diagnostics, and sets `context` to a strict subset (enclosing unit + referenced signature/import lines) — never the whole file; export through `packages/coven/src/index.ts`.
    - _Requirements: 11.1, 11.2, 11.3_
    - _Design: B.1 Residual chunking_

  - [x]* 5.2 Write property test for residual chunks never containing the whole file
    - **Property 9 (R11.1, R11.2): residual chunks never contain the whole file**
    - fast-check over files + residual sets; assert every `context` is a strict subset and each chunk carries only its own diagnostics.
    - **Validates: Requirements 11.1, 11.2**

  - [x] 5.3 Add the `ChunkEditSchema` and the deterministic chunk gate to py2to3
    - In `packages/grimoires/py2to3` add (additively, `.strict()`) `ChunkEditSchema { chunkId, replacementCode, requiredImports: string[], reason<=280, confidence 0..1 }` (purpose `py2to3.chunk`) and a pure `acceptChunk(before, edit, diagnose, parse)` gate helper that: declines (keeps the deterministic chunk, NO retry) when `confidence === 0`; rejects any `replacementCode` containing a mask placeholder (e.g. `***MASKED***`); rejects any non-stdlib `requiredImports` entry; hoists the stdlib `requiredImports` DETERMINISTICALLY outside the chunk; and otherwise accepts only if the spliced result parses as Python 3 with zero error nodes, retains no Python 2 constructs under the reused diagnosis rules, preserves public signatures, and keeps the diff within the chunk EXCLUDING the hoisted imports; export additively from the grimoire barrel.
    - _Requirements: 12.1, 12.2, 12.5, 12.6, 12.7_
    - _Design: B.2 Structured edit schema + gate (requiredImports, decline, mask guard)_

  - [x] 5.4 Wire per-chunk routing, the gate, and the one unified retry into the runner's LLM_Pass
    - Refactor `#runLlmPass` in `packages/coven/src/runners/local.ts` to drive chunks via `groupResiduals`, route EACH CHUNK through the injected `ModelRouterPort.route(signals)` (escalating FAST->STRONG), send only that chunk's residual diagnostics via the shared template (minimal AST-sliced context, stable system prompt first, bounded `max_tokens`, temperature EXACTLY 0 — R5.1/R5.2/R5.4), validate with `ChunkEditSchema` and the `acceptChunk` gate (confidence-0 decline + mask-placeholder/non-stdlib-import rejection), apply the ONE unified retry policy under the single-request DEADLINE model (each call `timeoutMs = min(perCallCap, remaining - 5000)`; skip the retry straight to deterministic fallback when `remaining < the retry minimum`; MAX CALLS PER UNIT = 2 carrying the exact error — R36.3) then keep the deterministic version; derive the deadline from the resurrect `setTimer` budget (R5.6) and stop issuing calls once the remaining budget is too small; honour the per-reading cap `NECRO_LLM_MAX_CALLS_PER_READING` (remaining chunks stay deterministic); accumulate `UsageRecord[]` and report the `sumUsage` `UsageAggregate` plus per-chunk healer attribution (`"llm"` vs `"rules"`) and reason as OPTIONAL additive, redaction-safe result/stream fields; demo mode uses the Mock provider; the public `RitualResult`/`FileResult` shapes stay unchanged.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.4, 5.6, 12.3, 13.1, 13.2, 13.3, 13.4, 36.1, 36.2, 36.3_
    - _Design: B.2 gate + per-chunk routing, B.3 Souls-spent, A.8 one retry policy + deadline_

  - [x]* 5.5 Write property test for the chunk validation gate
    - **Property 10 (R12.2, R12.3): the chunk validation gate admits only safe edits**
    - fast-check over chunk edits; assert acceptance only when the result parses as Python 3, has no remaining Python 2 constructs, preserves public signatures, and keeps the diff within the chunk; otherwise one repair retry then keep deterministic.
    - **Validates: Requirements 12.2, 12.3**

  - [x]* 5.6 Write property test for Part B never degrading already-converted code
    - **Property 11 (R12.4): Part B never degrades already-converted code**
    - fast-check over files; assert the LLM_Pass output is at least as valid as the deterministic PRE_PASS result (never more Python 2 constructs, never a parse regression).
    - **Validates: Requirements 12.4**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add the oracle JavaScript grammar and trace its WASM into the lovers route
  - [x] 7.1 Implement `parseJavascript` in `@necro/oracle`
    - Add `parseJavascript(source): Tree` to `@necro/oracle` that loads `tree-sitter-javascript/tree-sitter-javascript.wasm` via `createRequire(import.meta.url).resolve(...)` exactly as `parsePython` loads the python grammar (same `initParser` arming, same error-node counting); export it through the oracle barrel.
    - _Requirements: 18.1_
    - _Design: C.3 Validation (parseJavascript)_

  - [x] 7.2 Trace the JavaScript + Python grammar WASM into `/api/lovers` and ABI-pin tree-sitter-javascript
    - In `apps/web/next.config.ts` add `"tree-sitter-javascript/tree-sitter-javascript.wasm"` to `WASM_TRACING_SPECIFIERS` and add `/api/lovers` to the `buildWasmTracingIncludes()` map alongside `/api/readings` and `/api/resurrect`; ensure BOTH the javascript grammar AND the python grammar + runtime WASM are traced into `/api/lovers`. Pin `tree-sitter-javascript` to an EXACT version whose grammar WASM is ABI-compatible with the installed `web-tree-sitter` (exact dependency entry + a `pnpm.overrides` entry so a transitive bump cannot drift the ABI). Extend `apps/web/scripts/check-wasm-trace.mjs` to assert the javascript grammar + the python grammar + runtime WASM are traced into `/api/lovers` and to load the javascript grammar once to fail fast on an ABI mismatch.
    - _Requirements: 18.2, 18.3, 44.1, 44.2_
    - _Design: C.3 Validation (WASM tracing), Dependencies (ABI pin)_

- [x] 8. Implement the Lovers grimoire and the LoversRunner (Part C)
  - [x] 8.1 Add the Lovers zod models in `@necro/coven`
    - Create `packages/coven/src/lovers/types.ts` with `.strict()` `LoversPlanSchema` (functions `.min(1).max(8)`), `LoversPairLlmSchema` (the GENERATE LLM output: `jsBeloved` client + `contractSchema` string + `pythonTests` + `jsTests`, NO `pythonHeart`), `LoversPairSchema` (= `LoversPairLlmSchema` extended with the deterministically-emitted `pythonHeart`), `ContractSchema`, and `LoversResultSchema` (file, targetLang literal `javascript`, pair, plan, `path: "llm"|"template"`, `soulsSpent: UsageAggregateSchema`, `soulSource`, `demo`); export through `packages/coven/src/index.ts`.
    - _Requirements: 16.2, 16.3, 16.4, 16.6, 17.6, 38.2_
    - _Design: C.2 Lovers grimoire schemas (LoversPairLlmSchema vs LoversPairSchema), C.4 LoversRunner_

  - [x] 8.2 Add deterministic `extractPlan` and scaffold the `lovers-js` grimoire with its LLM steps
    - Create `packages/coven/src/lovers/extract-plan.ts`: a pure deterministic `extractPlan(source)` (tree-sitter: top-level function names, params, defaults) over the RESURRECTED Python 3 source, used as the minimal PLAN context, the PLAN-failure fallback plan, and the fixture input; cap at `MAX_BINDABLE = 8` functions and `MAX_SOURCE_BYTES = 32768`. Create `packages/grimoires/lovers-js/` (adapter-free, mirrors py2to3): `src/index.ts` exposing the grimoire object with `LANGUAGE_PAIR = "python3->javascript"` parameterized by `LanguagePairId`; `src/llm/plan.ts` (`LlmStep` step 1: FAST model -> `LoversPlan`, strict schema, context = `extractPlan`) and `src/llm/generate.ts` (`LlmStep` step 2: routed model -> `LoversPairLlmSchema` — `jsBeloved`/`contractSchema`/`pythonTests`/`jsTests`, NEVER the heart, `max_tokens` HARD_CAP 6144), each with a deterministic `mockFixture`; imports `@necro/oracle` only, no adapters.
    - _Requirements: 15.1, 15.2, 15.5, 16.1, 23.2, 37.1, 37.2_
    - _Design: C.2 Lovers grimoire, C.4 extractPlan_

  - [x] 8.3 Implement the pure deterministic AST-template bridge fallback
    - Create `packages/grimoires/lovers-js/src/fixers/ast-bridge.ts`: a pure fixer that ALWAYS emits the mechanically-correct `pythonHeart` (the JSON-lines dispatcher: one `{"id","fn","args":{paramName:value}}` per stdin line -> `{"id","ok":true,"value"}`/`{"id","ok":false,"error":{"type","message"}}` per stdout line, `json.dumps(..., ensure_ascii=False, allow_nan=False, separators=(",", ":"))` + flush, user stdout redirected to stderr during a call, exit 0 on EOF, and a `handle(request)` entry the tests call) on BOTH the LLM path and the fallback path; and, on the fallback path only, also emits the `jsBeloved` client (spawns `process.env.PYTHON ?? "python3"` with `heart.py`, one child, correlates by `id`, `close()`) + `contractSchema` (draft 2020-12 string with `$defs["<fn>.request"]`/`$defs["<fn>.response"]`) + both stdlib-only contract tests from the plan alone (the LLM plan OR the `extractPlan` fallback; no model call).
    - _Requirements: 16.2, 16.3, 16.4, 16.6, 17.4, 37.2, 38.1_
    - _Design: C.2a protocol, C.3 Validation (fallback), item 3 deterministic heart_

  - [x] 8.4 Implement the Lovers validation gate with deny-list and name equality
    - Create `packages/grimoires/lovers-js/src/validate.ts` with the pure `validateLovers(plan, pair, parsePy, parseJs, validateSchema, denyScan)` gate: the deterministically-emitted `pythonHeart` AND the python contract test parse with zero error nodes (python grammar), js beloved AND js contract test parse with zero error nodes (javascript grammar), the contract schema is a valid JSON Schema draft 2020-12 whose `$defs` keys (`<fn>.request`/`<fn>.response`, reduced via `contractFnNames()`) equal `plan.functions`, every planned function is defined on both sides, AND the static deny-list scan (new `packages/coven/src/lovers/deny-list.ts`: no eval/Function/exec, no network, no fs writes/deletes, no os.system, no child_process except the single spawn of the heart) finds no forbidden construct. The parsed heart is always the deterministic one (item 3).
    - _Requirements: 17.1, 17.2, 17.3, 17.7, 17.8, 39.1, 39.2_
    - _Design: C.2a protocol, C.3 Validation gate ($defs keys), C.3a deny-list scan_

  - [x] 8.5 Add the three landing-repo golden fixtures
    - Add `packages/grimoires/lovers-js/src/fixtures/{pytarl,robotadventure,test-repo}/{before,after}/` golden fixtures for `tomaes/pytarl`, `ArmstrongJ/robotadventure`, and `neubig/test-repo`, each keyed by its `extractPlan` output, with a test asserting each `before` produces its pinned `after` through the deterministic (template) path.
    - _Requirements: 23.1, 37.2_
    - _Design: Testing Strategy (lovers golden fixtures)_

  - [x] 8.6 Implement the LoversRunner driving PLAN -> GENERATE -> VALIDATE -> EMIT
    - Create `packages/coven/src/lovers/runner.ts` with `run(input, ports, emit)`: the input is the RESURRECTED Python 3 source; compute `extractPlan(source)` first (minimal PLAN context + PLAN-failure fallback plan); PLAN (FAST model -> strict `LoversPlan`), GENERATE (routed via the injected `ModelRouterPort`, starting FAST, by function count/token estimate) producing `LoversPairLlmSchema` (NO heart), then ALWAYS emit the deterministic `pythonHeart` via `ast-bridge` and assemble the full `LoversPairSchema`; VALIDATE via `validateLovers` (incl. deny-list); apply the ONE unified retry policy under the single-request DEADLINE model (each call `timeoutMs = min(perCallCap, remaining - 5000)`; PLAN perCallCap 12 s, GENERATE perCallCap 45 s; skip a retry to the deterministic fallback when `remaining < the retry minimum`; replace the PLAN retry with the `extractPlan` fallback when `remaining < 30 s`; MAX CALLS PER UNIT = 2 carrying the exact error — R36.3), then fall back to the AST-template bridge with `path: "template"` (passing validation sets `path: "llm"`; the `pythonHeart` is identical on both paths); mask all repository source through `maskSecretsInText` and neutralise delimiters; reuse `makeBudget`/`withinBudget`, the per-reading cap, and the shared cache (accepted outputs only); demo mode uses the Mock provider with a pinned fixture (network blocked); emit the `LoversResult` with the `UsageAggregate`; export through `packages/coven/src/index.ts`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 15.1, 15.2, 15.3, 15.4, 15.5, 16.6, 17.4, 17.5, 17.6, 23.2, 36.2, 36.3, 37.2_
    - _Design: C.4 LoversRunner, A.8 one retry policy + deadline, A.3 Model_Router, item 3 deterministic heart_

  - [x]* 8.7 Write property test for the one unified retry policy
    - **Property 2 (R4.1, R4.2, R4.4): one retry per unit, FAST->STRONG only, max 2 calls**
    - **Property 30 (R36.1, R36.2): per-reading call cap honoured**
    - fast-check over routings/units; assert a FAST start whose validation fails retries exactly once at STRONG, a STRONG start never downgrades, MAX CALLS PER UNIT = 2, then deterministic fallback; and that total calls per reading never exceed `NECRO_LLM_MAX_CALLS_PER_READING` (remaining units stay deterministic).
    - **Validates: Requirements 4.1, 4.2, 4.4, 36.1, 36.2**

  - [x]* 8.8 Write property test for every planned function on both sides
    - **Property 12 (R17.3): every planned function exists on both sides**
    - fast-check over accepted `LoversResult` (path `"llm"`); assert every `plan.functions` entry is defined in both `pythonHeart` and `jsBeloved`.
    - **Validates: Requirements 17.3**

  - [x]* 8.9 Write property test for both sides parsing and the contract validating
    - **Property 13 (R17.1, R17.2): both sides parse and the contract validates**
    - fast-check over accepted `LoversResult`; assert `pythonHeart`/`jsBeloved` parse with zero error nodes and `contractSchema` is a valid JSON Schema.
    - **Validates: Requirements 17.1, 17.2**

  - [x]* 8.10 Write property test for the contract round-trip (ajv JS-only, optional python CI)
    - **Property 14 (R16.5): contract round-trip validates in JS (ajv), optional python in CI**
    - fast-check over values in the contract domain: encode in JS, validate against `contractSchema` with `ajv`, decode, and assert equality (JS ONLY, no python spawned); add an OPTIONAL CI-only python round-trip that is SKIPPED when `python3` is absent from `PATH`. This also provides the contract-round-trip property coverage required by R23.3.
    - **Validates: Requirements 16.5, 23.3**

  - [x]* 8.11 Write property test for deterministic fallback with path reported
    - **Property 15 (R17.4, R17.5, R17.6): deterministic fallback on failure, with path reported**
    - fast-check over generations; assert a failure after one repair retry yields the template bridge with `path === "template"` and a passing generation reports `path === "llm"`.
    - **Validates: Requirements 17.4, 17.5, 17.6**

  - [x]* 8.12 Write unit test for language-pair parameterization
    - **Property 26 (R23.2): the language pair is parameterized**
    - Plain unit test over a fixed set of target language ids; assert `python3->javascript` is enabled and representative other targets are rejected at parse with an oracle-voice error rather than by a hardcoded branch.
    - **Validates: Requirements 23.2**

  - [x]* 8.13 Write property tests for the deny-list scan and the jsBeloved client role
    - **Property 33 (R39.1, R39.2): the deny-list scan rejects dangerous generated code**
    - **Property 32 (R38.1, R38.2): jsBeloved is a client, not a reimplementation**
    - fast-check over generated pairs: assert `eval`/`Function`/`exec`, network, fs writes/deletes, `os.system`, and `child_process` beyond spawning the heart are rejected (offending token returned, code never executed); and assert an accepted `jsBeloved` spawns `python3 heart.py` and dispatches each planned call over the JSON contract without reimplementing the python bodies.
    - **Validates: Requirements 38.1, 38.2, 39.1, 39.2**

  - [x]* 8.14 Write property test for Lovers grounding and caps
    - **Property 31 (R37.1, R37.2, R37.3): extractPlan grounding, resurrected-source input, and caps**
    - fast-check over resurrected sources; assert the PLAN context and the PLAN-failure fallback plan come from `extractPlan`, the input is the resurrected Python 3 source, and a file with >8 bindable functions or >32768 bytes is rejected at the precondition with the oracle-voice error and no model call.
    - **Validates: Requirements 37.1, 37.2, 37.3**

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement the command parsing, session state, and HUD (ui-crt)
  - [x] 10.1 Parse `lovers`, `key`, and `model` commands
    - In `packages/ui-crt/src/command/parse.ts` and `command/types.ts` add the `Command` variants `{ kind: "lovers"; file; targetLang: "javascript" }`, `{ kind: "key"; op: "set"|"status"|"clear" }`, `{ kind: "model"; tier: "fast"|"strong"; id }`: `lovers <file> <lang>` requires exactly two args with `<lang>` in `js|javascript` normalized to `"javascript"` and the file case preserved (any other target => unknown); `key set|status|clear` requires exactly one arg from that set; `model fast|strong <id>` validates `<id>` against the corrected `MODEL_ID_RE = /^(?=.{1,128}$)~?[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[a-z0-9]+(?:[._-][a-z0-9]+)*)?$/i` (accepts `vendor/model`, optional leading `~`, optional `:tag`, length <= 128; mismatch => unknown). The parser stays pure, total, browser-safe (no `@necro/coven`). Each new command is also a clickable chip.
    - _Requirements: 14.1, 14.2, 25.1, 25.5, 25.6, 25.7_
    - _Design: C.1 Command parsing, D.2 Commands + masked input, Resolved decision 6_

  - [x]* 10.2 Write property test for the safe model-id pattern
    - **Property 23 (R25.7): the safe model-id pattern accepts only safe model ids**
    - fast-check over strings; assert acceptance iff it matches `MODEL_ID_RE`, accepting `openai/gpt-4o-mini`, `anthropic/claude-3.5-sonnet`, `meta-llama/llama-3.1-70b-instruct:free`, `~mistralai/mixtral-8x7b:nitro`, and rejecting whitespace, control chars, over-length (>128), a bare vendor, leading/trailing separators, and `..` path-traversal forms with the oracle-voice error.
    - **Validates: Requirements 25.7**

  - [x]* 10.3 Write unit tests for the lovers/key/model parser and chips
    - Cover `lovers <file> js|javascript` normalization and case preservation, a non-js target => unknown, `key set|status|clear`, valid/invalid `model fast|strong <id>`, and that each new command is exposed as a chip; assert all other commands parse byte-identically.
    - _Requirements: 14.1, 14.2, 25.1, 25.5, 25.6_

  - [x] 10.4 Add Soul_Source and session-model-override state (session only)
    - In `packages/ui-crt/src/session/state.ts` and `session/reducer.ts` add `soulSource` and `sessionModelOverrides` (plus the `{ keySet, last4 }` HUD mirror), all held in session state only and never written to any storage; `key set` opens the masked input (never the raw command line), `key status` reduces to set/not-set + last-4, `key clear` resets the flag; a `model` command records the session-only override. Export the additive state through `packages/ui-crt/src/index.ts`.
    - _Requirements: 24.1, 24.2, 24.4, 25.2, 25.3, 25.4, 25.8_
    - _Design: D.2 Commands, D.6 HUD_

  - [x]* 10.5 Write unit test for session model overrides never persisting
    - **Property 24 (R25.8): session model overrides never persist**
    - Plain unit test over representative `model fast/strong <id>` sequences; assert the override lives only in session state, is gone on reset/reload, and is never written to any storage.
    - **Validates: Requirements 25.8**

  - [x] 10.6 Implement the Soul_Source HUD indicator and lovers chips
    - Add the HUD "SOUL SOURCE" indicator (`SOUL SOURCE: ORACLE` / `SOUL SOURCE: YOURS`) attributing the souls-spent to the active source, plus the lovers/key/model clickable chips, in `packages/ui-crt/src/components/`; offer the `lovers <file> js` command and chip + hint while THE LOVERS (VI) was drawn and the file is resurrectable.
    - _Requirements: 14.3, 24.4_
    - _Design: D.6 HUD + a11y_

- [x] 11. Implement the lovers route, user-key transport, and BYOK container (apps/web)
  - [x] 11.1 Add the lovers request, the models override field, and stream/wire schemas
    - In `apps/web/src/protocol/schemas.ts` add the `.strict()` `LoversRequestSchema { ref, file, targetLang: literal "javascript", spread: enum["fates","necropsy"], models?: { fast?, strong? } (each MODEL_ID_RE-validated), demo?: literal true }` and add the SAME optional `models` field to `ResurrectRequestSchema`; create `apps/web/src/protocol/lovers-stream.ts` (server line schemas reusing coven `LoversResultSchema`, phases `["PLAN","GENERATE","VALIDATE","BIND"]`) and `apps/web/src/protocol/lovers-wire.ts` (pure-zod browser mirror, like `resurrect-wire.ts`) with a compile-time conformance assertion against the ui-crt render contract.
    - _Requirements: 19.3, 40.1_
    - _Design: C.5 Lovers route + wire schemas, D.2 model overrides_

  - [x] 11.2 Implement `user-key.ts` parse/validate/redaction/cache-key exclusion
    - Create `apps/web/src/server/user-key.ts` with `parseUserKey(header)` validating `X-Necro-User-Key` against `UserKeySchema = z.string().regex(/^[^\s\x00-\x1f\x7f]{8,512}$/)` (present-but-malformed => typed `VALIDATION_FAILED`), the `redactDeep` registration entry for the user key, and the rule that the completion/response cache key follows R5.3 (`sha256(purposeId + schemaName + PROMPT_VERSION + resolvedModel + contentHash + retryFlag/errorHash)`) and never includes the user key. The parsed key is passed to the provider as `LlmCallOptions.apiKey` for that request only, then dropped.
    - _Requirements: 27.1, 27.2, 27.4, 27.5_
    - _Design: D.4 Transport + redaction + cache-key exclusion_

  - [x]* 11.3 Write property test for cache-key exclusion of the user key
    - **Property 3 (R5.3, R27.4): the cache key excludes the user key**
    - fast-check over two requests identical in content/`PROMPT_VERSION`/model but differing in (or with/without) a user key; assert the derived cache key is identical and no user-key byte is recoverable.
    - **Validates: Requirements 5.3, 27.4**

  - [x] 11.4 Implement the non-persistable SoulKeyContext
    - Create `apps/web/src/terminal/soul-key-context.tsx` backed by `useRef<string|null>(null)` exposing `setKey`/`clearKey`/`getKeyForRequest`/`status` (set + last-4) and never the raw value as state; the module imports none of `localStorage`, `sessionStorage`, `document.cookie`, `indexedDB`, `location`, `history`, or any analytics client; reload/close loses the value.
    - _Requirements: 26.2, 26.3, 26.4_
    - _Design: D.3 Non-persistable state container_

  - [x] 11.5 Implement the masked SoulKeyInput
    - Create `apps/web/src/components/SoulKeyInput.tsx`: a `type="password"`, `autocomplete="off"`, `aria-label="OpenRouter key"` field that never writes the value to the log, scrollback, or command history; on submit the value goes only to the in-memory ref and the reducer records `{ keySet: true, last4 }` with the oracle-voice set confirmation.
    - _Requirements: 25.2, 26.4_
    - _Design: D.2 Commands + masked input_

  - [x] 11.6a Wire `deps.llm`/BYOK/redaction into composition + the resurrect route
    - Update `apps/web/src/server/composition.ts` to build the OpenRouter provider + the `ModelRouterPort` when `OPENROUTER_API_KEY` is present and not demo (else Mock), AND to build an OpenRouter provider PER REQUEST from a valid user key when `OPENROUTER_API_KEY` is absent (so BYOK works with no server key — `soulSource = YOURS`), and inject it as `deps.llm` for `/api/resurrect` (previously never wired); update `apps/web/src/server/handlers/resurrect.ts` to `parseUserKey`, set `soulSource`, skip/keep the server spend ceiling exactly like `/api/lovers` (YOURS skips the ceiling, keeps the per-IP limit), pass `LlmCallOptions.apiKey`, and redact `OPENROUTER_API_KEY` + the user key (not only the legacy `NECRO_LLM_API_KEY`) on every outgoing line; update `apps/web/src/server/deps.ts` with the user-key seam + `ModelRouterPort` + daily ceiling. Mock stays the default when no key at all is present.
    - _Requirements: 24.1, 24.2, 24.3, 27.1, 27.2, 34.1, 34.2, 34.3, 34.4_
    - _Design: Part B production wiring, D.1/D.4/D.5 BYOK (no-server-key), composition_

  - [x] 11.6b Implement the lovers handler/route with precondition, BYOK, overrides, and soft-degrade
    - Create `apps/web/src/server/handlers/lovers.ts` and `apps/web/src/app/api/lovers/route.ts` mirroring the resurrect route: Node runtime, `force-dynamic`, `maxDuration = 120` (the Fluid Compute limit permits it; keep 50 with the same deadline algorithm if a target caps it), method guard -> per-IP limiter chain -> body guard -> strict `LoversRequestSchema` -> commit to a `200 application/x-ndjson` stream from inside `ReadableStream.start`, validating every line against the stream schema before writing and mapping coven errors to oracle codes via `mapEngineError`; enforce the precondition (LOVERS VI not drawn, file not bindable, >8 functions, or >32768 bytes => typed `VALIDATION_FAILED`, no model call); apply the separate `NECRO_LOVERS_DAILY_CEILING`; set the single request DEADLINE from `maxDuration` minus the summon+resurrect time already spent and pass each call's `timeoutMs = min(perCallCap, remaining - 5000)` (A.8); set `soulSource` from a valid user key (YOURS skips the server spend ceiling, keeps the per-IP limit; builds the provider per request from the user key when no server key is set), honour `models` overrides only when YOURS (ignore + emit an oracle-voice NOTICE line when ORACLE), pass `LlmCallOptions.apiKey`; redact every outgoing line with both `OPENROUTER_API_KEY` and the user key; log only `{code,message,stack}`; on USER-key `401`/`402` return the typed `UPSTREAM_UNAVAILABLE` oracle-voice error with no silent server-key fallback. Consume the `deps.llm`/`LoversDeps` wiring from 11.6a.
    - _Requirements: 14.4, 19.1, 19.2, 19.3, 19.4, 19.5, 20.1, 24.2, 24.3, 27.1, 28.1, 28.2, 36.3, 36.4, 37.3, 40.2, 40.3_
    - _Design: C.5 Lovers route, A.8 deadline, D.4 Transport, D.5 Limits + error mapping_

  - [x] 11.6c Add the degrade-matrix NOTICE lines for both routes
    - Add the server-key soft-degrade oracle-voice NOTICE lines (mystical line -> plain fact, per the degrade matrix) for BOTH `/api/resurrect` and `/api/lovers`: no key, demo, daily ceiling, spend breaker open, timeout, server `402`/`429`/`401`, per-reading call cap, and model overrides ignored on ORACLE — each yields the deterministic result plus ONE NOTICE line (validated against the stream schema, redaction-safe), never a failure; a USER-key `401`/`402` stays the one hard typed case (11.6b). Wire these notices into both handlers.
    - _Requirements: 40.2, 42.1, 42.2_
    - _Design: Degrade matrix, D.5 Limits + error mapping_

  - [x]* 11.7 Write property test for the Lovers precondition
    - **Property 16 (R14.4): the Lovers precondition is enforced**
    - fast-check over requests where LOVERS (VI) was not drawn or the file is not bindable; assert the route terminates with the typed oracle-voice `VALIDATION_FAILED` error and never calls a model.
    - **Validates: Requirements 14.4**

  - [x]* 11.8 Write property tests for BYOK limits and auth-failure fallback
    - **Property 21 (R24.2, R24.3): BYOK skips the server ceiling but keeps per-IP limits**
    - **Property 22 (R28.1, R28.2): BYOK auth failure has no silent server-key fallback**
    - fast-check: a valid user-key request skips the server spend ceiling while keeping the per-IP limit (a server-key request applies both); an OpenRouter `401`/`402` on a user-key request yields the typed oracle-voice error with the only fallback being the deterministic layer, never the server key.
    - **Validates: Requirements 24.2, 24.3, 28.1, 28.2**

  - [x] 11.9 Attach the user-key header on the browser resurrect/lovers clients and wire SoulKey into the shell
    - Modify (or add) the browser fetch clients `apps/web/src/terminal/resurrect-client.ts` and `apps/web/src/terminal/lovers-client.ts` to attach `X-Necro-User-Key` from `SoulKeyApi.getKeyForRequest()` when a key is set (no header otherwise), never logging the key value; and wire `SoulKeyProvider`, the masked `SoulKeyInput`, and the `SOUL SOURCE` HUD into the existing terminal shell (`apps/web/src/terminal/shell.tsx`).
    - _Requirements: 41.1, 41.2_
    - _Design: D.3 container, D.6 HUD, Where-code-lives (browser clients)_

  - [x]* 11.10 Write property tests for wiring, overrides, header attachment, and soft-degrade
    - **Property 28 (R34.1-R34.4): resurrect wires deps.llm from the key; Mock stays the default**
    - **Property 34 (R40.1, R40.2, R40.3): overrides honoured only on YOURS, ignored with a notice on ORACLE**
    - **Property 35 (R41.1, R41.2): browser clients attach the user-key header; never logged**
    - **Property 36 (R42.1, R42.2): server-key failures soft-degrade; USER-key 401/402 stays the hard case**
    - fast-check over compositions/requests: assert `deps.llm` is OpenRouter iff `OPENROUTER_API_KEY` present and not demo (else Mock), the resurrect route parses the key/soulSource/ceilings/redaction exactly like lovers; overrides reach `resolveModel` only on YOURS and are ignored with a NOTICE on ORACLE; the clients attach the header only when a key is set and never log it; and every degrade-matrix condition yields a deterministic result + one NOTICE (never a failure) while a USER-key 401/402 stays typed.
    - **Validates: Requirements 34.1, 34.2, 34.3, 34.4, 40.1, 40.2, 40.3, 41.1, 41.2, 42.1, 42.2**

- [x] 12. Implement the DMG Lovers view and client-side ZIP (lazy chunks)
  - [x] 12.1 Add the lazy-load seams for the view and the ZIP builder
    - Create `apps/web/src/terminal/load-lovers-view.ts` (literal-path dynamic import -> `LoversView` chunk) and `apps/web/src/terminal/load-zip-builder.ts` (literal-path dynamic import -> the client-side ZIP builder chunk), each resolving to a distinct non-initial chunk.
    - _Requirements: 22.1, 31.1_
    - _Design: C.6 DMG Lovers view + viewport fit_

  - [x] 12.2 Implement the LoversView DMG split view
    - Create `apps/web/src/components/LoversView.tsx`: the DMG pixel ritual (two hearts + a seam, animated only inside motion zones, off under `prefers-reduced-motion`/motion off), then a split view (Python left / contract center / JavaScript right) with code rising line by line; strict 4-shade DMG palette (`#001a00/#0b4f1a/#2fa84a/#8cff9e`) or transparent, bundled bitmap font, single-integer-factor scaling on both axes, `image-rendering: pixelated`; reuse the `oracle-landing-polish` viewport-fit utilities so the PAGE never scrolls at 1280x720 / 1366x768 / 1920x1080 (outer `overflow: hidden`) and overflow is confined to the internal code panes which paginate or scroll WITHIN their fixed integer grid; loaded through `load-lovers-view.ts`. A "Download pair" action builds the ZIP client-side via `load-zip-builder.ts` with the layout `python/`, `js/`, `contract/`, and a `README` with run instructions.
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 22.1_
    - _Design: C.6 DMG Lovers view + viewport fit + overflow policy_

  - [x]* 12.3 Write property test for DMG palette purity on the Lovers view
    - **Property 18 (R21.3): DMG palette purity on the Lovers view**
    - jsdom computed-style sweep over every Lovers surface; assert every computed `color`/`background-color`/`border-color` is a DMG_Palette member or transparent.
    - **Validates: Requirements 21.3**

- [x] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. BYOK security tests and accessibility of the new surfaces
  - [x]* 14.1 Write the structural import-ban guard for the key container
    - **Property 19 (R26.1, R26.2): the user key is structurally impossible to persist**
    - Static text-scan test asserting `soul-key-context.tsx` imports none of `localStorage`, `sessionStorage`, `document.cookie`, `indexedDB`, `location`, `history`, or any analytics client (mirrors the existing boundary guard).
    - **Validates: Requirements 26.1, 26.2**

  - [x]* 14.2 Write runtime spy property tests for key no-persistence and non-leakage
    - **Property 19 (R26.1, R26.2): runtime spies confirm no-persistence**
    - **Property 20 (R27.3, R29.1): the user key never appears in any outgoing surface**
    - fast-check over `key set`/`key clear` sequences with spies on every storage/cookie/IndexedDB/history/analytics API and over the request pipeline; assert the key value never reaches any of them and never appears in any log line, response body, DOM text beyond the last-4 preview, or error body (this is the property coverage required by R29.1).
    - **Validates: Requirements 26.1, 26.2, 27.3, 29.1**

  - [x]* 14.3 Write the BYOK end-to-end suite (OPENROUTER_API_KEY unset, provider throws)
    - Create `apps/web/e2e/byok.e2e.ts`, run with `OPENROUTER_API_KEY` UNSET and the provider `fetchImpl` configured to THROW if called: `key set` (masked input, never echoed), `key status` (set + last-4 only), `key clear` (flag reset), and reload-clears-the-key; assert the HUD "SOUL SOURCE" indicator reflects ORACLE/YOURS.
    - _Requirements: 25.2, 25.3, 25.4, 26.3, 29.2_

  - [x]* 14.4 Write the lovers flow end-to-end suite (OPENROUTER_API_KEY unset, provider throws)
    - Create `apps/web/e2e/lovers-flow.e2e.ts`: run with `OPENROUTER_API_KEY` UNSET and the provider `fetchImpl` configured to THROW if called (proving the flow never touches the network); the `lovers <file> js` chip runs the ritual over the NDJSON stream, the DMG split view renders, and "Download pair" produces the client-side ZIP. Assert the PAGE never scrolls at 1280x720 / 1366x768 / 1920x1080 and only integer scaling is used (this absorbs the former viewport-fit property, Property 17 / R21.5), and that pane overflow scrolls internally (R21.6).
    - _Requirements: 14.3, 19.1, 21.5, 21.6, 22.1, 29.2_

  - [x]* 14.5 Write axe zero-violation tests for the new surfaces
    - Assert zero axe violations on the Lovers_View and on the Soul_Source_HUD + masked input; assert accessible names, an `aria-live` status region, computed contrast >= 4.5:1, and every command offered as a clickable chip.
    - _Requirements: 30.1, 30.2, 30.3_

- [x] 15. No-regression, budget, and WASM-trace gate
  - [x] 15.1 Assert the budget and distinct lazy chunks (impl + property)
    - **Property 25 (R31.1, R31.2, R31.3): Lovers view and ZIP builder are distinct lazy chunks; budget unchanged**
    - Extend `scripts/check-web-budget.mjs` and `apps/web/src/budget.test.ts` to keep `BUDGET_BYTES` at `250000` with the terminal initial-route JS at or below it gzipped, and to assert — over the production build — that the Lovers_View and the ZIP builder each resolve to a separate, non-initial chunk.
    - _Requirements: 31.1, 31.2, 31.3_
    - _Design: C.6, Performance Considerations_
    - **Validates: Requirements 31.1, 31.2, 31.3**

  - [x] 15.3 Run the full no-regression + budget + WASM-trace gate (incl. do-no-harm assertions)
    - **Property 27 (R32.1, R32.2, R32.3): do no harm — prior-spec results unchanged**
    - Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `node scripts/check-web-budget.mjs`; confirm all prior-spec tests stay green unchanged, `BUDGET_BYTES` is unchanged at `250000`, the Lovers_View and ZIP builder are distinct lazy chunks, and the WASM trace check passes for `/api/lovers`; assert the `RitualResult`/`FileResult`/resurrect NDJSON wire shapes are unchanged (healer/souls fields optional-additive), the resurrect NDJSON contract is unchanged, and the Mock provider is still the default. Fix any regression before proceeding.
    - _Requirements: 32.1, 32.2, 32.3, 18.3, 31.2_
    - _Design: Testing Strategy, Do-no-harm_
    - **Validates: Requirements 32.1, 32.2, 32.3**

- [x] 16. Screenshot baselines and documentation
  - [x]* 16.1 Add screenshot baselines for the Lovers view and HUD modes
    - Add `apps/web/e2e/screenshots.e2e.ts` capture-only frames for the Lovers_View DMG split view and the Soul_Source_HUD ORACLE/YOURS modes (gated by `CAPTURE_SCREENSHOTS`).
    - _Requirements: 33.1, 21.1_
    - _Design: Testing Strategy_

  - [x] 16.2 Update the docs in the same change
    - Update `docs/ARCHITECTURE.md` (the OpenRouter LLM layer + Model_Router, the Lovers grimoire + route + WASM tracing, the BYOK transport/redaction/cache-key rules), add the new `docs/PROMPTS.md` (`PROMPT_VERSION`, the template catalogue, the documented default model ids, the prompt-injection defense notes), and append a dated entry to `docs/KIRO_USAGE.md` for this spec's Kiro-assisted work.
    - _Requirements: 33.2_
    - _Design: Docs discipline_

- [x] 17. Final checkpoint - full suite green and no regression
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests/coverage/screenshots) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each property test names its property number and the requirement clause it validates, placed close to the implementation it checks so errors surface early.
- The design has a Correctness Properties section, so property-based tests (fast-check) are included for P1-P39; unit/example tests complement them (P18, P24, P26 are plain unit tests; P6, P14, P17, P39 are assertion/build checks rather than cross-language fast-check).
- All pure core modules (Model_Router, structured output, `sumUsage`, residual chunking, the gates, the contract round-trip, `MODEL_ID_RE`, the BYOK spies) are testable with Mock providers / injected `fetchImpl` / recorded fixtures only — no network, LLM, or sandbox in unit or property tests.
- The governing rule is "do no harm": task 15.3 is the explicit no-regression + budget + WASM-trace gate (R32, R18.3, R31.2) and runs before the final checkpoint; `BUDGET_BYTES` stays `250000` and the Mock provider stays the default.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.4", "1.5", "7.1", "10.1"] },
    { "id": 1, "tasks": ["1.3", "1.6", "2.1", "2.3", "2.5", "5.1", "7.2", "8.1", "10.4", "11.2", "11.4", "11.5", "12.1"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.6", "4.1", "5.2", "5.3", "8.3", "10.2", "10.3", "10.5", "10.6", "11.1", "11.3", "12.2"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.4", "5.4", "8.2", "8.4", "12.3", "14.1"] },
    { "id": 4, "tasks": ["5.5", "5.6", "8.5", "8.6", "11.6a"] },
    { "id": 5, "tasks": ["8.7", "8.8", "8.9", "8.10", "8.11", "8.12", "8.13", "8.14", "11.6b"] },
    { "id": 6, "tasks": ["11.6c", "11.7", "11.8", "11.9"] },
    { "id": 7, "tasks": ["11.10", "14.2", "14.3", "14.4", "14.5", "15.1", "16.1"] },
    { "id": 8, "tasks": ["15.3", "16.2"] }
  ]
}
```
