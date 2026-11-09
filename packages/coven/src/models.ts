// @necro/coven — canonical zod data models and ritual types.
//
// This module owns the data-model contracts the Coven_Runner, grimoires, and
// the web route all speak (design: "Data Models"). `ports.ts` forward-declared
// minimal placeholders for several of these types so the port interfaces could
// typecheck in isolation (task 1.1); this file replaces them with the canonical
// zod-inferred types and `ports.ts` now imports from here. All models are
// zod-validated at every boundary (HTTP, LLM output, runner input/output).
//
// The feature reuses @necro/oracle's `NecroError` class unchanged and extends
// its machine-code set with the resurrection-specific codes this feature needs
// (design: "Error Handling").

import {
  NecroError,
  NecroErrorCodeSchema,
  type OsvData,
  type RegistryData,
  type RepoSnapshot,
  type Reading,
  type SpreadKind,
} from "@necro/oracle";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Error codes (design: "Error Handling")
//
// Reuse @necro/oracle's `NecroError` and extend its code set with the codes
// this feature introduces. Existing oracle codes (`RATE_LIMITED`,
// `VALIDATION_FAILED`, `NETWORK_TIMEOUT`, `UPSTREAM_UNAVAILABLE`, …) are reused
// as-is; the new codes below cover registry, re-diagnosis, budget, and demo
// failure modes.
// ---------------------------------------------------------------------------

/** Resurrection-specific machine codes not already in the oracle code set. */
export const CovenErrorCodeSchema = z.enum([
  "PAIR_UNKNOWN", // resolve() called with an unregistered language-pair id (R15.2)
  "PAIR_DUPLICATE", // register() called twice for the same id (R15.3)
  "REDIAGNOSIS_FAILED", // post-resurrection reading rejected (R6.5)
  "BUDGET_EXHAUSTED", // wall-clock / token / sandbox budget reached (R10.4)
  "DEMO_FIXTURE_MISSING", // a required demo fixture is missing/unreadable (R14.6)
]);

export type CovenErrorCode = z.infer<typeof CovenErrorCodeSchema>;

/**
 * The full machine-code set the engine can raise: every oracle code plus the
 * resurrection-specific codes above. Both schemas are plain `z.enum`s, so their
 * option lists compose into one enum — the single source of truth for a valid
 * `NecroError.code` on this feature's surface.
 */
export const EngineErrorCodeSchema = z.enum([
  ...NecroErrorCodeSchema.options,
  ...CovenErrorCodeSchema.options,
]);

export type EngineErrorCode = z.infer<typeof EngineErrorCodeSchema>;

/**
 * Construct a `NecroError` with any engine code (oracle or coven). The oracle's
 * `NecroError` constructor is typed to the oracle code union; this factory is
 * the single, controlled widening point so callers get a fully typed
 * `EngineErrorCode` surface while the reused class is left unmodified. The
 * runtime `code` field carries the coven code verbatim.
 */
export function covenError(
  code: EngineErrorCode,
  userMessage: string,
  cause?: unknown,
): NecroError {
  // `code` is validated by EngineErrorCodeSchema at call sites / boundaries;
  // the cast only bridges the reused oracle constructor's narrower type.
  return new NecroError(code as never, userMessage, cause);
}

// ---------------------------------------------------------------------------
// Language pair (design: "Language_Pair_Registry")
// ---------------------------------------------------------------------------

/** Language pair identifier, e.g. "python2->python3". */
export const LanguagePairIdSchema = z.custom<`${string}->${string}`>(
  (value) => typeof value === "string" && value.includes("->"),
  { message: "expected a language-pair id of the form '<from>-><to>'" },
);

export type LanguagePairId = z.infer<typeof LanguagePairIdSchema>;

// ---------------------------------------------------------------------------
// Resurrect target (design: RitualInput.target — "card id | file path | bare")
//
// The terminal `resurrect [<card-or-file>]` command's target: a bare run (all
// py2 candidates), a specific card id, or a specific file path (R1.1–R1.4).
// Parse-level only; semantic validation (card/file existence, py2
// classification) happens server-side during SELECT.
// ---------------------------------------------------------------------------

