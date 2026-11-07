// @necro/coven — agents, ledger, gates, runners (ports only, no direct adapters)
export const COVEN_VERSION = "0.0.0";

// --- Port interfaces and the adapter-free Grimoire contract (ports) --------
// Cross-package consumers import these only through this barrel.
export {
  // Port interfaces
  type LlmRequest,
  type LlmResult,
  type LlmCallOptions,
  type LlmPort,
  type SandboxPort,
  type LedgerPort,
  type ClockPort,
  type RitualPorts,
  type LoversPorts,
  type LlmCachePort,
  // Model-router port + structural model-type references (design A.1/A.3/A.6)
  type ModelRouterPort,
  type ModelTier,
  type RouterSignals,
  type UsageRecord,
  // Chunked LLM_Pass structured-edit gate (design B.2)
  type ChunkStep,
  type ChunkRequestInput,
  type ChunkGateResult,
  type ChunkRejectReason,
  type ChunkDiagnoseFn,
  type ChunkParseFn,
  // Grimoire interface and its parts
  type FixResult,
  type Fixer,
  type FixerContext,
  type LlmStep,
  type Grimoire,
} from "./ports.js";

// --- Canonical zod data models and ritual types (models) -------------------
// The single source of truth for the shared data-model contracts. The port
// interfaces above import these same types from ./models.js, so there is no
// duplicate declaration or name collision.
export {
  // Error codes (reuses @necro/oracle's NecroError)
  CovenErrorCodeSchema,
  type CovenErrorCode,
  EngineErrorCodeSchema,
  type EngineErrorCode,
  covenError,
  // Language pair / resurrect target
  LanguagePairIdSchema,
  type LanguagePairId,
  ResurrectTargetSchema,
  type ResurrectTarget,
  // Candidate / residual / diff / file result
  CandidateFileSchema,
  type CandidateFile,
  ResidualEntrySchema,
  type ResidualEntry,
  DiffLineSchema,
  type DiffLine,
  FileResultSchema,
  type FileResult,
  // Supporting grimoire/port models
  ValidationResultSchema,
  type ValidationResult,
  GrimoireInputSchema,
  type GrimoireInput,
  LlmConstructInputSchema,
  type LlmConstructInput,
  DivergenceEntrySchema,
  type DivergenceEntry,
  LedgerEventSchema,
  type LedgerEvent,
  // Ritual result / input
  ChangedCardSchema,
  type ChangedCard,
  RitualResultSchema,
  type RitualResult,
  type RitualInput,
} from "./models.js";

// --- Prompt templates: the ONE source of truth for prompt text (A.4, A.5a) -
// Pure, browser-safe, Node-builtin-free text assembly shared by the adapter-
// free grimoires AND re-exported through the `@necro/llm` barrel. py2to3's
// `LlmStep.buildRequest` delegates to `buildMessages("py2to3.chunk", …)` here
// (R43.9), so there is a single source of truth for prompt text. The markers
// (`UNTRUSTED_OPEN`/`UNTRUSTED_CLOSE`) and `PROMPT_VERSION` are OWNED here; the
// crypto cache-key hash lives in `@necro/llm` and consumes `cacheKeyParts`.
export {
  PROMPT_VERSION,
  UNTRUSTED_OPEN,
  UNTRUSTED_CLOSE,
  neutraliseDelimiters,
  PROMPT_TEMPLATES,
  getTemplate,
  buildMessages,
  cacheKeyParts,
  type PromptPurpose,
  type PromptTemplate,
  type FewShotPair,
  type MessageInputs,
  type PromptMessage,
  type BuiltMessages,
  type CacheKeyInputs,
} from "./prompts/templates.js";

// --- Residual chunking for the Resurrection LLM_Pass (chunk) ---------------
// Pure, adapter-free (imports @necro/oracle `parsePython` only, injected by
// default). `groupResiduals` folds a file's residual diagnostics into per-unit
// `ResidualChunk`s — one per enclosing top-level def/class plus a module-level
// chunk — each carrying ONLY its own diagnostics and a `context` that is a
// strict subset of the file (enclosing unit + referenced import lines), never
// the whole file (R11.1-R11.3).
export {
  groupResiduals,
  type ResidualChunk,
  type ParseFn,
} from "./chunk/residual-chunk.js";

// --- Per-file diff and unified-patch generation (diff) ---------------------
// Pure, adapter-free. `lineDiff` produces a `DiffLine[]` per file (R7.1/R7.2);
// `buildPatch` emits a single round-tripping unified-diff over the validated,
// changed files only (R7.3–R7.5, R7.7).
export { lineDiff, buildPatch } from "./diff.js";

