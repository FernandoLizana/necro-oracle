// apps/web/src/protocol/resurrect-wire.ts
//
// The BROWSER-SAFE wire schemas of the Resurrection_Route NDJSON stream, for
// the browser API client (`terminal/api-client.ts`) to validate each decoded
// line against before rendering (design: "Resurrection NDJSON additions";
// R9.5, R9.6).
//
// Why a second schema beside `resurrect-stream.ts`? `resurrect-stream.ts` is
// the SERVER's source of truth and imports `RitualResultSchema` directly from
// `@necro/coven`, whose package barrel pulls in node-only modules (the local /
// Inngest runners, `@necro/oracle` main). Importing it into the browser bundle
// would violate the client boundary (R16.4) and blow the terminal route's JS
// budget. This module restates the same wire shape in PURE zod — no
// `@necro/coven`, no `@necro/oracle` main — exactly as `stream.ts`/`schemas.ts`
// restate the reading-route shapes for the browser. It is kept in lockstep with
// the `@necro/ui-crt` `RitualResponse` type (the terminal's render contract) by
// the compile-time conformance assertion at the bottom of this file; the server
// keeps `resurrect-stream.ts` in lockstep with the coven source of truth, so a
// drift on either side fails typecheck.
//
// The result line's leaves are only strings, numbers, booleans and enums —
// there is no `cause`, stack, or free-form error object that could carry a
// secret value — so the shape is redaction-safe by construction, and every
// error that reaches the client is the two-field `ErrorLineSchema` envelope.
//
// _Requirements: R9.1, R9.2, R9.3, R9.5, R9.6, R12.1_

import type { RitualResponse } from "@necro/ui-crt";
import { z } from "zod";

import { ErrorEnvelopeSchema } from "./schemas.js";

/** The six ordered Resurrection_Phases surfaced to the client (R9.2). */
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

/** A skip-note line: `{ skip: true, note }` (identical to the reading stream). */
export const ResurrectSkipNoteLineSchema = z
  .object({ skip: z.literal(true), note: z.string().min(1).max(2000) })
  .strict();

/** The final error line: `{ error }` reusing the Error_Envelope error object. */
export const ResurrectErrorLineSchema = z
  .object({ error: ErrorEnvelopeSchema.shape.error })
  .strict();

// --- The RitualResult wire shape (pure-zod mirror of @necro/coven) ---------

/** One line of a per-file before/after diff (mirrors coven `DiffLine`). */
export const WireDiffLineSchema = z
  .object({
    kind: z.enum(["add", "remove", "context"]),
    text: z.string(),
  })
  .strict();

/** One unconverted construct left behind (mirrors coven `ResidualEntry`). */
export const WireResidualSchema = z
  .object({
    path: z.string().min(1),
    line: z.number().int().nonnegative(),
    construct: z.string().min(1),
    reason: z.enum([
      "parse_failed",
      "no_transform",
      "llm_unavailable",
      "llm_invalid_output",
      "output_unparseable",
      "not_validated",
      "incomplete",
    ]),
  })
  .strict();

/** One file's resurrection outcome (mirrors coven `FileResult`). */
export const WireFileResultSchema = z
  .object({
    path: z.string().min(1),
    before: z.string(),
    after: z.string(),
    diff: z.array(WireDiffLineSchema),
    residuals: z.array(WireResidualSchema),
    fullyConverted: z.boolean(),
    validated: z.boolean(),
  })
  .strict();

/** One changed-card entry (mirrors coven `ChangedCard`). */
export const WireChangedCardSchema = z
  .object({
    card: z.string(),
    change: z.enum(["added", "removed", "severity", "orientation"]),
    improved: z.boolean(),
  })
  .strict();

/**
 * The redaction-safe wire form of a `RitualResult`, pure-zod mirror of the
 * `@necro/coven` `RitualResultSchema`. The client re-validates the result line
 * against this before resolving (R9.3, mirroring how the reading client
 * re-validates against `ReadingResponseSchema`).
 */
export const RitualResultWireSchema = z
  .object({
    ritualId: z.string().uuid(),
    selectedCount: z.number().int().nonnegative(),
    files: z.array(WireFileResultSchema),
    patch: z.string(),
    beforeVitality: z.number().int().min(0).max(100),
    afterVitality: z.number().int().min(0).max(100).nullable(),
    vitalityDelta: z.number().int().nullable(),
    changedCards: z.array(WireChangedCardSchema),
    degraded: z.boolean(),
    demo: z.boolean(),
  })
  .strict();

/** The final result line: `{ result }` wrapping a validated `RitualResult`. */
export const ResurrectResultLineSchema = z
  .object({ result: RitualResultWireSchema })
  .strict();

/** The union of every valid NDJSON line of the Resurrection_Route stream. */
export const ResurrectStreamLineSchema = z.union([
  ResurrectPhaseLineSchema,
  ResurrectSkipNoteLineSchema,
  ResurrectResultLineSchema,
  ResurrectErrorLineSchema,
]);

export type ResurrectStreamLine = z.infer<typeof ResurrectStreamLineSchema>;

// --- Compile-time conformance with the @necro/ui-crt render contract (D2) --
// The browser client resolves with the `@necro/ui-crt` `RitualResponse`, so the
// wire schema's inferred type must be assignable to it: the terminal renders a
// (super)set of the validated fields. This fails typecheck if the wire shape
// drops a field the render contract needs. Type-level only; erases at runtime.
const _wire: RitualResponse = {} as z.infer<typeof RitualResultWireSchema>;
void _wire;
