// @necro/grimoires-lovers-js — the PLAN LlmStep (step 1, design C.2 "lovers.plan").
//
// Step 1 of the Lovers binding: a FAST model turns the RESURRECTED Python 3
// module into a strict {@link LoversPlan} — the list of bindable top-level
// functions (>=1, <=8) with their Python->JSON->JS type mapping and edge cases.
// The step is DECLARATIVE: it describes the request, the output schema, the
// deterministic application, and a deterministic Mock fixture; the Coven_Runner
// (not the grimoire) performs the injected `LlmPort` call. The grimoire is
// adapter-free — it imports `@necro/coven` (shared templates + contracts) and
// `@necro/oracle` (`parsePython` via `extractPlan`, `maskSecret`) only, never an
// adapter (R15.6, R15.7).
//
// PROMPT TEXT IS NOT OWNED HERE. Per design A.4/A.5a and R43.9 the `lovers.plan`
// prompt lives in the ONE shared source of truth — `@necro/coven`'s
// `prompts/templates.ts`. `buildRequest` DELEGATES to
// `buildMessages("lovers.plan", …)`: the untrusted slot carries the MASKED
// resurrected source (neutralised + wrapped to exactly one marker pair — R8.2),
// and the trusted `extractedSignatures` slot carries the deterministic
// `extractPlan` signatures. The minimal PLAN context is therefore the
// `extractPlan` output (signatures) + the source, exactly as design C.2 pins.

import {
  buildMessages,
  extractPlan,
  LoversPlanSchema,
  LOVERS_LANGUAGE_PAIR,
  type ExtractPlanResult,
  type LlmConstructInput,
  type LlmRequest,
  type LlmStep,
  type LoversPlan,
} from "@necro/coven";
import { maskSecret } from "@necro/oracle";
import { createHash } from "node:crypto";

/** Per-plan token budget for the FAST model (design A.3; PLAN is a small unit). */
const MAX_TOKENS = 1200;

/** Per-plan timeout in milliseconds (design A.8 PLAN perCallCap is 12 s). */
const TIMEOUT_MS = 12_000;

/**
 * Render the deterministic `extractPlan` signatures into the trusted
 * `extractedSignatures` slot the `lovers.plan` user template expects: one
 * `- name(param, param=…)` line per function, in source order. Required params
 * render bare; optional (defaulted) params render with a trailing `=…`.
 */
function renderSignatures(plan: LoversPlan): string {
  return plan.functions
    .map((fn) => {
      const params = fn.params
        .map((p) => (p.required ? p.name : `${p.name}=…`))
        .join(", ");
      return `- ${fn.name}(${params})`;
    })
    .join("\n");
}

/**
 * Content-addressed cache key: sha256 over the pair id, the extracted
 * signatures, and the built prompt. The prompt already carries the MASKED
 * source, so the key never contains a raw secret (R5.3, R20.4).
 */
function deriveCacheKey(signatures: string, prompt: string): string {
  return createHash("sha256")
    .update(LOVERS_LANGUAGE_PAIR)
    .update("\u0000")
    .update(signatures)
    .update("\u0000")
    .update(prompt)
    .digest("hex");
}

/**
 * Build the PLAN request the runner sends through the injected `LlmPort`.
 *
 * `input.source` is the RESURRECTED Python 3 module. Steps:
 *  1. `maskSecret` over the source BEFORE it enters the prompt (R12.3).
 *  2. Derive the deterministic signatures via `extractPlan` (pure; the oracle
 *     parser is armed by the runner). A rejection (oversized / no bindable fn)
 *     yields empty signatures — the runner enforces the precondition and makes
 *     NO model call in that case; `buildRequest` stays total.
 *  3. DELEGATE to `buildMessages("lovers.plan", …)`: fills the trusted
 *     `extractedSignatures` slot and the untrusted `resurrectedSource` slot
 *     (neutralised + wrapped — exactly one marker pair, R8.2). System prompt is
 *     the verbatim A.5a text.
 *  4. Set `maxTokens`, `timeoutMs`, `cacheKey`, and the PROMPT_VERSION stamp.
 */
function buildRequest(input: LlmConstructInput): LlmRequest {
  const masked = maskSecret(input.source);
  const result: ExtractPlanResult = extractPlan(input.source);
  const signatures = result.ok ? renderSignatures(result.plan) : "";
  const built = buildMessages("lovers.plan", {
    untrustedSource: masked,
    slots: { extractedSignatures: signatures },
  });
  const prompt = built.user;
  return {
    system: built.system,
    prompt,
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS,
    cacheKey: deriveCacheKey(signatures, prompt),
    promptVersion: built.promptVersion,
  };
}

/**
 * Apply the validated plan deterministically. A PLAN step produces the plan
 * itself, so `apply` is the identity on the parsed value serialised back to its
 * canonical JSON — the runner consumes the parsed `LoversPlan`; returning the
 * JSON keeps the `LlmStep<T>.apply(source, parsed): string` contract total and
 * deterministic (identical plan => identical string).
 */
function apply(_source: string, parsed: LoversPlan): string {
  return JSON.stringify(parsed);
}

/**
 * Deterministic Mock provider output (R4.7, R4.8): the `extractPlan` plan over
 * the resurrected source, serialised as the `LoversPlanSchema`-shaped JSON. A
 * pure function of `input` — repeated calls are byte-identical, and the Mock
 * path needs no network. When `extractPlan` rejects the input, the fixture
 * falls back to a minimal single-function plan so the Mock still returns a
 * schema-valid plan (the runner handles the real precondition upstream).
 */
function mockFixture(input: LlmConstructInput): string {
  const result = extractPlan(input.source);
  const plan: LoversPlan = result.ok
    ? result.plan
    : {
        functions: [
          {
            name: "identity",
            params: [
              {
                name: "value",
                pyType: "Any",
                jsonType: "object",
                jsType: "*",
                required: true,
              },
            ],
            returns: { pyType: "Any", jsonType: "object", jsType: "*" },
            bindable: true,
            edgeCases: [],
          },
        ],
        typeMap: [{ py: "Any", json: "object", js: "*" }],
      };
  return JSON.stringify(plan);
}

/**
 * The PLAN step (step 1). Wired into the grimoire `llm.plan` field in
 * `src/index.ts`. The runner supplies the `LlmPort`; the prompt TEXT comes from
 * the shared `@necro/coven` templates module (the ONE source of truth).
 */
export const PLAN_STEP: LlmStep<LoversPlan> = {
  outputSchema: LoversPlanSchema,
  buildRequest,
  apply,
  mockFixture,
};