// --- Candidate_File selection (select) -------------------------------------
// Pure, adapter-free. `selectCandidates` derives the ascending-by-path
// Candidate_Files a Ritual processes from a completed reading and a parsed
// `ResurrectTarget`, applying the py2-evidence rule and the 1 MB / 50-file /
// repo-size guards (R1.2-R1.5, R2.1-R2.2, R2.5-R2.7). It returns the candidate
// set plus the oracle-voice skip-notes the runner streams.
export {
  selectCandidates,
  MAX_CANDIDATES,
  type SelectionResult,
} from "./select.js";

// --- Language_Pair_Registry (registry) -------------------------------------
// The guarded, in-memory pair -> grimoire binding the runner resolves at SELECT
// time, before any sandbox/LLM work. `createDefaultRegistry` is the documented
// registration point for the shipped `python2->python3` grimoire.
export {
  LanguagePairRegistry,
  createDefaultRegistry,
  PYTHON2_TO_PYTHON3,
} from "./registry.js";

// --- Vitality re-diagnosis via snapshot overlay (rediagnose) ---------------
// Pure, adapter-free (imports @necro/oracle only). `rediagnose` overlays the
// validated+changed After_Content into a copy of the summoned RepoSnapshot,
// re-divines it with the same spread via `runReading`, and reports
// before/after vitality, the signed delta, and the changed-card set. On
// post-reading failure it returns a typed REDIAGNOSIS_FAILED error with
// after/delta nulled, never discarding the produced File_Results (R6.1–R6.5).
export { rediagnose, changedCards, type RediagnoseResult } from "./rediagnose.js";

// --- Cross-sink secret masking (mask) --------------------------------------
// Pure, adapter-free (imports @necro/oracle `maskSecret` only). The runner
// routes every file's content, residual text, skip-note, and ledger entry
// through `maskSecretsInText` before it reaches any sink so no raw secret
// survives (R12.3, R13.2); `maskContentItem` masks one item and throws the
// typed `maskFailedError` when masking cannot complete, so the runner can
// WITHHOLD that item from every sink rather than leak it (R12.4).
export {
  maskSecretsInText,
  maskContentItem,
  maskFailedError,
} from "./mask.js";

// --- Local Coven_Runner (runners/local) ------------------------------------
// The central orchestration module: drives one Ritual through
// SELECT -> PRE_PASS -> LLM_PASS -> VALIDATE -> REDIAGNOSE -> DIFF via a
// monotonic `emit`, injecting `RitualPorts`. Imports @necro/oracle + local
// modules only — no grimoire package (the grimoire arrives through the injected
// `LanguagePairRegistry`) and no adapter (adapters come via ports). It skips
// LLM_PASS in Degraded_Mode with exactly one oracle-voice skip-note, falls back
// to the Target_Parser when the optional SandboxPort is unavailable, enforces a
// wall-clock budget that ends the Ritual with partial File_Results and a
// BUDGET_EXHAUSTED error, and appends append-only, increasing-`seq` ledger
// events.
export {
  LocalCovenRunner,
  budgetExhaustedError,
  asCovenError,
  RESURRECTION_PHASES,
  type ResurrectionPhase,
  type PhaseEmit,
  type CovenRunner,
  type CovenRunnerOptions,
  type RitualOutcome,
} from "./runners/local.js";

// --- Optional Inngest Coven_Runner (runners/inngest) -----------------------
// The OPTIONAL enhancement selected ONLY WHERE the Inngest env is configured
// (R10.2). It wraps the LocalCovenRunner and drives the identical phase
// pipeline, but moves the long-running sandbox parse-check onto Inngest as a
// background step kicked off and then POLLED with `step.sleep`, each step
// idempotent on `(ritualId, phase)`. On a failed/stalled background poll it
// ends the Ritual, disposes the sandbox, and returns the partial File_Results
// through `RitualOutcome.error` (R10.5), never discarding them. The `inngest`
// SDK is an optional peer loaded via a dynamic import only WHERE configured;
// `createInngestCovenRunner` returns `undefined` otherwise, keeping the
// default/local path free of any Inngest dependency.
export {
  InngestCovenRunner,
  createInngestCovenRunner,
  isInngestConfigured,
  type InngestConfig,
  type InngestClientLike,
  type InngestStepTools,
} from "./runners/inngest.js";

// --- Demo_Mode wiring (demo/*) ---------------------------------------------
// The browser-safe Demo_Mode seam (design: "Demo mode"; R14.2, R14.3, R14.4,
// R14.6). The NODE-ONLY fixture loader (`loadDemoRitualInput`) lives behind the
// package's "./node" subpath so this barrel stays `fs`-free; what ships here is
// the pure wiring the route composes:
//   - `[DEMO]` line labelling applied once at the server emit layer (R14.3):
//     `demoEmit` wraps a `PhaseEmit` to prefix the runner's free-text
//     skip-notes; `prefixDemoLine`/`DEMO_PREFIX` label every other serialized
//     stream line (phase, terminal) so each line carries exactly one `[DEMO]`.
//   - `createDemoPorts` assembles the demo `RitualPorts` from the injected Mock
//     `LlmPort` with the sandbox omitted (R14.4); `installNetworkBlockGuard`
//     blocks outbound network for the run with a guard that throws (R14.2).
//   - `demoFixtureMissingError` is the canonical `DEMO_FIXTURE_MISSING` the
//     Node loader raises for a missing/unreadable fixture (R14.6).
export { DEMO_PREFIX, prefixDemoLine, demoEmit } from "./demo/prefix.js";
export {
  createDemoPorts,
  installNetworkBlockGuard,
  demoNetworkBlockedError,
  type DemoPortsInput,
} from "./demo/ports.js";
export { demoFixtureMissingError } from "./demo/errors.js";

