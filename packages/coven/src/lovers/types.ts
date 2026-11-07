// @necro/coven — The Lovers (VI) binding zod data models.
//
// These are the canonical, adapter-free data-model contracts for the Lovers
// grimoire (design C.2 "Lovers grimoire schemas", C.2a "Pinned JSON-lines
// protocol", C.4 "LoversRunner", "Data Models"). They own the PLAN, the LLM
// GENERATE output, the full assembled pair (which carries the deterministically
// emitted Python heart), the contract helper, and the final result.
//
// Every schema is `.strict()` (no unknown keys survive a boundary). Field
// `.describe(...)` annotations are intentional: the zod->JSON-Schema step
// (design A.5 `toStrictJsonSchema`) reads them to produce a per-field
// `description` that guides the model, so they are part of the contract, not
// documentation noise.
//
// Dependency direction (oracle <- grimoires <- coven <- web; adapters injected
// into coven via ports). `@necro/coven` deliberately does NOT depend on
// `@necro/llm` (its package.json lists only `@necro/oracle` + `zod`), and the
// coven-contracts rule forbids coven importing an adapter. `UsageAggregate` is
// OWNED by `@necro/llm` (`usage/accounting.ts`), so — exactly as `ports.ts`
// already mirrors `UsageRecord`/`RouterSignals`/`ModelTier` structurally rather
// than importing them — the `soulsSpent` aggregate shape is declared
// STRUCTURALLY here as `UsageAggregateSchema` below. It is kept byte-for-byte
// compatible with `@necro/llm`'s `UsageAggregateSchema` (design A.6) so a value
// produced by `sumUsage` validates against this schema unchanged.

import { z } from "zod";

import type { LanguagePairId } from "../models.js";

// ---------------------------------------------------------------------------
// Language pair the Lovers grimoire binds (design C.2).
//
// The pair is parameterized by the canonical `LanguagePairId` (models.ts) so
// the runner/grimoire speak one pair type. Today the only shipped target is
// JavaScript, hence the `targetLang` literal on `LoversResultSchema` below; the
// pair string is the `LanguagePairId` the `lovers-js` grimoire registers
// (task 8.2). Typing the constant as `LanguagePairId` keeps the `->` shape
// checked at the source.
// ---------------------------------------------------------------------------

/** The Lovers language pair id: resurrected Python 3 bound to JavaScript. */
export const LOVERS_LANGUAGE_PAIR: LanguagePairId = "python3->javascript";

/** Hard cap on bindable top-level functions in one binding (design C.2). */
export const MAX_BINDABLE = 8 as const;

/** The JSON types a contract parameter / return value may take (design C.2 / C.2a). */
export const JsonTypeSchema = z
  .enum(["string", "number", "integer", "boolean", "null", "array", "object"])
  .describe("JSON Schema primitive type of the value crossing the contract");

export type JsonType = z.infer<typeof JsonTypeSchema>;

// ---------------------------------------------------------------------------
// Reading-level usage aggregate — STRUCTURAL MIRROR of @necro/llm's
// `UsageAggregateSchema` (design A.6). Declared here so `@necro/coven` never
// imports `@necro/llm`; kept identical to the owning schema so `sumUsage`
// output validates unchanged.
// ---------------------------------------------------------------------------

/** One per-model subtotal row inside a {@link UsageAggregateSchema}. */
const UsageByModelSchema = z
  .object({
    model: z.string().describe("the model id the endpoint actually served"),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  })
  .strict();

/**
 * The reading-level "souls spent" aggregate: summed token/cost totals, the
 * active `soulSource`, and a per-model breakdown whose subtotals sum to the
 * totals. Structurally identical to `@necro/llm`'s `UsageAggregateSchema`
 * (design A.6); mirrored here to preserve the dependency direction.
 */
export const UsageAggregateSchema = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
    soulSource: z.enum(["ORACLE", "YOURS"]),
    byModel: z.array(UsageByModelSchema).default([]),
  })
  .strict();

/** The reading-level usage aggregate (see {@link UsageAggregateSchema}). */
export type UsageAggregate = z.infer<typeof UsageAggregateSchema>;

// ---------------------------------------------------------------------------
// LoversPlanSchema — the deterministic/LLM plan (design C.2, prompt `lovers.plan`).
//
// `functions` is capped at MAX_BINDABLE (>=1, <=8). Each function describes its
// params (Python type, JSON type, JSDoc JS type, required), its return JSON type
// info, whether it is bindable (with an optional skip reason when not), and up
// to 8 concrete edge cases.
// ---------------------------------------------------------------------------

