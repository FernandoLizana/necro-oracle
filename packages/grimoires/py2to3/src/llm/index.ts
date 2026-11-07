// @necro/grimoires-py2to3 — declarative LLM_Pass step (task 5.1, refactored 2.5).
//
// A grimoire is adapter-free in the I/O sense: it performs no network, LLM, or
// sandbox work. It DESCRIBES its LLM step declaratively — a request builder, an
// output schema, a deterministic application, and a mock fixture — and the
// Coven_Runner (not the grimoire) performs the injected `LlmPort` call.
//
// Prompt text is NOT owned here. Per design A.4/A.5a and R43.9 the prompt text
// for `py2to3.chunk`, `lovers.plan`, and `lovers.generate` lives in ONE shared
// module — `@necro/coven`'s `prompts/templates.ts` (the adapter-free contract
// layer; `@necro/llm` re-exports it through its own barrel). This file
// DELEGATES `buildRequest` to `buildMessages("py2to3.chunk", …)` there so there
// is a single source of truth for prompts. That module is pure, browser-safe
// text assembly (no network/LLM/sandbox, no adapter import), so the grimoire
// stays adapter-free (R15.6, R15.7) — the runner still performs the `LlmPort`
// call.
//
// This file therefore imports:
//   - `@necro/coven`  for the shared prompt templates + delimiter markers (the
//                     ONE source of truth), the `LlmStep` / `LlmConstructInput`
//                     / `LlmRequest` type contracts, and `PYTHON2_TO_PYTHON3`,
//   - `@necro/oracle` for `maskSecret`,
//   - `zod`           for the output schema, and
//   - `node:crypto`   (standard library, not an adapter) for the sha-256 used
//                     to derive the content-addressed `cacheKey`.
//
// Flow (design: LLM_Pass): for each remaining residual the runner builds a
// request via `buildRequest`, calls `ports.llm.complete(req)`, parses the
// result text with `outputSchema` (retry once on zod failure), and applies the
// validated result with `apply`. In tests and Demo_Mode the Mock provider
// returns `mockFixture(input)` deterministically with no network.

import {
  buildMessages,
  PYTHON2_TO_PYTHON3,
  UNTRUSTED_OPEN as COVEN_UNTRUSTED_OPEN,
  UNTRUSTED_CLOSE as COVEN_UNTRUSTED_CLOSE,
  type LlmConstructInput,
  type LlmRequest,
  type LlmStep,
} from "@necro/coven";
import { maskSecret } from "@necro/oracle";
import { createHash } from "node:crypto";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Untrusted-data delimiters (security rule 2: prompt injection)
//
// The marker constants are owned by `@necro/coven`'s `prompts/templates.ts`
// (the single source of truth — R8.2). They are RE-EXPORTED here unchanged so
// that existing importers of these names from the grimoire barrel keep working.
// The Mock provider's `defaultMockText` matches the opening marker's
// `<<<UNTRUSTED_REPOSITORY_CODE` prefix and the closing marker verbatim.
// ---------------------------------------------------------------------------

/** Opening delimiter — marks the start of untrusted repository code. */
export const UNTRUSTED_OPEN = COVEN_UNTRUSTED_OPEN;

/** Closing delimiter — marks the end of untrusted repository code. */
export const UNTRUSTED_CLOSE = COVEN_UNTRUSTED_CLOSE;

/** Per-construct token budget (R4.1). */
const MAX_TOKENS = 512;

/** Per-construct timeout in milliseconds (R4.1). */
const TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Output schema (R4.3)
// ---------------------------------------------------------------------------

/**
 * The validated shape of a model completion for one construct: the converted
 * Python 3 source span. `.strict()` rejects any extra field so a drifting model
 * response fails zod (the runner then retries once, then records an
 * `llm_invalid_output` residual — R4.4).
 */
export const OutputSchema = z
  .object({
    /** The converted Python 3 source for the handed construct. */
    converted: z.string(),
  })
  .strict();

/** The validated per-construct conversion result. */
export type LlmOutput = z.infer<typeof OutputSchema>;