// --- The Lovers (VI) binding data models (lovers/types) --------------------
// The canonical, adapter-free zod contracts for the Lovers grimoire (design
// C.2 "Lovers grimoire schemas", C.2a "Pinned JSON-lines protocol", C.4
// "LoversRunner"). `LoversPairLlmSchema` is the GENERATE LLM output (jsBeloved +
// contractSchema + pythonTests + jsTests, NO heart); `LoversPairSchema` extends
// it with the deterministically-emitted `pythonHeart` (identical on both the
// llm and template paths). `UsageAggregateSchema` is a STRUCTURAL MIRROR of
// `@necro/llm`'s owning schema so coven never depends on the llm adapter.
export {
  LOVERS_LANGUAGE_PAIR,
  MAX_BINDABLE,
  JsonTypeSchema,
  type JsonType,
  UsageAggregateSchema,
  type UsageAggregate,
  LoversParamSchema,
  type LoversParam,
  LoversReturnsSchema,
  type LoversReturns,
  LoversFunctionSchema,
  type LoversFunction,
  LoversTypeMapEntrySchema,
  type LoversTypeMapEntry,
  LoversPlanSchema,
  type LoversPlan,
  LoversPairLlmSchema,
  type LoversPairLlm,
  LoversPairSchema,
  type LoversPair,
  ContractSchema,
  type Contract,
  parseContract,
  LoversResultSchema,
  type LoversResult,
} from "./lovers/types.js";

// --- Deterministic PLAN extraction for the Lovers binding (lovers/extract) -
// Pure, adapter-free (imports @necro/oracle `parsePython` only, injected by
// default — mirrors `residual-chunk.ts`'s `ParseFn` pattern). `extractPlan`
// reads the top-level `function_definition` nodes of the RESURRECTED Python 3
// source into a `LoversPlan` (params/returns/bindable/edgeCases/typeMap),
// capping bindable functions at `MAX_BINDABLE` (8) and rejecting input over
// `MAX_SOURCE_BYTES` (32768) with a `{ ok:false, reason }` oracle-voice signal
// so the runner/route can skip the model call (design C.2 / C.4).
export {
  extractPlan,
  MAX_SOURCE_BYTES,
  type ExtractPlanResult,
  type ParseFn as LoversParseFn,
} from "./lovers/extract-plan.js";

// --- Static deny-list scan for the Lovers binding (lovers/deny-list) -------
// Pure, adapter-free static source scan (design C.3a). `denyScan(code, lang)`
// returns the first offending construct (eval/Function/exec, network, fs
// write/delete, os.system, child_process beyond a single spawn of the python
// heart) or `null` when clean. The Lovers gate (`validateLovers`) runs it over
// every generated artifact and rejects a hit WITHOUT executing the code
// (R17.7, R17.8). It never imports an adapter and never runs the scanned code.
export { denyScan, type DenyScanLang } from "./lovers/deny-list.js";

// --- The LoversRunner (lovers/runner) --------------------------------------
// Drives one Lovers (VI) binding through PLAN -> GENERATE -> VALIDATE -> EMIT
// (design C.4). Adapter-free: the `LlmPort`/`ModelRouterPort`/cache arrive via
// the injected `LoversPorts`, and the grimoire capabilities (the two `LlmStep`s,
// the deterministic `ast-bridge`, and `validateLovers`) arrive via the injected
// `LoversGrimoirePort` — coven never imports a grimoire or `@necro/llm`. It
// computes `extractPlan` first (R16.6 precondition), applies the ONE unified
// retry policy under a single-request deadline (A.8), ALWAYS emits the
// deterministic `pythonHeart` (item 3), falls back to the AST-template bridge
// with `path: "template"`, and folds usage with the coven-local `sumUsage`.
export {
  LocalLoversRunner,
  LOVERS_PHASES,
  type LoversRunner,
  type LoversRunnerInput,
  type LoversRunnerOptions,
  type LoversEmit,
  type LoversPhase,
  type LoversGrimoirePort,
  type LoversGateParseFn,
  type LoversValidateSchemaFn,
  type LoversDenyScanFn,
  type LoversValidateResult,
} from "./lovers/runner.js";