export const ResurrectTargetSchema = z.union([
  z.object({ kind: z.literal("bare") }).strict(),
  z.object({ kind: z.literal("card"), card: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("file"), path: z.string().min(1) }).strict(),
]);

export type ResurrectTarget = z.infer<typeof ResurrectTargetSchema>;

// ---------------------------------------------------------------------------
// Candidate_File (design: "Candidate_File")
// ---------------------------------------------------------------------------

export const CandidateFileSchema = z.object({
  path: z.string().min(1), // repo-relative, ends in ".py"
  before: z.string(), // Before_Content (from snapshot.contents)
  sizeBytes: z.number().int().nonnegative(),
  flaggedBy: z.array(z.string()), // card ids whose evidence referenced this path
});

export type CandidateFile = z.infer<typeof CandidateFileSchema>;

// ---------------------------------------------------------------------------
// ResidualEntry (design: "ResidualEntry")
// ---------------------------------------------------------------------------

export const ResidualEntrySchema = z.object({
  path: z.string().min(1), // source location: file (R8.1)
  line: z.number().int().nonnegative(), // 1-based source line (R8.1)
  construct: z.string().min(1), // the unconverted construct kind/text
  reason: z.enum([
    "parse_failed", // tree-sitter could not parse (R3.7)
    "no_transform", // no mechanical rule applied
    "llm_unavailable", // timeout / no key / breaker open (R4.5, R4.6)
    "llm_invalid_output", // failed zod after retry (R4.4)
    "output_unparseable", // produced content failed Target_Parser (R5.2)
    "not_validated", // VALIDATE budget reached (R5.8, R9.7)
    "incomplete", // ritual terminated before confirmation (R8.4)
  ]),
});

export type ResidualEntry = z.infer<typeof ResidualEntrySchema>;

// ---------------------------------------------------------------------------
// DiffLine + File_Result (design: "File_Result")
// ---------------------------------------------------------------------------

export const DiffLineSchema = z.object({
  kind: z.enum(["add", "remove", "context"]),
  text: z.string(),
});

export type DiffLine = z.infer<typeof DiffLineSchema>;

export const FileResultSchema = z.object({
  path: z.string().min(1),
  before: z.string(), // Before_Content
  after: z.string(), // After_Content (validated py3, or == before)
  diff: z.array(DiffLineSchema), // per-line before/after (R7.1)
  residuals: z.array(ResidualEntrySchema), // R8.1–R8.4
  fullyConverted: z.boolean(), // residuals.length === 0 (R8.3)
  validated: z.boolean(), // false ⇒ excluded from Patch (R5.8, R7.7)
});

export type FileResult = z.infer<typeof FileResultSchema>;

// ---------------------------------------------------------------------------
// Supporting grimoire/port types finalized here (placeholders in ports.ts)
// ---------------------------------------------------------------------------

/** Result of the Target_Parser validity check (R5.1). */
export const ValidationResultSchema = z.object({
  valid: z.boolean(), // zero error nodes ⇒ valid Python 3
  errorNodeCount: z.number().int().nonnegative(),
});

export type ValidationResult = z.infer<typeof ValidationResultSchema>;

/** Input a grimoire accepts for one file. */
export const GrimoireInputSchema = z.object({
  path: z.string().min(1),
  before: z.string(),
});

export type GrimoireInput = z.infer<typeof GrimoireInputSchema>;

/** One unconverted construct handed to the LLM step. */
export const LlmConstructInputSchema = z.object({
  path: z.string().min(1),
  construct: z.string().min(1),
  source: z.string(),
});

export type LlmConstructInput = z.infer<typeof LlmConstructInputSchema>;

/** A sanctioned divergence from byte-for-byte equivalence (grimoire-authoring). */
export const DivergenceEntrySchema = z.object({
  construct: z.string().min(1),
  note: z.string(),
});

