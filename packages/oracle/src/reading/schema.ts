// src/reading/schema.ts
//
// Reading schemas and ReadingOpts for the Oracle Deck Engine. A Reading is the
// top-level result of divining a repository snapshot: the drawn cards, the
// assigned spread, the computed vitality, and any per-detector errors.
//
// These schemas live in their own module (separate from the runReading
// orchestrator in ./run.ts) so that the browser-safe Client_Safe_Entry can
// import them without pulling in the orchestrator's Node/tree-sitter closure.

import { z } from "zod";
import { CardDrawSchema, SpreadPositionSchema } from "../registry/schema.js";
import { RepoRefSchema } from "../snapshot/types.js";

export const SpreadKindSchema = z.enum(["fates", "necropsy", "celtic"]);
export type SpreadKind = z.infer<typeof SpreadKindSchema>;

export const ReadingOptsSchema = z.object({
  spreadKind: SpreadKindSchema.default("necropsy"),
  registryData: z
    .instanceof(Map)
    .optional()
    .describe("Pre-fetched dep freshness for Tower detector"),
  osvData: z
    .array(z.unknown())
    .optional()
    .describe("Pre-fetched OSV vulnerabilities for Devil detector"),
  now: z
    .string()
    .describe(
      "ISO 8601 UTC string; used by all time-sensitive detectors. Never call Date.now() inside detectors."
    ),
});
export type ReadingOpts = z.infer<typeof ReadingOptsSchema>;

export const ReadingSchema = z.object({
  id: z.string().uuid().describe("UUID v4"),
  repo: RepoRefSchema,
  draws: z.array(CardDrawSchema),
  spread: z.array(SpreadPositionSchema),
  vitality: z.number().int().min(0).max(100),
  createdAt: z
    .string()
    .describe(
      "ISO 8601 UTC string; always equals opts.now, never the system clock"
    ),
  engineVersion: z.string().describe("Version from package.json"),
  errors: z
    .array(
      z.object({
        code: z.string(),
        userMessage: z.string(),
        cardId: z.string().optional(),
      })
    )
    .describe("Errors from individual detectors; empty when all succeed"),
});
export type Reading = z.infer<typeof ReadingSchema>;
