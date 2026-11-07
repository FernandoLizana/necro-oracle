// @necro/llm — strict structured-output parsing + request-field assembly
// (R7.1, R7.2, R7.3, R7.4, R43.2, R43.3, R43.4, R43.5).
//
// Two concerns live here, both PURE (no network — the OpenRouter provider in
// task 4.1 does the fetch; here we only shape the request fields it sends and
// parse the text it returns):
//
//   1. `parseStructured(text, schema)` — turn raw model text into a validated
//      value. The primary path is a strict `json_schema` response, but models
//      sometimes wrap the JSON in prose or markdown fences, so we extract the
//      FIRST balanced JSON object from the text and then `schema.safeParse` it.
//      On any failure it returns `{ ok: false, error }` carrying the EXACT zod
//      error string — it NEVER throws. The caller (runner) issues the single
//      unified retry (design A.8) carrying that error, then falls back to the
//      deterministic path; the retry/fallback policy is NOT this module's job.
//
//   2. `structuredRequestFields(...)` — assemble the structured-output request
//      parts the provider puts on the wire: `response_format.json_schema`
//      (strict, generated from the zod schema), `provider.require_parameters`
//      (sent ONLY together with `response_format`/`temperature`/`max_tokens`),
//      `temperature` (EXACTLY 0), and `max_tokens`. It DOES NOT include a
//      `seed` field — no Claude endpoint supports `seed` and
//      `require_parameters:true` would then exclude the STRONG tier; determinism
//      comes from `temperature = 0` plus the content-hash completion cache.
//
//   3. `usageRecordFromResponse(...)` — build a `UsageRecord` from an OpenRouter
//      chat response: cost is read from `usage.cost` (OpenRouter returns cost
//      directly on the usage object; we do NOT send the deprecated
//      `usage: { include: true }`), and the SERVED model is taken from
//      `response.model` (which may differ from the requested model when a
//      fallback endpoint answered).

import type { ZodType } from "zod";

import {
  UsageRecordSchema,
  type UsageRecord,
} from "../usage/accounting.js";
import {
  toStrictJsonSchema,
  type StrictJsonSchema,
} from "./zod-to-schema.js";

// ---------------------------------------------------------------------------
// 1. parseStructured
// ---------------------------------------------------------------------------

/** Success / failure union returned by {@link parseStructured}; never thrown. */
export type ParseStructuredResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/**
 * Extract the first balanced top-level JSON object from `text`, tolerating
 * surrounding prose and ```json code fences. Scans for the first `{`, then
 * walks forward tracking brace depth while respecting string literals and
 * escapes, and returns the substring through the matching `}`. Returns
 * `undefined` if no balanced object is present.
 *
 * Pure and allocation-light: a single left-to-right pass, no regex backtracking.
 */
export function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  // Unbalanced: opening brace without a matching close.
  return undefined;
}

/**
 * Parse `text` into a value validated by `schema`. Extracts the first balanced
 * JSON object (handling models that wrap JSON in prose or markdown fences),
 * `JSON.parse`s it, then runs `schema.safeParse`.
 *
 * Returns `{ ok: true, value }` on success, or `{ ok: false, error }` on ANY
 * failure (no JSON object found, invalid JSON, or zod validation failure). On a
 * zod failure the `error` is the exact `ZodError` message so the caller's single
 * repair retry (design A.8) can carry it verbatim.
 *
 * NEVER throws: all failure modes are folded into the `ok: false` branch.
 */
export function parseStructured<T>(
  text: string,
  schema: ZodType<T>,
): ParseStructuredResult<T> {
  const json = extractFirstJsonObject(text);
  if (json === undefined) {
    return { ok: false, error: "no balanced JSON object found in model output" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: `invalid JSON: ${message}` };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, value: result.data };
}

// ---------------------------------------------------------------------------
// 2. structuredRequestFields
// ---------------------------------------------------------------------------

/**
 * The structured-output request parts the OpenRouter provider merges into its
 * chat body. `temperature` is literal `0`, `provider.require_parameters` is
 * literal `true`, and there is intentionally NO `seed` field on this type — the
 * absence is part of the contract (see module header / design A.2 note).
 */
export interface StructuredRequestFields {
  /** Strict structured output; generated from the step's zod schema. */
  readonly response_format: {
    readonly type: "json_schema";
    readonly json_schema: StrictJsonSchema;
  };
  /**
   * Require every listed parameter: a fallback endpoint that cannot honour the
   * schema is skipped rather than silently ignoring it. Sent ONLY together with
   * `response_format`, `temperature`, and `max_tokens`.
   */
  readonly provider: { readonly require_parameters: true };
  /** EXACTLY 0 for every purpose: determinism = temperature 0 + cache. */
  readonly temperature: 0;
  /** Per-purpose token ceiling (design A.5 max_tokens formula). */
  readonly max_tokens: number;
}

/**
 * Assemble the structured-output request fields the provider sends on the wire.
 *
 * Builds `response_format.json_schema` from the zod `schema` (strict form via
 * {@link toStrictJsonSchema}), pairs it with `provider.require_parameters:true`,
 * `temperature: 0`, and the given `maxTokens`. It DOES NOT emit a `seed` field —
 * the returned object has no `seed` key, by design.
 *
 * `schemaName` is the structured-output schema name (matches the per-purpose
 * output schema name in the prompt catalogue). Pure.
 */
export function structuredRequestFields(
  schemaName: string,
  schema: ZodType<unknown>,
  maxTokens: number,
): StructuredRequestFields {
  return {
    response_format: {
      type: "json_schema",
      json_schema: toStrictJsonSchema(schemaName, schema),
    },
    provider: { require_parameters: true },
    temperature: 0,
    max_tokens: maxTokens,
  };
}

// ---------------------------------------------------------------------------
// 3. usageRecordFromResponse
// ---------------------------------------------------------------------------

/**
 * The minimal shape of an OpenRouter chat completion response this module reads
 * to build a {@link UsageRecord}. Only the fields we consume are modelled; the
 * provider parses the full response and passes this subset in.
 */
export interface OpenRouterUsageResponse {
  /** The model OpenRouter ACTUALLY served (may differ from the requested id). */
  readonly model?: string;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    /** Dollar cost OpenRouter returns directly on the usage object. */
    readonly cost?: number;
  };
}

/**
 * Build a {@link UsageRecord} from an OpenRouter chat response: the SERVED model
 * is `response.model`, and cost is read from `usage.cost` (NEVER from the
 * deprecated `usage: { include: true }` path). Missing numeric fields default to
 * `0`. The record is validated through `UsageRecordSchema` so a malformed /
 * negative value is rejected at this boundary.
 *
 * Pure: no network, no clock.
 */
export function usageRecordFromResponse(
  response: OpenRouterUsageResponse,
): UsageRecord {
  return UsageRecordSchema.parse({
    model: response.model ?? "",
    promptTokens: response.usage?.prompt_tokens ?? 0,
    completionTokens: response.usage?.completion_tokens ?? 0,
    costUsd: response.usage?.cost ?? 0,
  });
}
