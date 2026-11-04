// src/registry/schema.ts
//
// Core primitive zod schemas for the Oracle Deck Engine. All runtime data
// passes through these schemas at boundaries; TypeScript types are inferred
// with `z.infer<typeof Schema>`.
//
// Note: NecroError / NecroErrorCodeSchema are defined in `src/util/errors.ts`,
// not here.

import { z } from "zod";

// --- CardId ---
export const CardIdSchema = z.enum([
  "judgement",
  "tower",
  "devil",
  "death",
  "wheel",
  "hermit",
  "hanged_man",
  "temperance",
  "justice",
  "moon",
  "star",
  "world",
]);
export type CardId = z.infer<typeof CardIdSchema>;

// --- Severity ---
export const SeveritySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type Severity = z.infer<typeof SeveritySchema>;

// --- Evidence ---
export const EvidenceSchema = z.object({
  kind: z.string().min(1),
  path: z.string().optional(),
  line: z.number().int().nonnegative().optional(),
  detail: z.string(),
  source: z.enum(["static", "github", "osv", "registry", "sandbox"]),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// --- CardDefinition (registry entry) ---
export const CardDefinitionSchema = z.object({
  id: z.string().min(1).max(40).describe("Snake_case card identifier"),
  numeral: z.string().min(1).describe("Roman numeral (e.g. 'XX', 'XVI')"),
  name: z.string().min(1).max(60).describe("Display name"),
  uprightMeaning: z
    .string()
    .min(1)
    .max(500)
    .describe("Technical upright description"),
  reversedMeaning: z
    .string()
    .min(1)
    .max(500)
    .describe("Technical reversed description"),
  weight: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("Vitality penalty weight; 0 for star and world"),
  linkedGrimoireIds: z
    .array(z.string().min(1).max(40))
    .max(20)
    .describe("Grimoire ids that can address this card"),
});
export type CardDefinition = z.infer<typeof CardDefinitionSchema>;

// --- CardDraw ---
export const CardDrawSchema = z.object({
  card: CardIdSchema,
  severity: SeveritySchema,
  orientation: z.enum(["upright", "reversed"]),
  evidence: z.array(EvidenceSchema),
  summary: z.string().describe("Short deterministic text, no LLM"),
  narration: z
    .string()
    .optional()
    .describe("LLM-written oracle voice narration; absent in oracle package"),
  grimoires: z.array(z.string()).describe("Grimoire ids applicable to this draw"),
});
export type CardDraw = z.infer<typeof CardDrawSchema>;

// --- SpreadPosition ---
export const SpreadPositionSchema = z.object({
  position: z
    .number()
    .int()
    .min(1)
    .describe("1-based position index in spread"),
  label: z.string().describe("Position name, e.g. 'The Corpse'"),
  draw: CardDrawSchema.nullable().describe("Null when void position"),
  description: z
    .string()
    .optional()
    .describe("Void sentinel description when draw is null"),
});
export type SpreadPosition = z.infer<typeof SpreadPositionSchema>;

// --- Verdict (for computeWorldDraw) ---
export const GateIdSchema = z.enum(["G1", "G2", "G3", "G4", "G5", "G6"]);
export type GateId = z.infer<typeof GateIdSchema>;

export const VerdictSchema = z.object({
  status: z.enum(["REVIVED", "UNDEAD", "STILL_DEAD"]),
  passedGates: z.array(GateIdSchema),
  failedGates: z.array(GateIdSchema),
});
export type Verdict = z.infer<typeof VerdictSchema>;
