// apps/web/src/protocol/stream.ts
//
// The NDJSON stream line schemas of the Reading_Route (design D13,
// "Streamed progress and time budgets"). The route body is one JSON object per
// line: each non-final line is a Progress_Event (a phase line) or a skip-note
// line; the final line is either `{ result: Reading_Response }` or
// `{ error: Error_Envelope }`. Only the result line carries a validated
// Reading_Response.
//
// `StreamLineSchema` is the union every decoded line is validated against,
// server-side before writing and client-side before rendering (see
// `terminal/ndjson.ts`).
//
// _Requirements: R6.14, R6.18, R12.1, R12.3_

import { z } from "zod";

import { ErrorEnvelopeSchema, ReadingResponseSchema } from "./schemas.js";

/** The four ordered Reading_Phases surfaced to the client (D14). */
export const ReadingPhaseSchema = z.enum([
  "SUMMON",
  "DOWNLOAD",
  "EXTERNAL",
  "READING",
]);

/** A phase progress line: `{ phase }`. */
export const PhaseLineSchema = z.object({ phase: ReadingPhaseSchema }).strict();

/** A skip-note line: `{ skip: true, note }` with a 1..2000 char note. */
export const SkipNoteLineSchema = z
  .object({ skip: z.literal(true), note: z.string().min(1).max(2000) })
  .strict();

/** The final result line: `{ result }` wrapping a validated Reading_Response. */
export const ResultLineSchema = z
  .object({ result: ReadingResponseSchema })
  .strict();

/** The final error line: `{ error }` reusing the Error_Envelope error object. */
export const ErrorLineSchema = z
  .object({ error: ErrorEnvelopeSchema.shape.error })
  .strict();

/** The union of every valid NDJSON line of the Reading_Route stream. */
export const StreamLineSchema = z.union([
  PhaseLineSchema,
  SkipNoteLineSchema,
  ResultLineSchema,
  ErrorLineSchema,
]);

export type StreamLine = z.infer<typeof StreamLineSchema>;
