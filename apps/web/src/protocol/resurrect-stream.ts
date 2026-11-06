// apps/web/src/protocol/resurrect-stream.ts
//
// The NDJSON stream line schemas of the Resurrection_Route (design:
// "Resurrection NDJSON additions"). As with the Reading_Route stream
// (`stream.ts`), the route body is one JSON object per line: each non-final
// line is a resurrection phase line or a skip-note line; the final line is
// either `{ result: RitualResult }` or `{ error: { code, userMessage } }`.
// Only the result line carries a validated, redaction-safe `RitualResult`.
//
// This module REUSES `SkipNoteLineSchema` and `ErrorLineSchema` from
// `stream.ts` verbatim — the skip-note and two-field error envelope are
// identical across both streams — and adds only the resurrection-specific
// phase enum and result line.
//
// The result line's wire form is the `@necro/coven` `RitualResultSchema`. That
// schema is redaction-safe by construction: every leaf is a string, number,
// boolean, or enum — there is no `cause`, stack, or free-form error object that
// could carry a secret value. The route masks each line through `redactDeep`
// before writing, and every error that reaches the client is the two-field
// `ErrorLineSchema` envelope (no `cause`). `ResurrectStreamLineSchema` is the
// union every decoded line is validated against, server-side before writing
// and client-side before rendering.
//
// _Requirements: R9.1, R9.5_

import { RitualResultSchema, type RitualResult } from "@necro/coven";
import { z } from "zod";

import { ErrorLineSchema, SkipNoteLineSchema } from "./stream.js";

/** The six ordered Resurrection_Phases surfaced to the client (design: pipeline). */
export const ResurrectionPhaseSchema = z.enum([
  "SELECT",
  "PRE_PASS",
  "LLM_PASS",
  "VALIDATE",
  "REDIAGNOSE",
  "DIFF",
]);

/** A phase progress line: `{ phase }`. */
export const ResurrectPhaseLineSchema = z
  .object({ phase: ResurrectionPhaseSchema })
  .strict();

/**
 * The redaction-safe wire form of a `RitualResult`. It is the `@necro/coven`
 * `RitualResultSchema` reused verbatim: that schema's leaves are only strings,
 * numbers, booleans and enums, so nothing in the shape can carry a secret value
 * or a stack/`cause`. The compile-time assertion below fails typecheck if this
 * schema ever stops inferring exactly the coven `RitualResult` type.
 */
export const RitualResultWireSchema = RitualResultSchema;

/** The final result line: `{ result }` wrapping a validated, redaction-safe `RitualResult`. */
export const ResurrectResultLineSchema = z
  .object({ result: RitualResultWireSchema })
  .strict();

/** The union of every valid NDJSON line of the Resurrection_Route stream. */
export const ResurrectStreamLineSchema = z.union([
  ResurrectPhaseLineSchema,
  SkipNoteLineSchema, // reused from stream.ts verbatim
  ResurrectResultLineSchema,
  ErrorLineSchema, // reused from stream.ts verbatim: { error: { code, userMessage } }
]);

export type ResurrectStreamLine = z.infer<typeof ResurrectStreamLineSchema>;

// --- Compile-time conformance with the @necro/coven RitualResult type ------
// Fails typecheck if the wire schema drifts from the coven data model it
// mirrors. Type-level only; erases at runtime.
const _wire: z.ZodType<RitualResult, z.ZodTypeDef, unknown> =
  RitualResultWireSchema;
void _wire;
