// apps/web/src/protocol/schemas.ts
//
// The HTTP wire zod schemas of the summon and readings routes (design D2,
// "Wire schemas"). These are the single boundary where the browser protocol
// is validated on the way in and out of the server.
//
// `@necro/ui-crt` owns the matching plain TypeScript interfaces in
// `src/protocol.ts`; the two must not drift. The compile-time conformance
// assertions at the bottom of this file reproduce the D2 check: if a schema
// here stops inferring exactly the ui-crt interface it mirrors, typecheck
// fails. The ui-crt types are the source of truth — adjust the schema, never
// the interface.
//
// The oracle Reading shape, RepoRef and the NecroError code enum are imported
// through the single permitted Client_Safe_Entry subpath `@necro/oracle/client`
// (D1, R16.3), so nothing here pulls in a Node, tree-sitter, OSV/TOML or any
// other non-browser-safe dependency.
//
// _Requirements: R6.14, R6.18, R12.1, R12.3_

import {
  NecroErrorCodeSchema,
  ReadingSchema,
  RepoRefSchema,
} from "@necro/oracle/client";
import type { ReadingResponse, SummonSummary } from "@necro/ui-crt";
import { z } from "zod";

/** `POST /api/summon` request body: a single repo reference, 1..200 chars. */
export const SummonRequestSchema = z
  .object({ repo: z.string().min(1).max(200) })
  .strict();

/**
 * `POST /api/readings` request body: a commit-pinned ref and one playable
 * spread. The ref is `owner/name@<40-hex-lowercase-sha>`; `celtic` is rejected
 * (Q15 — the server only plays fates/necropsy).
 */
export const ReadingRequestSchema = z
  .object({
    ref: z
      .string()
      .max(200)
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/),
    spread: z.enum(["fates", "necropsy"]),
  })
  .strict();

/**
 * `POST /api/resurrect` request body (design: "Request schema"). A
 * commit-pinned ref (same `owner/name@<40-hex-lowercase-sha>` shape as the
 * reading request), an optional `target` (a card id or a file path; absent ⇒ a
 * bare run over all py2 candidates, R1.4), the spread of the in-scope reading
 * (`celtic` is rejected, matching the reading route), and the optional
 * literal-`true` demo marker.
 */
export const ResurrectRequestSchema = z
  .object({
    ref: z
      .string()
      .max(200)
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/),
    target: z.string().max(400).optional(),
    spread: z.enum(["fates", "necropsy"]),
    demo: z.literal(true).optional(),
  })
  .strict();

/**
 * The validated summary of a summon: public repo metadata only, never any
 * snapshot contents. Mirrors the `@necro/ui-crt` `SummonSummary` interface.
 * The ref reuses the oracle `RepoRefSchema` but tightens `sha` to exactly 40
 * lowercase hex (the interface still infers `sha: string`, so the conformance
 * assertion holds). `demo` is the optional literal-`true` demo marker.
 */
export const SummonSummarySchema = z
  .object({
    ref: RepoRefSchema.extend({ sha: z.string().regex(/^[0-9a-f]{40}$/) }),
    stars: z.number().int().nonnegative(),
    hasWorkflowsDir: z.boolean(),
    degradedFields: z.array(z.enum(["pulls", "release"])).readonly(),
    cache: z.enum(["hit", "miss"]),
    fileCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    demo: z.literal(true).optional(),
  })
  .strict()
  .readonly();

/** The final result of a reading: the summary paired with the oracle Reading. */
export const ReadingResponseSchema = z
  .object({ summary: SummonSummarySchema, reading: ReadingSchema })
  .strict()
  .readonly();

/** The error envelope every failing route returns: `{ error: { code, userMessage } }`, no `cause`. */
export const ErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: NecroErrorCodeSchema,
        userMessage: z.string().min(1).max(2000),
      })
      .strict(),
  })
  .strict();

// --- Compile-time conformance with the @necro/ui-crt interfaces (D2) -------
// These assignments fail typecheck if a schema drifts from the interface it
// must mirror. They are type-level only and erase at runtime.
const _summary: z.ZodType<SummonSummary, z.ZodTypeDef, unknown> =
  SummonSummarySchema;
const _response: z.ZodType<ReadingResponse, z.ZodTypeDef, unknown> =
  ReadingResponseSchema;
void _summary;
void _response;
