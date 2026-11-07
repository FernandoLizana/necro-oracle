// @necro/grimoires-lovers-js — the GENERATE LlmStep (step 2, design C.2 "lovers.generate").
//
// Step 2 of the Lovers binding: a ROUTED model (started FAST, escalated to
// STRONG by the runner's router on a validation failure) turns the validated
// {@link LoversPlan} + the pinned JSON-lines protocol spec into a
// {@link LoversPairLlm} — the FOUR artifacts `jsBeloved`, `contractSchema`,
// `pythonTests`, `jsTests`. It NEVER produces `pythonHeart`: the JSON-lines
// dispatcher heart is mechanical and is ALWAYS emitted deterministically by
// `ast-bridge` (task 8.3), so `outputSchema` is `LoversPairLlmSchema` (no
// heart), not `LoversPairSchema`.
//
// Declarative + adapter-free, exactly like `plan.ts`: `buildRequest` DELEGATES
// to the ONE shared templates source of truth via
// `buildMessages("lovers.generate", …)` (R43.9), filling the trusted
// `validatedPlanJson` slot and the untrusted `protocolSpec` slot (neutralised +
// wrapped — exactly one marker pair, R8.2). The runner performs the injected
// `LlmPort` call; the grimoire imports `@necro/coven` + `@necro/oracle` only.

import {
  buildMessages,
  LoversPairLlmSchema,
  LOVERS_LANGUAGE_PAIR,
  type LlmConstructInput,
  type LlmRequest,
  type LlmStep,
  type LoversPairLlm,
} from "@necro/coven";
import { maskSecret } from "@necro/oracle";
import { createHash } from "node:crypto";

/**
 * HARD token cap for the GENERATE unit (design C.2). The four artifacts can be
 * sizeable; this caps the completion so a routed call stays within budget.
 */
export const MAX_TOKENS_HARD_CAP = 6144 as const;

/** Per-generate timeout in milliseconds (design A.8 GENERATE perCallCap is 45 s). */
const TIMEOUT_MS = 45_000;

/**
 * The pinned JSON-lines protocol spec (design C.2a) handed to the model as the
 * UNTRUSTED `protocolSpec` slot. It is fixed Oracle-authored text describing the
 * wire, not repository data — but it travels in the untrusted slot so the model
 * treats it uniformly as data, and it is neutralised/wrapped like any source.
 */
const PROTOCOL_SPEC =
  'One JSON object per line. Request: {"id":int,"fn":str,"args":{paramName:value}}. ' +
  'Response: {"id":int,"ok":true,"value":any} on success, or ' +
  '{"id":int,"ok":false,"error":{"type":str,"message":str}} on failure. ' +
  "The Python heart reads one request object per stdin line and writes one " +
  "response object per stdout line (json.dumps with ensure_ascii=False, " +
  "allow_nan=False, compact separators, then flush); user stdout during a call " +
  "is redirected to stderr; EOF exits 0. The heart is ALREADY generated — do " +
  "not write it. Write only the JavaScript beloved, the contract schema, the " +
  "python tests, and the js tests.";

/**
 * Content-addressed cache key: sha256 over the pair id, the validated plan
 * JSON, and the built prompt. The prompt carries only the MASKED plan JSON and
 * the fixed protocol spec, so the key never contains a raw secret (R5.3).
 */
function deriveCacheKey(planJson: string, prompt: string): string {
  return createHash("sha256")
    .update(LOVERS_LANGUAGE_PAIR)
    .update("\u0000")
    .update(planJson)
    .update("\u0000")
    .update(prompt)
    .digest("hex");
}

/**
 * Build the GENERATE request the runner sends through the injected `LlmPort`.
 *
 * For this step `input.construct` carries the validated plan JSON (the trusted
 * `validatedPlanJson` slot) and `input.source` is unused as source — the
 * untrusted slot is the fixed {@link PROTOCOL_SPEC}. The plan JSON is masked
 * before it enters the prompt (defence in depth; the plan is Oracle-derived but
 * may echo repository identifiers — R12.3). Delegates to
 * `buildMessages("lovers.generate", …)` so the prompt text has one source of
 * truth; sets the HARD token cap, timeout, cache key, and PROMPT_VERSION stamp.
 */
function buildRequest(input: LlmConstructInput): LlmRequest {
  const planJson = maskSecret(input.construct);
  const built = buildMessages("lovers.generate", {
    untrustedSource: PROTOCOL_SPEC,
    slots: { validatedPlanJson: planJson },
  });
  const prompt = built.user;
  return {
    system: built.system,
    prompt,
    maxTokens: MAX_TOKENS_HARD_CAP,
    timeoutMs: TIMEOUT_MS,
    cacheKey: deriveCacheKey(planJson, prompt),
    promptVersion: built.promptVersion,
  };
}

/**
 * Apply the validated pair deterministically. The GENERATE step produces the
 * four LLM artifacts; `apply` serialises the parsed `LoversPairLlm` back to its
 * canonical JSON so the `LlmStep<T>.apply` contract stays total (the runner
 * consumes the parsed value and then assembles the full pair with the
 * deterministic heart via `ast-bridge`).
 */
function apply(_source: string, parsed: LoversPairLlm): string {
  return JSON.stringify(parsed);
}

/**
 * Deterministic Mock provider output (R4.7, R4.8): a schema-valid
 * {@link LoversPairLlm} with placeholder-but-parseable artifacts and NO
 * `pythonHeart`. A pure function of `input` — repeated calls are byte-identical
 * and the Mock path needs no network. The strings are intentionally minimal
 * stubs; the real artifacts come from a live routed call or the deterministic
 * `ast-bridge` template path (task 8.3).
 */
function mockFixture(_input: LlmConstructInput): string {
  const pair: LoversPairLlm = {
    jsBeloved:
      "// mock beloved\n" +
      "export function close() {}\n",
    contractSchema: JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $defs: {},
    }),
    pythonTests: "import unittest\n\n# mock python tests\n",
    jsTests: 'import test from "node:test";\n\n// mock js tests\n',
  };
  return JSON.stringify(pair);
}

/**
 * The GENERATE step (step 2). Wired into the grimoire `llm.generate` field in
 * `src/index.ts`. The runner supplies the `LlmPort` and routes the model
 * (FAST->STRONG on failure); the prompt TEXT comes from the shared
 * `@necro/coven` templates module (the ONE source of truth).
 */
export const GENERATE_STEP: LlmStep<LoversPairLlm> = {
  outputSchema: LoversPairLlmSchema,
  buildRequest,
  apply,
  mockFixture,
};
