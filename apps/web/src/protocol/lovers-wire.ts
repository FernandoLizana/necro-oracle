// apps/web/src/protocol/lovers-wire.ts
//
// The BROWSER-SAFE wire schemas of the Lovers_Route NDJSON stream, for the
// browser lovers client (`terminal/lovers-client.ts`) to validate each decoded
// line against before rendering (lovers-binding design C.5).
//
// Why a second schema beside `lovers-stream.ts`? `lovers-stream.ts` is the
// SERVER's source of truth and imports `LoversResultSchema` directly from
// `@necro/coven`, whose package barrel pulls in node-only modules (the local /
// Inngest runners, `@necro/oracle` main, tree-sitter). Importing it into the
// browser bundle would violate the client boundary (R16.4) and blow the
// terminal route's JS budget. This module restates the same wire shape in PURE
// zod — no `@necro/coven`, no `@necro/oracle` main — exactly as
// `resurrect-wire.ts` restates the resurrection-route shapes for the browser.
//
// `@necro/ui-crt` does not (yet) export a Lovers render interface, so the
// minimal browser-safe render contract (`LoversResponse`) is declared HERE and
// the ui-crt render path (the lazy `LoversView`) consumes it. The compile-time
// conformance assertion at the bottom keeps the pure-zod wire schema and that
// render contract in lockstep; the server keeps `lovers-stream.ts` in lockstep
// with the coven source of truth (via its own type-level assertion), so a drift
// on either side fails typecheck. When `@necro/ui-crt` later exports its own
// `LoversResponse`, swap the local alias for the imported type and the same
// assertion still holds.
//
// The result line's leaves are only strings, numbers, booleans and enums —
// there is no `cause`, stack, or free-form error object that could carry a
// secret value — so the shape is redaction-safe by construction, and every
// error that reaches the client is the two-field `ErrorLineSchema` envelope.
//
// _Requirements: R19.3, R40.1_

import { z } from "zod";
import type { LoversResponse as UiCrtLoversResponse } from "@necro/ui-crt";

import { ErrorEnvelopeSchema } from "./schemas.js";

/** The four ordered Lovers_Phases surfaced to the client (design C.5). */
export const LoversPhaseSchema = z.enum([
  "PLAN",
  "GENERATE",
  "VALIDATE",
  "BIND",
]);

/** A phase progress line: `{ phase }`. */
export const LoversPhaseLineSchema = z
  .object({ phase: LoversPhaseSchema })
  .strict();

/** A skip-note line: `{ skip: true, note }` (identical to the reading stream). */
export const LoversSkipNoteLineSchema = z
  .object({ skip: z.literal(true), note: z.string().min(1).max(2000) })
  .strict();

/** The final error line: `{ error }` reusing the Error_Envelope error object. */
export const LoversErrorLineSchema = z
  .object({ error: ErrorEnvelopeSchema.shape.error })
  .strict();

// --- The LoversResult wire shape (pure-zod mirror of @necro/coven) ---------

/** A JSON type crossing the contract (mirrors coven `JsonType`). */
const WireJsonTypeSchema = z.enum([
  "string",
  "number",
  "integer",
  "boolean",
  "null",
  "array",
  "object",
]);

/** One planned function parameter (mirrors coven `LoversParam`). */
const WireLoversParamSchema = z
  .object({
    name: z.string().min(1),
    pyType: z.string().min(1),
    jsonType: WireJsonTypeSchema,
    jsType: z.string().min(1),
    required: z.boolean(),
  })
  .strict();

/** The planned return-value type info (mirrors coven `LoversReturns`). */
const WireLoversReturnsSchema = z
  .object({
    pyType: z.string().min(1),
    jsonType: WireJsonTypeSchema,
    jsType: z.string().min(1),
  })
  .strict();

/** One planned function (mirrors coven `LoversFunction`). */
const WireLoversFunctionSchema = z
  .object({
    name: z.string().min(1),
    params: z.array(WireLoversParamSchema),
    returns: WireLoversReturnsSchema,
    bindable: z.boolean(),
    skipReason: z.string().min(1).optional(),
    edgeCases: z.array(z.string()).max(8),
  })
  .strict();

