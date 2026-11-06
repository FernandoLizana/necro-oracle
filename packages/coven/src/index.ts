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
  // Supporting types (placeholders finalized in models.ts, task 1.2)
  type LanguagePairId,
  type ResidualEntry,
  type ValidationResult,
  type GrimoireInput,
  type FileResult,
  type LlmConstructInput,
  type DivergenceEntry,
  type LedgerEvent,
} from "./ports.js";
