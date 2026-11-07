// @necro/coven — port interfaces and the adapter-free Grimoire contract.
//
// Ports are the ONLY side-effecting surface the Coven_Runner touches. Fixers and
// the grimoire LLM step receive them as injected parameters and never import an
// adapter module (dependency direction: oracle <- grimoires <- coven; adapters
// are injected through these ports). This file defines the contracts; the
// concrete providers live in @necro/llm, @necro/sandbox, the ledger, etc.
//
// NOTE: the supporting data-model types these port contracts reference
// (`LedgerEvent`, `ResidualEntry`, `LanguagePairId`, `GrimoireInput`,
// `FileResult`, `ValidationResult`, `DivergenceEntry`, `LlmConstructInput`) are
// the canonical zod-inferred types owned by `models.ts` (task 1.2). They are
// imported below rather than redeclared, so there is a single definition and no
// type collision through `src/index.ts`.

import type { Tree } from "@necro/oracle";
import type { ZodType } from "zod";
import type {
  DivergenceEntry,
  FileResult,
  GrimoireInput,
  LanguagePairId,
  LedgerEvent,
  LlmConstructInput,
  ResidualEntry,
  ValidationResult,
} from "./models.js";

// ---------------------------------------------------------------------------
// Structural model-type references (design A.1 / A.3 / A.6)
//
// `UsageRecord`, `RouterSignals`, and `ModelTier` are OWNED by `@necro/llm`
// (`usage/accounting.ts`, `router/`). To preserve the enforced dependency
// direction (oracle <- grimoires <- coven <- web) `@necro/coven` must NOT import
// `@necro/llm`, so these shapes are declared STRUCTURALLY here: the runner and
// the injected `ModelRouterPort` depend only on these coven-owned types. When
// `@necro/llm` later defines its own `UsageRecord`/`RouterSignals`/`ModelTier`
// they are structurally compatible with these pinned shapes (design A.3/A.6).
// ---------------------------------------------------------------------------

/** FAST vs STRONG model tier (structural; design A.3). */
export type ModelTier = "FAST" | "STRONG";

/** Measurable routing signals (structural; design A.3). No side effects. */
export interface RouterSignals {
  readonly tokenEstimate: number; // estimated prompt+completion tokens for the unit
  readonly unresolvedDiagnostics: number; // residual diagnostics carried by the unit
  readonly difficulty: {
    readonly metaclass: boolean;
    readonly unicodeBytes: boolean;
    readonly dynamicImport: boolean;
    readonly crossLangTypeMapping: boolean;
  };
}

/** One LLM call's tokens + cost + the model actually served (structural; design A.6). */
export interface UsageRecord {
  readonly model: string; // the model id the endpoint actually served
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd: number;
}

// ---------------------------------------------------------------------------
// Chunked LLM_Pass structured-edit gate (design B.2).
//
// The deterministic chunk gate (`acceptChunk`) and the `ChunkEditSchema` live
// in the `py2to3` grimoire (adapter-free). The runner must not import a
// grimoire package, so the grimoire exposes its chunk capability through the
// OPTIONAL `Grimoire.chunk` field below, whose `accept` returns this
// coven-owned structural `ChunkGateResult`. The grimoire's own
// `chunk-gate.ts#ChunkGateResult` is byte-compatible with this shape, so the
// concrete `acceptChunk` plugs straight into `ChunkStep.accept`.
// ---------------------------------------------------------------------------

/** Why a chunk edit was rejected (structural mirror of the grimoire's enum). */
export type ChunkRejectReason =
  | "mask_placeholder"
  | "bad_import"
  | "output_unparseable"
  | "no_transform";

/** The chunk gate's typed outcome (structural mirror; design B.2). */
export type ChunkGateResult =
  | { readonly status: "accept"; readonly after: string }
  | { readonly status: "decline" }
  | { readonly status: "reject"; readonly reason: ChunkRejectReason };

/** The injected Python diagnosis rule: true when any Python 2 node remains. */
export type ChunkDiagnoseFn = (tree: Tree) => boolean;

/** The injected Python parser (mirrors `FixerContext.parse`). */
export type ChunkParseFn = (source: string) => Tree;

/**
 * The trusted inputs a chunk request builder needs: the stable `chunkId` the
 * edit must echo, the masked minimal `context` the model sees, and the
 * per-chunk residual diagnostics text. The runner derives these from a
 * `ResidualChunk` (`groupResiduals`) and the builder wraps `context` in the
 * untrusted delimiters via the shared template (purpose `py2to3.chunk`).
 */
