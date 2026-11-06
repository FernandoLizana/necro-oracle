// @necro/coven — agents, ledger, gates, runners (ports only, no direct adapters)
export const COVEN_VERSION = "0.0.0";

// --- Port interfaces and the adapter-free Grimoire contract (ports) --------
// Cross-package consumers import these only through this barrel.
export {
  // Port interfaces
  type LlmRequest,
  type LlmResult,
  type LlmPort,
  type SandboxPort,
  type LedgerPort,
  type ClockPort,
  type RitualPorts,
  // Grimoire interface and its parts
  type FixResult,
  type Fixer,
  type FixerContext,
  type LlmStep,
  type Grimoire,
} from "./ports.js";

// --- Canonical zod data models and ritual types (models) -------------------
// The single source of truth for the shared data-model contracts. The port
// interfaces above import these same types from ./models.js, so there is no
// duplicate declaration or name collision.
export {
  // Error codes (reuses @necro/oracle's NecroError)
  CovenErrorCodeSchema,
  type CovenErrorCode,
  EngineErrorCodeSchema,
  type EngineErrorCode,
  covenError,
  // Language pair / resurrect target
  LanguagePairIdSchema,
  type LanguagePairId,
  ResurrectTargetSchema,
  type ResurrectTarget,
  // Candidate / residual / diff / file result
  CandidateFileSchema,
  type CandidateFile,
  ResidualEntrySchema,
  type ResidualEntry,
  DiffLineSchema,
  type DiffLine,
  FileResultSchema,
  type FileResult,
  // Supporting grimoire/port models
  ValidationResultSchema,
  type ValidationResult,
  GrimoireInputSchema,
  type GrimoireInput,
  LlmConstructInputSchema,
  type LlmConstructInput,
  DivergenceEntrySchema,
  type DivergenceEntry,
  LedgerEventSchema,
  type LedgerEvent,
  // Ritual result / input
  ChangedCardSchema,
  type ChangedCard,
  RitualResultSchema,
  type RitualResult,
  type RitualInput,
} from "./models.js";

// --- Per-file diff and unified-patch generation (diff) ---------------------
// Pure, adapter-free. `lineDiff` produces a `DiffLine[]` per file (R7.1/R7.2);
// `buildPatch` emits a single round-tripping unified-diff over the validated,
// changed files only (R7.3–R7.5, R7.7).
export { lineDiff, buildPatch } from "./diff.js";

// --- Candidate_File selection (select) -------------------------------------
// Pure, adapter-free. `selectCandidates` derives the ascending-by-path
// Candidate_Files a Ritual processes from a completed reading and a parsed
// `ResurrectTarget`, applying the py2-evidence rule and the 1 MB / 50-file /
// repo-size guards (R1.2-R1.5, R2.1-R2.2, R2.5-R2.7). It returns the candidate
// set plus the oracle-voice skip-notes the runner streams.
export {
  selectCandidates,
  MAX_CANDIDATES,
  type SelectionResult,
} from "./select.js";

// --- Language_Pair_Registry (registry) -------------------------------------
// The guarded, in-memory pair -> grimoire binding the runner resolves at SELECT
// time, before any sandbox/LLM work. `createDefaultRegistry` is the documented
// registration point for the shipped `python2->python3` grimoire.
export {
  LanguagePairRegistry,
  createDefaultRegistry,
  PYTHON2_TO_PYTHON3,
} from "./registry.js";

// --- Vitality re-diagnosis via snapshot overlay (rediagnose) ---------------
// Pure, adapter-free (imports @necro/oracle only). `rediagnose` overlays the
// validated+changed After_Content into a copy of the summoned RepoSnapshot,
// re-divines it with the same spread via `runReading`, and reports
// before/after vitality, the signed delta, and the changed-card set. On
// post-reading failure it returns a typed REDIAGNOSIS_FAILED error with
// after/delta nulled, never discarding the produced File_Results (R6.1–R6.5).
export { rediagnose, type RediagnoseResult } from "./rediagnose.js";
