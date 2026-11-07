// @necro/grimoires-py2to3 — declarative chunked LLM_Pass step (task 5.4).
//
// Part B (design B.2) sends ONLY a residual CHUNK's diagnostics + minimal
// context to the model and accepts a STRUCTURED edit behind the deterministic
// `acceptChunk` gate (chunk-gate.ts), falling back to the deterministic chunk
// whenever the edit cannot be proven safe. The Coven_Runner drives this step:
// it groups residuals into chunks (`groupResiduals`), routes each chunk, calls
// the injected `LlmPort`, validates with `ChunkEditSchema`, and runs the gate.
//
// This file DESCRIBES that step declaratively — a request builder delegating to
// the shared `py2to3.chunk` template (the ONE source of truth for prompt text,
// design A.4/A.5a), the strict `ChunkEditSchema` as the output schema, the pure
// `acceptChunk` gate as `accept`, and a deterministic `mockFixture`. The
// grimoire stays ADAPTER-FREE (imports `@necro/coven` for the contract +
// templates and `@necro/oracle` for `maskSecret`/`Tree`, plus `node:crypto` for
// the cache key — no `@necro/llm`, no network/process sink).
//
// The runner injects the Python diagnosis rule (oracle `hasLegacyPythonNodes`)
// and the parser (oracle `parsePython`) into `accept`, so the gate stays pure.

import {
  buildMessages,
  PYTHON2_TO_PYTHON3,
  type ChunkRequestInput,
  type ChunkStep,
  type LlmRequest,
} from "@necro/coven";
import { maskSecret } from "@necro/oracle";
import { createHash } from "node:crypto";

import {
  acceptChunk,
  ChunkEditSchema,
  type ChunkEdit,
} from "../chunk-gate.js";

/** Per-chunk token budget (bounded; design A.8 reserves the deadline). */
const MAX_TOKENS = 1_024;

/** Per-chunk timeout in milliseconds — the runner's deadline model overrides it. */
const TIMEOUT_MS = 45_000;

/**
 * Content-addressed cache key for a chunk request (design A.5/A.8 cache key
 * inputs): the purpose/template id, the chunk id, and the built prompt (which
 * already carries the masked context). Identical (purpose, chunk, prompt)
 * triples collapse to one key. Never includes a user key.
 */
function deriveChunkCacheKey(chunkId: string, prompt: string): string {
  return createHash("sha256")
    .update(PYTHON2_TO_PYTHON3)
    .update("\u0000")
    .update("py2to3.chunk")
    .update("\u0000")
    .update(chunkId)
    .update("\u0000")
    .update(prompt)
    .digest("hex");
}

/**
 * Build the chunk request the runner sends through the injected `LlmPort`.
 *
 *   1. `maskSecret` over the chunk context BEFORE it enters the prompt (R4.2):
 *      the runner ALSO masks, so this is belt-and-braces — no raw secret ever
 *      reaches the model or the cache key.
 *   2. DELEGATE to the shared `py2to3.chunk` template via `buildMessages`: it
 *      fills the verbatim USER template, NEUTRALISES any literal marker inside
 *      the masked context (A.9), and wraps it so the built request has EXACTLY
 *      one opening and one closing marker (R8.2). The system prompt is the
 *      verbatim A.5a text, placed first (R5.2).
 *   3. Set `maxTokens`, `timeoutMs`, and the content-addressed `cacheKey`. The
 *      runner overrides `model`/`timeoutMs`/`prompt` (retry error) per A.8.
 */
function buildRequest(input: ChunkRequestInput): LlmRequest {
  const masked = maskSecret(input.context);
  const built = buildMessages("py2to3.chunk", {
    untrustedSource: masked,
    slots: {
      chunkId: input.chunkId,
      residualDiagnosticsList:
        input.residualDiagnostics.length === 0
          ? "- (no diagnostics)"
          : input.residualDiagnostics.map((d) => `- ${d}`).join("\n"),
    },
  });
  const prompt = built.user;
  return {
    system: built.system,
    prompt,
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS,
    cacheKey: deriveChunkCacheKey(input.chunkId, prompt),
  };
}

/**
 * Deterministic Mock provider output (R13.3). The Mock `LlmPort` wires this
 * into its completion so tests and Demo_Mode run with no network.
 *
 * It returns a `ChunkEditSchema`-shaped edit that DECLINES (`confidence: 0`):
 * the Mock never guesses a rewrite, so the gate keeps the deterministic chunk
 * and the Mock path never degrades already-converted code. Pure in `input`, so
 * repeated calls are byte-identical.
 */
function mockFixture(input: ChunkRequestInput): string {
  const edit: ChunkEdit = {
    chunkId: input.chunkId,
    replacementCode: "",
    requiredImports: [],
    reason: "The Mock oracle abstains; the deterministic rites stand.",
    confidence: 0,
  };
  return JSON.stringify(edit);
}

/**
 * The grimoire's declarative CHUNKED LLM step (design B.2). Wired into the
 * grimoire `chunk` field in `src/index.ts`. The runner supplies the `LlmPort` +
 * `ModelRouterPort` and injects the diagnosis/parser into `accept`; the prompt
 * TEXT comes from the shared `@necro/coven` templates (the ONE source of truth).
 */
export const CHUNK_STEP: ChunkStep<ChunkEdit> = {
  outputSchema: ChunkEditSchema,
  buildRequest,
  accept: acceptChunk,
  mockFixture,
};
