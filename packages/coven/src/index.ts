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