// ---------------------------------------------------------------------------
// cacheKey = sha256(pairId + construct + prompt)  (design: LLM_Pass)
// ---------------------------------------------------------------------------

/**
 * Content-addressed cache key. Identical (pair, construct, prompt) triples
 * collapse to one key, so the shared completion cache is deterministic and
 * network calls are never repeated for the same input. The prompt already
 * carries the masked code, so the key is derived purely from data that never
 * contains a raw secret.
 */
function deriveCacheKey(construct: string, prompt: string): string {
  return createHash("sha256")
    .update(PYTHON2_TO_PYTHON3)
    .update("\u0000")
    .update(construct)
    .update("\u0000")
    .update(prompt)
    .digest("hex");
}

/**
 * Build the request the runner sends through the injected `LlmPort`.
 *
 * Steps (design: LLM_Pass + A.4/A.5a delegation):
 *  1. `maskSecret` over the construct source BEFORE it enters the prompt
 *     (R4.2, R12.3) — no raw secret ever reaches the model or the cache key.
 *  2. DELEGATE to the shared `@necro/coven` templates module via
 *     `buildMessages("py2to3.chunk", …)`: it fills the verbatim `py2to3.chunk`
 *     USER template, NEUTRALISES any literal marker inside the masked source
 *     (A.9) and wraps it so the built request has EXACTLY one opening and one
 *     closing marker (R8.2). The system prompt is the verbatim A.5a text.
 *  3. Set `maxTokens`, `timeoutMs`, and `cacheKey = sha256(pair+construct+prompt)`.
 *
 * The step's own `OutputSchema`/`apply`/`mockFixture` behaviour is unchanged:
 * only the prompt TEXT is now sourced from the shared single source of truth.
 */
function buildRequest(input: LlmConstructInput): LlmRequest {
  const masked = maskSecret(input.source);
  const built = buildMessages("py2to3.chunk", {
    untrustedSource: masked,
    slots: {
      // The existing LlmStep handles one construct per call; the construct id
      // doubles as the chunkId, and its single residual diagnostic line names
      // the construct. These trusted slots are Oracle-derived, never untrusted.
      chunkId: input.construct,
      residualDiagnosticsList: `- ${input.construct}`,
    },
  });
  const prompt = built.user;
  return {
    system: built.system,
    prompt,
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS,
    cacheKey: deriveCacheKey(input.construct, prompt),
  };
}

/**
 * Apply a validated conversion deterministically. `input.source` is the single
 * construct span handed to the step, so the converted replacement IS the new
 * content for that span: `apply` returns it verbatim. This is a pure function
 * of `parsed` — identical validated output always yields identical content.
 *
 * The `source` parameter (the span the runner passed in) is intentionally
 * unused: the model's `converted` field is the authoritative replacement, and
 * returning it unconditionally keeps application deterministic and total.
 */
function apply(_source: string, parsed: LlmOutput): string {
  return parsed.converted;
}

/**
 * Deterministic Mock provider output (R4.7, R4.8). The Mock `LlmPort` wires
 * this string into its completion, so tests and Demo_Mode run with no network.
 *
 * It returns the `OutputSchema`-shaped JSON whose `converted` value is the
 * (unmasked) construct source: the deterministic no-op conversion. This keeps
 * `validate(apply(source, mockOutput))` equal to the Pre_Pass result, so the
 * Mock path never degrades already-converted code. The value is a pure
 * function of `input`, so repeated calls are byte-identical.
 */
function mockFixture(input: LlmConstructInput): string {
  const output: LlmOutput = { converted: input.source };
  return JSON.stringify(output);
}

/**
 * The grimoire's declarative LLM step. Wired into the grimoire `llm` field in
 * `src/index.ts`. The runner supplies the `LlmPort`; the prompt TEXT comes from
 * the shared `@necro/llm` templates module (the ONE source of truth).
 */
export const LLM_STEP: LlmStep<LlmOutput> = {
  outputSchema: OutputSchema,
  buildRequest,
  apply,
  mockFixture,
};
