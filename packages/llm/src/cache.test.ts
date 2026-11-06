// @necro/llm — unit tests for the completion cache (task 2.2).
//
// The cache memoizes raw completion text by `LlmRequest.cacheKey`: the first
// time a key is seen `compute` runs and the result is returned with
// `cached: false`; every later request with the same key returns the stored
// text with `cached: true` and does NOT call `compute` again (R4.8). First
// write wins: re-deriving the same key never overwrites the stored entry and a
// different key is an independent entry.
//
// Pure in-memory — no network / LLM / sandbox.
//
// Validates: Requirements 4.8, 14.4

import { describe, expect, it, vi } from "vitest";

import { createLlmCache, withCache } from "./cache.js";

describe("R4.8, R14.4: LlmCache stores completion text by cacheKey", () => {
  it("starts empty and reports unseen keys", () => {
    const cache = createLlmCache();
    expect(cache.size).toBe(0);
    expect(cache.has("k")).toBe(false);
    expect(cache.get("k")).toBeUndefined();
  });

  it("stores on first write and reports the key thereafter", () => {
    const cache = createLlmCache();
    cache.set("k", "hello");
    expect(cache.has("k")).toBe(true);
    expect(cache.get("k")).toBe("hello");
    expect(cache.size).toBe(1);
  });

  it("first write wins: a later write for the same key is ignored", () => {
    const cache = createLlmCache();
    cache.set("k", "first");
    cache.set("k", "second");
    expect(cache.get("k")).toBe("first");
    expect(cache.size).toBe(1);
  });

  it("keeps distinct keys as independent entries", () => {
    const cache = createLlmCache();
    cache.set("a", "A");
    cache.set("b", "B");
    expect(cache.get("a")).toBe("A");
    expect(cache.get("b")).toBe("B");
    expect(cache.size).toBe(2);
  });
});

describe("R4.8, R14.4: withCache sets the cached flag and skips recompute on a hit", () => {
  it("misses on the first call: cached:false and compute runs once", () => {
    const cache = createLlmCache();
    const compute = vi.fn(() => "completion");

    const result = withCache(cache, { cacheKey: "k" }, compute);

    expect(result).toEqual({ text: "completion", cached: false });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(cache.get("k")).toBe("completion");
  });

  it("hits on a repeat of the same cacheKey: cached:true and compute is NOT called", () => {
    const cache = createLlmCache();
    const first = vi.fn(() => "completion");
    const second = vi.fn(() => "DIFFERENT");

    const r1 = withCache(cache, { cacheKey: "k" }, first);
    const r2 = withCache(cache, { cacheKey: "k" }, second);

    expect(r1).toEqual({ text: "completion", cached: false });
    // The stored text is returned verbatim; the second compute never runs.
    expect(r2).toEqual({ text: "completion", cached: true });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("treats a different cacheKey as a fresh miss", () => {
    const cache = createLlmCache();
    const a = vi.fn(() => "A");
    const b = vi.fn(() => "B");

    const ra = withCache(cache, { cacheKey: "a" }, a);
    const rb = withCache(cache, { cacheKey: "b" }, b);

    expect(ra).toEqual({ text: "A", cached: false });
    expect(rb).toEqual({ text: "B", cached: false });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("caches empty-string completions (distinguishes stored-empty from unseen)", () => {
    const cache = createLlmCache();
    const compute = vi.fn(() => "");

    const r1 = withCache(cache, { cacheKey: "k" }, compute);
    const r2 = withCache(cache, { cacheKey: "k" }, compute);

    expect(r1).toEqual({ text: "", cached: false });
    expect(r2).toEqual({ text: "", cached: true });
    expect(compute).toHaveBeenCalledTimes(1);
  });
});
