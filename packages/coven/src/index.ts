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

// --- Language_Pair_Registry (registry) -------------------------------------
// The guarded, in-memory pair -> grimoire binding the runner resolves at SELECT
// time, before any sandbox/LLM work. `createDefaultRegistry` is the documented
// registration point for the shipped `python2->python3` grimoire.
export {
  LanguagePairRegistry,
  createDefaultRegistry,
  PYTHON2_TO_PYTHON3,
} from "./registry.js";
