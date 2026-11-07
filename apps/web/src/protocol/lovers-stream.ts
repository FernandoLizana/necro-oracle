// apps/web/src/protocol/lovers-stream.ts
//
// The NDJSON stream line schemas of the Lovers_Route (`POST /api/lovers`,
// lovers-binding design C.5). As with the Resurrection_Route stream
// (`resurrect-stream.ts`), the route body is one JSON object per line: each
// non-final line is a Lovers phase line or a skip-note line; the final line is
// either `{ result: LoversResult }` or `{ error: { code, userMessage } }`. Only
// the result line carries a validated, redaction-safe `LoversResult`.
//
// This module REUSES `SkipNoteLineSchema` and `ErrorLineSchema` from
// `stream.ts` verbatim — the skip-note and two-field error envelope are
// identical across every stream — and adds only the lovers-specific phase enum
// and result line.
//
// The result line's wire form is the `@necro/coven` `LoversResultSchema`. Like
// `RitualResultSchema`, that schema is redaction-safe by construction: every
// leaf is a string, number, boolean, or enum — there is no `cause`, stack, or
// free-form error object that could carry a secret value. The route masks each
// line through `redactDeep` before writing, and every error that reaches the
// client is the two-field `ErrorLineSchema` envelope (no `cause`).
// `LoversStreamLineSchema` is the union every decoded line is validated
// against, server-side before writing and client-side before rendering.
//
// _Requirements: R19.3, R40.1_

import { LoversResultSchema, type LoversResult } from "@necro/coven";
import { z } from "zod";

import { ErrorLineSchema, SkipNoteLineSchema } from "./stream.js";

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

/**
 * The redaction-safe wire form of a `LoversResult`. It is the `@necro/coven`
 * `LoversResultSchema` reused verbatim: that schema's leaves are only strings,
 * numbers, booleans and enums, so nothing in the shape can carry a secret value
 * or a stack/`cause`. The compile-time assertion below fails typecheck if this
 * schema ever stops inferring exactly the coven `LoversResult` type.
 */
export const LoversResultWireSchema = LoversResultSchema;

/** The final result line: `{ result }` wrapping a validated, redaction-safe `LoversResult`. */
export const LoversResultLineSchema = z
  .object({ result: LoversResultWireSchema })
  .strict();

/** The union of every valid NDJSON line of the Lovers_Route stream. */
export const LoversStreamLineSchema = z.union([
  LoversPhaseLineSchema,
  SkipNoteLineSchema, // reused from stream.ts verbatim
  LoversResultLineSchema,
  ErrorLineSchema, // reused from stream.ts verbatim: { error: { code, userMessage } }
]);

export type LoversStreamLine = z.infer<typeof LoversStreamLineSchema>;

// --- Compile-time conformance with the @necro/coven LoversResult type ------
// Fails typecheck if the wire schema drifts from the coven data model it
// mirrors. Type-level only; erases at runtime.
const _wire: z.ZodType<LoversResult, z.ZodTypeDef, unknown> =
  LoversResultWireSchema;
void _wire;
