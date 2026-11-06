// @necro/llm — per-construct token and timeout budget helpers.
//
// The LLM_Pass bounds every construct it sends to the model by a token budget
// and a timeout (R4.1). These helpers are pure: they produce the per-construct
// bounds a grimoire's `LlmStep.buildRequest` stamps onto each `LlmRequest`, and
// they never read the ambient clock or touch the network. Keeping them here
// (rather than inside a grimoire or the runner) gives every provider and
// grimoire one shared, testable definition of "within budget".

/** A per-construct budget: the token ceiling and wall-clock timeout for one request. */
export interface LlmBudget {
  /** Maximum tokens the model may spend on a single construct. */
  readonly maxTokens: number;
  /** Maximum wall-clock time, in milliseconds, for a single completion. */
  readonly timeoutMs: number;
}

/**
 * Default per-construct budget. Small on purpose: a residual construct is a
 * single Python 2 span, not a whole file, so a tight ceiling keeps spend
 * bounded and completions fast. Callers may override either field.
 */
export const DEFAULT_LLM_BUDGET: LlmBudget = {
  maxTokens: 512,
  timeoutMs: 20_000,
};

/**
 * Build a per-construct budget, filling unspecified fields from
 * {@link DEFAULT_LLM_BUDGET}. Both values must be finite and strictly positive;
 * a non-positive or non-finite bound is a programming error, not a runtime
 * condition, so it throws rather than silently clamping.
 */
export function makeBudget(overrides: Partial<LlmBudget> = {}): LlmBudget {
  const maxTokens = overrides.maxTokens ?? DEFAULT_LLM_BUDGET.maxTokens;
  const timeoutMs = overrides.timeoutMs ?? DEFAULT_LLM_BUDGET.timeoutMs;

  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw new RangeError(
      `maxTokens must be a finite positive number, received ${String(maxTokens)}`,
    );
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(
      `timeoutMs must be a finite positive number, received ${String(timeoutMs)}`,
    );
  }

  return { maxTokens, timeoutMs };
}

/**
 * Pure predicate: does a request's `(maxTokens, timeoutMs)` pair fit inside the
 * given budget? Used by the runner and tests to assert no construct is sent
 * over its per-construct ceiling (R4.1).
 */
export function withinBudget(
  req: { readonly maxTokens: number; readonly timeoutMs: number },
  budget: LlmBudget,
): boolean {
  return (
    req.maxTokens > 0 &&
    req.timeoutMs > 0 &&
    req.maxTokens <= budget.maxTokens &&
    req.timeoutMs <= budget.timeoutMs
  );
}