/** One Python->JSON->JS type-mapping row (mirrors coven `LoversTypeMapEntry`). */
const WireLoversTypeMapEntrySchema = z
  .object({
    py: z.string().min(1),
    json: z.string().min(1),
    js: z.string().min(1),
  })
  .strict();

/** The plan the pair was generated from (mirrors coven `LoversPlan`). */
const WireLoversPlanSchema = z
  .object({
    functions: z.array(WireLoversFunctionSchema).min(1).max(8),
    typeMap: z.array(WireLoversTypeMapEntrySchema),
  })
  .strict();

/** The full assembled pair (mirrors coven `LoversPair`). */
const WireLoversPairSchema = z
  .object({
    jsBeloved: z.string().min(1),
    contractSchema: z.string().min(1),
    pythonTests: z.string().min(1),
    jsTests: z.string().min(1),
    pythonHeart: z.string().min(1),
  })
  .strict();

/** One per-model usage subtotal (mirrors coven `UsageAggregate.byModel[]`). */
const WireUsageByModelSchema = z
  .object({
    model: z.string(),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  })
  .strict();

/** The reading-level "souls spent" aggregate (mirrors coven `UsageAggregate`). */
const WireUsageAggregateSchema = z
  .object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
    soulSource: z.enum(["ORACLE", "YOURS"]),
    byModel: z.array(WireUsageByModelSchema).default([]),
  })
  .strict();

/**
 * The redaction-safe wire form of a `LoversResult`, pure-zod mirror of the
 * `@necro/coven` `LoversResultSchema`. The client re-validates the result line
 * against this before resolving (mirroring how the resurrect client
 * re-validates against its `RitualResultWireSchema`).
 */
export const LoversResultWireSchema = z
  .object({
    file: z.string().min(1),
    targetLang: z.literal("javascript"),
    pair: WireLoversPairSchema,
    plan: WireLoversPlanSchema,
    path: z.enum(["llm", "template"]),
    soulsSpent: WireUsageAggregateSchema,
    soulSource: z.enum(["ORACLE", "YOURS"]),
    demo: z.boolean(),
  })
  .strict();

/** The final result line: `{ result }` wrapping a validated `LoversResult`. */
export const LoversResultLineSchema = z
  .object({ result: LoversResultWireSchema })
  .strict();

/** The union of every valid NDJSON line of the Lovers_Route stream. */
export const LoversStreamLineSchema = z.union([
  LoversPhaseLineSchema,
  LoversSkipNoteLineSchema,
  LoversResultLineSchema,
  LoversErrorLineSchema,
]);

export type LoversStreamLine = z.infer<typeof LoversStreamLineSchema>;

// --- The browser render contract (ui-crt owns this) ------------------------
// `@necro/ui-crt` now exports its own browser-safe `LoversResponse` render
// contract (the lovers-binding task 14.4 wiring), so this module re-exports
// THAT type as the client's resolve type rather than declaring a local alias.
// The compile-time assertions below keep the pure-zod wire schema and the
// ui-crt render contract in lockstep in BOTH directions — the server keeps
// `lovers-stream.ts` conformant with the coven source of truth, so a drift on
// any side fails typecheck.
export type { UiCrtLoversResponse as LoversResponse };

// --- Compile-time conformance with the ui-crt render contract (C.5) --------
// The browser client resolves with the wire-schema's inferred (mutable) type,
// and the ui-crt `LoversView` consumes the `readonly` `UiCrtLoversResponse`.
// Assert the wire shape is assignable to that render contract: the view renders
// a (super)set of the validated fields, so a field the view needs but the wire
// drops (or renames) fails typecheck here. A mutable value is assignable to a
// `readonly` target, so only this direction is sound; the server keeps
// `lovers-stream.ts` conformant with the coven source of truth in the other
// direction. Type-level only; erases at runtime.
const _wireToRender: UiCrtLoversResponse = {} as z.infer<
  typeof LoversResultWireSchema
>;
void _wireToRender;