/** One function parameter in a {@link LoversPlanSchema} entry. */
export const LoversParamSchema = z
  .object({
    name: z.string().min(1).describe("parameter name, exactly as in the Python signature"),
    pyType: z.string().min(1).describe("the Python type of the parameter"),
    jsonType: JsonTypeSchema.describe("JSON type the parameter serializes to over the contract"),
    jsType: z.string().min(1).describe("JSDoc type annotation for the JavaScript side"),
    required: z.boolean().describe("true when the parameter has no default and must be supplied"),
  })
  .strict();

export type LoversParam = z.infer<typeof LoversParamSchema>;

/** The return-value type info for a {@link LoversPlanSchema} entry. */
export const LoversReturnsSchema = z
  .object({
    pyType: z.string().min(1).describe("the Python return type"),
    jsonType: JsonTypeSchema.describe("JSON type the return value serializes to over the contract"),
    jsType: z.string().min(1).describe("JSDoc type annotation for the JavaScript return value"),
  })
  .strict();

export type LoversReturns = z.infer<typeof LoversReturnsSchema>;

/** One planned function in a {@link LoversPlanSchema}. */
export const LoversFunctionSchema = z
  .object({
    name: z.string().min(1).describe("top-level function name, exactly as extracted"),
    params: z.array(LoversParamSchema).describe("the function's parameters, in declared order"),
    returns: LoversReturnsSchema.describe("the function's return-value type info"),
    bindable: z
      .boolean()
      .describe(
        "false when a param or return value is not JSON-serializable (bytes, set, object, generator, callable, file handle) or the signature uses *args/**kwargs",
      ),
    skipReason: z
      .string()
      .min(1)
      .optional()
      .describe("when bindable is false, the plain-English reason the function cannot be bound"),
    edgeCases: z
      .array(z.string())
      .max(MAX_BINDABLE)
      .describe("up to 8 concrete edge cases to exercise (e.g. empty list, None, negative int)"),
  })
  .strict();

export type LoversFunction = z.infer<typeof LoversFunctionSchema>;

/** One Python->JSON->JS type-mapping row carried by the plan (design C.2). */
export const LoversTypeMapEntrySchema = z
  .object({
    py: z.string().min(1).describe("the Python type"),
    json: z.string().min(1).describe("the JSON type it maps to"),
    js: z.string().min(1).describe("the JavaScript/JSDoc type it maps to"),
  })
  .strict();

export type LoversTypeMapEntry = z.infer<typeof LoversTypeMapEntrySchema>;

/**
 * The PLAN (design C.2, prompt `lovers.plan`): the list of bindable functions
 * (>=1, <=8) with their cross-language type mapping. Produced either by the
 * FAST LLM step or deterministically by `extractPlan` (task 8.2) as the
 * PLAN-failure fallback.
 */
export const LoversPlanSchema = z
  .object({
    functions: z
      .array(LoversFunctionSchema)
      .min(1)
      .max(MAX_BINDABLE)
      .describe("the bindable top-level functions, in order (at most 8)"),
    typeMap: z
      .array(LoversTypeMapEntrySchema)
      .describe("the Python->JSON->JS type-mapping rows used across the plan"),
  })
  .strict();

export type LoversPlan = z.infer<typeof LoversPlanSchema>;

// ---------------------------------------------------------------------------
// LoversPairLlmSchema — the GENERATE LLM OUTPUT shape (design C.2, prompt
// `lovers.generate`). It MUST NOT contain `pythonHeart`: the JSON-lines
// dispatcher heart is mechanical and is ALWAYS emitted deterministically by
// `ast-bridge` (task 8.3, design item 3), so the LLM produces only the four
// artifacts below.
// ---------------------------------------------------------------------------

export const LoversPairLlmSchema = z
  .object({
    jsBeloved: z
      .string()
      .min(1)
      .describe(
        "Node ESM client that spawns process.env.PYTHON ?? \"python3\" with heart.py, keeps one child, correlates replies by id, exposes close(); JSDoc types + input validation; never reimplements the Python logic",
      ),
    contractSchema: z
      .string()
      .min(1)
      .describe(
        "JSON Schema draft 2020-12, SERIALIZED AS A STRING, with exactly $defs[\"<fn>.request\"] and $defs[\"<fn>.response\"] per bindable function and nothing else",
      ),
    pythonTests: z
      .string()
      .min(1)
      .describe("unittest module calling the heart's handle(request) directly for each function and edge case"),
    jsTests: z
      .string()
      .min(1)
      .describe("node:test + node:assert tests driving jsBeloved end to end"),
  })
  .strict();

export type LoversPairLlm = z.infer<typeof LoversPairLlmSchema>;

