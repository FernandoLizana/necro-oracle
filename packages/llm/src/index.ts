// @necro/llm — providers (bedrock, anthropic, openai, mock), cache, budget.
//
// Cross-package consumers import these only through this barrel. The Mock
// provider is the required, deterministic, network-free provider used by the
// local runner, tests, and Demo_Mode.
export const LLM_VERSION = "0.0.0";

// --- Mock provider (required; deterministic, no network) -------------------
export {
  createMockLlmPort,
  defaultMockText,
  type MockProviderOptions,
} from "./providers/mock.js";

// --- Completion cache (keyed by LlmRequest.cacheKey) -----------------------
export {
  createLlmCache,
  withCache,
  type LlmCache,
} from "./cache.js";

// --- Per-construct token/timeout budget helpers (R4.1) ---------------------
export {
  DEFAULT_LLM_BUDGET,
  makeBudget,
  withinBudget,
  type LlmBudget,
} from "./budget.js";