export interface ChunkRequestInput {
  readonly chunkId: string;
  readonly path: string;
  readonly context: string; // untrusted repo source (the runner masks it)
  readonly residualDiagnostics: readonly string[]; // trusted, oracle-derived
}

// ---------------------------------------------------------------------------
// Port interfaces (design: "Port interfaces")
// ---------------------------------------------------------------------------

/** A single completion request to a language model. */
export interface LlmRequest {
  readonly system: string; // fixed instruction, oracle-neutral
  readonly prompt: string; // untrusted code wrapped in delimiters
  readonly maxTokens: number; // per-construct token budget (R4.1)
  readonly timeoutMs: number; // per-construct timeout (R4.1)
  readonly cacheKey: string; // sha-256 of (pairId, construct, prompt); never the user key
  readonly model?: string; // ADD (optional): routed model id (R35.1)
  readonly promptVersion?: string; // ADD (optional): PROMPT_VERSION stamp (R35.1)
}

export interface LlmResult {
  readonly text: string; // raw model text; caller validates with zod
  readonly cached: boolean;
  readonly usage?: UsageRecord; // ADD (optional): one call's tokens + cost + served model (R32.2)
}

/**
 * Per-call options. All fields are optional and `readonly`, so every existing
 * caller of `complete(req)` compiles unchanged (design A.1, additive).
 */
export interface LlmCallOptions {
  /** BYOK: the user-supplied key for THIS request only; never stored. */
  readonly apiKey?: string;
  /** Session model override (validated upstream) for THIS request only. */
  readonly modelOverride?: string;
  /** Per-call timeout; its SUM across a request must fit the budget (design A.8). */
  readonly timeoutMs?: number;
}

/** The provider port. Mock provider is deterministic and network-free (R4.7, R4.8). */
export interface LlmPort {
  readonly providerId: "mock" | "bedrock" | "anthropic" | "openai" | "openrouter";
  complete(req: LlmRequest, opts?: LlmCallOptions): Promise<LlmResult>; // throws NecroError on timeout/unavailable
}

/**
 * Pure injected router (design: Resolved decision 7). Keeps the dependency
 * direction `oracle <- grimoires <- coven <- web`: the runners depend only on
 * this coven-owned port type, so `@necro/llm` never imports `@necro/coven`.
 * `composition.ts` builds the concrete implementation from the pure `@necro/llm`
 * router + the tier env models and injects it.
 */
export interface ModelRouterPort {
  /** Pure: pick FAST vs STRONG from measurable signals (R35.4). */
  route(signals: RouterSignals): ModelTier;
  /** Pure: resolve a tier (+ optional validated session override) to a model id (R35.1). */
  resolveModel(tier: ModelTier, override?: { fast?: string; strong?: string }): string;
}

/** Optional parse-only check inside an E2B sandbox (R5.5). Never executes code. */
export interface SandboxPort {
  parseCheckPython3(
    source: string,
    opts: { timeoutMs: number },
  ): Promise<{
    readonly ok: boolean; // true iff `python -m py_compile` style parse passed
  }>;
  dispose(): Promise<void>; // destroy the micro-VM in every terminal state
}

/** Append-only ritual ledger (coven-contracts). State derivable by folding. */
export interface LedgerPort {
  append(event: LedgerEvent): Promise<void>; // strictly increasing seq
}

/** Deterministic time; detectors and budgets never read the ambient clock. */
export interface ClockPort {
  nowMs(): number;
}

/** Everything the runner injects into a Ritual. `llm`/`sandbox` may be absent. */
export interface RitualPorts {
  readonly clock: ClockPort;
  readonly ledger: LedgerPort;
  readonly llm?: LlmPort; // absent => Degraded_Mode (R13.3)
  readonly sandbox?: SandboxPort; // absent => Target_Parser only (R5.7)
  readonly router?: ModelRouterPort; // ADD (optional): injected pure router + resolveModel (R35.4)
}

/**
 * The shared completion cache, as a STRUCTURAL shape (design A.5/A.8). The
 * canonical `LlmCache` is OWNED by `@necro/llm` (`cache.ts`); to preserve the
 * dependency direction (oracle <- grimoires <- coven <- web) `@necro/coven`
 * must NOT import `@necro/llm`, so the Lovers runner depends only on this
 * coven-owned structural mirror. The concrete `createLlmCache()` value is
 * byte-compatible with this shape, so the composition root injects it unchanged.
 *
 * Only outputs that passed BOTH schema AND gate validation are written here
 * (design A.8 "Cache rule"); the runner never caches a rejected or retried
 * output.
 */