// ---------------------------------------------------------------------------
// LoversPairSchema — the FULL assembled pair. It extends the LLM output with
// the deterministically-emitted `pythonHeart` (design C.2). The heart is the
// SAME deterministic JSON-lines dispatcher on both the LLM path and the
// template fallback path; it is never produced by the model.
// ---------------------------------------------------------------------------

export const LoversPairSchema = LoversPairLlmSchema.extend({
  pythonHeart: z
    .string()
    .min(1)
    .describe(
      "the deterministic JSON-lines dispatcher heart emitted by ast-bridge (identical on the llm and template paths); one request object per stdin line -> one response object per stdout line",
    ),
}).strict();

export type LoversPair = z.infer<typeof LoversPairSchema>;

// ---------------------------------------------------------------------------
// ContractSchema — a zod helper/validator for the contract (design C.2a).
//
// The contract travels as a STRING (JSON Schema draft 2020-12 serialized), so
// this is the parse/shape helper for that string rather than the wire shape
// itself (the wire shape is `jsBeloved`'s `contractSchema` string on the pair).
// `ContractSchema` validates the PARSED contract object: it must declare the
// draft 2020-12 `$schema` and carry a `$defs` map keyed EXACTLY by
// `"<fn>.request"` / `"<fn>.response"` per bindable function (design C.2a). The
// per-def shapes are JSON Schema fragments, left as records here; name equality
// between the `$defs` keys and `plan.functions` is enforced by the Lovers gate
// (task 8.4 `validateLovers` via `contractFnNames()`), not by this schema.
// `parseContract` is the string -> validated-object helper.
// ---------------------------------------------------------------------------

/** A single `$defs` fragment (a JSON Schema sub-document). */
const ContractDefSchema = z.record(z.unknown());

/**
 * The PARSED contract object (design C.2a): JSON Schema draft 2020-12 whose
 * `$defs` keys are the `"<fn>.request"`/`"<fn>.response"` pairs. Not `.strict()`
 * on the top level because a JSON Schema document legitimately carries
 * additional standard keywords (`$id`, `title`, `type`, ...); the keys that
 * matter — `$schema` and `$defs` — are pinned, and the exact `$defs` key set is
 * checked against the plan by the gate.
 */
export const ContractSchema = z
  .object({
    $schema: z
      .string()
      .describe("JSON Schema dialect; the draft 2020-12 meta-schema URI")
      .refine((s) => s.includes("2020-12"), {
        message: "contract must declare the JSON Schema draft 2020-12 dialect",
      }),
    $defs: z
      .record(ContractDefSchema)
      .describe('the per-function request/response definitions, keyed "<fn>.request" / "<fn>.response"'),
  })
  .passthrough();

export type Contract = z.infer<typeof ContractSchema>;

/**
 * Parse a serialized contract string (design C.2a) into a validated
 * {@link Contract}. Pure: it only parses JSON and validates shape; it never
 * executes anything. Returns a discriminated result rather than throwing so the
 * Lovers gate (task 8.4) can reject with a typed reason.
 */
export function parseContract(
  serialized: string,
): { ok: true; value: Contract } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (cause) {
    return { ok: false, error: `contract is not valid JSON: ${(cause as Error).message}` };
  }
  const result = ContractSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => i.message).join("; ") };
  }
  return { ok: true, value: result.data };
}

// ---------------------------------------------------------------------------
// LoversResultSchema — the final Lovers result (design C.4).
//
// `targetLang` is the `z.literal("javascript")` shipped today (the `python3->
// javascript` pair above); `soulsSpent` is the reading-level `UsageAggregate`
// (structural mirror above); `path` records whether the accepted pair came from
// the LLM or the deterministic template bridge; `demo` flags the offline Mock
// path.
// ---------------------------------------------------------------------------

export const LoversResultSchema = z
  .object({
    file: z.string().min(1).describe("repo-relative path of the bound file"),
    targetLang: z.literal("javascript").describe("the bound target language (JavaScript today)"),
    pair: LoversPairSchema.describe("the full assembled pair, including the deterministic pythonHeart"),
    plan: LoversPlanSchema.describe("the plan the pair was generated from"),
    path: z
      .enum(["llm", "template"])
      .describe('"llm" when the LLM pair passed validation; "template" when the deterministic bridge was used'),
    soulsSpent: UsageAggregateSchema.describe("tokens + cost + per-model breakdown for this binding"),
    soulSource: z.enum(["ORACLE", "YOURS"]).describe("whose key paid for the binding"),
    demo: z.boolean().describe("true when produced by the offline Mock demo path"),
  })
  .strict();

export type LoversResult = z.infer<typeof LoversResultSchema>;
