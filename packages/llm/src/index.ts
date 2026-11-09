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

// --- OpenRouter provider (real; network via injectable fetch — A.2) --------
// The only network-capable provider. Lives outside the no-network guard set;
// tests inject `fetchImpl` and never open a socket. Mock stays the default.
export {
  createOpenRouterLlmPort,
  OPENROUTER_URL,
  NECRO_PUBLIC_URL,
  type OpenRouterOptions,
} from "./providers/openrouter.js";

// --- Completion cache (keyed by LlmRequest.cacheKey) -----------------------
export {
  createLlmCache,
  withCache,
  DEFAULT_LLM_CACHE_MAX_ENTRIES,
  type LlmCache,
} from "./cache.js";

// --- Per-construct token/timeout budget helpers (R4.1) ---------------------
export {
  DEFAULT_LLM_BUDGET,
  makeBudget,
  withinBudget,
  type LlmBudget,
} from "./budget.js";

// --- Usage / cost accounting (R6.1–R6.3): the "souls spent" aggregate ------
export {
  UsageRecordSchema,
  UsageAggregateSchema,
  sumUsage,
  type UsageRecord,
  type UsageAggregate,
  type UsageByModel,
} from "./usage/accounting.js";

// --- Prompt template version (participates in every cache key — R8.4) ------
// --- Prompt templates: the ONE source of truth for prompt text (A.4, A.5a) -
// Re-exported from `@necro/coven` (the owner) via `./prompts/templates.js`,
// which also adds the crypto-backed `deriveCacheKey`/`contentHashOf`. The
// `PROMPT_VERSION` re-export is unchanged for existing `@necro/llm` consumers.
export {
  PROMPT_VERSION,
  PROMPT_TEMPLATES,
  getTemplate,
  buildMessages,
  neutraliseDelimiters,
  cacheKeyParts,
  deriveCacheKey,
  contentHashOf,
  UNTRUSTED_OPEN,
  UNTRUSTED_CLOSE,
  type PromptPurpose,
  type PromptTemplate,
  type FewShotPair,
  type MessageInputs,
  type PromptMessage,
  type BuiltMessages,
  type CacheKeyInputs,
} from "./prompts/templates.js";

// --- Structured output: zod -> OpenAI-strict JSON Schema (R43.1) -----------
export {
  toStrictJsonSchema,
  STRIPPED_KEYWORDS,
  type StrictJsonSchema,
} from "./response/zod-to-schema.js";

// --- Structured output: parse + request-field assembly (R7.x, R43.2–R43.5) -
export {
  parseStructured,
  extractFirstJsonObject,
  structuredRequestFields,
  usageRecordFromResponse,
  type ParseStructuredResult,
  type StructuredRequestFields,
  type OpenRouterUsageResponse,
} from "./response/structured.js";

// --- Pure Model_Router: signal extraction + tier/id resolution (A.3) -------
export {
  extractDifficultyFlags,
  type RouterSignals,
  type DifficultyFlags,
} from "./router/signals.js";

export {
  routeModel,
  routeGenerate,
  resolveModel,
  FAST_DIAGNOSTIC_LIMIT,
  FAST_TOKEN_LIMIT,
  type ModelTier,
} from "./router/model-router.js";