export interface LlmCachePort {
  /** Stored completion text for this key, or `undefined` if unseen. */
  get(cacheKey: string): string | undefined;
  /** Store completion text under this key (first write wins). */
  set(cacheKey: string, text: string): void;
}

/**
 * Everything the {@link LoversPorts}-driven Lovers runner injects (design C.4).
 * Unlike {@link RitualPorts} — where `llm`/`router` are optional Degraded_Mode
 * seams — the Lovers binding's PLAN/GENERATE phases REQUIRE a model, so `llm`
 * and `router` are first-class (still optional so the deterministic template
 * path stays reachable with neither, which is also the no-key fallback). The
 * optional `cache` is the shared accepted-output cache (design A.8). There is
 * no `sandbox` port: the Lovers gate parses but never executes (security rule
 * 1), so no micro-VM is needed.
 */
export interface LoversPorts {
  readonly clock: ClockPort;
  readonly ledger: LedgerPort;
  readonly llm?: LlmPort; // the provider (Mock in demo); absent => deterministic template path
  readonly router?: ModelRouterPort; // injected pure router + resolveModel (R35.4)
  readonly cache?: LlmCachePort; // shared accepted-output completion cache (A.8)
}

// ---------------------------------------------------------------------------
// Grimoire interface (design: "Grimoire interface")
//
// A grimoire is adapter-free. Fixers are pure; the LLM step is described
// declaratively (prompt builder + output schema + mock fixture) so the runner —
// not the grimoire — performs the injected `LlmPort` call.
// ---------------------------------------------------------------------------

export interface FixResult {
  readonly after: string; // transformed source
  readonly residuals: ResidualEntry[]; // constructs this fixer could not convert
}

/** A pure fixer: idempotent, preserves string-literal/comment contents. */
export type Fixer = (source: string, ctx: FixerContext) => FixResult;

export interface FixerContext {
  readonly parse: (source: string) => Tree; // injected parsePython
  readonly path: string;
}

/** Declarative LLM step — the runner executes it through the injected LlmPort. */
export interface LlmStep<T> {
  readonly outputSchema: ZodType<T>; // validated before applying (R4.3)
  buildRequest(input: LlmConstructInput): LlmRequest; // wraps code in delimiters (R4.2)
  apply(source: string, parsed: T): string; // deterministic application
  readonly mockFixture: (input: LlmConstructInput) => string; // Mock provider output (R4.8)
}

/**
 * OPTIONAL chunked LLM step (design B.2). A grimoire that supports the Part B
 * chunked LLM_Pass exposes this capability so the runner can drive per-chunk
 * residual diagnostics through the injected `LlmPort` + `ModelRouterPort`,
 * validate the structured `ChunkEdit` with `outputSchema`, and run the pure
 * `accept` gate. It is purely additive: a grimoire without it (every test stub,
 * older callers) keeps the single-tier `LlmStep` path unchanged.
 *
 * `accept` is the grimoire's pure gate (e.g. `acceptChunk`) with the Python
 * diagnosis rule and parser INJECTED by the runner (oracle `hasLegacyPythonNodes`
 * and `parsePython`), so the grimoire stays adapter-free and the gate stays
 * pure and testable.
 */
export interface ChunkStep<T> {
  readonly outputSchema: ZodType<T>; // the strict ChunkEditSchema (R12.1)
  buildRequest(input: ChunkRequestInput): LlmRequest; // minimal AST-sliced context (R5.1/R5.2)
  accept(
    before: string,
    edit: T,
    diagnose: ChunkDiagnoseFn,
    parse: ChunkParseFn,
  ): ChunkGateResult; // the pure deterministic gate (R12.2)
  readonly mockFixture: (input: ChunkRequestInput) => string; // Mock provider output
}

export interface Grimoire {
  readonly id: string; // e.g. "py2to3"
  readonly pair: LanguagePairId; // { from: "python2", to: "python3" }
  readonly inputSchema: ZodType<GrimoireInput>;
  readonly outputSchema: ZodType<FileResult>;
  readonly fixers: readonly Fixer[]; // Pre_Pass, in fixed order
  readonly llm: LlmStep<unknown>; // LLM_Pass (single-tier, legacy path)
  readonly chunk?: ChunkStep<unknown>; // ADD (optional): chunked LLM_Pass (Part B, design B.2)
  validate(after: string): ValidationResult; // Target_Parser; zero error nodes => valid (R5.1)
  readonly divergenceAllowlist: readonly DivergenceEntry[]; // grimoire-authoring rule
}
