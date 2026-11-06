// @necro/llm — unit tests for the per-construct budget helpers (task 2.2).
//
// `makeBudget` fills unspecified fields from DEFAULT_LLM_BUDGET and rejects a
// non-finite or non-positive bound (a programming error, not a runtime one).
// `withinBudget` is a pure predicate: a request's (maxTokens, timeoutMs) pair
// fits iff both are strictly positive and neither exceeds the budget (R4.1).
//
// Pure computation — no network / LLM / sandbox.
//
// Validates: Requirements 4.7, 4.8, 14.4

import { describe, expect, it } from "vitest";

import { DEFAULT_LLM_BUDGET, makeBudget, withinBudget } from "./budget.js";

describe("makeBudget: defaults and validation", () => {
  it("returns the default budget when given no overrides", () => {
    expect(makeBudget()).toEqual(DEFAULT_LLM_BUDGET);
  });

  it("fills only the unspecified field from the default", () => {
    expect(makeBudget({ maxTokens: 128 })).toEqual({
      maxTokens: 128,
      timeoutMs: DEFAULT_LLM_BUDGET.timeoutMs,
    });
    expect(makeBudget({ timeoutMs: 5_000 })).toEqual({
      maxTokens: DEFAULT_LLM_BUDGET.maxTokens,
      timeoutMs: 5_000,
    });
  });

  it("is deterministic: the same overrides yield equal budgets", () => {
    expect(makeBudget({ maxTokens: 256, timeoutMs: 1_000 })).toEqual(
      makeBudget({ maxTokens: 256, timeoutMs: 1_000 }),
    );
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws RangeError for a non-positive/non-finite maxTokens (%s)",
    (bad) => {
      expect(() => makeBudget({ maxTokens: bad })).toThrow(RangeError);
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws RangeError for a non-positive/non-finite timeoutMs (%s)",
    (bad) => {
      expect(() => makeBudget({ timeoutMs: bad })).toThrow(RangeError);
    },
  );
});

describe("withinBudget: the fit predicate", () => {
  const budget = makeBudget({ maxTokens: 512, timeoutMs: 20_000 });

  it("accepts a request strictly under both bounds", () => {
    expect(withinBudget({ maxTokens: 100, timeoutMs: 1_000 }, budget)).toBe(true);
  });

  it("accepts a request exactly on both bounds", () => {
    expect(withinBudget({ maxTokens: 512, timeoutMs: 20_000 }, budget)).toBe(true);
  });

  it("rejects a request over the token ceiling", () => {
    expect(withinBudget({ maxTokens: 513, timeoutMs: 1_000 }, budget)).toBe(false);
  });

  it("rejects a request over the timeout ceiling", () => {
    expect(withinBudget({ maxTokens: 100, timeoutMs: 20_001 }, budget)).toBe(false);
  });

  it("rejects a non-positive token request", () => {
    expect(withinBudget({ maxTokens: 0, timeoutMs: 1_000 }, budget)).toBe(false);
  });

  it("rejects a non-positive timeout request", () => {
    expect(withinBudget({ maxTokens: 100, timeoutMs: 0 }, budget)).toBe(false);
  });
});