export type DivergenceEntry = z.infer<typeof DivergenceEntrySchema>;

/** Append-only ledger event (coven-contracts: strictly increasing `seq`). */
export const LedgerEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  type: z.string().min(1),
  at: z.string(), // ISO timestamp from ClockPort
});

export type LedgerEvent = z.infer<typeof LedgerEventSchema>;

// ---------------------------------------------------------------------------
// Ritual result (design: "Ritual result")
// ---------------------------------------------------------------------------

export const ChangedCardSchema = z.object({
  card: z.string(),
  change: z.enum(["added", "removed", "severity", "orientation"]),
  improved: z.boolean(),
});

export type ChangedCard = z.infer<typeof ChangedCardSchema>;

export const RitualResultSchema = z.object({
  ritualId: z.string().uuid(),
  selectedCount: z.number().int().nonnegative(), // R1.1
  files: z.array(FileResultSchema),
  patch: z.string(), // unified diff over validated, changed files (R7.3)
  beforeVitality: z.number().int().min(0).max(100), // R6.2
  afterVitality: z.number().int().min(0).max(100).nullable(), // null if re-diagnosis failed (R6.5)
  vitalityDelta: z.number().int().nullable(), // after - before (R6.3), null on failure
  changedCards: z.array(ChangedCardSchema), // R6.4
  degraded: z.boolean(), // Degraded_Mode flag (R13.5)
  demo: z.boolean(), // [DEMO] labelling (R14.3)
});

export type RitualResult = z.infer<typeof RitualResultSchema>;

// ---------------------------------------------------------------------------
// Ritual input (design: "Coven_Runner")
//
// Not a zod schema: `snapshot`/`reading`/`spread` are already-validated oracle
// values threaded through from a completed reading, so re-parsing them at this
// boundary would duplicate the oracle's own validation. The runner validates
// the wire-level request upstream (the web route's request schema) and the
// oracle guarantees these values' shapes.
// ---------------------------------------------------------------------------

export interface RitualInput {
  readonly pairId: LanguagePairId;
  readonly snapshot: RepoSnapshot; // the summoned repo
  readonly reading: Reading; // the completed reading
  readonly target: ResurrectTarget; // card id | file path | bare
  readonly spread: SpreadKind; // same spread as the reading
  readonly now: string; // ISO; from ClockPort
  readonly demo: boolean;

  /**
   * The SAME external-data context the pre-resurrection reading was divined
   * with — the Tower detector's dependency-freshness map (R6.*). It is carried
   * here so re-diagnosis can re-run `runReading` on the overlay snapshot with
   * identical external data, making the before/after comparison apples-to-
   * apples: only the resurrected source changes the draws, not a difference in
   * what the two readings knew about dependencies. `ReadingOpts.registryData`
   * accepts this `Map`; omit the key entirely (not `undefined`) when the
   * pre-reading had none, so re-diagnosis mirrors the original exactly.
   */
  readonly registryData?: RegistryData;

  /**
   * The SAME OSV vulnerability list the pre-resurrection reading was divined
   * with — consumed by the Devil detector. Carried here for the same apples-to-
   * apples reason as {@link registryData}: re-diagnosis re-runs the reading on
   * the overlay snapshot with this identical list so the Devil draw only moves
   * when the resurrected source moves it. `ReadingOpts.osvData` accepts this
   * array; omit the key entirely when the pre-reading had none.
   */
  readonly osvData?: OsvData;

  /**
   * Item 24: the per-request BYOK model override (design D.2 / R40). Present
   * ONLY when the route decided soulSource = YOURS; the chunked LLM_Pass passes
   * it to `ModelRouterPort.resolveModel(tier, override)` so a user-supplied
   * `model fast|strong <id>` is honoured for THIS reading. Omit the key
   * entirely (exactOptionalPropertyTypes) on ORACLE so the env-configured tier
   * models are used unchanged.
   */
  readonly modelOverride?: { readonly fast?: string; readonly strong?: string };
}
