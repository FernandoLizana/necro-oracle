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
// Port interfaces (design: "Port interfaces")
// ---------------------------------------------------------------------------

/** A single completion request to a language model. */
export interface LlmRequest {
  readonly system: string; // fixed instruction, oracle-neutral
  readonly prompt: string; // untrusted code wrapped in delimiters
  readonly maxTokens: number; // per-construct token budget (R4.1)
  readonly timeoutMs: number; // per-construct timeout (R4.1)
  readonly cacheKey: string; // sha-256 of (pairId, construct, prompt)
}

export interface LlmResult {
  readonly text: string; // raw model text; caller validates with zod
  readonly cached: boolean;
}

/** The provider port. Mock provider is deterministic and network-free (R4.7, R4.8). */
export interface LlmPort {
  readonly providerId: "mock" | "bedrock" | "anthropic" | "openai";
  complete(req: LlmRequest): Promise<LlmResult>; // throws NecroError on timeout/unavailable
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

export interface Grimoire {
  readonly id: string; // e.g. "py2to3"
  readonly pair: LanguagePairId; // { from: "python2", to: "python3" }
  readonly inputSchema: ZodType<GrimoireInput>;
  readonly outputSchema: ZodType<FileResult>;
  readonly fixers: readonly Fixer[]; // Pre_Pass, in fixed order
  readonly llm: LlmStep<unknown>; // LLM_Pass
  validate(after: string): ValidationResult; // Target_Parser; zero error nodes => valid (R5.1)
  readonly divergenceAllowlist: readonly DivergenceEntry[]; // grimoire-authoring rule
}
